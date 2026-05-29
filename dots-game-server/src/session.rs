use crate::game::Game;
use crate::types::Color;
use tokio::sync::mpsc;

pub struct GameSession {
    pub game: Game,
    pub player1_tx: Option<mpsc::UnboundedSender<String>>,
    pub player2_tx: Option<mpsc::UnboundedSender<String>>,
    pub player1_connected: bool,
    pub player2_connected: bool,
    pub rematch_vote_p1: bool,
    pub rematch_vote_p2: bool,
}

impl GameSession {
    pub fn new(p1_color: Color, p2_color: Color) -> Self {
        GameSession {
            game: Game::new(15, 10, p1_color, p2_color),
            player1_tx: None,
            player2_tx: None,
            player1_connected: false,
            player2_connected: false,
            rematch_vote_p1: false,
            rematch_vote_p2: false,
        }
    }

    pub fn is_full(&self) -> bool {
        self.player1_connected && self.player2_connected
    }

    fn has_moves(&self) -> bool {
        self.game.grid.iter().any(|row| row.iter().any(|c| !matches!(c, crate::types::Cell::Empty)))
    }

    pub fn add_player(&mut self, tx: mpsc::UnboundedSender<String>) -> Option<u8> {
        // If the session was kept alive after both disconnected mid-game, start fresh.
        if !self.player1_connected && !self.player2_connected && self.has_moves() {
            self.game = Game::new(15, 10, self.game.player1_color, self.game.player2_color);
        }
        if !self.player1_connected {
            self.player1_tx = Some(tx);
            self.player1_connected = true;
            Some(1)
        } else if !self.player2_connected {
            self.player2_tx = Some(tx);
            self.player2_connected = true;
            Some(2)
        } else {
            None
        }
    }

    pub fn broadcast(&self, message: &str) {
        if let Some(tx) = &self.player1_tx {
            let _ = tx.send(message.to_string());
        }
        if let Some(tx) = &self.player2_tx {
            let _ = tx.send(message.to_string());
        }
    }

    pub fn register_rematch_vote(&mut self, player_number: u8) -> (bool, bool, bool) {
        if player_number == 1 {
            self.rematch_vote_p1 = true;
        } else {
            self.rematch_vote_p2 = true;
        }
        let both = self.rematch_vote_p1 && self.rematch_vote_p2;
        (self.rematch_vote_p1, self.rematch_vote_p2, both)
    }

    pub fn restart_game(&mut self) {
        let p1 = self.game.player1_color;
        let p2 = self.game.player2_color;
        self.game = Game::new(15, 10, p1, p2);
        self.rematch_vote_p1 = false;
        self.rematch_vote_p2 = false;
    }
}
