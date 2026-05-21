use keyring_core::{Entry, Error};
use tauri::AppHandle;

use crate::error::AppResult;
use crate::models::SecretStatus;

const SERVICE_NAME: &str = "com.codex.apiclient";

fn entry(secret_name: &str) -> Result<Entry, Error> {
    Entry::new(SERVICE_NAME, secret_name)
}

pub fn secret_exists(secret_name: &str) -> AppResult<bool> {
    let entry = entry(secret_name)?;
    match entry.get_password() {
        Ok(_) => Ok(true),
        Err(Error::NoEntry) => Ok(false),
        Err(error) => Err(error.into()),
    }
}

pub fn list_secret_statuses(_app: &AppHandle) -> AppResult<Vec<SecretStatus>> {
    let names = ["prod_token", "staging_token", "proxy_password"];
    let mut secrets = Vec::new();

    for name in names {
        secrets.push(SecretStatus {
            name: name.to_string(),
            exists: secret_exists(name)?,
        });
    }

    Ok(secrets)
}

pub fn save_secret(secret_name: &str, value: &str) -> AppResult<SecretStatus> {
    let entry = entry(secret_name)?;
    entry.set_password(value)?;

    Ok(SecretStatus {
        name: secret_name.to_string(),
        exists: true,
    })
}

pub fn read_secret(secret_name: &str) -> AppResult<String> {
    let entry = entry(secret_name)?;
    entry.get_password().map_err(Into::into)
}
