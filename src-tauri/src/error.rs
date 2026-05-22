use std::fmt::{Display, Formatter};

#[derive(Debug)]
pub enum AppError {
    Io(std::io::Error),
    Sql(rusqlite::Error),
    Keyring(keyring_core::Error),
    MissingPath(&'static str),
    NotFound(String),
    InvalidData(String),
}

impl Display for AppError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(f, "io error: {error}"),
            Self::Sql(error) => write!(f, "sqlite error: {error}"),
            Self::Keyring(error) => write!(f, "keyring error: {error}"),
            Self::MissingPath(path_name) => write!(f, "missing required path: {path_name}"),
            Self::NotFound(message) => write!(f, "not found: {message}"),
            Self::InvalidData(message) => write!(f, "invalid data: {message}"),
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Sql(value)
    }
}

impl From<keyring_core::Error> for AppError {
    fn from(value: keyring_core::Error) -> Self {
        Self::Keyring(value)
    }
}

impl std::error::Error for AppError {}

pub type AppResult<T> = Result<T, AppError>;
