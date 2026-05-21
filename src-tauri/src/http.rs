use std::time::Instant;

use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, COOKIE};
use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::models::{
    ResponseHeader, ResponseSummary, ResponseTimelineItem, SendRequestInput, SendRequestResult,
};
use crate::secrets;
use crate::storage::{self, StoragePaths};

pub fn execute_request(
    paths: &StoragePaths,
    input: SendRequestInput,
) -> AppResult<SendRequestResult> {
    let client = Client::builder()
        .build()
        .map_err(|error| AppError::InvalidData(error.to_string()))?;

    let resolved_environment = input
        .environment
        .vars
        .iter()
        .map(|item| (item.key.clone(), item.value.clone()))
        .collect::<std::collections::HashMap<_, _>>();

    let url_with_vars = resolve_template(&input.url, &resolved_environment)?;
    let mut url = reqwest::Url::parse(&url_with_vars)
        .map_err(|error| AppError::InvalidData(error.to_string()))?;

    for row in input
        .params
        .iter()
        .filter(|row| row.enabled && !row.key.trim().is_empty())
    {
        let value = resolve_template(&row.value, &resolved_environment)?;
        url.query_pairs_mut().append_pair(&row.key, &value);
    }

    let mut headers = HeaderMap::new();
    for row in input
        .headers
        .iter()
        .filter(|row| row.enabled && !row.key.trim().is_empty())
    {
        let header_name = HeaderName::from_bytes(row.key.trim().as_bytes())
            .map_err(|error| AppError::InvalidData(error.to_string()))?;
        let header_value =
            HeaderValue::from_str(&resolve_template(&row.value, &resolved_environment)?)
                .map_err(|error| AppError::InvalidData(error.to_string()))?;
        headers.insert(header_name, header_value);
    }

    if input.auth_type == "bearer" && !input.auth_token.trim().is_empty() {
        let token = resolve_template(&input.auth_token, &resolved_environment)?;
        let auth_value = HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|error| AppError::InvalidData(error.to_string()))?;
        headers.insert(reqwest::header::AUTHORIZATION, auth_value);
    }

    let cookie_jar_name = resolved_environment
        .get("cookie_jar")
        .cloned()
        .unwrap_or_else(|| "default".to_string());
    if !headers.contains_key(COOKIE) {
        if let Some(cookie_header) = storage::load_cookie_header(paths, &cookie_jar_name, &url)? {
            let cookie_value = HeaderValue::from_str(&cookie_header)
                .map_err(|error| AppError::InvalidData(error.to_string()))?;
            headers.insert(COOKIE, cookie_value);
        }
    }

    let method = reqwest::Method::from_bytes(input.method.as_bytes())
        .map_err(|error| AppError::InvalidData(error.to_string()))?;
    let started_at = Instant::now();
    let mut request = client.request(method, url.clone()).headers(headers);

    if !input.body.trim().is_empty() {
        request = request.body(resolve_template(&input.body, &resolved_environment)?);
    }

    let response = request
        .send()
        .map_err(|error| AppError::InvalidData(error.to_string()))?;

    let elapsed = started_at.elapsed();
    let status = response.status();
    let protocol = format!("{:?}", response.version()).replace("HTTP_", "HTTP/");
    let response_url = response.url().clone();
    let response_headers = response
        .headers()
        .iter()
        .map(|(key, value)| ResponseHeader {
            key: key.to_string(),
            value: value.to_str().unwrap_or_default().to_string(),
        })
        .collect::<Vec<_>>();
    let persisted_cookies = storage::store_set_cookie_headers(
        paths,
        &cookie_jar_name,
        &response_url,
        response.headers(),
    )?;
    let body = response
        .text()
        .map_err(|error| AppError::InvalidData(error.to_string()))?;
    let size_bytes = body.len();

    Ok(SendRequestResult {
        status: format!(
            "{} {}",
            status.as_u16(),
            status.canonical_reason().unwrap_or("Unknown")
        ),
        duration_ms: elapsed.as_millis() as i64,
        size_bytes,
        protocol,
        body: format_body(body),
        headers: response_headers,
        timeline: vec![
            ResponseTimelineItem {
                step: "Total".to_string(),
                value: format!("{}ms", elapsed.as_millis()),
            },
            ResponseTimelineItem {
                step: "Transport".to_string(),
                value: "reqwest blocking".to_string(),
            },
        ],
        summary: ResponseSummary {
            cookie_jar: format!("SQLite / {cookie_jar_name} / {persisted_cookies} updated"),
            secret_source: if input.auth_type == "bearer" && !input.auth_token.trim().is_empty() {
                input.auth_token
            } else {
                "No auth".to_string()
            },
            collection_file: format!("{}.json / {}", input.collection, input.request_name),
        },
    })
}

fn resolve_template(
    raw: &str,
    environment: &std::collections::HashMap<String, String>,
) -> AppResult<String> {
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

fn format_body(body: String) -> String {
    match serde_json::from_str::<Value>(&body) {
        Ok(value) => serde_json::to_string_pretty(&value).unwrap_or(body),
        Err(_) => body,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::fs;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::thread;
    use std::time::{SystemTime, UNIX_EPOCH};

    use reqwest::header::{HeaderValue, SET_COOKIE};

    use super::*;
    use crate::models::{EnvironmentSummary, EnvironmentVariable, RequestKeyValue};
    use crate::storage::StoragePaths;

    fn make_test_paths(label: &str) -> StoragePaths {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("api-client-http-{label}-{nonce}"));

        fs::create_dir_all(root.join("workspaces")).expect("create workspaces dir");
        fs::create_dir_all(root.join("collections")).expect("create collections dir");
        fs::create_dir_all(root.join("environments")).expect("create environments dir");

        StoragePaths {
            app_data_dir: root.clone(),
            database_path: root.join("api-client.sqlite3"),
            workspaces_dir: root.join("workspaces"),
            collections_dir: root.join("collections"),
            environments_dir: root.join("environments"),
        }
    }

    #[test]
    fn execute_request_sends_real_http_request_and_maps_response() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
        let address = listener.local_addr().expect("read local addr");
        let paths = make_test_paths("request-cookies");
        storage::initialize_database(&paths.database_path).expect("initialize database");
        let request_url =
            reqwest::Url::parse(&format!("http://{address}/echo")).expect("parse test request url");
        let mut seed_cookie_headers = HeaderMap::new();
        seed_cookie_headers.append(
            SET_COOKIE,
            HeaderValue::from_static("workspace_session=stored; Path=/"),
        );
        storage::store_set_cookie_headers(
            &paths,
            "integration-jar",
            &request_url,
            &seed_cookie_headers,
        )
        .expect("seed cookie jar");

        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept request");
            let mut reader = BufReader::new(stream.try_clone().expect("clone stream"));

            let mut request_line = String::new();
            reader
                .read_line(&mut request_line)
                .expect("read request line");

            let mut headers = HashMap::new();
            let mut content_length = 0usize;

            loop {
                let mut line = String::new();
                reader.read_line(&mut line).expect("read header line");
                if line == "\r\n" {
                    break;
                }

                let trimmed = line.trim_end();
                if let Some((name, value)) = trimmed.split_once(':') {
                    let normalized_name = name.trim().to_ascii_lowercase();
                    let normalized_value = value.trim().to_string();
                    if normalized_name == "content-length" {
                        content_length = normalized_value
                            .parse::<usize>()
                            .expect("parse content-length");
                    }
                    headers.insert(normalized_name, normalized_value);
                }
            }

            let mut body = vec![0; content_length];
            reader.read_exact(&mut body).expect("read request body");

            assert_eq!(
                request_line.trim_end(),
                "POST /echo?query=workspace&limit=10 HTTP/1.1"
            );
            assert_eq!(
                headers.get("authorization"),
                Some(&"Bearer local-token".to_string())
            );
            assert_eq!(headers.get("x-env"), Some(&"workspace".to_string()));
            assert_eq!(
                headers.get("content-type"),
                Some(&"application/json".to_string())
            );
            let cookie_header = headers.get("cookie").expect("cookie header");
            assert!(cookie_header.contains("workspace_session=stored"));
            assert_eq!(
                String::from_utf8(body).expect("decode request body"),
                "{\"query\":\"workspace\"}"
            );

            let response_body = r#"{"ok":true,"echo":"workspace"}"#;
            let response = format!(
                "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nX-Trace: abc123\r\nSet-Cookie: server_session=renewed; Path=/; HttpOnly\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream
                .write_all(response.as_bytes())
                .expect("write response");
            stream.flush().expect("flush response");
        });

        let result = execute_request(
            &paths,
            SendRequestInput {
                request_id: "req-http-test".to_string(),
                request_name: "POST /echo".to_string(),
                collection: "Core API".to_string(),
                method: "POST".to_string(),
                url: format!("http://{address}/echo"),
                params: vec![
                    RequestKeyValue {
                        key: "query".to_string(),
                        value: "{{env.query_value}}".to_string(),
                        enabled: true,
                    },
                    RequestKeyValue {
                        key: "limit".to_string(),
                        value: "10".to_string(),
                        enabled: true,
                    },
                ],
                headers: vec![
                    RequestKeyValue {
                        key: "Content-Type".to_string(),
                        value: "application/json".to_string(),
                        enabled: true,
                    },
                    RequestKeyValue {
                        key: "X-Env".to_string(),
                        value: "{{query_value}}".to_string(),
                        enabled: true,
                    },
                ],
                body: r#"{"query":"{{query_value}}"}"#.to_string(),
                auth_type: "bearer".to_string(),
                auth_token: "{{api_token}}".to_string(),
                environment: EnvironmentSummary {
                    name: "Local Test".to_string(),
                    file_path: "environments/local-test.json".to_string(),
                    vars: vec![
                        EnvironmentVariable {
                            key: "query_value".to_string(),
                            value: "workspace".to_string(),
                        },
                        EnvironmentVariable {
                            key: "api_token".to_string(),
                            value: "local-token".to_string(),
                        },
                        EnvironmentVariable {
                            key: "cookie_jar".to_string(),
                            value: "integration-jar".to_string(),
                        },
                    ],
                },
            },
        )
        .expect("execute request");

        server.join().expect("join server");
        let persisted_cookie_header =
            storage::load_cookie_header(&paths, "integration-jar", &request_url)
                .expect("load persisted cookie header")
                .expect("persisted cookie header");
        assert!(persisted_cookie_header.contains("workspace_session=stored"));
        assert!(persisted_cookie_header.contains("server_session=renewed"));

        assert_eq!(result.status, "201 Created");
        assert_eq!(result.protocol, "HTTP/1.1");
        assert!(result.duration_ms >= 0);
        assert!(result.size_bytes > 0);
        assert_eq!(
            result.body,
            "{\n  \"echo\": \"workspace\",\n  \"ok\": true\n}"
        );
        assert!(result
            .headers
            .iter()
            .any(|header| header.key == "content-type" && header.value == "application/json"));
        assert!(result
            .headers
            .iter()
            .any(|header| header.key == "x-trace" && header.value == "abc123"));
        assert_eq!(result.timeline.len(), 2);
        assert_eq!(
            result.summary.cookie_jar,
            "SQLite / integration-jar / 1 updated"
        );
        assert_eq!(result.summary.secret_source, "{{api_token}}");
        assert_eq!(result.summary.collection_file, "Core API.json / POST /echo");
    }
}
