use reqwest::blocking::{Client, ClientBuilder};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::Proxy;

use crate::error::{AppError, AppResult};
use crate::models::{EnvironmentVariable, RequestKeyValue};
use crate::secrets;

pub type EnvironmentMap = std::collections::HashMap<String, String>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProxyMode {
    System,
    Disabled,
    Custom(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransportConfig {
    pub proxy_mode: ProxyMode,
    pub tls_verify: bool,
    pub tls_hostname_verify: bool,
    pub https_only: bool,
}

pub fn environment_map(vars: &[EnvironmentVariable]) -> EnvironmentMap {
    vars.iter()
        .map(|item| (item.key.clone(), item.value.clone()))
        .collect()
}

pub fn build_client(environment: &EnvironmentMap) -> AppResult<Client> {
    build_client_builder(environment)?
        .build()
        .map_err(|error| AppError::InvalidData(error.to_string()))
}

pub fn build_client_builder(environment: &EnvironmentMap) -> AppResult<ClientBuilder> {
    let config = transport_config(environment)?;
    let mut builder = Client::builder();

    match &config.proxy_mode {
        ProxyMode::System => {}
        ProxyMode::Disabled => {
            builder = builder.no_proxy();
        }
        ProxyMode::Custom(proxy_url) => {
            let mut proxy =
                Proxy::all(proxy_url).map_err(|error| AppError::InvalidData(error.to_string()))?;
            if let Some((username, password)) = proxy_credentials(environment)? {
                proxy = proxy.basic_auth(&username, &password);
            }
            builder = builder.proxy(proxy);
        }
    }

    if !config.tls_verify {
        builder = builder.danger_accept_invalid_certs(true);
    }
    if !config.tls_hostname_verify {
        builder = builder.danger_accept_invalid_hostnames(true);
    }
    if config.https_only {
        builder = builder.https_only(true);
    }

    Ok(builder)
}

pub fn transport_config(environment: &EnvironmentMap) -> AppResult<TransportConfig> {
    Ok(TransportConfig {
        proxy_mode: proxy_mode(environment)?,
        tls_verify: bool_setting(environment, "tls_verify", true)?,
        tls_hostname_verify: bool_setting(environment, "tls_hostname_verify", true)?,
        https_only: bool_setting(environment, "https_only", false)?,
    })
}

pub fn build_headers(
    headers: &[RequestKeyValue],
    environment: &EnvironmentMap,
) -> AppResult<HeaderMap> {
    let mut parsed = HeaderMap::new();

    for row in headers
        .iter()
        .filter(|row| row.enabled && !row.key.trim().is_empty())
    {
        let header_name = HeaderName::from_bytes(row.key.trim().as_bytes())
            .map_err(|error| AppError::InvalidData(error.to_string()))?;
        let header_value = HeaderValue::from_str(&resolve_template(&row.value, environment)?)
            .map_err(|error| AppError::InvalidData(error.to_string()))?;
        parsed.insert(header_name, header_value);
    }

    Ok(parsed)
}

pub fn resolve_template(raw: &str, environment: &EnvironmentMap) -> AppResult<String> {
    let mut result = raw.to_string();

    for (key, value) in environment {
        let token = format!("{{{{{key}}}}}");
        let env_token = format!("{{{{env.{key}}}}}");
        result = result.replace(&token, value);
        result = result.replace(&env_token, value);
    }

    while let Some(start) = result.find("{{secret.") {
        let rest = &result[start + 9..];
        let Some(end) = rest.find("}}") else {
            break;
        };
        let secret_name = &rest[..end];
        let password = secrets::read_secret(secret_name)?;
        let token = format!("{{{{secret.{secret_name}}}}}");
        result = result.replace(&token, &password);
    }

    Ok(result)
}

fn proxy_mode(environment: &EnvironmentMap) -> AppResult<ProxyMode> {
    let proxy = environment
        .get("proxy")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or("system");
    let proxy_lower = proxy.to_ascii_lowercase();

    match proxy_lower.as_str() {
        "system" | "auto" => Ok(ProxyMode::System),
        "disabled" | "disable" | "none" | "off" | "false" => Ok(ProxyMode::Disabled),
        "custom" => custom_proxy_url(environment),
        _ if proxy.contains("://") => Ok(ProxyMode::Custom(resolve_template(proxy, environment)?)),
        _ => Err(AppError::InvalidData(format!(
            "unsupported proxy mode: {proxy}. Use system, disabled, custom + proxy_url, or a proxy URL"
        ))),
    }
}

fn custom_proxy_url(environment: &EnvironmentMap) -> AppResult<ProxyMode> {
    let Some(proxy_url) = environment
        .get("proxy_url")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    else {
        return Err(AppError::InvalidData(
            "proxy=custom requires proxy_url".to_string(),
        ));
    };

    Ok(ProxyMode::Custom(resolve_template(proxy_url, environment)?))
}

fn proxy_credentials(environment: &EnvironmentMap) -> AppResult<Option<(String, String)>> {
    let username = environment
        .get("proxy_username")
        .map(|value| resolve_template(value, environment))
        .transpose()?
        .unwrap_or_default();
    let password = environment
        .get("proxy_password")
        .map(|value| resolve_template(value, environment))
        .transpose()?
        .unwrap_or_default();

    if username.trim().is_empty() && password.trim().is_empty() {
        Ok(None)
    } else {
        Ok(Some((username, password)))
    }
}

fn bool_setting(environment: &EnvironmentMap, key: &str, fallback: bool) -> AppResult<bool> {
    let Some(raw_value) = environment
        .get(key)
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    else {
        return Ok(fallback);
    };

    match raw_value.to_ascii_lowercase().as_str() {
        "true" | "1" | "yes" | "on" => Ok(true),
        "false" | "0" | "no" | "off" => Ok(false),
        _ => Err(AppError::InvalidData(format!(
            "{key} must be true or false, got {raw_value}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> EnvironmentMap {
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
            .collect()
    }

    #[test]
    fn transport_config_supports_system_disabled_and_custom_proxy_modes() {
        let system = transport_config(&env(&[("proxy", "system")])).expect("system config");
        assert_eq!(system.proxy_mode, ProxyMode::System);
        assert!(system.tls_verify);

        let disabled = transport_config(&env(&[("proxy", "disabled")])).expect("disabled config");
        assert_eq!(disabled.proxy_mode, ProxyMode::Disabled);

        let custom = transport_config(&env(&[
            ("proxy", "custom"),
            ("proxy_url", "http://127.0.0.1:8080"),
            ("tls_verify", "false"),
            ("tls_hostname_verify", "false"),
            ("https_only", "true"),
        ]))
        .expect("custom config");
        assert_eq!(
            custom.proxy_mode,
            ProxyMode::Custom("http://127.0.0.1:8080".to_string())
        );
        assert!(!custom.tls_verify);
        assert!(!custom.tls_hostname_verify);
        assert!(custom.https_only);
    }

    #[test]
    fn transport_config_accepts_proxy_url_directly() {
        let config =
            transport_config(&env(&[("proxy", "http://proxy.internal:8080")])).expect("config");

        assert_eq!(
            config.proxy_mode,
            ProxyMode::Custom("http://proxy.internal:8080".to_string())
        );
    }

    #[test]
    fn transport_config_rejects_invalid_proxy_and_bool_values() {
        let proxy_error = transport_config(&env(&[("proxy", "corp-proxy")]))
            .expect_err("invalid proxy should fail");
        assert!(proxy_error.to_string().contains("unsupported proxy mode"));

        let bool_error = transport_config(&env(&[("tls_verify", "sometimes")]))
            .expect_err("invalid bool should fail");
        assert!(bool_error.to_string().contains("tls_verify"));
    }

    #[test]
    fn build_client_accepts_supported_tls_and_proxy_modes() {
        build_client(&env(&[("proxy", "system")])).expect("system client");
        build_client(&env(&[("proxy", "disabled")])).expect("disabled proxy client");
        build_client(&env(&[
            ("proxy", "custom"),
            ("proxy_url", "http://127.0.0.1:8080"),
            ("tls_verify", "false"),
            ("tls_hostname_verify", "false"),
            ("https_only", "true"),
        ]))
        .expect("custom proxy tls client");
    }
}
