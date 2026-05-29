use crate::db;
use crate::session::GameSession;
use crate::types::*;
use axum::extract::{Path, State, ws::{WebSocket, WebSocketUpgrade, Message}};
use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

pub type GameSessions = Arc<Mutex<HashMap<String, Arc<Mutex<GameSession>>>>>;

#[derive(Clone)]
pub struct AppState {
    pub sessions: GameSessions,
    pub db: sqlx::SqlitePool,
}

pub async fn hello_handler() -> &'static str {
    "Hello from Rust! 🦀"
}

pub async fn websocket_handler(
    ws: WebSocketUpgrade,
    Path(game_code): Path<String>,
    State(state): State<AppState>,
) -> impl axum::response::IntoResponse {
    let db_pool = state.db.clone();
    ws.on_upgrade(move |socket| handle_socket(socket, game_code, state.sessions, db_pool))
}

async fn handle_socket(
    socket: WebSocket,
    game_code: String,
    sessions: GameSessions,
    db_pool: sqlx::SqlitePool,
) {
    let (mut sender, mut receiver) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    let mut send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if sender.send(Message::Text(msg)).await.is_err() {
                break;
            }
        }
    });

    let session = {
        let mut sessions = sessions.lock().await;
        sessions
            .entry(game_code.clone())
            .or_insert_with(|| Arc::new(Mutex::new(GameSession::new(Color::Blue, Color::Yellow))))
            .clone()
    };

    let player_number = {
        let mut s = session.lock().await;
        match s.add_player(tx.clone()) {
            Some(num) => num,
            None => {
                let msg = ServerMessage::Error { message: "Game is full".to_string() };
                let _ = tx.send(serde_json::to_string(&msg).unwrap());
                tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
                return;
            }
        }
    };
    let player_color = if player_number == 1 { Color::Blue } else { Color::Yellow };

    tracing::info!(game_code, player_number, "Player joined");

    let join_msg = ServerMessage::PlayerJoined { game_code: game_code.clone(), player_number };
    let _ = tx.send(serde_json::to_string(&join_msg).unwrap());

    {
        let s = session.lock().await;
        if s.is_full() {
            let started = ServerMessage::GameStarted { game_code: game_code.clone() };
            s.broadcast(&serde_json::to_string(&started).unwrap());
            s.broadcast(&serde_json::to_string(&build_state_msg(&s, &game_code)).unwrap());
        }
    }

    let tx_err = tx.clone();
    let session_clone = session.clone();
    let gc = game_code.clone();
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(Message::Text(text))) = receiver.next().await {
            let Ok(client_msg) = serde_json::from_str::<ClientMessage>(&text) else { continue };

            match client_msg {
                ClientMessage::PlaceDot { x, y } => {
                    let mut s = session_clone.lock().await;
                    if s.game.current_turn != player_color {
                        let err = ServerMessage::Error { message: "Not your turn".to_string() };
                        let _ = tx_err.send(serde_json::to_string(&err).unwrap());
                        continue;
                    }
                    match s.game.place_dot(x, y) {
                        Ok(outcome) => {
                            let move_msg = ServerMessage::MoveResult {
                                game_code: gc.clone(),
                                success: true,
                                message: outcome.message,
                                captured_count: outcome.captured_count,
                                loop_points: outcome.loop_points,
                                capturing_color: outcome.capturing_color,
                            };
                            s.broadcast(&serde_json::to_string(&move_msg).unwrap());
                            s.broadcast(&serde_json::to_string(&build_state_msg(&s, &gc)).unwrap());

                            if let Some(info) = outcome.game_over {
                                let over_msg = ServerMessage::GameOver { game_code: gc.clone(), info: info.clone() };
                                s.broadcast(&serde_json::to_string(&over_msg).unwrap());
                                let db = db_pool.clone();
                                let code = gc.clone();
                                tokio::spawn(async move {
                                    let winner_str = info.winner.map(|c| match c {
                                        Color::Blue => "Blue",
                                        Color::Yellow => "Yellow",
                                        Color::Pink => "Pink",
                                    });
                                    if let Err(e) = db::record_completed_game(&db, &code, winner_str, info.score_p1, info.score_p2, &info.reason).await {
                                        tracing::warn!(error = %e, "Failed to record completed game");
                                    }
                                });
                            }
                        }
                        Err(msg) => {
                            let err = ServerMessage::Error { message: msg };
                            let _ = tx_err.send(serde_json::to_string(&err).unwrap());
                        }
                    }
                }

                ClientMessage::PlayAgainRequest => {
                    let mut s = session_clone.lock().await;
                    if !s.game.ended { continue; }
                    let pn = if player_color == Color::Blue { 1u8 } else { 2u8 };
                    let (v1, v2, both) = s.register_rematch_vote(pn);
                    let rematch = ServerMessage::RematchStatus { game_code: gc.clone(), p1_voted: v1, p2_voted: v2 };
                    s.broadcast(&serde_json::to_string(&rematch).unwrap());
                    if both {
                        s.restart_game();
                        let restarted = ServerMessage::GameRestarted { game_code: gc.clone() };
                        s.broadcast(&serde_json::to_string(&restarted).unwrap());
                        s.broadcast(&serde_json::to_string(&build_state_msg(&s, &gc)).unwrap());
                    }
                }
            }
        }
    });

    tokio::select! {
        _ = &mut send_task => recv_task.abort(),
        _ = &mut recv_task => send_task.abort(),
    }

    // Cleanup on disconnect
    let session_arc = {
        let lock = sessions.lock().await;
        lock.get(&game_code).cloned()
    };
    let mut remove = false;
    if let Some(arc) = session_arc {
        let mut s = arc.lock().await;
        if player_number == 1 {
            s.player1_connected = false;
            s.player1_tx = None;
        } else {
            s.player2_connected = false;
            s.player2_tx = None;
        }
        remove = !s.player1_connected && !s.player2_connected;
        tracing::info!(game_code, player_number, "Player disconnected");
    }
    if remove {
        sessions.lock().await.remove(&game_code);
        tracing::info!(game_code, "Session removed");
    }
}

fn build_state_msg(s: &GameSession, game_code: &str) -> ServerMessage {
    ServerMessage::GameState {
        game_code: game_code.to_string(),
        grid: s.game.grid.clone(),
        width: s.game.width,
        height: s.game.height,
        current_turn: s.game.current_turn,
        score_p1: s.game.score_p1,
        score_p2: s.game.score_p2,
        player1_color: s.game.player1_color,
        player2_color: s.game.player2_color,
        ended: s.game.ended,
    }
}
