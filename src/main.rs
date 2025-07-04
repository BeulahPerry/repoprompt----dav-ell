use actix_cors::Cors;
use actix_web::{get, post, web, App, HttpResponse, HttpRequest, HttpServer};
use actix_web::http::header;
use rust_embed::RustEmbed; // Import rust-embed
use mime_guess; // For determining MIME types
use ignore::gitignore::Gitignore;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::env;
use std::fs::{self, File};
use std::io::BufReader;
use std::path::{Path, PathBuf};
use rustls_pemfile::{certs, pkcs8_private_keys};
use tokio::fs as tokio_fs;
use rustls::ServerConfig;
use futures::stream::{self, StreamExt}; // Keep futures for batch processing

#[derive(RustEmbed)]
#[folder = "public/"]
struct Asset; // Embed the public directory

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
    let resolved_path = PathBuf::from(requested_path)
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize path: {}", e))?;
    let root = PathBuf::from("/").canonicalize().unwrap();
    if !resolved_path.starts_with(&root) {
        return Err("Invalid path: Path traversal detected.".to_string());
    }
    Ok(resolved_path)
}

fn natural_compare(a: &str, b: &str) -> std::cmp::Ordering {
    natord::compare(a, b)
}

fn build_tree(path: &Path, ig: &Gitignore) -> Result<HashMap<String, TreeNode>, String> {
    let mut tree = HashMap::new();
    let entries = fs::read_dir(path).map_err(|e| format!("Failed to read directory: {}", e))?;
    let mut dirents = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| format!("Directory entry error: {}", e))?;
        let entry_path = entry.path();
        let relative_path = entry_path.strip_prefix(path).unwrap();
        if ig.matched(relative_path, entry_path.is_dir()).is_ignore() {
            continue;
        }
        dirents.push(entry);
    }

    dirents.sort_by(|a, b| {
        let a_is_dir = a.path().is_dir();
        let b_is_dir = b.path().is_dir();
        // Sort directories before files. `true` (is_dir) is "greater than" `false`.
        // To sort directories first, we sort `is_dir` in descending order by comparing `b` to `a`.
        b_is_dir.cmp(&a_is_dir).then_with(|| {
            natural_compare(
                &a.file_name().to_string_lossy(),
                &b.file_name().to_string_lossy(),
            )
        })
    });

    for dirent in dirents {
        let entry_path = dirent.path();
        let name = dirent.file_name().to_string_lossy().to_string();
        if entry_path.is_dir() {
            let sub_ig_path = entry_path.join(".gitignore");
            let sub_ig = if sub_ig_path.exists() {
                Gitignore::new(sub_ig_path).0
            } else {
                ig.clone()
            };
            let children = build_tree(&entry_path, &sub_ig)?;
            if !children.is_empty() {
                tree.insert(
                    name,
                    TreeNode {
                        node_type: "folder".to_string(),
                        path: entry_path.to_string_lossy().to_string(),
                        children: Some(children),
                    },
                );
            }
        } else {
            tree.insert(
                name,
                TreeNode {
                    node_type: "file".to_string(),
                    path: entry_path.to_string_lossy().to_string(),
                    children: None,
                },
            );
        }
    }
    Ok(tree)
}

#[get("/api/directory")]
async fn get_directory(query: web::Query<DirectoryQuery>) -> HttpResponse {
    let requested_path = query.path.clone().unwrap_or_else(|| env::current_dir().unwrap().to_string_lossy().to_string());
    let dir_path = match validate_path(&requested_path) {
        Ok(p) => p,
        Err(e) => return HttpResponse::BadRequest().json(json!({ "success": false, "error": e })),
    };

    let ig_path = dir_path.join(".gitignore");
    let ig = if ig_path.exists() {
        Gitignore::new(ig_path).0
    } else {
        Gitignore::empty()
    };

    match build_tree(&dir_path, &ig) {
        Ok(tree) => HttpResponse::Ok().json(json!({ "success": true, "tree": tree, "root": dir_path.to_string_lossy().to_string() })),
        Err(e) => HttpResponse::BadRequest().json(json!({ "success": false, "error": e })),
    }
}

#[get("/api/file")]
async fn get_file(query: web::Query<DirectoryQuery>) -> HttpResponse {
    let file_path = match query.path.as_ref() {
        Some(p) => p,
        None => return HttpResponse::BadRequest().json(json!({ "success": false, "error": "Path parameter is required" })),
    };
    let file_path = match validate_path(file_path) {
        Ok(p) => p,
        Err(e) => return HttpResponse::BadRequest().json(json!({ "success": false, "error": e })),
    };

    match fs::read_to_string(&file_path) {
        Ok(content) => HttpResponse::Ok().json(json!({ "success": true, "content": content })),
        Err(e) => HttpResponse::BadRequest().json(json!({ "success": false, "error": e.to_string() })),
    }
}

#[post("/api/files")]
async fn get_files_batch(body: web::Json<FilesRequest>) -> HttpResponse {
    let paths = body.paths.clone();
    if paths.is_empty() {
        return HttpResponse::BadRequest().json(json!({ "success": false, "error": "Paths array is required and cannot be empty" }));
    }

    let concurrency_limit = 50;
    let mut results = HashMap::new();
    let mut stream = stream::iter(paths).map(|path| {
        async move {
            let validated_path = match validate_path(&path) {
                Ok(p) => p,
                Err(e) => return (path, FileResult { success: false, content: None, error: Some(e) }),
            };
            match tokio_fs::read_to_string(&validated_path).await {
                Ok(content) => (path, FileResult { success: true, content: Some(content), error: None }),
                Err(e) => (path, FileResult { success: false, content: None, error: Some(e.to_string()) }),
            }
        }
    }).buffer_unordered(concurrency_limit);

    while let Some((path, result)) = stream.next().await {
        results.insert(path, result);
    }

    HttpResponse::Ok().json(json!({ "success": true, "files": results }))
}

#[get("/api/connect")]
async fn connect(_req: HttpRequest) -> HttpResponse {
    let port = env::var("PORT").unwrap_or_else(|_| "3000".to_string());
    HttpResponse::Ok().json(json!({
        "success": true,
        "status": "Server is running",
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "port": port
    }))
}

#[get("/api/config")]
async fn get_config() -> HttpResponse {
    // This endpoint might not be needed anymore if refreshInterval was only for SSE
    // For now, keep it, but it might be removed later if unused.
    let refresh_interval = env::var("REFRESH_INTERVAL")
        .unwrap_or_else(|_| "10000".to_string())
        .parse::<u64>()
        .unwrap_or(10000);
    HttpResponse::Ok().json(json!({ "success": true, "refreshInterval": refresh_interval }))
}

// Handler to serve embedded static files
async fn serve_asset(req: HttpRequest) -> actix_web::Result<HttpResponse> {
    let path = if req.path() == "/" {
        "index.html"
    } else {
        &req.path()[1..] // Remove leading '/'
    };
    match Asset::get(path) {
        Some(content) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            Ok(HttpResponse::Ok()
                .content_type(mime.as_ref())
                .body(content.data.into_owned()))
        }
        None => Ok(HttpResponse::NotFound().body("404 Not Found")),
    }
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    env_logger::init_from_env(env_logger::Env::new().default_filter_or("info"));
    dotenv::dotenv().ok();

    let port = env::var("PORT").unwrap_or_else(|_| "3000".to_string()).parse::<u16>().unwrap();
    let use_https = env::var("USE_HTTPS").unwrap_or_else(|_| "false".to_string()) == "true";
    let allowed_origins: Vec<String> = env::var("ALLOWED_ORIGINS")
        .unwrap_or_else(|_| "https://repoprompt.netlify.app".to_string())
        .split(',')
        .map(String::from)
        .collect();

    let server = HttpServer::new(move || {
        let mut cors = Cors::default();
        for origin in &allowed_origins {
            cors = cors.allowed_origin(origin);
        }
        cors = cors
            .allowed_methods(vec!["GET", "POST", "OPTIONS"])
            .allowed_headers(vec![
                header::CONTENT_TYPE,
                header::HeaderName::from_static("ngrok-skip-browser-warning"),
            ])
            .max_age(3600);

        App::new()
            .wrap(cors)
            .service(get_directory)
            .service(get_file)
            .service(get_files_batch)
            .service(connect)
            .service(get_config)
            .default_service(web::to(serve_asset)) // Serve embedded files as default
    });

    if use_https {
        let cert_file = File::open("server.cert").expect("Failed to open server.cert");
        let key_file = File::open("server.key").expect("Failed to open server.key");

        let cert_chain: Result<Vec<rustls::pki_types::CertificateDer<'static>>, _> = certs(&mut BufReader::new(cert_file)).collect();
        let cert_chain = cert_chain.map_err(|e| format!("Failed to parse certificate: {}", e)).expect("Failed to parse certificate");

        let keys: Result<Vec<rustls::pki_types::PrivatePkcs8KeyDer<'static>>, _> = pkcs8_private_keys(&mut BufReader::new(key_file)).collect();
        let keys = keys.map_err(|e| format!("Failed to parse private key: {}", e)).expect("Failed to parse private key");
        let private_key = keys.into_iter().next().expect("No private key found");

        let config = ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(cert_chain, rustls::pki_types::PrivateKeyDer::Pkcs8(private_key))
            .expect("Failed to build TLS config");

        server.bind_rustls_0_23(("0.0.0.0", port), config)?
            .run()
            .await
    } else {
        server.bind(("0.0.0.0", port))?
            .run()
            .await
    }
}