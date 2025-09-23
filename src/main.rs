use actix_cors::Cors;
use actix_web::{get, post, web, App, HttpResponse, HttpRequest, HttpServer, middleware};
use actix_web::http::header::{self, HeaderName};
use rust_embed::RustEmbed;
use mime_guess;
use ignore::gitignore::Gitignore;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};
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

/// Helper function to resolve a relative import/module path to a file path.
/// Tries appending possible suffixes and checks if the resolved path exists within the root.
fn resolve_relative_path(
    parent_dir: &Path,
    import_str: &str,
    root_path: &Path,
    suffixes: &[&str],
) -> Option<String> {
    for suffix in suffixes {
        let candidate = parent_dir.join(format!("{}{}", import_str, suffix)).clean();
        if candidate.is_file() && candidate.starts_with(root_path) {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    None
}

fn process_python_module(
    module_str: &str,
    file_path_str: &String,
    file_path: &Path,
    root_path: &Path,
    dependency_graph: &mut HashMap<String, Vec<String>>,
) {
     let clean_import = if module_str.starts_with('.') {
        // Relative import like 'from .foo import ...' or 'from ..foo.bar import ...'
        let num_dots = module_str.find(|c| c != '.').unwrap_or(module_str.len());
        
        let mut path_prefix = String::new();
        if num_dots > 1 {
            path_prefix.push_str(&"../".repeat(num_dots - 1));
        }

        let module_part = &module_str[num_dots..];
        format!("{}{}", path_prefix, module_part.replace('.', "/"))
    } else {
        // Absolute import
        module_str.replace('.', "/")
    };
    
    debug!("Found Python import '{}', processed to '{}' in '{}'", module_str, clean_import, file_path.display());
    if let Some(parent_dir) = file_path.parent() {
        let possible_exts = [".py", "/__init__.py"];
        if let Some(resolved) = resolve_relative_path(parent_dir, &clean_import, root_path, &possible_exts) {
            dependency_graph
                .entry(file_path_str.clone())
                .or_insert_with(Vec::new)
                .push(resolved);
        }
    }
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

    // JavaScript/TypeScript
    let language_js: Language = tree_sitter_javascript::LANGUAGE.into();
    let mut parser_js = Parser::new();
    if let Err(e) = parser_js.set_language(&language_js) {
        warn!("Failed to set language for JavaScript: {}. JS/TS dependency analysis will be skipped.", e);
    } else {
        let query_js_src = r#"
(import_statement source: (string (string_fragment) @path))
(call_expression
    function: (identifier) @_fn
    arguments: (arguments (string (string_fragment) @path))
    (#eq? @_fn "require"))
"#;
        match Query::new(&language_js, query_js_src) {
            Ok(query_js) => {
                let js_like_files: Vec<_> = files_to_scan.iter()
                    .filter(|file_path_str| {
                        let file_path = PathBuf::from(file_path_str);
                        file_path.extension().map_or(false, |e| e == "js" || e == "jsx" || e == "ts" || e == "tsx")
                    })
                    .collect();
                
                debug!("Found {} JavaScript/TypeScript files to scan for dependencies.", js_like_files.len());

                for file_path_str in js_like_files {
                    let file_path = PathBuf::from(file_path_str);
                    debug!("Scanning JS/TS file for dependencies: {}", file_path.display());

                    if let Ok(content) = fs::read_to_string(&file_path) {
                        if let Some(tree) = parser_js.parse(content.as_bytes(), None) {
                            let mut cursor = QueryCursor::new();
                            let mut matches_iter = cursor.matches(&query_js, tree.root_node(), content.as_bytes());
                            while let Some(mat) = matches_iter.next() {
                                for cap in mat.captures {
                                    let cap_name = query_js.capture_names()[cap.index as usize];
                                    if cap_name == "path" {
                                        let path_node = cap.node;
                                        let import_path_str = &content[path_node.byte_range()];
                                        let clean_import = import_path_str.trim_matches('"').trim_matches('\'');
                                        debug!("Found JS/TS import '{}' in '{}'", clean_import, file_path.display());
                                        if let Some(parent_dir) = file_path.parent() {
                                            let possible_exts = ["", ".js", ".jsx", ".ts", ".tsx", "/index.js", "/index.jsx", "/index.ts", "/index.tsx"];
                                            if let Some(resolved) = resolve_relative_path(parent_dir, clean_import, root_path, &possible_exts) {
                                                dependency_graph
                                                    .entry(file_path_str.clone())
                                                    .or_insert_with(Vec::new)
                                                    .push(resolved);
                                            }
                                        }
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            },
            Err(e) => {
                warn!("Failed to compile JavaScript tree-sitter query: {}. JS/TS dependency analysis will be skipped.", e);
            }
        }
    }

    // Python
    let language_py: Language = tree_sitter_python::LANGUAGE.into();
    let mut parser_py = Parser::new();
    if let Err(e) = parser_py.set_language(&language_py) {
        warn!("Failed to set language for Python: {}. Python dependency analysis will be skipped.", e);
    } else {
        let query_py_src = r#"
; Pattern 0: import foo
(import_statement (dotted_name) @module)

; Pattern 1: from foo.bar import ... and from .foo import ...
(import_from_statement
    module_name: [
        (dotted_name) @module
        ; This captures the entire relative_import node (e.g., ".foo")
        ; if it has a module name part.
        (relative_import (dotted_name) . ) @module
    ]
)

; Pattern 2: from . import foo
(import_from_statement
    ; capture the relative_import node as @dots
    module_name: (relative_import) @dots
    name: [
        (dotted_name) @name
        (aliased_import name: (dotted_name) @name)
    ]
    ; predicate to ensure it only contains dots, making it mutually
    ; exclusive with the relative import part of Pattern 1.
    (#match? @dots "^\.+$")
)
"#;
        match Query::new(&language_py, query_py_src) {
            Ok(query_py) => {
                let py_files: Vec<_> = files_to_scan.iter()
                    .filter(|file_path_str| {
                        let file_path = PathBuf::from(file_path_str);
                        file_path.extension().map_or(false, |e| e == "py")
                    })
                    .collect();
                
                debug!("Found {} Python files to scan for dependencies.", py_files.len());

                for file_path_str in py_files {
                    let file_path = PathBuf::from(file_path_str);
                    debug!("Scanning Python file for dependencies: {}", file_path.display());

                    if let Ok(content) = fs::read_to_string(&file_path) {
                        if let Some(tree) = parser_py.parse(content.as_bytes(), None) {
                            let mut cursor = QueryCursor::new();
                            let mut matches_iter = cursor.matches(&query_py, tree.root_node(), content.as_bytes());
                            
                            while let Some(mat) = matches_iter.next() {
                                match mat.pattern_index {
                                    0 | 1 => { // import a.b, from a.b import c, from .a import c
                                        for cap in mat.captures {
                                            if query_py.capture_names()[cap.index as usize] == "module" {
                                                let module_str = &content[cap.node.byte_range()];
                                                process_python_module(module_str, file_path_str, &file_path, root_path, &mut dependency_graph);
                                            }
                                        }
                                    },
                                    2 => { // from . import a, from .. import b
                                        let mut dots_opt = None;
                                        let mut names = Vec::new();
                                        for cap in mat.captures {
                                            let cap_name = query_py.capture_names()[cap.index as usize];
                                            let text = &content[cap.node.byte_range()];
                                            match cap_name {
                                                "dots" => dots_opt = Some(text),
                                                "name" => names.push(text),
                                                _ => {}
                                            }
                                        }

                                        if let Some(dots) = dots_opt {
                                            for name in names {
                                                let combined_module = format!("{}{}", dots, name);
                                                process_python_module(&combined_module, file_path_str, &file_path, root_path, &mut dependency_graph);
                                            }
                                        }
                                    },
                                    _ => {} // Unhandled pattern
                                }
                            }
                        }
                    }
                }
            },
            Err(e) => {
                warn!("Failed to compile Python tree-sitter query: {}. Python dependency analysis will be skipped.", e);
            }
        }
    }

    // Rust
    let language_rs: Language = tree_sitter_rust::LANGUAGE.into();
    let mut parser_rs = Parser::new();
    if let Err(e) = parser_rs.set_language(&language_rs) {
        warn!("Failed to set language for Rust: {}. Rust dependency analysis will be skipped.", e);
    } else {
        let query_rs_src = r#"
(mod_item
    name: (identifier) @module
)
(use_declaration
    argument: [
        (identifier) @module
        (scoped_identifier) @module
    ]
)
"#;
        match Query::new(&language_rs, query_rs_src) {
            Ok(query_rs) => {
                let rs_files: Vec<_> = files_to_scan.iter()
                    .filter(|file_path_str| {
                        let file_path = PathBuf::from(file_path_str);
                        file_path.extension().map_or(false, |e| e == "rs")
                    })
                    .collect();
                
                debug!("Found {} Rust files to scan for dependencies.", rs_files.len());

                for file_path_str in rs_files {
                    let file_path = PathBuf::from(file_path_str);
                    debug!("Scanning Rust file for dependencies: {}", file_path.display());

                    if let Ok(content) = fs::read_to_string(&file_path) {
                        if let Some(tree) = parser_rs.parse(content.as_bytes(), None) {
                            let mut cursor = QueryCursor::new();
                            let mut matches_iter = cursor.matches(&query_rs, tree.root_node(), content.as_bytes());
                            while let Some(mat) = matches_iter.next() {
                                for cap in mat.captures {
                                    let cap_name = query_rs.capture_names()[cap.index as usize];
                                    if cap_name == "module" {
                                        let path_node = cap.node;
                                        let module_str = &content[path_node.byte_range()];
                                        
                                        let mut clean_import = if let Some(stripped) = module_str.strip_prefix("self::") {
                                            stripped.to_string()
                                        } else if let Some(stripped) = module_str.strip_prefix("super::") {
                                            format!("../{}", stripped)
                                        } else {
                                            module_str.to_string()
                                        };
                                        clean_import = clean_import.replace("::", "/");

                                        debug!("Found Rust module/use '{}', processed to '{}' in '{}'", module_str, clean_import, file_path.display());
                                        if let Some(parent_dir) = file_path.parent() {
                                            let possible_exts = [".rs", "/mod.rs"];
                                            if let Some(resolved) = resolve_relative_path(parent_dir, &clean_import, root_path, &possible_exts) {
                                                dependency_graph
                                                    .entry(file_path_str.clone())
                                                    .or_insert_with(Vec::new)
                                                    .push(resolved);
                                            }
                                        }
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            },
            Err(e) => {
                warn!("Failed to compile Rust tree-sitter query: {}. Rust dependency analysis will be skipped.", e);
            }
        }
    }

    // C++
    let language_cpp: Language = tree_sitter_cpp::LANGUAGE.into();
    let mut parser_cpp = Parser::new();
    if let Err(e) = parser_cpp.set_language(&language_cpp) {
        warn!("Failed to set language for C++: {}. C++ dependency analysis will be skipped.", e);
    } else {
        let query_cpp_src = r#"
(preproc_include
    path: (string_literal (string_content) @header)
)
"#;
        match Query::new(&language_cpp, query_cpp_src) {
            Ok(query_cpp) => {
                let cpp_files: Vec<_> = files_to_scan.iter()
                    .filter(|file_path_str| {
                        let file_path = PathBuf::from(file_path_str);
                        let ext = file_path.extension().and_then(|s| s.to_str());
                        matches!(ext, Some("cpp" | "c" | "h" | "hpp" | "hxx"))
                    })
                    .collect();
                
                debug!("Found {} C++ files to scan for dependencies.", cpp_files.len());

                for file_path_str in cpp_files {
                    let file_path = PathBuf::from(file_path_str);
                    debug!("Scanning C++ file for dependencies: {}", file_path.display());

                    if let Ok(content) = fs::read_to_string(&file_path) {
                        if let Some(tree) = parser_cpp.parse(content.as_bytes(), None) {
                            let mut cursor = QueryCursor::new();
                            let mut matches_iter = cursor.matches(&query_cpp, tree.root_node(), content.as_bytes());
                            while let Some(mat) = matches_iter.next() {
                                for cap in mat.captures {
                                    let cap_name = query_cpp.capture_names()[cap.index as usize];
                                    if cap_name == "header" {
                                        let path_node = cap.node;
                                        let header_str = &content[path_node.byte_range()];
                                        let clean_import = header_str.trim_matches('"').trim_matches('\'');
                                        debug!("Found C++ include '{}' in '{}'", clean_import, file_path.display());
                                        if let Some(parent_dir) = file_path.parent() {
                                            let possible_exts = ["", ".h", ".hpp", ".hxx"];
                                            if let Some(resolved) = resolve_relative_path(parent_dir, clean_import, root_path, &possible_exts) {
                                                dependency_graph
                                                    .entry(file_path_str.clone())
                                                    .or_insert_with(Vec::new)
                                                    .push(resolved);
                                            }
                                        }
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            },
            Err(e) => {
                warn!("Failed to compile C++ tree-sitter query: {}. C++ dependency analysis will be skipped.", e);
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

fn collect_transitive_init_deps(
    init_file: &str,
    original_graph: &HashMap<String, Vec<String>>,
    final_deps: &mut HashSet<String>,
    visited: &mut HashSet<String>,
) {
    if !visited.insert(init_file.to_string()) {
        return; // Cycle detected or already visited
    }

    if let Some(init_direct_deps) = original_graph.get(init_file) {
        for dep in init_direct_deps {
            final_deps.insert(dep.clone());
            if Path::new(dep).file_name().and_then(|s| s.to_str()) == Some("__init__.py") {
                collect_transitive_init_deps(dep, original_graph, final_deps, visited);
            }
        }
    }
}

fn expand_init_dependencies(
    dependency_graph: &HashMap<String, Vec<String>>,
) -> HashMap<String, Vec<String>> {
    let mut expanded_graph = HashMap::new();

    for (file, direct_deps) in dependency_graph {
        let mut final_deps: HashSet<String> = direct_deps.iter().cloned().collect();
        
        for dep in direct_deps {
            if Path::new(dep).file_name().and_then(|s| s.to_str()) == Some("__init__.py") {
                let mut visited = HashSet::new();
                collect_transitive_init_deps(dep, dependency_graph, &mut final_deps, &mut visited);
            }
        }
        
        let mut sorted_deps: Vec<String> = final_deps.into_iter().collect();
        sorted_deps.sort_by(|a, b| natord::compare(a, b));
        expanded_graph.insert(file.clone(), sorted_deps);
    }

    expanded_graph
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

    let expanded_graph = expand_init_dependencies(&dependency_graph);

    let duration = start_time.elapsed();
    info!("Successfully processed directory '{}' in {:.2?}.", path.display(), duration);
    HttpResponse::Ok().json(json!({
        "success": true,
        "root": path.to_str().unwrap_or(""),
        "tree": tree,
        "dependencyGraph": expanded_graph,
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
    debug!("Reading file: {}", path_str);
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