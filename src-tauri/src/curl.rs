use reqwest::Url;

use crate::error::{AppError, AppResult};
use crate::models::{CurlExportInput, CurlImportInput, RequestKeyValue, StoredRequest};

pub fn import_command(input: CurlImportInput) -> AppResult<StoredRequest> {
    let tokens = tokenize(&input.command)?;
    let mut explicit_method = None;
    let mut headers = Vec::new();
    let mut data_parts = Vec::new();
    let mut url = None;
    let mut use_get = false;
    let mut index = 0;

    while index < tokens.len() {
        let token = &tokens[index];

        if token == "curl" {
            index += 1;
            continue;
        }

        match token.as_str() {
            "-X" | "--request" => {
                explicit_method = Some(next_token(&tokens, &mut index, token)?);
            }
            "-H" | "--header" => {
                headers.push(parse_header(&next_token(&tokens, &mut index, token)?)?);
            }
            "-d" | "--data" | "--data-raw" | "--data-binary" | "--data-urlencode" => {
                data_parts.push(next_token(&tokens, &mut index, token)?);
            }
            "-G" | "--get" => {
                use_get = true;
            }
            "-I" | "--head" => {
                explicit_method = Some("HEAD".to_string());
            }
            "--url" => {
                url = Some(next_token(&tokens, &mut index, token)?);
            }
            _ if token.starts_with("--request=") => {
                explicit_method = Some(token["--request=".len()..].to_string());
            }
            _ if token.starts_with("--header=") => {
                headers.push(parse_header(&token["--header=".len()..])?);
            }
            _ if token.starts_with("--data=") => {
                data_parts.push(token["--data=".len()..].to_string());
            }
            _ if token.starts_with("--data-raw=") => {
                data_parts.push(token["--data-raw=".len()..].to_string());
            }
            _ if token.starts_with("--data-binary=") => {
                data_parts.push(token["--data-binary=".len()..].to_string());
            }
            _ if token.starts_with("--data-urlencode=") => {
                data_parts.push(token["--data-urlencode=".len()..].to_string());
            }
            _ if token.starts_with("-X") && token.len() > 2 => {
                explicit_method = Some(token[2..].to_string());
            }
            _ if token.starts_with("-H") && token.len() > 2 => {
                headers.push(parse_header(&token[2..])?);
            }
            _ if token.starts_with("-d") && token.len() > 2 => {
                data_parts.push(token[2..].to_string());
            }
            _ if token.starts_with('-') => {}
            _ => {
                url = Some(token.to_string());
            }
        }

        index += 1;
    }

    let raw_url =
        url.ok_or_else(|| AppError::InvalidData("curl command is missing a URL".to_string()))?;
    let (url_without_query, mut params) = split_url_and_params(&raw_url);
    let body = if use_get {
        for part in &data_parts {
            params.extend(parse_query_pairs(part));
        }
        String::new()
    } else {
        data_parts.join("&")
    };
    let method = explicit_method
        .unwrap_or_else(|| {
            if body.trim().is_empty() {
                "GET"
            } else {
                "POST"
            }
            .to_string()
        })
        .to_ascii_uppercase();
    let (headers, auth_type, auth_token) = split_auth_header(headers);

    Ok(StoredRequest {
        id: input.request_id,
        name: format!("{} {}", method, request_name_path(&url_without_query)),
        collection: input.collection,
        collection_file: input.collection_file,
        method,
        url: url_without_query,
        params,
        headers,
        body,
        auth_type,
        auth_token,
    })
}

pub fn export_command(input: CurlExportInput) -> AppResult<String> {
    if input.url.trim().is_empty() {
        return Err(AppError::InvalidData("request URL is required".to_string()));
    }

    let method = input.method.trim().to_ascii_uppercase();
    let url = append_query_pairs(&input.url, &input.params);
    let mut parts = vec![
        "curl".to_string(),
        "-X".to_string(),
        shell_quote(&method),
        shell_quote(&url),
    ];
    let has_auth_header = input
        .headers
        .iter()
        .any(|row| row.enabled && row.key.eq_ignore_ascii_case("authorization"));

    for row in input
        .headers
        .iter()
        .filter(|row| row.enabled && !row.key.trim().is_empty())
    {
        parts.push("-H".to_string());
        parts.push(shell_quote(&format!("{}: {}", row.key.trim(), row.value)));
    }

    if input.auth_type == "bearer" && !input.auth_token.trim().is_empty() && !has_auth_header {
        parts.push("-H".to_string());
        parts.push(shell_quote(&format!(
            "Authorization: Bearer {}",
            input.auth_token.trim()
        )));
    }

    if !input.body.trim().is_empty() {
        parts.push("--data-raw".to_string());
        parts.push(shell_quote(&input.body));
    }

    Ok(parts.join(" \\\n  "))
}

fn next_token(tokens: &[String], index: &mut usize, flag: &str) -> AppResult<String> {
    *index += 1;
    tokens
        .get(*index)
        .cloned()
        .ok_or_else(|| AppError::InvalidData(format!("{flag} expects a value")))
}

fn parse_header(raw: &str) -> AppResult<RequestKeyValue> {
    let (key, value) = raw
        .split_once(':')
        .ok_or_else(|| AppError::InvalidData(format!("invalid header: {raw}")))?;

    Ok(RequestKeyValue {
        key: key.trim().to_string(),
        value: value.trim().to_string(),
        enabled: true,
    })
}

fn split_auth_header(headers: Vec<RequestKeyValue>) -> (Vec<RequestKeyValue>, String, String) {
    let mut auth_type = "none".to_string();
    let mut auth_token = String::new();
    let mut retained_headers = Vec::new();

    for header in headers {
        if header.key.eq_ignore_ascii_case("authorization") {
            let value = header.value.trim();
            if let Some(token) = value.strip_prefix("Bearer ") {
                auth_type = "bearer".to_string();
                auth_token = token.trim().to_string();
                continue;
            }
        }

        retained_headers.push(header);
    }

    (retained_headers, auth_type, auth_token)
}

fn split_url_and_params(raw_url: &str) -> (String, Vec<RequestKeyValue>) {
    if let Ok(mut parsed_url) = Url::parse(raw_url) {
        let params = parsed_url
            .query_pairs()
            .map(|(key, value)| RequestKeyValue {
                key: key.into_owned(),
                value: value.into_owned(),
                enabled: true,
            })
            .collect::<Vec<_>>();
        parsed_url.set_query(None);
        return (parsed_url.to_string(), params);
    }

    let Some((url, query)) = raw_url.split_once('?') else {
        return (raw_url.to_string(), Vec::new());
    };

    (url.to_string(), parse_query_pairs(query))
}

fn parse_query_pairs(raw: &str) -> Vec<RequestKeyValue> {
    raw.split('&')
        .filter(|part| !part.trim().is_empty())
        .map(|part| {
            let (key, value) = part.split_once('=').unwrap_or((part, ""));
            RequestKeyValue {
                key: key.to_string(),
                value: value.to_string(),
                enabled: true,
            }
        })
        .collect()
}

fn append_query_pairs(url: &str, params: &[RequestKeyValue]) -> String {
    let query = params
        .iter()
        .filter(|row| row.enabled && !row.key.trim().is_empty())
        .map(|row| {
            if row.value.is_empty() {
                row.key.trim().to_string()
            } else {
                format!("{}={}", row.key.trim(), row.value)
            }
        })
        .collect::<Vec<_>>();

    if query.is_empty() {
        return url.to_string();
    }

    let separator = if url.contains('?') {
        if url.ends_with('?') || url.ends_with('&') {
            ""
        } else {
            "&"
        }
    } else {
        "?"
    };

    format!("{url}{separator}{}", query.join("&"))
}

fn request_name_path(url: &str) -> String {
    Url::parse(url)
        .map(|parsed| {
            let path = parsed.path();
            if path.is_empty() || path == "/" {
                parsed.host_str().unwrap_or(url).to_string()
            } else {
                path.to_string()
            }
        })
        .unwrap_or_else(|_| url.to_string())
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn tokenize(command: &str) -> AppResult<Vec<String>> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut chars = command.trim().chars().peekable();
    let mut in_single = false;
    let mut in_double = false;

    while let Some(character) = chars.next() {
        match character {
            '\'' if !in_double => {
                in_single = !in_single;
            }
            '"' if !in_single => {
                in_double = !in_double;
            }
            '\\' if !in_single => {
                if matches!(chars.peek(), Some('\n')) {
                    chars.next();
                } else if let Some(next) = chars.next() {
                    current.push(next);
                }
            }
            character if character.is_whitespace() && !in_single && !in_double => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            character => {
                current.push(character);
            }
        }
    }

    if in_single || in_double {
        return Err(AppError::InvalidData(
            "curl command has an unterminated quote".to_string(),
        ));
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    Ok(tokens)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_common_curl_command_into_request() {
        let request = import_command(CurlImportInput {
            command: "curl -X POST 'https://api.example.com/v1/search?q=workspace' -H 'Accept: application/json' -H 'Authorization: Bearer {{secret.prod_token}}' --data-raw '{\"limit\":20}'".to_string(),
            request_id: "req-import".to_string(),
            collection: "Core API".to_string(),
            collection_file: "collections/core-api.json".to_string(),
        })
        .expect("import curl");

        assert_eq!(request.id, "req-import");
        assert_eq!(request.name, "POST /v1/search");
        assert_eq!(request.method, "POST");
        assert_eq!(request.url, "https://api.example.com/v1/search");
        assert_eq!(request.params[0].key, "q");
        assert_eq!(request.params[0].value, "workspace");
        assert_eq!(request.headers.len(), 1);
        assert_eq!(request.headers[0].key, "Accept");
        assert_eq!(request.auth_type, "bearer");
        assert_eq!(request.auth_token, "{{secret.prod_token}}");
        assert_eq!(request.body, "{\"limit\":20}");
    }

    #[test]
    fn imports_get_data_as_query_params() {
        let request = import_command(CurlImportInput {
            command: "curl -G https://api.example.com/v1/workspaces --data-urlencode page=1 --data-urlencode limit=20".to_string(),
            request_id: "req-get".to_string(),
            collection: "Core API".to_string(),
            collection_file: "collections/core-api.json".to_string(),
        })
        .expect("import curl");

        assert_eq!(request.method, "GET");
        assert_eq!(request.params.len(), 2);
        assert_eq!(request.body, "");
    }

    #[test]
    fn exports_request_as_curl_command() {
        let command = export_command(CurlExportInput {
            method: "POST".to_string(),
            url: "https://api.example.com/v1/search".to_string(),
            params: vec![RequestKeyValue {
                key: "q".to_string(),
                value: "workspace".to_string(),
                enabled: true,
            }],
            headers: vec![RequestKeyValue {
                key: "Accept".to_string(),
                value: "application/json".to_string(),
                enabled: true,
            }],
            body: "{\"limit\":20}".to_string(),
            auth_type: "bearer".to_string(),
            auth_token: "{{secret.prod_token}}".to_string(),
        })
        .expect("export curl");

        assert!(command.contains("curl"));
        assert!(command.contains("-X"));
        assert!(command.contains("'POST'"));
        assert!(command.contains("'https://api.example.com/v1/search?q=workspace'"));
        assert!(command.contains("'Accept: application/json'"));
        assert!(command.contains("'Authorization: Bearer {{secret.prod_token}}'"));
        assert!(command.contains("--data-raw"));
    }
}
