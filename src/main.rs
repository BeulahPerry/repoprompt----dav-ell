use actix_cors::Cors;
use actix_web::{get, post, web, App, HttpResponse, HttpRequest, HttpServer, middleware};
use actix_web::http::header::{self, HeaderName};
use rust_embed::RustEmbed;
use mime_guess;
use ignore::gitignore::Gitignore;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::env;
use std::fs::{self, File as FsFile};
use std::io::BufReader;
use std::path::{Path, PathBuf};
use rustls_pemfile::{certs, pkcs8_private_keys};
use tokio::fs as tokio_fs;
use rustls::ServerConfig;
use futures::stream::{self, StreamExt};
use tree_sitter::{Parser, Language, Query, QueryCursor}; 
use std::error::Error;
use path_clean::PathClean;
use tree_sitter_javascript;
use streaming_iterator::StreamingIterator;
use log::{info, debug, warn};
use std::time::Instant;

#[derive(RustEmbed)]
#[folder = "public/"]
struct Asset;

#[derive(Serialize)]
struct TreeNode {
    #[serde(rename = "type")]
    node_type: String,
    path: String,
    children: Option<HashMap<String, TreeNode>>,
}

#[derive(Deserialize)]
struct DirectoryQuery {
    path: Option<String>,
}

#[derive(Serialize)]
struct FileResult {
    success: bool,
    content: Option<String>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct FilesRequest {
    paths: Vec<String>,
}

fn validate_path(requested_path: &str) -> Result<PathBuf, String> {
    let base_path = PathBuf::from(requested_path);
    if !base_path.exists() {
        return Err(format!("Path does not exist: {}", requested_path));
    }
    let resolved_path = base_path
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize path: {}", e))?;
    
    // For security, you might want to restrict access to certain directories.
    // This example allows access to any valid path on the system.
    Ok(resolved_path)
}

fn natural_compare(a: &str, b: &str) -> std::cmp::Ordering {
    natord::compare(a, b)
}

fn analyze_dependencies(
    root_path: &Path,
    tree: &HashMap<String, TreeNode>,
) -> Result<HashMap<String, Vec<String>>, Box<dyn Error>> {
    info!("Starting dependency analysis for '{}'...", root_path.display());
    let start_time = Instant::now();
    let mut dependency_graph = HashMap::new();
    let mut files_to_scan = Vec::new();

    fn collect_files(node: &HashMap<String, TreeNode>, files: &mut Vec<String>) {
        for (_, child) in node {
            if child.node_type == "file" {
                files.push(child.path.clone());
            }
            if let Some(children) = &child.children {
                collect_files(children, files);
            }
        }
    }
    collect_files(tree, &mut files_to_scan);

    let language_js: Language = tree_sitter_javascript::LANGUAGE.into();
    let mut parser = Parser::new();
    parser.set_language(&language_js).expect("Failed to load JS grammar");

    let query_src = r#"
(import_statement source: (string (string_fragment) @path))
(call_expression
    function: (identifier) @_fn
    arguments: (arguments (string (string_fragment) @path))
    (#eq? @_fn "require"))
"#;
    let query = Query::new(&language_js, query_src).expect("Failed to compile query");

    let js_like_files: Vec<_> = files_to_scan.iter()
        .filter(|file_path_str| {
            let file_path = PathBuf::from(file_path_str);
            file_path.extension().map_or(false, |e| e == "js" || e == "jsx" || e == "ts" || e == "tsx")
        })
        .collect();
    
    debug!("Found {} JavaScript/TypeScript files to scan for dependencies.", js_like_files.len());

    for file_path_str in js_like_files {
        let file_path = PathBuf::from(file_path_str);
        debug!("Scanning file for dependencies: {}", file_path.display());

        if let Ok(content) = fs::read_to_string(&file_path) {
            if let Some(tree) = parser.parse(content.as_bytes(), None) {
                let mut cursor = QueryCursor::new();
                let mut matches_iter = cursor.matches(&query, tree.root_node(), content.as_bytes());
                while let Some(mat) = matches_iter.next() {
                    for cap in mat.captures {
                        let cap_name = query.capture_names()[cap.index as usize];
                        if cap_name == "path" {
                            let path_node = cap.node;
                            let import_path_str = &content[path_node.byte_range()];
                            debug!("Found potential import '{}' in '{}'", import_path_str, file_path.display());
                            if let Some(parent_dir) = file_path.parent() {
                                let possible_exts = ["", ".js", ".jsx", ".ts", ".tsx", "/index.js", "/index.jsx", "/index.ts", "/index.tsx"];
                                for ext in possible_exts.iter() {
                                    let resolved_path = parent_dir.join(format!("{}{}", import_path_str, ext)).clean();
                                    if resolved_path.is_file() && resolved_path.starts_with(root_path) {
                                        let resolved_path_str = resolved_path.to_string_lossy().to_string();
                                        dependency_graph
                                            .entry(file_path_str.clone())
                                            .or_insert_with(Vec::new)
                                            .push(resolved_path_str);
                                        break;
                                    }
                                }
                            }
                            break;  // Only one @path per match
                        }
                    }
                }
            }
        }
    }

    let duration = start_time.elapsed();
    info!(
        "Dependency analysis for '{}' finished in {:.2?}. Found dependencies for {} files.",
        root_path.display(),
        duration,
        dependency_graph.len()
    );
    Ok(dependency_graph)
}

fn build_tree(path: &Path, ig: &Gitignore) -> Result<HashMap<String, TreeNode>, String> {
    debug!("Building file tree for directory: {}", path.display());
    let mut tree = HashMap::new();
    let entries = fs::read_dir(path).map_err(|e| format!("Failed to read directory: {}", e))?;
    let mut dirents = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        if ig.matched(&entry.path(), entry.path().is_dir()).is_ignore() {
            continue;
        }
        dirents.push(entry);
    }

    dirents.sort_by(|a, b| {
        let a_is_dir = a.file_type().map_or(false, |ft| ft.is_dir());
        let b_is_dir = b.file_type().map_or(false, |ft| ft.is_dir());
        if a_is_dir != b_is_dir {
            return b_is_dir.cmp(&a_is_dir);
        }
        natural_compare(&a.file_name().to_string_lossy(), &b.file_name().to_string_lossy())
    });

    for entry in dirents {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            let children = build_tree(&path, ig)?;
            let node = TreeNode {
                node_type: "folder".to_string(),
                path: path.to_string_lossy().to_string(),
                children: Some(children),
            };
            tree.insert(name, node);
        } else {
            let node = TreeNode {
                node_type: "file".to_string(),
                path: path.to_string_lossy().to_string(),
                children: None,
            };
            tree.insert(name, node);
        }
    }
    Ok(tree)
}

#[get("/api/connect")]
async fn connect() -> HttpResponse {
    HttpResponse::Ok().json(json!({ "success": true, "message": "Connection successful" }))
}

#[get("/api/directory")]
async fn get_directory_contents(query: web::Query<DirectoryQuery>) -> HttpResponse {
    let base_path_str = query.path.clone().unwrap_or_else(|| ".".to_string());
    info!("Received request for directory contents: {}", base_path_str);
    let start_time = Instant::now();

    let path = match validate_path(&base_path_str) {
        Ok(p) => p,
        Err(e) => {
            warn!("Path validation failed for '{}': {}", base_path_str, e);
            return HttpResponse::Ok().json(json!({ "success": false, "error": e }));
        }
    };
    info!("Processing canonicalized path: {}", path.display());

    let (gitignore, _) = Gitignore::new(&path.join(".gitignore"));

    let tree = match build_tree(&path, &gitignore) {
        Ok(t) => t,
        Err(e) => {
            warn!("Failed to build tree for '{}': {}", path.display(), e);
            return HttpResponse::Ok().json(json!({ "success": false, "error": e }));
        }
    };

    let dependency_graph = match analyze_dependencies(&path, &tree) {
        Ok(deps) => deps,
        Err(e) => {
            warn!("Dependency analysis failed for path '{}': {}", path.display(), e);
            HashMap::new()
        }
    };

    let duration = start_time.elapsed();
    info!("Successfully processed directory '{}' in {:.2?}.", path.display(), duration);
    HttpResponse::Ok().json(json!({
        "success": true,
        "root": path.to_str().unwrap_or(""),
        "tree": tree,
        "dependencyGraph": dependency_graph,
    }))
}

#[get("/api/file")]
async fn get_file_content(query: web::Query<DirectoryQuery>) -> HttpResponse {
    let path_str = match &query.path {
        Some(p) => p,
        None => {
            warn!("Received file content request with no path.");
            return HttpResponse::BadRequest().json(json!({"success": false, "error": "Path is required"}));
        }
    };
    debug!("Reading file content for: {}", path_str);
    match tokio_fs::read_to_string(path_str).await {
        Ok(content) => {
            debug!("Successfully read file: {}", path_str);
            HttpResponse::Ok().json(json!({"success": true, "content": content}))
        },
        Err(e) => {
            warn!("Failed to read file '{}': {}", path_str, e);
            HttpResponse::InternalServerError().json(json!({"success": false, "error": e.to_string()}))
        },
    }
}

#[post("/api/files")]
async fn get_files_content(req: web::Json<FilesRequest>) -> HttpResponse {
    info!("Received batch request for {} files.", req.paths.len());
    let start_time = Instant::now();
    let results: HashMap<String, FileResult> = stream::iter(&req.paths)
        .then(|path_str| async move {
            debug!("Reading file in batch: {}", path_str);
            let result = match tokio_fs::read_to_string(path_str).await {
                Ok(content) => FileResult {
                    success: true,
                    content: Some(content),
                    error: None,
                },
                Err(e) => {
                    warn!("Failed to read file '{}' in batch: {}", path_str, e);
                    FileResult {
                        success: false,
                        content: None,
                        error: Some(e.to_string()),
                    }
                },
            };
            (path_str.clone(), result)
        })
        .collect()
        .await;

    let duration = start_time.elapsed();
    info!("Batch file request processed in {:.2?}.", duration);
    HttpResponse::Ok().json(json!({
        "success": true,
        "files": results
    }))
}

async fn static_handler(req: HttpRequest) -> HttpResponse {
    let path = req.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    debug!("Serving static asset: {}", path);

    match Asset::get(path) {
        Some(content) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            HttpResponse::Ok()
                .content_type(mime.as_ref())
                .body(content.data.into_owned())
        }
        None => HttpResponse::NotFound().body("404 Not Found"),
    }
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // Initialize env_logger. You can override the log level with the RUST_LOG environment variable.
    // e.g., `RUST_LOG=debug cargo run` for more verbose output.
    env::set_var("RUST_LOG", env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string()));
    env_logger::init();

    let port = env::var("PORT").unwrap_or_else(|_| "3000".to_string());
    let addr = format!("0.0.0.0:{}", port);
    info!("Server running at http://{}", addr);

    let mut http_server = HttpServer::new(|| {
        let cors = Cors::default()
            .allow_any_origin()
            .allowed_methods(vec!["GET", "POST"])
            .allowed_headers(vec![header::AUTHORIZATION, header::ACCEPT, header::CONTENT_TYPE, HeaderName::from_static("ngrok-skip-browser-warning")])
            .supports_credentials()
            .max_age(3600);
        
        App::new()
            .wrap(cors)
            .wrap(middleware::Logger::default())
            .service(connect)
            .service(get_directory_contents)
            .service(get_file_content)
            .service(get_files_content)
            .default_service(web::to(static_handler))
    });

    if let (Ok(cert_path), Ok(key_path)) = (env::var("CERT_PATH"), env::var("KEY_PATH")) {
        if !Path::new(&cert_path).exists() || !Path::new(&key_path).exists() {
             warn!("Warning: CERT_PATH or KEY_PATH points to a non-existent file. Starting without HTTPS.");
        } else {
            info!("Attempting to start HTTPS server...");
            let cert_file = &mut BufReader::new(FsFile::open(cert_path)?);
            let key_file = &mut BufReader::new(FsFile::open(key_path)?);
            let cert_chain = certs(cert_file).map(|r| r.unwrap()).collect();
            let mut keys = pkcs8_private_keys(key_file).map(|r| r.unwrap()).collect::<Vec<_>>();

            if keys.is_empty() {
                return Err(std::io::Error::new(std::io::ErrorKind::Other, "No private keys found in key file"));
            }

            let config = ServerConfig::builder()
                .with_no_client_auth()
                .with_single_cert(cert_chain, keys.remove(0).into())
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            
            info!("Successfully configured TLS. Binding to https://{}", addr);
            http_server = http_server.bind_rustls_0_23(addr, config)?;
        }
    } else {
        info!("No CERT_PATH or KEY_PATH found in env. Starting plain HTTP server.");
        http_server = http_server.bind(addr)?;
    }

    http_server.run().await
}