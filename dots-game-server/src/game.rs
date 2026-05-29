use crate::types::{Cell, Color, CaptureInfo, MoveOutcome, GameOverInfo};
use std::collections::{HashSet, VecDeque};

pub struct Game {
    pub grid: Vec<Vec<Cell>>,
    pub width: usize,
    pub height: usize,
    pub player1_color: Color,
    pub player2_color: Color,
    pub current_turn: Color,
    pub score_p1: u32,
    pub score_p2: u32,
    pub ended: bool,
}

impl Game {
    pub fn new(width: usize, height: usize, p1_color: Color, p2_color: Color) -> Self {
        Game {
            grid: vec![vec![Cell::Empty; width]; height],
            width,
            height,
            player1_color: p1_color,
            player2_color: p2_color,
            current_turn: p1_color,
            score_p1: 0,
            score_p2: 0,
            ended: false,
        }
    }

    pub fn place_dot(&mut self, x: usize, y: usize) -> Result<MoveOutcome, String> {
        if x >= self.width || y >= self.height {
            return Err(format!("Position ({}, {}) is out of bounds", x, y));
        }
        if self.grid[y][x] != Cell::Empty {
            return Err("Cell is already occupied".to_string());
        }
        if self.ended {
            return Err("Game already ended".to_string());
        }

        let capturing_color = self.current_turn;
        self.grid[y][x] = Cell::Occupied(self.current_turn);
        let capture_info = self.check_captures(x, y);
        self.switch_turn();

        let game_over = self.determine_game_over();
        if game_over.is_some() {
            self.ended = true;
        }

        Ok(MoveOutcome {
            message: format!("Dot placed. {} dots captured", capture_info.count),
            captured_count: capture_info.count,
            loop_points: capture_info.loop_points,
            capturing_color,
            game_over,
        })
    }

    fn switch_turn(&mut self) {
        self.current_turn = if self.current_turn == self.player1_color {
            self.player2_color
        } else {
            self.player1_color
        };
    }

    fn get_neighbors(&self, x: usize, y: usize) -> Vec<(usize, usize)> {
        let directions = [
            (-1, -1), (0, -1), (1, -1),
            (-1,  0),          (1,  0),
            (-1,  1), (0,  1), (1,  1),
        ];
        directions.iter().filter_map(|&(dx, dy)| {
            let nx = x as i32 + dx;
            let ny = y as i32 + dy;
            if nx >= 0 && nx < self.width as i32 && ny >= 0 && ny < self.height as i32 {
                Some((nx as usize, ny as usize))
            } else {
                None
            }
        }).collect()
    }

    fn check_captures(&mut self, _placed_x: usize, _placed_y: usize) -> CaptureInfo {
        let placed_color = self.current_turn;
        let opponent_color = if placed_color == self.player1_color {
            self.player2_color
        } else {
            self.player1_color
        };

        let captured: Vec<(usize, usize)> = (0..self.height)
            .flat_map(|y| (0..self.width).map(move |x| (x, y)))
            .filter(|&(x, y)| {
                matches!(self.grid[y][x], Cell::Occupied(c) if c == opponent_color)
                    && self.is_surrounded(x, y, placed_color)
            })
            .collect();

        let count = captured.len() as u32;
        let loop_points = if count > 0 {
            Some(self.find_loop_boundary(&captured, placed_color))
        } else {
            None
        };

        for &(x, y) in &captured {
            self.grid[y][x] = Cell::Captured(opponent_color);
        }

        if placed_color == self.player1_color {
            self.score_p1 += count;
        } else {
            self.score_p2 += count;
        }

        CaptureInfo { count, loop_points }
    }

    fn find_loop_boundary(&self, captured: &[(usize, usize)], wall_color: Color) -> Vec<(usize, usize)> {
        let mut boundary: HashSet<(usize, usize)> = HashSet::new();
        for &(cx, cy) in captured {
            for (nx, ny) in self.get_neighbors(cx, cy) {
                if matches!(self.grid[ny][nx], Cell::Occupied(c) if c == wall_color) {
                    boundary.insert((nx, ny));
                }
            }
        }
        boundary.into_iter().collect()
    }

    fn is_surrounded(&self, x: usize, y: usize, wall_color: Color) -> bool {
        let mut visited: HashSet<(usize, usize)> = HashSet::new();
        let mut queue = VecDeque::new();
        queue.push_back((x, y));

        while let Some((cx, cy)) = queue.pop_front() {
            if !visited.insert((cx, cy)) {
                continue;
            }
            if cx == 0 || cx == self.width - 1 || cy == 0 || cy == self.height - 1 {
                return false;
            }
            for (nx, ny) in [(cx.wrapping_sub(1), cy), (cx + 1, cy), (cx, cy.wrapping_sub(1)), (cx, cy + 1)] {
                if nx >= self.width || ny >= self.height || visited.contains(&(nx, ny)) {
                    continue;
                }
                if matches!(self.grid[ny][nx], Cell::Occupied(c) if c == wall_color) {
                    continue;
                }
                queue.push_back((nx, ny));
            }
        }
        true
    }

    fn determine_game_over(&self) -> Option<GameOverInfo> {
        if self.grid.iter().any(|row| row.iter().any(|c| matches!(c, Cell::Empty))) {
            return None;
        }
        let winner = match self.score_p1.cmp(&self.score_p2) {
            std::cmp::Ordering::Greater => Some(self.player1_color),
            std::cmp::Ordering::Less => Some(self.player2_color),
            std::cmp::Ordering::Equal => None,
        };
        Some(GameOverInfo {
            winner,
            score_p1: self.score_p1,
            score_p2: self.score_p2,
            reason: "Board full".to_string(),
        })
    }
}
