use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use reqwest::blocking::multipart;

use crate::error::{AppError, AppResult};
use crate::models::{FileDownloadInput, FileDownloadResult, FileUploadInput, FileUploadResult};
use crate::transport;

pub fn upload_file(input: FileUploadInput) -> AppResult<FileUploadResult> {
    let environment = transport::environment_map(&input.environment.vars);
    let url = transport::resolve_template(&input.url, &environment)?;
    let file_path = PathBuf::from(transport::resolve_template(&input.file_path, &environment)?);
    validate_existing_file(&file_path)?;
    let field_name = input
        .field_name
        .trim()
        .is_empty()
        .then_some("file")
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| input.field_name.trim().to_string());
    let metadata = fs::metadata(&file_path)?;
    let file_name = file_path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "upload.bin".to_string());
    let headers = transport::build_headers(&input.headers, &environment)?;
    let form = multipart::Form::new()
        .file(field_name, &file_path)
        .map_err(|error| AppError::InvalidData(error.to_string()))?;
    let client = transport::build_client(&environment)?;
    let started_at = Instant::now();
    let response = client
        .post(url)
        .headers(headers)
        .multipart(form)
        .send()
        .map_err(|error| AppError::InvalidData(error.to_string()))?;
    let elapsed = started_at.elapsed();
    let status = response.status();
    let response_body = response
        .text()
        .map_err(|error| AppError::InvalidData(error.to_string()))?;

    Ok(FileUploadResult {
        status: format!(
            "{} {}",
            status.as_u16(),
            status.canonical_reason().unwrap_or("Unknown")
        ),
        duration_ms: elapsed.as_millis() as i64,
        size_bytes: metadata.len(),
        file_name,
        response_body,
    })
}

pub fn download_file(input: FileDownloadInput) -> AppResult<FileDownloadResult> {
    let environment = transport::environment_map(&input.environment.vars);
    let url = transport::resolve_template(&input.url, &environment)?;
    let destination_path = PathBuf::from(transport::resolve_template(
        &input.destination_path,
        &environment,
    )?);
    validate_destination_path(&destination_path, input.overwrite)?;
    let headers = transport::build_headers(&input.headers, &environment)?;
    let client = transport::build_client(&environment)?;
    let started_at = Instant::now();
    let response = client
        .get(url)
        .headers(headers)
        .send()
        .map_err(|error| AppError::InvalidData(error.to_string()))?;
    let elapsed = started_at.elapsed();
    let status = response.status();
    let bytes = response
        .bytes()
        .map_err(|error| AppError::InvalidData(error.to_string()))?;

    if let Some(parent) = destination_path.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::write(&destination_path, &bytes)?;

    Ok(FileDownloadResult {
        status: format!(
            "{} {}",
            status.as_u16(),
            status.canonical_reason().unwrap_or("Unknown")
        ),
        duration_ms: elapsed.as_millis() as i64,
        size_bytes: bytes.len() as u64,
        destination_path: destination_path.to_string_lossy().into_owned(),
    })
}

fn validate_existing_file(path: &Path) -> AppResult<()> {
    let metadata = fs::metadata(path)?;

    if !metadata.is_file() {
        return Err(AppError::InvalidData(format!(
            "upload path is not a file: {}",
            path.display()
        )));
    }

    Ok(())
}

fn validate_destination_path(path: &Path, overwrite: bool) -> AppResult<()> {
    if path.as_os_str().is_empty() {
        return Err(AppError::InvalidData(
            "download destination path is required".to_string(),
        ));
    }

    if path.exists() && !overwrite {
        return Err(AppError::InvalidData(format!(
            "download destination already exists: {}",
            path.display()
        )));
    }

    if path.exists() && path.is_dir() {
        return Err(AppError::InvalidData(format!(
            "download destination is a directory: {}",
            path.display()
        )));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::io::Read;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;
    use crate::models::{EnvironmentSummary, EnvironmentVariable};

    fn temp_path(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("api-client-file-transfer-{label}-{nonce}"))
    }

    #[test]
    fn multipart_form_contains_file_field_and_content() {
        let root = temp_path("upload-form");
        fs::create_dir_all(&root).expect("create temp root");
        let upload_path = root.join("sample.txt");
        fs::write(&upload_path, "hello upload").expect("write upload file");

        let form = multipart::Form::new()
            .file("asset", &upload_path)
            .expect("add file");
        let mut body = String::new();
        form.into_reader()
            .read_to_string(&mut body)
            .expect("read multipart body");

        assert!(body.contains("name=\"asset\""));
        assert!(body.contains("filename=\"sample.txt\""));
        assert!(body.contains("hello upload"));
    }

    #[test]
    fn download_rejects_existing_destination_without_overwrite() {
        let destination = temp_path("download-existing.txt");
        fs::write(&destination, "existing").expect("write existing destination");

        let error = validate_destination_path(&destination, false)
            .expect_err("existing destination should require overwrite");

        assert!(error.to_string().contains("already exists"));
    }

    #[test]
    fn templates_resolve_environment_tokens_for_transfer_inputs() {
        let environment = EnvironmentSummary {
            name: "Local".to_string(),
            file_path: "environments/local.json".to_string(),
            vars: vec![EnvironmentVariable {
                key: "base_url".to_string(),
                value: "https://api.example.com".to_string(),
            }],
        };
        let resolved = transport::resolve_template(
            "{{base_url}}/files/{{env.base_url}}",
            &transport::environment_map(&environment.vars),
        )
        .expect("resolve template");

        assert_eq!(
            resolved,
            "https://api.example.com/files/https://api.example.com"
        );
    }
}
