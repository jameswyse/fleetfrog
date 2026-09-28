//! A small HTTP/1.1 client over TCP and rustls, for the few plain requests the agent makes: pairing
//! with the hub, and downloading updates from GitHub. An HTTP client crate would add more to the
//! binary than these need.

use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{
    AsyncBufRead, AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader,
};
use tokio::net::TcpStream;
use url::{Position, Url};

use crate::hub::tls;
use crate::machine::AGENT_VERSION;

pub trait Io: AsyncRead + AsyncWrite + Unpin + Send {}

impl<T: AsyncRead + AsyncWrite + Unpin + Send> Io for T {}

pub type Stream = Pin<Box<dyn Io>>;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
/// How long a response may go quiet. A slow download fails only once it stops arriving.
const READ_TIMEOUT: Duration = Duration::from_secs(60);
const MAXIMUM_HEAD: usize = 64 * 1024;
/// Well above any release asset, so a runaway response can't use up the machine's memory.
const MAXIMUM_BODY: usize = 64 * 1024 * 1024;
/// GitHub sends a release download through one redirect, to its storage host.
const MAXIMUM_REDIRECTS: usize = 5;

/// Opens a connection to the URL's host, with TLS when `tls` is given.
pub async fn open_stream(url: &Url, tls: Option<rustls::ClientConfig>) -> Result<Stream, String> {
    let host = url
        .host_str()
        .ok_or_else(|| format!("{url} has no host"))?
        .to_string();
    let port = url
        .port_or_known_default()
        .ok_or_else(|| format!("{url} has no port"))?;
    let bare = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_string();
    let timed_out = || format!("Timed out connecting to {bare}");
    let tcp = tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect((bare.as_str(), port)))
        .await
        .map_err(|_| timed_out())?
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
            .map_err(|_| timed_out())?
            .map_err(|error| error.to_string())?;

            Ok(Box::pin(stream))
        }
    }
}

pub struct Response {
    pub status: u16,
    pub body: Vec<u8>,
}

struct Head {
    status: u16,
    headers: Vec<(String, String)>,
}

impl Head {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(found, _)| found.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

/// Fails a read that goes quiet for too long.
async fn in_time<T>(reading: impl Future<Output = std::io::Result<T>>) -> Result<T, String> {
    match tokio::time::timeout(READ_TIMEOUT, reading).await {
        Err(_) => Err("The server stopped responding".into()),
        Ok(result) => result.map_err(|error| error.to_string()),
    }
}

/// Sends a request, asking the server to close the connection once it has responded.
async fn send(
    url: &Url,
    tls: Option<rustls::ClientConfig>,
    method: &str,
    headers: &[(&str, &str)],
    body: &[u8],
) -> Result<BufReader<Stream>, String> {
    let mut stream = open_stream(url, tls).await?;
    let host = match url.port() {
        Some(port) => format!("{}:{port}", url.host_str().unwrap_or("")),
        None => url.host_str().unwrap_or("").to_string(),
    };
    let target = &url[Position::BeforePath..Position::AfterQuery];
    let mut head = format!(
        "{method} {target} HTTP/1.1\r\nHost: {host}\r\nUser-Agent: fleetfrog-agent/{AGENT_VERSION}\r\nConnection: close\r\n"
    );

    for (name, value) in headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }

    if method != "GET" {
        head.push_str(&format!("Content-Length: {}\r\n", body.len()));
    }

    head.push_str("\r\n");
    in_time(async {
        stream.write_all(head.as_bytes()).await?;
        stream.write_all(body).await?;
        stream.flush().await
    })
    .await?;

    Ok(BufReader::new(stream))
}

/// One line of the response's head or chunk framing, without its line ending.
async fn read_line(
    reader: &mut (impl AsyncBufRead + Unpin),
    limit: usize,
) -> Result<String, String> {
    let mut line = Vec::new();

    in_time(
        (&mut *reader)
            .take(limit as u64)
            .read_until(b'\n', &mut line),
    )
    .await?;

    if line.pop() != Some(b'\n') {
        return Err("The server sent a malformed response".into());
    }

    if line.last() == Some(&b'\r') {
        line.pop();
    }

    Ok(String::from_utf8_lossy(&line).into_owned())
}

async fn read_head(reader: &mut (impl AsyncBufRead + Unpin)) -> Result<Head, String> {
    let malformed = || "The server sent a malformed response".to_string();
    let status_line = read_line(reader, MAXIMUM_HEAD).await?;
    let status = status_line
        .split(' ')
        .nth(1)
        .and_then(|code| code.parse().ok())
        .ok_or_else(malformed)?;
    let mut headers = Vec::new();
    let mut remaining = MAXIMUM_HEAD.saturating_sub(status_line.len());

    loop {
        let line = read_line(reader, remaining).await?;

        if line.is_empty() {
            return Ok(Head { status, headers });
        }

        remaining = remaining.saturating_sub(line.len() + 2);

        let (name, value) = line.split_once(':').ok_or_else(malformed)?;

        headers.push((name.trim().to_string(), value.trim().to_string()));
    }
}

/// Appends exactly `length` more bytes to `body`.
async fn read_exactly(
    reader: &mut (impl AsyncBufRead + Unpin),
    body: &mut Vec<u8>,
    length: usize,
) -> Result<(), String> {
    let end = body.len() + length;

    if end > MAXIMUM_BODY {
        return Err("The response is too large".into());
    }

    while body.len() < end {
        let available = in_time(reader.fill_buf()).await?;

        if available.is_empty() {
            return Err("The connection closed before the whole response arrived".into());
        }

        let taken = available.len().min(end - body.len());

        body.extend_from_slice(&available[..taken]);
        reader.consume(taken);
    }

    Ok(())
}

/// Reads the body the head describes: with a length, in chunks, or up to the end of the connection.
async fn read_body(
    reader: &mut (impl AsyncBufRead + Unpin),
    head: &Head,
) -> Result<Vec<u8>, String> {
    let malformed = || "The server sent a malformed response".to_string();
    let mut body = Vec::new();

    if head
        .header("transfer-encoding")
        .is_some_and(|encoding| encoding.to_ascii_lowercase().contains("chunked"))
    {
        loop {
            let line = read_line(reader, MAXIMUM_HEAD).await?;
            let size = usize::from_str_radix(line.split(';').next().unwrap_or("").trim(), 16)
                .map_err(|_| malformed())?;

            if size == 0 {
                return Ok(body);
            }

            read_exactly(reader, &mut body, size).await?;

            if !read_line(reader, 2).await?.is_empty() {
                return Err(malformed());
            }
        }
    }

    if let Some(length) = head.header("content-length") {
        let length = length.parse().map_err(|_| malformed())?;

        read_exactly(reader, &mut body, length).await?;

        return Ok(body);
    }

    loop {
        let available = match in_time(reader.fill_buf()).await {
            Ok(available) => available,
            // The server closed without TLS's close notification, which still ends the body here.
            Err(_) if !body.is_empty() => return Ok(body),
            Err(error) => return Err(error),
        };

        if available.is_empty() {
            return Ok(body);
        }

        if body.len() + available.len() > MAXIMUM_BODY {
            return Err("The response is too large".into());
        }

        let taken = available.len();

        body.extend_from_slice(available);
        reader.consume(taken);
    }
}

/// Sends one request and reads its response, whatever its status.
pub async fn request(
    url: &Url,
    tls: Option<rustls::ClientConfig>,
    method: &str,
    headers: &[(&str, &str)],
    body: &[u8],
) -> Result<Response, String> {
    let mut reader = send(url, tls, method, headers, body).await?;
    let head = read_head(&mut reader).await?;
    let body = read_body(&mut reader, &head).await?;

    Ok(Response {
        status: head.status,
        body,
    })
}

#[derive(Debug)]
pub enum GetError {
    /// The server answered with a status other than success.
    Status(u16),
    Failed(String),
}

impl std::fmt::Display for GetError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GetError::Status(status) => {
                write!(formatter, "The server answered with status {status}")
            }
            GetError::Failed(message) => formatter.write_str(message),
        }
    }
}

/// Where a redirect from `from` leads. Only HTTPS is followed, so a redirect can't take a download
/// off an encrypted connection.
fn redirect_target(from: &Url, location: Option<&str>) -> Result<Url, String> {
    let location = location.ok_or("The server redirected without saying where")?;
    let target = from
        .join(location)
        .map_err(|_| format!("The server redirected to an invalid address: {location}"))?;

    if target.scheme() != "https" {
        return Err(format!(
            "The server redirected to {target}, which isn't HTTPS"
        ));
    }

    Ok(target)
}

/// Downloads a publicly served HTTPS address, following redirects, and returns the body of a
/// successful response.
pub async fn get(url: &Url) -> Result<Vec<u8>, GetError> {
    if url.scheme() != "https" {
        return Err(GetError::Failed(format!("{url} isn't HTTPS")));
    }

    let mut current = url.clone();

    for _ in 0..=MAXIMUM_REDIRECTS {
        let tls = tls::client_config(None).map_err(GetError::Failed)?;
        let mut reader = send(&current, Some(tls), "GET", &[], &[])
            .await
            .map_err(GetError::Failed)?;
        let head = read_head(&mut reader).await.map_err(GetError::Failed)?;

        match head.status {
            200 => {
                return read_body(&mut reader, &head)
                    .await
                    .map_err(GetError::Failed);
            }
            301 | 302 | 303 | 307 | 308 => {
                current =
                    redirect_target(&current, head.header("location")).map_err(GetError::Failed)?;
            }
            status => return Err(GetError::Status(status)),
        }
    }

    Err(GetError::Failed(format!("Too many redirects from {url}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn read(response: &[u8]) -> Result<(u16, String), String> {
        let mut reader = BufReader::new(response);
        let head = read_head(&mut reader).await?;
        let body = read_body(&mut reader, &head).await?;

        Ok((head.status, String::from_utf8_lossy(&body).into_owned()))
    }

    #[tokio::test]
    async fn reads_bodies_by_length_in_chunks_and_to_the_end() {
        assert_eq!(
            read(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n[]extra").await,
            Ok((200, "[]".into()))
        );
        assert_eq!(
            read(b"HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n3\r\n[1,\r\n2;x=y\r\n2]\r\n0\r\n\r\n").await,
            Ok((200, "[1,2]".into()))
        );
        assert_eq!(
            read(b"HTTP/1.1 404 Not Found\r\n\r\nmissing").await,
            Ok((404, "missing".into()))
        );
        assert!(
            read(b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nshort")
                .await
                .is_err()
        );
        assert!(
            read(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n")
                .await
                .is_err()
        );
    }

    #[test]
    fn follows_redirects_only_to_https() {
        let from = Url::parse("https://github.com/owner/repo/releases/download/v1/asset").unwrap();

        assert_eq!(
            redirect_target(&from, Some("https://objects.example.com/a?sig=1"))
                .unwrap()
                .as_str(),
            "https://objects.example.com/a?sig=1"
        );
        assert_eq!(
            redirect_target(&from, Some("../v2/asset"))
                .unwrap()
                .as_str(),
            "https://github.com/owner/repo/releases/download/v2/asset"
        );
        assert!(redirect_target(&from, Some("http://objects.example.com/a")).is_err());
        assert!(redirect_target(&from, None).is_err());
    }
}
