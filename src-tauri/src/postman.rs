use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::models::{PostmanImportInput, RequestKeyValue, StoredRequest};

pub fn import_collection(input: PostmanImportInput) -> AppResult<Vec<StoredRequest>> {
    let collection: PostmanCollection = serde_json::from_str(&input.collection_json)
        .map_err(|error| AppError::InvalidData(format!("invalid Postman JSON: {error}")))?;
    let collection_name = collection
        .info
        .and_then(|info| info.name)
        .filter(|name| !name.trim().is_empty())
        .unwrap_or(input.collection);
    let mut requests = Vec::new();

    collect_items(
        &collection.item,
        &collection_name,
        &input.collection_file,
        &mut Vec::new(),
        &mut requests,
    )?;

    if requests.is_empty() {
        return Err(AppError::InvalidData(
            "Postman collection does not contain any requests".to_string(),
        ));
    }

    Ok(requests)
}

fn collect_items(
    items: &[PostmanItem],
    collection_name: &str,
    collection_file: &str,
    path: &mut Vec<String>,
    requests: &mut Vec<StoredRequest>,
) -> AppResult<()> {
    for item in items {
        let item_name = item.name.clone().unwrap_or_else(|| "Untitled".to_string());

        if let Some(request) = &item.request {
            requests.push(convert_request(
                request,
                &item_name,
                collection_name,
                collection_file,
                path,
                requests.len(),
            )?);
        }

        if !item.item.is_empty() {
            path.push(item_name);
            collect_items(&item.item, collection_name, collection_file, path, requests)?;
            path.pop();
        }
    }

    Ok(())
}

fn convert_request(
    request: &PostmanRequest,
    item_name: &str,
    collection_name: &str,
    collection_file: &str,
    path: &[String],
    index: usize,
) -> AppResult<StoredRequest> {
    let (url, params) = parse_url(&request.url)?;
    let (headers, mut auth_type, mut auth_token) = parse_headers(&request.header);
    if let Some((parsed_auth_type, parsed_auth_token)) = parse_auth(request.auth.as_ref()) {
        auth_type = parsed_auth_type;
        auth_token = parsed_auth_token;
    }
    let body = request
        .body
        .as_ref()
        .and_then(|body| body.raw.clone())
        .unwrap_or_default();
    let method = request
        .method
        .clone()
        .unwrap_or_else(|| "GET".to_string())
        .to_ascii_uppercase();
    let mut name_parts = path.to_vec();
    name_parts.push(item_name.to_string());
    let name = name_parts.join(" / ");

    Ok(StoredRequest {
        id: format!("postman-{}-{}", slugify(collection_name), index + 1),
        name,
        collection: collection_name.to_string(),
        collection_file: collection_file.to_string(),
        method,
        url,
        params,
        headers,
        body,
        body_mode: "raw".to_string(),
        body_content_type: String::new(),
        body_rows: Vec::new(),
        auth_type,
        auth_token,
    })
}

fn parse_url(url: &PostmanUrl) -> AppResult<(String, Vec<RequestKeyValue>)> {
    match url {
        PostmanUrl::String(raw) => split_raw_url(raw),
        PostmanUrl::Object(object) => {
            let raw = object
                .raw
                .clone()
                .or_else(|| build_url_from_parts(object))
                .ok_or_else(|| {
                    AppError::InvalidData("Postman request is missing a URL".to_string())
                })?;
            let (base_url, mut params) = split_raw_url(&raw)?;
            params.extend(object.query.iter().filter_map(|item| {
                if item.disabled.unwrap_or(false) {
                    return None;
                }

                Some(RequestKeyValue {
                    key: item.key.clone().unwrap_or_default(),
                    value: item.value.clone().unwrap_or_default(),
                    enabled: true,
                })
            }));
            Ok((base_url, dedupe_params(params)))
        }
    }
}

fn build_url_from_parts(url: &PostmanUrlObject) -> Option<String> {
    let host = url.host.as_ref()?.join(".");
    let path = url
        .path
        .as_ref()
        .map(|parts| parts.join("/"))
        .unwrap_or_default();
    let protocol = url.protocol.as_deref().unwrap_or("https");

    if path.is_empty() {
        Some(format!("{protocol}://{host}"))
    } else {
        Some(format!("{protocol}://{host}/{path}"))
    }
}

fn split_raw_url(raw: &str) -> AppResult<(String, Vec<RequestKeyValue>)> {
    if raw.trim().is_empty() {
        return Err(AppError::InvalidData(
            "Postman request URL is empty".to_string(),
        ));
    }

    let Some((base, query)) = raw.split_once('?') else {
        return Ok((raw.to_string(), Vec::new()));
    };

    let params = query
        .split('&')
        .filter(|part| !part.trim().is_empty())
        .map(|part| {
            let (key, value) = part.split_once('=').unwrap_or((part, ""));
            RequestKeyValue {
                key: key.to_string(),
                value: value.to_string(),
                enabled: true,
            }
        })
        .collect();

    Ok((base.to_string(), params))
}

fn parse_headers(headers: &[PostmanHeader]) -> (Vec<RequestKeyValue>, String, String) {
    let mut parsed_headers = Vec::new();
    let mut auth_type = "none".to_string();
    let mut auth_token = String::new();

    for header in headers {
        if header.disabled.unwrap_or(false) {
            continue;
        }

        let key = header.key.clone().unwrap_or_default();
        let value = header.value.clone().unwrap_or_default();
        if key.eq_ignore_ascii_case("authorization") {
            if let Some(token) = parse_bearer_value(&value) {
                auth_type = "bearer".to_string();
                auth_token = token;
                continue;
            }
        }

        parsed_headers.push(RequestKeyValue {
            key,
            value,
            enabled: true,
        });
    }

    (parsed_headers, auth_type, auth_token)
}

fn parse_auth(auth: Option<&PostmanAuth>) -> Option<(String, String)> {
    let auth = auth?;
    if !auth
        .auth_type
        .as_deref()
        .is_some_and(|auth_type| auth_type.eq_ignore_ascii_case("bearer"))
    {
        return None;
    }

    auth.bearer
        .iter()
        .find_map(|entry| {
            let key = entry.key.as_deref().unwrap_or_default();
            if !key.eq_ignore_ascii_case("token") {
                return None;
            }

            entry
                .value
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string())
        })
        .or_else(|| {
            auth.bearer.iter().find_map(|entry| {
                entry
                    .value
                    .as_ref()
                    .map(|value| value.trim())
                    .filter(|value| !value.is_empty())
                    .map(|value| value.to_string())
            })
        })
        .map(|token| ("bearer".to_string(), token))
}

fn parse_bearer_value(value: &str) -> Option<String> {
    let (scheme, token) = value.trim().split_once(' ')?;

    if !scheme.eq_ignore_ascii_case("bearer") {
        return None;
    }

    let token = token.trim();
    if token.is_empty() {
        None
    } else {
        Some(token.to_string())
    }
}

fn dedupe_params(params: Vec<RequestKeyValue>) -> Vec<RequestKeyValue> {
    let mut deduped = Vec::new();

    for param in params {
        if deduped.iter().any(|existing: &RequestKeyValue| {
            existing.key == param.key && existing.value == param.value
        }) {
            continue;
        }

        deduped.push(param);
    }

    deduped
}

fn slugify(value: &str) -> String {
    let slug = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    if slug.is_empty() {
        "collection".to_string()
    } else {
        slug
    }
}

#[derive(Debug, Deserialize)]
struct PostmanCollection {
    #[serde(default)]
    info: Option<PostmanInfo>,
    #[serde(default)]
    item: Vec<PostmanItem>,
}

#[derive(Debug, Deserialize)]
struct PostmanInfo {
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PostmanItem {
    name: Option<String>,
    #[serde(default)]
    item: Vec<PostmanItem>,
    request: Option<PostmanRequest>,
}

#[derive(Debug, Deserialize)]
struct PostmanRequest {
    method: Option<String>,
    url: PostmanUrl,
    #[serde(default)]
    header: Vec<PostmanHeader>,
    body: Option<PostmanBody>,
    auth: Option<PostmanAuth>,
}

#[derive(Debug, Deserialize)]
struct PostmanHeader {
    key: Option<String>,
    value: Option<String>,
    disabled: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct PostmanBody {
    raw: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PostmanAuth {
    #[serde(rename = "type")]
    auth_type: Option<String>,
    #[serde(default)]
    bearer: Vec<PostmanAuthEntry>,
}

#[derive(Debug, Deserialize)]
struct PostmanAuthEntry {
    key: Option<String>,
    value: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum PostmanUrl {
    String(String),
    Object(PostmanUrlObject),
}

#[derive(Debug, Deserialize)]
struct PostmanUrlObject {
    raw: Option<String>,
    protocol: Option<String>,
    host: Option<Vec<String>>,
    path: Option<Vec<String>>,
    #[serde(default)]
    query: Vec<PostmanQueryParam>,
}

#[derive(Debug, Deserialize)]
struct PostmanQueryParam {
    key: Option<String>,
    value: Option<String>,
    disabled: Option<bool>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_nested_postman_collection() {
        let requests = import_collection(PostmanImportInput {
            collection: "Fallback".to_string(),
            collection_file: "collections/imported.json".to_string(),
            collection_json: r#"{
              "info": { "name": "Imported API" },
              "item": [
                {
                  "name": "Workspace",
                  "item": [
                    {
                      "name": "Search",
                      "request": {
                        "method": "POST",
                        "url": {
                          "raw": "https://api.example.com/v1/search?q=workspace",
                          "query": [{ "key": "limit", "value": "20" }]
                        },
                        "header": [
                          { "key": "Accept", "value": "application/json" },
                          { "key": "Authorization", "value": "Bearer {{secret.prod_token}}" }
                        ],
                        "body": { "mode": "raw", "raw": "{\"preview\":true}" }
                      }
                    }
                  ]
                }
              ]
            }"#
            .to_string(),
        })
        .expect("import postman");

        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].id, "postman-imported-api-1");
        assert_eq!(requests[0].name, "Workspace / Search");
        assert_eq!(requests[0].collection, "Imported API");
        assert_eq!(requests[0].method, "POST");
        assert_eq!(requests[0].url, "https://api.example.com/v1/search");
        assert_eq!(requests[0].params.len(), 2);
        assert_eq!(requests[0].headers.len(), 1);
        assert_eq!(requests[0].auth_type, "bearer");
        assert_eq!(requests[0].auth_token, "{{secret.prod_token}}");
        assert_eq!(requests[0].body, "{\"preview\":true}");
    }

    #[test]
    fn rejects_collection_without_requests() {
        let error = import_collection(PostmanImportInput {
            collection: "Empty".to_string(),
            collection_file: "collections/empty.json".to_string(),
            collection_json: r#"{ "info": { "name": "Empty" }, "item": [] }"#.to_string(),
        })
        .expect_err("empty collection should fail");

        assert!(error.to_string().contains("does not contain any requests"));
    }

    #[test]
    fn imports_bearer_auth_from_postman_auth_object() {
        let requests = import_collection(PostmanImportInput {
            collection: "Auth API".to_string(),
            collection_file: "collections/auth.json".to_string(),
            collection_json: r#"{
              "item": [
                {
                  "name": "Profile",
                  "request": {
                    "method": "GET",
                    "url": {
                      "protocol": "https",
                      "host": ["api", "example", "com"],
                      "path": ["v1", "profile"]
                    },
                    "auth": {
                      "type": "bearer",
                      "bearer": [{ "key": "token", "value": "{{secret.profile_token}}" }]
                    }
                  }
                }
              ]
            }"#
            .to_string(),
        })
        .expect("import postman auth");

        assert_eq!(requests[0].url, "https://api.example.com/v1/profile");
        assert_eq!(requests[0].auth_type, "bearer");
        assert_eq!(requests[0].auth_token, "{{secret.profile_token}}");
    }
}
