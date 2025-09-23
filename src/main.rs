use actix_cors::Cors;
use actix_web::{web, App, HttpServer, middleware};
use actix_web::http::header::{self, HeaderName};
use log::{info, warn};
use rustls::ServerConfig;
use rustls_pemfile::{certs, pkcs8_private_keys};
use std::env;
use std::fs::File as FsFile;
use std::io::BufReader;
use std::path::Path;

// Declare application modules
mod dependency_analyzer;
mod file_system;
mod handlers;
mod models;
mod utils;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // Initialize env_logger. You can override the log level with the RUST_LOG environment variable.
    // e.g., `RUST_LOG=debug cargo run` for more verbose output.
    env::set_var("RUST_LOG", env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string()));
    env_logger::init();

    let port = env::var("PORT").unwrap_or_else(|_| "3000".to_string());
    let addr = format!("0.0.0.0:{}", port);
    info!("Server starting at http://{}", addr);

    let mut http_server = HttpServer::new(|| {
        let cors = Cors::default()
            .allow_any_origin()
            .allowed_methods(vec!["GET", "POST"])
            .allowed_headers(vec![
                header::AUTHORIZATION,
                header::ACCEPT,
                header::CONTENT_TYPE,
                HeaderName::from_static("ngrok-skip-browser-warning"),
            ])
            .supports_credentials()
            .max_age(3600);

        App::new()
            .wrap(cors)
            .wrap(middleware::Logger::default())
            .service(handlers::connect)
            .service(handlers::get_directory_contents)
            .service(handlers::get_file_content)
            .service(handlers::get_files_content)
            .default_service(web::to(handlers::static_handler))
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
                return Err(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    "No private keys found in key file",
                ));
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