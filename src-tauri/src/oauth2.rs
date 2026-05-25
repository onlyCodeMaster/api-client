// OAuth2 token acquisition helpers.
//
// Supports two non-interactive grant types:
//   * `client_credentials` — service-to-service auth
//   * `password` — legacy resource-owner password grant
//
// Authorization Code with PKCE is intentionally not implemented here: it
// requires a browser redirect dance and is better handled by a dedicated
// flow in the UI layer when (if) added.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

/// Subset of the standard OAuth2 token endpoint response (RFC 6749 §5.1).
/// Extra provider-specific fields are ignored.
#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    /// Lifetime in seconds. Optional per spec; many providers omit it.
    #[serde(default)]
    expires_in: Option<i64>,
    /// Some providers include a refresh_token even for client_credentials
    /// (against the spec, but common). We don't surface it yet.
    #[allow(dead_code)]
    #[serde(default)]
    refresh_token: Option<String>,
    /// Some providers normalise to "Bearer" but we don't currently use it.
    #[allow(dead_code)]
    #[serde(default)]
    token_type: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OAuth2FetchRequest {
    pub grant_type: String, // "client_credentials" | "password"
    pub token_url: String,
    pub client_id: String,
    pub client_secret: String,
    /// Space-separated.
    pub scope: Option<String>,
    /// "basic" (HTTP Basic in Authorization header) or "body" (in form body).
    /// Defaults to "basic" when omitted, matching most providers' preference.
    pub client_auth: Option<String>,
    /// grant_type=password fields.
    pub username: Option<String>,
    pub password: Option<String>,
    /// Whether to skip TLS verification when fetching the token. Mirrors the
    /// per-request setting so OAuth2 against self-signed dev IdPs works.
    #[serde(default)]
    pub insecure: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct OAuth2FetchResponse {
    pub access_token: String,
    /// Unix millis when the token stops being valid. `None` if the provider
    /// didn't supply `expires_in`.
    pub expires_at: Option<i64>,
}

pub async fn fetch_token(req: OAuth2FetchRequest) -> Result<OAuth2FetchResponse, String> {
    if req.token_url.trim().is_empty() {
        return Err("Token URL is required".to_string());
    }
    if req.client_id.trim().is_empty() {
        return Err("Client ID is required".to_string());
    }
    let grant = req.grant_type.as_str();
    if grant != "client_credentials" && grant != "password" {
        return Err(format!("Unsupported grant_type: {}", grant));
    }
    if grant == "password" {
        if req.username.as_deref().unwrap_or("").is_empty() {
            return Err("Username is required for grant_type=password".to_string());
        }
        if req.password.as_deref().unwrap_or("").is_empty() {
            return Err("Password is required for grant_type=password".to_string());
        }
    }

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(req.insecure)
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let mut form: HashMap<&str, &str> = HashMap::new();
    form.insert("grant_type", grant);
    if let Some(s) = req.scope.as_deref() {
        if !s.is_empty() {
            form.insert("scope", s);
        }
    }
    if grant == "password" {
        // SAFETY: validated above.
        form.insert("username", req.username.as_deref().unwrap());
        form.insert("password", req.password.as_deref().unwrap());
    }

    let client_auth = req.client_auth.as_deref().unwrap_or("basic");
    let mut builder = client.post(&req.token_url);

    match client_auth {
        "basic" => {
            // Per RFC 6749 §2.3.1, client creds in HTTP Basic is the preferred
            // method when the provider supports it.
            builder = builder.basic_auth(&req.client_id, Some(&req.client_secret));
        }
        "body" => {
            form.insert("client_id", &req.client_id);
            if !req.client_secret.is_empty() {
                form.insert("client_secret", &req.client_secret);
            }
        }
        other => return Err(format!("Unsupported client_auth: {}", other)),
    }

    builder = builder
        .header("Accept", "application/json")
        .form(&form);

    let resp = builder
        .send()
        .await
        .map_err(|e| format!("Token request failed: {}", e))?;

    let status = resp.status();
    let body_text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read token response body: {}", e))?;

    if !status.is_success() {
        // Many providers return JSON {"error": "...", "error_description": "..."}
        // on failure. Surface that verbatim if present, otherwise raw body.
        let snippet = if body_text.len() > 500 {
            format!("{}…", &body_text[..500])
        } else {
            body_text.clone()
        };
        return Err(format!("Token endpoint returned {}: {}", status, snippet));
    }

    let parsed: TokenResponse = serde_json::from_str(&body_text)
        .map_err(|e| format!("Failed to parse token response: {} (body: {})", e, body_text))?;

    let expires_at = parsed.expires_in.map(|seconds| {
        let now = chrono::Utc::now().timestamp_millis();
        // Treat the token as expiring 30s earlier than the provider claims
        // so clock skew and in-flight latency don't cause first-use 401s.
        now + (seconds.max(60) - 30) * 1000
    });

    Ok(OAuth2FetchResponse {
        access_token: parsed.access_token,
        expires_at,
    })
}
