mod db;
mod game;
mod handlers;
mod session;
mod types;

use axum::{routing::get, Router};
use handlers::AppState;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tower_http::cors::CorsLayer;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "dots_game_server=info".into()),
        )
        .init();

    let db_path = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "./data/dots_game.db".to_string());
    let pool = db::create_pool(&db_path).await.expect("Failed to init DB");

    let state = AppState {
        sessions: Arc::new(Mutex::new(HashMap::new())),
        db: pool,
    };

    let app = Router::new()
        .route("/", get(handlers::hello_handler))
        .route("/ws/:game_code", get(handlers::websocket_handler))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let host = std::env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".to_string());
    let addr = format!("{}:{}", host, port);

    tracing::info!("Server running on http://{}", addr);
    tracing::info!("WebSocket available at ws://{}/ws/{{game_code}}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
