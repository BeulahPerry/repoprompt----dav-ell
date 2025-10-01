use crate::dependency_analyzer::{analyze_dependencies, expand_init_dependencies};
use crate::file_system::{build_tree, validate_path};
use crate::models::{DirectoryQuery, FileResult, FilesRequest};
use actix_web::{get, post, web, HttpRequest, HttpResponse};
use futures::stream::{self, StreamExt};
use ignore::gitignore::Gitignore;
use log::{debug, info, warn};
use rust_embed::RustEmbed;
use serde_json::json;
use std::collections::HashMap;
use std::time::Instant;
use tokio::fs as tokio_fs;

#[derive(RustEmbed)]
#[folder = "public/"]
struct Asset;

#[get("/api/connect")]
pub async fn connect() -> HttpResponse {
    HttpResponse::Ok().json(json!({ "success": true, "message": "Connection successful" }))
}

#[get("/api/directory")]
pub async fn get_directory_contents(query: web::Query<DirectoryQuery>) -> HttpResponse {
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

    let duration = start_time.elapsed();
    info!("Successfully processed directory '{}' in {:.2?}.", path.display(), duration);
    HttpResponse::Ok().json(json!({
        "success": true,
        "root": path.to_str().unwrap_or(""),
        "tree": tree,
    }))
}

#[get("/api/dependencies")]
pub async fn get_dependencies(query: web::Query<DirectoryQuery>) -> HttpResponse {
    let base_path_str = query.path.clone().unwrap_or_else(|| ".".to_string());
    info!("Received request for dependencies: {}", base_path_str);
    let start_time = Instant::now();

    let path = match validate_path(&base_path_str) {
        Ok(p) => p,
        Err(e) => {
            warn!("Path validation failed for '{}': {}", base_path_str, e);
            return HttpResponse::Ok().json(json!({ "success": false, "error": e }));
        }
    };
    info!("Processing dependency analysis for: {}", path.display());

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
    info!("Successfully processed dependencies for '{}' in {:.2?}.", path.display(), duration);
    HttpResponse::Ok().json(json!({
        "success": true,
        "root": path.to_str().unwrap_or(""),
        "dependencyGraph": expanded_graph,
    }))
}

#[get("/api/file")]
pub async fn get_file_content(query: web::Query<DirectoryQuery>) -> HttpResponse {
    let path_str = match &query.path {
        Some(p) => p,
        None => {
            warn!("Received file content request with no path.");
            return HttpResponse::BadRequest()
                .json(json!({"success": false, "error": "Path is required"}));
        }
    };
    debug!("Reading file: {}", path_str);
    match tokio_fs::read_to_string(path_str).await {
        Ok(content) => {
            debug!("Successfully read file: {}", path_str);
            HttpResponse::Ok().json(json!({"success": true, "content": content}))
        }
        Err(e) => {
            warn!("Failed to read file '{}': {}", path_str, e);
            HttpResponse::InternalServerError()
                .json(json!({"success": false, "error": e.to_string()}))
        }
    }
}

#[post("/api/files")]
pub async fn get_files_content(req: web::Json<FilesRequest>) -> HttpResponse {
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
                }
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

pub async fn static_handler(req: HttpRequest) -> HttpResponse {
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