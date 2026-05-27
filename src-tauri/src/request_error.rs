//! Structured error type for the `send_request` command (B10).
//!
//! Pre-B10 the command returned `Result<_, String>`, which gave the frontend
//! a single human-readable string with no machine-readable category. That made
//! it impossible to render useful UI (e.g. a "Retry" button that knows the
//! request *can* be retried vs. one whose URL is malformed) or to localize
//! the error message.
//!
//! This module introduces [`RequestError`], a small typed struct that the
//! frontend can pattern-match against. The `kind` field is the stable
//! machine-readable category; `code` is a finer-grained sub-code; `message`
//! is the original human-readable description from the underlying library
//! (`reqwest::Error`, `std::io::Error`, …) preserved verbatim so power users
//! can still see the upstream detail.

use serde::Serialize;
use std::error::Error as StdError;

/// Top-level error category. Stable across releases — the frontend uses these
/// to pick icons, retry behaviour, and localized strings.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    /// The user (or app) cancelled the request mid-flight.
    Cancelled,
    /// Timed out before the server returned headers / a body.
    Timeout,
    /// DNS lookup failed.
    Dns,
    /// TCP connection failed (refused, host unreachable, …).
    Connection,
    /// TLS handshake / certificate validation failed.
    Tls,
    /// Proxy URL was malformed or the proxy refused the connection.
    Proxy,
    /// The configured client certificate could not be loaded.
    ClientCertificate,
    /// Caller-supplied input (URL, method, header name/value) was invalid.
    /// Retrying without fixing the input would just fail again.
    Input,
    /// Too many redirects, redirect loop, or invalid redirect target.
    Redirect,
    /// The response was received but reading the body failed mid-stream.
    Body,
    /// Anything we don't (yet) classify. The default fallback.
    Unknown,
}

impl ErrorKind {
    /// Whether a UI "Retry" button makes sense for this category.
    /// `false` for input-class errors (URL/method/header malformed) and
    /// cancellation, where blindly retrying would not help.
    pub fn is_retryable(self) -> bool {
        !matches!(self, ErrorKind::Input | ErrorKind::Cancelled)
    }
}

/// Wire-format error returned from `send_request`. Serializes to JSON;
/// the frontend has a matching TypeScript interface.
#[derive(Debug, Clone, Serialize)]
pub struct RequestError {
    /// Stable category — see [`ErrorKind`].
    pub kind: ErrorKind,
    /// Finer-grained sub-code (e.g. `"INVALID_HEADER_NAME"`). Free-form but
    /// stable within a given `kind`.
    pub code: &'static str,
    /// Human-readable description, suitable for display. Includes the
    /// original library error message so power users can still debug.
    pub message: String,
    /// Whether retrying the request unchanged is likely to succeed. Derived
    /// from `kind` but stored so the frontend doesn't have to know the
    /// retryability rules.
    pub retryable: bool,
}

impl RequestError {
    pub fn new(kind: ErrorKind, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            kind,
            code,
            message: message.into(),
            retryable: kind.is_retryable(),
        }
    }

    pub fn cancelled() -> Self {
        Self::new(ErrorKind::Cancelled, "CANCELLED", "Request cancelled")
    }

    pub fn input(code: &'static str, message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Input, code, message)
    }
}

/// Classify a `reqwest::Error` into an [`ErrorKind`].
///
/// `reqwest::Error` has predicates (`is_timeout`, `is_connect`, …) but only
/// a few of them; for everything else we walk the chain of sources looking
/// for typed std/hyper/rustls errors. Order matters — more specific
/// predicates first.
pub fn classify_reqwest(err: &reqwest::Error) -> (ErrorKind, &'static str) {
    if err.is_timeout() {
        return (ErrorKind::Timeout, "TIMEOUT");
    }
    if err.is_redirect() {
        return (ErrorKind::Redirect, "REDIRECT_LIMIT");
    }
    if err.is_body() {
        return (ErrorKind::Body, "BODY_READ_FAILED");
    }

    // Walk the error source chain — reqwest wraps hyper/rustls errors here.
    let mut source: Option<&(dyn StdError + 'static)> = err.source();
    let mut chain_text = format!("{}", err);
    while let Some(s) = source {
        chain_text.push_str(" / ");
        chain_text.push_str(&s.to_string());
        if let Some(io_err) = s.downcast_ref::<std::io::Error>() {
            // io::ErrorKind covers the most common transport failures.
            use std::io::ErrorKind as IoKind;
            return match io_err.kind() {
                IoKind::TimedOut => (ErrorKind::Timeout, "TIMEOUT"),
                IoKind::ConnectionRefused => (ErrorKind::Connection, "CONNECTION_REFUSED"),
                IoKind::ConnectionReset => (ErrorKind::Connection, "CONNECTION_RESET"),
                IoKind::ConnectionAborted => (ErrorKind::Connection, "CONNECTION_ABORTED"),
                IoKind::NotConnected => (ErrorKind::Connection, "NOT_CONNECTED"),
                IoKind::AddrNotAvailable => (ErrorKind::Connection, "ADDR_NOT_AVAILABLE"),
                IoKind::HostUnreachable | IoKind::NetworkUnreachable => {
                    (ErrorKind::Connection, "HOST_UNREACHABLE")
                }
                _ => (ErrorKind::Connection, "IO_ERROR"),
            };
        }
        source = s.source();
    }

    // Fallback: heuristic string match. We try to keep this short — most
    // failures are caught above.
    let lower = chain_text.to_lowercase();
    if lower.contains("dns") || lower.contains("name resolution") || lower.contains("nodename") {
        return (ErrorKind::Dns, "DNS_FAILED");
    }
    if lower.contains("certificate") || lower.contains("ssl") || lower.contains("tls") {
        return (ErrorKind::Tls, "TLS_FAILED");
    }
    if err.is_connect() {
        return (ErrorKind::Connection, "CONNECTION_FAILED");
    }
    if err.is_request() {
        return (ErrorKind::Input, "BAD_REQUEST");
    }
    (ErrorKind::Unknown, "UNKNOWN")
}

/// Wrap a `reqwest::Error` into a [`RequestError`]. The original error
/// message is preserved in `message` for debuggability.
pub fn from_reqwest(err: reqwest::Error) -> RequestError {
    let (kind, code) = classify_reqwest(&err);
    RequestError::new(kind, code, err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retryable_classification() {
        // Network-class errors are retryable.
        assert!(ErrorKind::Timeout.is_retryable());
        assert!(ErrorKind::Dns.is_retryable());
        assert!(ErrorKind::Connection.is_retryable());
        assert!(ErrorKind::Tls.is_retryable());
        assert!(ErrorKind::Body.is_retryable());
        assert!(ErrorKind::Unknown.is_retryable());

        // Input-class errors and cancellation are NOT retryable.
        assert!(!ErrorKind::Input.is_retryable());
        assert!(!ErrorKind::Cancelled.is_retryable());
    }

    #[test]
    fn structured_error_serializes() {
        let err = RequestError::input("INVALID_URL", "scheme missing");
        let json = serde_json::to_string(&err).expect("serialize");
        // Stable wire format the frontend depends on.
        assert!(json.contains(r#""kind":"input""#));
        assert!(json.contains(r#""code":"INVALID_URL""#));
        assert!(json.contains(r#""retryable":false"#));
        assert!(json.contains(r#""message":"scheme missing""#));
    }

    #[test]
    fn cancelled_builder() {
        let err = RequestError::cancelled();
        assert_eq!(err.kind, ErrorKind::Cancelled);
        assert_eq!(err.code, "CANCELLED");
        assert!(!err.retryable);
    }

    #[test]
    fn classify_timeout_via_reqwest() {
        // reqwest::Error doesn't have a public constructor we can use here,
        // so we test the timeout path by triggering a real timeout against a
        // black-hole address. This is a smoke test; the unit asserts that
        // the classifier produces a Timeout/Connection kind, not the exact
        // message.
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("rt");
        let kind = rt.block_on(async {
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_millis(1))
                .build()
                .expect("client");
            // 192.0.2.x is reserved for documentation per RFC 5737 — packets
            // to it are dropped, so we reliably get a timeout/connect error.
            let err = client
                .get("http://192.0.2.1/")
                .send()
                .await
                .expect_err("expected error");
            classify_reqwest(&err).0
        });
        // Either timeout or connect failure is acceptable depending on the
        // OS — both classify into a retryable network category.
        assert!(matches!(
            kind,
            ErrorKind::Timeout | ErrorKind::Connection | ErrorKind::Dns
        ));
    }

    #[test]
    fn classify_bad_url_input() {
        // A malformed URL inside the URL crate path won't go through reqwest
        // at all — it's caught earlier as `RequestError::input(...)`. We
        // sanity-check the input builder here.
        let err = RequestError::input("INVALID_URL", "scheme missing");
        assert_eq!(err.kind, ErrorKind::Input);
        assert!(!err.retryable);
    }
}
