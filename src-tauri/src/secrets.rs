use keyring::Entry;

const SERVICE_NAME: &str = "com.apiclient.dev";

pub fn store_secret(key: &str, value: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, key)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;
    entry
        .set_password(value)
        .map_err(|e| format!("Failed to store secret: {}", e))?;
    Ok(())
}

pub fn get_secret(key: &str) -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE_NAME, key)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to get secret: {}", e)),
    }
}

pub fn delete_secret(key: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, key)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;
    match entry.delete_password() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to delete secret: {}", e)),
    }
}

/// Store a secret with a namespaced key (e.g., "env:env_id:VAR_NAME")
pub fn store_env_secret(env_id: &str, var_key: &str, value: &str) -> Result<(), String> {
    let namespaced_key = format!("env:{}:{}", env_id, var_key);
    store_secret(&namespaced_key, value)
}

pub fn get_env_secret(env_id: &str, var_key: &str) -> Result<Option<String>, String> {
    let namespaced_key = format!("env:{}:{}", env_id, var_key);
    get_secret(&namespaced_key)
}

pub fn delete_env_secret(env_id: &str, var_key: &str) -> Result<(), String> {
    let namespaced_key = format!("env:{}:{}", env_id, var_key);
    delete_secret(&namespaced_key)
}

/// Store auth credentials (e.g., "auth:collection_id:bearer_token")
pub fn store_auth_secret(scope_id: &str, auth_key: &str, value: &str) -> Result<(), String> {
    let namespaced_key = format!("auth:{}:{}", scope_id, auth_key);
    store_secret(&namespaced_key, value)
}

pub fn get_auth_secret(scope_id: &str, auth_key: &str) -> Result<Option<String>, String> {
    let namespaced_key = format!("auth:{}:{}", scope_id, auth_key);
    get_secret(&namespaced_key)
}

pub fn delete_auth_secret(scope_id: &str, auth_key: &str) -> Result<(), String> {
    let namespaced_key = format!("auth:{}:{}", scope_id, auth_key);
    delete_secret(&namespaced_key)
}

/// Store a scoped variable secret. `scope` distinguishes the layer
/// (e.g. "workspace", "collection", "folder") so that variables sharing
/// the same key across scopes don't collide in the keychain.
pub fn store_scope_var_secret(
    scope: &str,
    scope_id: &str,
    var_key: &str,
    value: &str,
) -> Result<(), String> {
    let namespaced_key = format!("{}:{}:{}", scope, scope_id, var_key);
    store_secret(&namespaced_key, value)
}

pub fn get_scope_var_secret(
    scope: &str,
    scope_id: &str,
    var_key: &str,
) -> Result<Option<String>, String> {
    let namespaced_key = format!("{}:{}:{}", scope, scope_id, var_key);
    get_secret(&namespaced_key)
}

pub fn delete_scope_var_secret(
    scope: &str,
    scope_id: &str,
    var_key: &str,
) -> Result<(), String> {
    let namespaced_key = format!("{}:{}:{}", scope, scope_id, var_key);
    delete_secret(&namespaced_key)
}
