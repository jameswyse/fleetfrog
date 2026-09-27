//! Talking to the hub with Effect RPC's JSON protocol: WebSocket for a paired agent, and one HTTPS
//! request for pairing. Requests, stream chunks, acknowledgements and pings follow
//! `effect/unstable/rpc` as the hub serves it.

pub mod rpc;
pub mod tls;

use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use url::Url;

pub trait Io: AsyncRead + AsyncWrite + Unpin + Send {}

impl<T: AsyncRead + AsyncWrite + Unpin + Send> Io for T {}

pub type Stream = Pin<Box<dyn Io>>;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);

/// An endpoint below the agent URL, keeping any path prefix a reverse proxy adds. Pairing uses the
/// HTTP scheme that matches the WebSocket one.
pub fn hub_endpoint(agent_url: &Url, endpoint: &str) -> Url {
    let mut base = agent_url.clone();

    if !base.path().ends_with('/') {
        let path = format!("{}/", base.path());

        base.set_path(&path);
    }

    let mut url = base.join(endpoint).unwrap_or(base);

    if endpoint == "pair" {
        let _ = url.set_scheme(if agent_url.scheme() == "ws" {
            "http"
        } else {
            "https"
        });
    }

    url
}

/// Opens a connection to the URL's host, with TLS for `wss` and `https`.
pub async fn open_stream(url: &Url, tls: Option<rustls::ClientConfig>) -> Result<Stream, String> {
    let host = url
        .host_str()
        .ok_or("The hub's address has no host")?
        .to_string();
    let port = url
        .port_or_known_default()
        .ok_or("The hub's address has no port")?;
    let bare = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_string();
    let tcp = tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect((bare.as_str(), port)))
        .await
        .map_err(|_| "Timed out connecting to the hub".to_string())?
        .map_err(|error| error.to_string())?;

    let _ = tcp.set_nodelay(true);

    match tls {
        None => Ok(Box::pin(tcp)),
        Some(config) => {
            let connector = tokio_rustls::TlsConnector::from(Arc::new(config));
            let stream = tokio::time::timeout(
                CONNECT_TIMEOUT,
                connector.connect(tls::server_name(&host)?, tcp),
            )
            .await
            .map_err(|_| "Timed out connecting to the hub".to_string())?
            .map_err(|error| error.to_string())?;

            Ok(Box::pin(stream))
        }
    }
}

fn is_secure(url: &Url) -> bool {
    matches!(url.scheme(), "wss" | "https")
}

/// Posts a JSON body and returns the response's status and body, for the pairing request.
pub async fn post_json(
    url: &Url,
    certificate_pem: Option<&str>,
    body: &str,
) -> Result<(u16, String), String> {
    let tls = if is_secure(url) {
        Some(tls::client_config(certificate_pem)?)
    } else {
        None
    };
    let mut stream = open_stream(url, tls).await?;
    let host = match url.port() {
        Some(port) => format!("{}:{port}", url.host_str().unwrap_or("")),
        None => url.host_str().unwrap_or("").to_string(),
    };
    let target = match url.query() {
        Some(query) => format!("{}?{query}", url.path()),
        None => url.path().to_string(),
    };
    let request = format!(
        "POST {target} HTTP/1.1\r\nHost: {host}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );

    stream
        .write_all(request.as_bytes())
        .await
        .map_err(|error| error.to_string())?;
    stream.flush().await.map_err(|error| error.to_string())?;

    let mut response = Vec::new();
    let reading = stream.read_to_end(&mut response);

    // A server that closes without TLS's close notification still sent a complete response.
    match tokio::time::timeout(Duration::from_secs(60), reading).await {
        Err(_) => return Err("Timed out waiting for the hub".into()),
        Ok(Err(error)) if response.is_empty() => return Err(error.to_string()),
        Ok(_) => {}
    }

    parse_http_response(&response)
}

fn parse_http_response(response: &[u8]) -> Result<(u16, String), String> {
    let split = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or("The hub sent an incomplete response")?;
    let head = String::from_utf8_lossy(&response[..split]);
    let mut body = response[split + 4..].to_vec();
    let mut lines = head.split("\r\n");
    let status = lines
        .next()
        .and_then(|line| line.split(' ').nth(1))
        .and_then(|code| code.parse().ok())
        .ok_or("The hub sent a malformed response")?;
    let chunked = lines.any(|line| {
        let (name, value) = line.split_once(':').unwrap_or((line, ""));

        name.trim().eq_ignore_ascii_case("transfer-encoding")
            && value.to_ascii_lowercase().contains("chunked")
    });

    if chunked {
        body = decode_chunked(&body).ok_or("The hub sent a malformed response")?;
    }

    Ok((status, String::from_utf8_lossy(&body).into_owned()))
}

fn decode_chunked(mut body: &[u8]) -> Option<Vec<u8>> {
    let mut decoded = Vec::new();

    loop {
        let line_end = body.windows(2).position(|window| window == b"\r\n")?;
        let size_text = std::str::from_utf8(&body[..line_end]).ok()?;
        let size = usize::from_str_radix(size_text.split(';').next()?.trim(), 16).ok()?;

        body = &body[line_end + 2..];

        if size == 0 {
            return Some(decoded);
        }

        decoded.extend_from_slice(body.get(..size)?);
        body = body.get(size + 2..)?;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn places_endpoints_below_the_agent_url() {
        let url = |text: &str| Url::parse(text).unwrap();

        assert_eq!(
            hub_endpoint(&url("wss://10.0.0.5:7421"), "agent").as_str(),
            "wss://10.0.0.5:7421/agent"
        );
        assert_eq!(
            hub_endpoint(&url("wss://hub.example.com/fleetfrog"), "pair").as_str(),
            "https://hub.example.com/fleetfrog/pair"
        );
        assert_eq!(
            hub_endpoint(&url("ws://localhost:7421/"), "pair").as_str(),
            "http://localhost:7421/pair"
        );
    }

    #[test]
    fn reads_plain_and_chunked_responses() {
        assert_eq!(
            parse_http_response(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n[]").unwrap(),
            (200, "[]".into())
        );
        assert_eq!(
            parse_http_response(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\n[1,\r\n2\r\n2]\r\n0\r\n\r\n").unwrap(),
            (200, "[1,2]".into())
        );
    }
}
