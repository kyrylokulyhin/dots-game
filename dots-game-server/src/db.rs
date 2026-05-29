use sqlx::{SqlitePool, sqlite::{SqliteConnectOptions, SqlitePoolOptions}};
use std::path::Path;

pub async fn create_pool(db_path: &str) -> Result<SqlitePool, sqlx::Error> {
    if let Some(parent) = Path::new(db_path).parent() {
        if !parent.as_os_str().is_empty() {
            let _ = std::fs::create_dir_all(parent);
        }
    }

    let options = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;

    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS completed_games (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            game_code TEXT NOT NULL,
            winner   TEXT,
            score_p1 INTEGER NOT NULL,
            score_p2 INTEGER NOT NULL,
            reason   TEXT NOT NULL,
            finished_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )"#,
    )
    .execute(&pool)
    .await?;

    Ok(pool)
}

pub async fn record_completed_game(
    pool: &SqlitePool,
    game_code: &str,
    winner: Option<&str>,
    score_p1: u32,
    score_p2: u32,
    reason: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO completed_games (game_code, winner, score_p1, score_p2, reason) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .bind(game_code)
    .bind(winner)
    .bind(score_p1 as i64)
    .bind(score_p2 as i64)
    .bind(reason)
    .execute(pool)
    .await?;
    Ok(())
}
