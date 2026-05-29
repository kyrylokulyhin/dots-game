use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, PartialEq, Debug, Serialize, Deserialize)]
pub enum Color {
    Blue,
    Yellow,
    Pink,
}

#[derive(Clone, Copy, PartialEq, Debug, Serialize, Deserialize)]
pub enum Cell {
    Empty,
    Occupied(Color),
    Captured(Color),
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ClientMessage {
    PlaceDot { x: usize, y: usize },
    PlayAgainRequest,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ServerMessage {
    GameState {
        game_code: String,
        grid: Vec<Vec<Cell>>,
        width: usize,
        height: usize,
        current_turn: Color,
        score_p1: u32,
        score_p2: u32,
        player1_color: Color,
        player2_color: Color,
        ended: bool,
    },
    PlayerJoined { game_code: String, player_number: u8 },
    OpponentJoined { game_code: String },
    GameStarted { game_code: String },
    GameRestarted { game_code: String },
    RematchStatus { game_code: String, p1_voted: bool, p2_voted: bool },
    MoveResult {
        game_code: String,
        success: bool,
        message: String,
        captured_count: u32,
        loop_points: Option<Vec<(usize, usize)>>,
        capturing_color: Color,
    },
    GameOver { game_code: String, info: GameOverInfo },
    Error { message: String },
}

/// Internal return value from `Game::place_dot`.
pub struct MoveOutcome {
    pub message: String,
    pub captured_count: u32,
    pub loop_points: Option<Vec<(usize, usize)>>,
    pub capturing_color: Color,
    pub game_over: Option<GameOverInfo>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct GameOverInfo {
    pub winner: Option<Color>,
    pub score_p1: u32,
    pub score_p2: u32,
    pub reason: String,
}

pub struct CaptureInfo {
    pub count: u32,
    pub loop_points: Option<Vec<(usize, usize)>>,
}
