use std::cmp::Ordering;
use std::process::Stdio;
use std::time::{Duration, Instant};

use futures_util::{FutureExt, SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use url::Url;

use crate::http::{self, Stream};
use crate::log;
use crate::paths;
use crate::process::run_tool;

const PREPARE_TIMEOUT: Duration = Duration::from_secs(25 * 60);
const COMMIT_TIMEOUT: Duration = Duration::from_secs(2 * 60);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const CLOSE_TIMEOUT: Duration = Duration::from_secs(2);
const DESCRIPTOR_TIMEOUT: Duration = Duration::from_secs(30);
const REVOKE_TIMEOUT: Duration = Duration::from_secs(5);
const REVOKE_POLL: Duration = Duration::from_millis(50);

const CLOSED_EARLY: &str = "T3 Code's server closed the connection before the update was ready.";

const UNSUPPORTED: &str =
    "FleetFrog doesn't support updating this version of T3 Code's desktop app.";

type Socket = WebSocketStream<Stream>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssuedSession {
    session_id: String,
    token: String,
}

async fn issue_session(cli: &str, home: &str) -> Result<IssuedSession, String> {
    let output = run_tool(
        cli,
        home,
        &[
            "auth",
            "session",
            "issue",
            "--base-dir",
            home,
            "--scope",
            "environment:maintain",
            "--scope",
            "orchestration:read",
            "--ttl",
            "30m",
            "--label",
            "FleetFrog",
            "--json",
        ],
    )
    .await
    .map_err(|error| format!("Couldn't start a session in T3 Code: {error}"))?;

    serde_json::from_str(&output).map_err(|_| {
        "Couldn't start a session in T3 Code: its command-line tool answered with something FleetFrog can't read.".to_string()
    })
}

struct Revocation<'a> {
    cli: &'a str,
    home: &'a str,
    id: Option<String>,
}

impl Revocation<'_> {
    fn command(&self, id: &str) -> std::process::Command {
        let mut command = std::process::Command::new(self.cli);

        command
            .args(["auth", "session", "revoke", id, "--base-dir", self.home])
            .current_dir(self.home)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        command
    }

    fn timed_out() -> String {
        format!("it took longer than {} seconds", REVOKE_TIMEOUT.as_secs())
    }

    fn ended(status: std::process::ExitStatus) -> Result<(), String> {
        if status.success() {
            Ok(())
        } else {
            Err(format!("it ended with {status}"))
        }
    }

    async fn revoke(mut self) {
        let Some(id) = self.id.clone() else {
            return;
        };
        let mut command = tokio::process::Command::from(self.command(&id));
        let revoked =
            match tokio::time::timeout(REVOKE_TIMEOUT, command.kill_on_drop(true).status()).await {
                Err(_) => Err(Self::timed_out()),
                Ok(status) => status
                    .map_err(|error| error.to_string())
                    .and_then(Self::ended),
            };

        self.id = None;

        if let Err(error) = revoked {
            log::warning("Could not revoke FleetFrog's session in T3 Code", error);
        }
    }

    fn revoke_now(&self, id: &str) -> Result<(), String> {
        let mut child = self
            .command(id)
            .spawn()
            .map_err(|error| error.to_string())?;
        let deadline = Instant::now() + REVOKE_TIMEOUT;

        loop {
            match child.try_wait().map_err(|error| error.to_string())? {
                Some(status) => return Self::ended(status),
                None if Instant::now() >= deadline => {
                    let _ = child.kill();
                    let _ = child.wait();

                    return Err(Self::timed_out());
                }
                None => std::thread::sleep(REVOKE_POLL),
            }
        }
    }
}

impl Drop for Revocation<'_> {
    fn drop(&mut self) {
        if let Some(id) = self.id.take()
            && let Err(error) = self.revoke_now(&id)
        {
            log::warning("Could not revoke FleetFrog's session in T3 Code", error);
        }
    }
}

fn version_parts(version: &str) -> Option<([u64; 3], Vec<&str>)> {
    let (core, prerelease) = match version.split_once('-') {
        None => (version, None),
        Some((core, prerelease)) => (core, Some(prerelease)),
    };
    let numbers: Vec<u64> = core
        .split('.')
        .map(|part| {
            part.bytes()
                .all(|byte| byte.is_ascii_digit())
                .then(|| part.parse().ok())
                .flatten()
        })
        .collect::<Option<_>>()?;
    let core: [u64; 3] = numbers.try_into().ok()?;
    let prerelease = match prerelease {
        None => Vec::new(),
        Some(text)
            if !text.is_empty()
                && text
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'-') =>
        {
            text.split('.').collect()
        }
        Some(_) => return None,
    };

    Some((core, prerelease))
}

fn compare_identifiers(left: &str, right: &str) -> Ordering {
    let number = |identifier: &str| {
        (!identifier.is_empty() && identifier.bytes().all(|byte| byte.is_ascii_digit()))
            .then(|| identifier.parse::<u64>().unwrap_or(u64::MAX))
    };

    match (number(left), number(right)) {
        (Some(left), Some(right)) => left.cmp(&right),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => left.cmp(right),
    }
}

fn is_newer(candidate: &str, current: &str) -> bool {
    let (Some((next_core, next)), Some((running_core, running))) =
        (version_parts(candidate), version_parts(current))
    else {
        return false;
    };

    if next_core != running_core {
        return next_core > running_core;
    }

    if next.is_empty() || running.is_empty() {
        return next.is_empty() && !running.is_empty();
    }

    for (index, identifier) in next.iter().enumerate() {
        let Some(other) = running.get(index) else {
            return true;
        };

        match compare_identifiers(identifier, other) {
            Ordering::Equal => {}
            order => return order == Ordering::Greater,
        }
    }

    false
}

fn running_version(descriptor: &Value) -> Option<String> {
    let capabilities = &descriptor["capabilities"];
    let supported = descriptor["orchestrationProtocolVersion"] == 2
        && capabilities["serverSelfUpdate"] == "desktop-managed"
        && capabilities["desktopAppUpdate"] == true
        && capabilities["serverSelfUpdateProgress"] == true;

    descriptor["serverVersion"]
        .as_str()
        .filter(|_| supported)
        .map(String::from)
}

async fn read_descriptor(port: i64) -> Result<String, String> {
    let url = Url::parse(&format!(
        "http://127.0.0.1:{port}/.well-known/t3/environment"
    ))
    .map_err(|error| error.to_string())?;
    let response = tokio::time::timeout(
        DESCRIPTOR_TIMEOUT,
        http::request(&url, None, "GET", &[], &[]),
    )
    .await
    .map_err(|_| {
        format!(
            "Couldn't reach T3 Code's server: it didn't answer within {} seconds.",
            DESCRIPTOR_TIMEOUT.as_secs()
        )
    })?
    .map_err(|error| format!("Couldn't reach T3 Code's server: {error}"))?;

    serde_json::from_slice::<Value>(&response.body)
        .ok()
        .filter(|_| response.status == 200)
        .and_then(|descriptor| running_version(&descriptor))
        .ok_or_else(|| UNSUPPORTED.to_string())
}

async fn connect(port: i64, token: &str) -> Result<Socket, String> {
    let failed = |error: String| format!("Couldn't connect to T3 Code's server: {error}");
    let url = Url::parse(&format!("ws://127.0.0.1:{port}/ws?orchestrationProtocol=2"))
        .map_err(|error| failed(error.to_string()))?;
    let stream = http::open_stream(&url, None).await.map_err(failed)?;
    let mut request = url
        .as_str()
        .into_client_request()
        .map_err(|error| failed(error.to_string()))?;
    let authorization = HeaderValue::from_str(&format!("Bearer {token}"))
        .map_err(|error| failed(error.to_string()))?;

    request.headers_mut().insert("authorization", authorization);

    let (socket, _) = tokio::time::timeout(
        CONNECT_TIMEOUT,
        tokio_tungstenite::client_async(request, stream),
    )
    .await
    .map_err(|_| failed("it didn't answer".into()))?
    .map_err(|error| failed(error.to_string()))?;

    Ok(socket)
}

async fn send(socket: &mut Socket, message: Value) -> Result<(), String> {
    socket
        .send(Message::text(message.to_string()))
        .await
        .map_err(|error| format!("Couldn't reach T3 Code's server: {error}"))
}

async fn request(socket: &mut Socket, id: &str, tag: &str, payload: Value) -> Result<(), String> {
    send(
        socket,
        json!({"_tag": "Request", "id": id, "tag": tag, "payload": payload, "headers": []}),
    )
    .await
}

enum Ended {
    Exit(Value),
    Closed,
}

async fn finish(socket: &mut Socket, id: &str, mut receive: impl FnMut(&Value)) -> Ended {
    while let Some(frame) = socket.next().await {
        let text = match frame {
            Ok(Message::Text(text)) => text.to_string(),
            Ok(Message::Binary(bytes)) => String::from_utf8_lossy(&bytes).into_owned(),
            Ok(Message::Close(_)) | Err(_) => break,
            Ok(_) => continue,
        };
        let envelopes = match serde_json::from_str::<Value>(&text) {
            Ok(Value::Array(envelopes)) => envelopes,
            Ok(envelope) => vec![envelope],
            Err(_) => continue,
        };

        for envelope in envelopes {
            let answers = envelope["requestId"] == id;

            match envelope["_tag"].as_str() {
                Some("Ping") => {
                    let _ = send(socket, json!({"_tag": "Pong"})).await;
                }
                Some("Chunk") if answers => {
                    for value in envelope["values"].as_array().into_iter().flatten() {
                        receive(value);
                    }

                    let _ = send(socket, json!({"_tag": "Ack", "requestId": id})).await;
                }
                Some("Exit") if answers => return Ended::Exit(envelope["exit"].clone()),
                _ => {}
            }
        }
    }

    Ended::Closed
}

fn failure_reason(exit: &Value) -> Option<String> {
    exit["cause"]
        .as_array()?
        .iter()
        .filter(|cause| cause["_tag"] == "Fail")
        .find_map(|cause| cause["error"]["reason"].as_str())
        .map(String::from)
}

fn succeeded(exit: &Value) -> bool {
    exit["_tag"] == "Success"
}

struct Prepared {
    target_version: String,
    token: String,
}

async fn prepare(socket: &mut Socket, version: &str) -> Result<Prepared, String> {
    request(
        socket,
        "1",
        "server.updateServerWithProgress",
        json!({"targetVersion": version}),
    )
    .await?;

    let mut stage = String::new();
    let mut complete = None;
    let ended = tokio::time::timeout(
        PREPARE_TIMEOUT,
        finish(socket, "1", |value| match value["type"].as_str() {
            Some("progress") => {
                let current = value["stage"].as_str().unwrap_or_default();

                if current != stage {
                    log::info(&format!("T3 Code's app is {current} the update"));
                    stage = current.to_string();
                }
            }
            Some("complete") => complete = Some(value["result"].clone()),
            _ => {}
        }),
    )
    .await
    .map_err(|_| {
        format!(
            "T3 Code's app took longer than {} minutes to prepare the update.",
            PREPARE_TIMEOUT.as_secs() / 60
        )
    })?;

    match ended {
        Ended::Closed => {
            return Err(CLOSED_EARLY.into());
        }
        Ended::Exit(exit) if !succeeded(&exit) => {
            return Err(failure_reason(&exit)
                .unwrap_or_else(|| "T3 Code's app couldn't prepare the update.".into()));
        }
        Ended::Exit(_) => {}
    }

    let result = complete.unwrap_or_default();

    match (
        result["method"].as_str(),
        result["targetVersion"].as_str(),
        result["desktopUpdateToken"].as_str(),
    ) {
        (Some("desktop-app"), Some(target_version), Some(token)) => Ok(Prepared {
            target_version: target_version.into(),
            token: token.into(),
        }),
        _ => Err(UNSUPPORTED.into()),
    }
}

fn still_open(socket: &mut Socket) -> bool {
    loop {
        match socket.next().now_or_never() {
            None => return true,
            Some(Some(Ok(Message::Close(_))) | Some(Err(_)) | None) => return false,
            Some(Some(Ok(_))) => {}
        }
    }
}

async fn commit(socket: &mut Socket, token: &str) -> Result<(), String> {
    if !still_open(socket) {
        return Err(CLOSED_EARLY.into());
    }

    request(
        socket,
        "2",
        "server.commitDesktopUpdate",
        json!({"requestId": token}),
    )
    .await
    .map_err(|_| CLOSED_EARLY.to_string())?;

    let ended = tokio::time::timeout(COMMIT_TIMEOUT, finish(socket, "2", |_| {}))
        .await
        .map_err(|_| {
            format!(
                "T3 Code's app didn't start installing the update within {} minutes.",
                COMMIT_TIMEOUT.as_secs() / 60
            )
        })?;

    match ended {
        Ended::Exit(exit) if !succeeded(&exit) => Err(failure_reason(&exit)
            .unwrap_or_else(|| "T3 Code's app couldn't install the update.".into())),
        Ended::Exit(_) | Ended::Closed => Ok(()),
    }
}

async fn exchange(
    socket: &mut Socket,
    running: &str,
    version: &str,
    still_idle: impl AsyncFn() -> Result<(), String>,
) -> Result<String, String> {
    let prepared = prepare(socket, version).await?;

    if !is_newer(&prepared.target_version, running) {
        return Err(format!(
            "T3 Code's app offered {}, which isn't newer than {running}.",
            prepared.target_version
        ));
    }

    still_idle().await?;
    commit(socket, &prepared.token).await?;

    Ok(prepared.target_version)
}

async fn update_with_session(
    port: i64,
    token: &str,
    version: &str,
    still_idle: impl AsyncFn() -> Result<(), String>,
) -> Result<String, String> {
    let running = read_descriptor(port).await?;
    let mut socket = connect(port, token).await?;
    let updated = exchange(&mut socket, &running, version, still_idle).await;
    let _ = tokio::time::timeout(CLOSE_TIMEOUT, socket.close(None)).await;

    updated
}

pub async fn update_app(
    home: &str,
    port: i64,
    version: &str,
    still_idle: impl AsyncFn() -> Result<(), String>,
) -> Result<String, String> {
    let cli = paths::join(home, "bin/t3");

    if !std::fs::metadata(&cli).is_ok_and(|found| found.is_file()) {
        return Err(format!(
            "Couldn't find T3 Code's command-line tool at {cli}."
        ));
    }

    let session = issue_session(&cli, home).await?;
    let revocation = Revocation {
        cli: &cli,
        home,
        id: Some(session.session_id),
    };
    let updated = update_with_session(port, &session.token, version, still_idle).await;

    revocation.revoke().await;
    updated
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Arc, Mutex};

    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    use tokio_tungstenite::tungstenite::handshake;
    use tokio_tungstenite::tungstenite::handshake::server::Callback;

    use super::*;

    enum Reply {
        Send(Value),
        Close,
    }

    #[derive(Default)]
    struct Seen {
        authorization: Option<String>,
        received: Vec<Value>,
        prepare_requested: Arc<tokio::sync::Notify>,
        connection_ended: Arc<tokio::sync::Notify>,
    }

    impl Seen {
        fn requests(&self, tag: &str) -> Vec<Value> {
            self.received
                .iter()
                .filter(|message| message["_tag"] == "Request" && message["tag"] == tag)
                .cloned()
                .collect()
        }

        fn count(&self, message: &Value) -> usize {
            self.received
                .iter()
                .filter(|received| *received == message)
                .count()
        }
    }

    struct Fake {
        descriptor: Value,
        prepare: Vec<Reply>,
        commit: Vec<Reply>,
    }

    fn descriptor(self_update: &str) -> Value {
        json!({
            "serverVersion": "0.0.45-nightly.20261001.2539",
            "orchestrationProtocolVersion": 2,
            "capabilities": {
                "serverSelfUpdate": self_update,
                "desktopAppUpdate": true,
                "serverSelfUpdateProgress": true,
            },
        })
    }

    fn chunk(values: Value) -> Value {
        json!({"_tag": "Chunk", "requestId": "1", "values": values})
    }

    fn complete(target_version: &str) -> Value {
        json!({
            "type": "complete",
            "result": {
                "targetVersion": target_version,
                "method": "desktop-app",
                "desktopUpdateToken": "prepared-1",
            },
        })
    }

    fn success(request_id: &str) -> Value {
        json!({"_tag": "Exit", "requestId": request_id, "exit": {"_tag": "Success", "value": null}})
    }

    fn prepared(target_version: &str) -> Vec<Reply> {
        vec![
            Reply::Send(json!([
                {"_tag": "Ping"},
                chunk(json!([{"type": "progress", "stage": "downloading"}])),
            ])),
            Reply::Send(chunk(json!([
                {"type": "progress", "stage": "installing"},
                complete(target_version),
            ]))),
            Reply::Send(success("1")),
        ]
    }

    async fn play(socket: &mut WebSocketStream<tokio::net::TcpStream>, replies: &[Reply]) -> bool {
        for reply in replies {
            match reply {
                Reply::Send(message) => {
                    socket
                        .send(Message::text(message.to_string()))
                        .await
                        .unwrap();
                }
                Reply::Close => {
                    let _ = socket.close(None).await;
                    return false;
                }
            }
        }

        true
    }

    async fn serve(fake: Fake) -> (i64, Arc<Mutex<Seen>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let seen = Arc::new(Mutex::new(Seen::default()));
        let recorded = seen.clone();

        tokio::spawn(async move {
            loop {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut start = [0u8; 64];
                let peeked = stream.peek(&mut start).await.unwrap();

                if start[..peeked].starts_with(b"GET /.well-known/t3/environment") {
                    let mut head = Vec::new();

                    while !head.ends_with(b"\r\n\r\n") {
                        head.push(stream.read_u8().await.unwrap());
                    }

                    let body = fake.descriptor.to_string();

                    stream
                        .write_all(
                            format!(
                                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                                body.len()
                            )
                            .as_bytes(),
                        )
                        .await
                        .unwrap();
                    let _ = stream.shutdown().await;
                    continue;
                }

                let mut socket =
                    tokio_tungstenite::accept_hdr_async(stream, Authorization(recorded.clone()))
                        .await
                        .unwrap();

                while let Some(Ok(frame)) = socket.next().await {
                    let Message::Text(text) = frame else {
                        continue;
                    };
                    let message: Value = serde_json::from_str(&text).unwrap();
                    let replies = match message["tag"].as_str() {
                        Some("server.updateServerWithProgress") => fake.prepare.as_slice(),
                        Some("server.commitDesktopUpdate") => fake.commit.as_slice(),
                        _ => &[],
                    };

                    let preparing = message["tag"] == "server.updateServerWithProgress";
                    let requested = {
                        let mut seen = recorded.lock().unwrap();

                        seen.received.push(message);
                        seen.prepare_requested.clone()
                    };

                    if preparing {
                        requested.notify_one();
                    }

                    if !play(&mut socket, replies).await {
                        break;
                    }
                }

                let ended = recorded.lock().unwrap().connection_ended.clone();

                ended.notify_one();
            }
        });

        (port as i64, seen)
    }

    struct Authorization(Arc<Mutex<Seen>>);

    impl Callback for Authorization {
        fn on_request(
            self,
            request: &handshake::server::Request,
            response: handshake::server::Response,
        ) -> Result<handshake::server::Response, handshake::server::ErrorResponse> {
            self.0.lock().unwrap().authorization = request
                .headers()
                .get("authorization")
                .and_then(|value| value.to_str().ok())
                .map(String::from);
            Ok(response)
        }
    }

    fn write_executable(path: &std::path::Path, script: &str) {
        let written = std::process::Command::new("sh")
            .args([
                "-c",
                "printf '%s' \"$2\" > \"$1\" && chmod 755 \"$1\"",
                "sh",
            ])
            .arg(path)
            .arg(script)
            .status()
            .unwrap();

        assert!(written.success());
    }

    struct Home(std::path::PathBuf);

    impl Home {
        fn new() -> Home {
            Home::with_revoke_taking("0")
        }

        fn with_revoke_taking(seconds: &str) -> Home {
            static NEXT: AtomicU64 = AtomicU64::new(0);

            let home = std::env::temp_dir().join(format!(
                "fleetfrog-t3code-app-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::SeqCst)
            ));
            let bin = home.join("bin");

            std::fs::create_dir_all(&bin).unwrap();
            write_executable(
                &bin.join("t3"),
                &format!(
                    "#!/bin/sh\necho \"$*\" >> \"$(dirname \"$0\")/../calls\"\nif [ \"$3\" = issue ]; then echo '{{\"sessionId\":\"session-1\",\"token\":\"secret-token\",\"method\":\"bearer-access-token\"}}'; fi\nif [ \"$3\" = revoke ]; then sleep {seconds}; fi\n"
                ),
            );
            Home(home)
        }

        fn path(&self) -> String {
            self.0.to_string_lossy().into_owned()
        }

        fn calls(&self) -> Vec<String> {
            std::fs::read_to_string(self.0.join("calls"))
                .unwrap_or_default()
                .lines()
                .map(String::from)
                .collect()
        }

        fn assert_revoked(&self) {
            let home = self.path();

            assert_eq!(
                self.calls(),
                vec![
                    format!(
                        "auth session issue --base-dir {home} --scope environment:maintain --scope orchestration:read --ttl 30m --label FleetFrog --json"
                    ),
                    format!("auth session revoke session-1 --base-dir {home}"),
                ]
            );
        }
    }

    impl Drop for Home {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    async fn ended(seen: &Arc<Mutex<Seen>>) {
        let ended = seen.lock().unwrap().connection_ended.clone();

        tokio::time::timeout(Duration::from_secs(30), ended.notified())
            .await
            .expect("the fake server's connection ended");
    }

    async fn idle() -> Result<(), String> {
        Ok(())
    }

    #[tokio::test]
    async fn prepares_and_commits_an_update_then_revokes_its_session() {
        let home = Home::new();
        let (port, seen) = serve(Fake {
            descriptor: descriptor("desktop-managed"),
            prepare: prepared("0.0.46-nightly.20261012.3021"),
            commit: vec![Reply::Close],
        })
        .await;

        let updated = update_app(&home.path(), port, "0.0.46-nightly.20261013.3050", idle).await;

        assert_eq!(updated, Ok("0.0.46-nightly.20261012.3021".into()));
        ended(&seen).await;

        let seen = seen.lock().unwrap();

        assert_eq!(seen.authorization.as_deref(), Some("Bearer secret-token"));
        assert_eq!(
            seen.requests("server.updateServerWithProgress"),
            vec![json!({
                "_tag": "Request",
                "id": "1",
                "tag": "server.updateServerWithProgress",
                "payload": {"targetVersion": "0.0.46-nightly.20261013.3050"},
                "headers": [],
            })]
        );
        assert_eq!(seen.count(&json!({"_tag": "Pong"})), 1);
        assert_eq!(seen.count(&json!({"_tag": "Ack", "requestId": "1"})), 2);
        assert_eq!(
            seen.requests("server.commitDesktopUpdate"),
            vec![json!({
                "_tag": "Request",
                "id": "2",
                "tag": "server.commitDesktopUpdate",
                "payload": {"requestId": "prepared-1"},
                "headers": [],
            })]
        );
        home.assert_revoked();
    }

    #[tokio::test]
    async fn revokes_without_holding_up_the_agent_when_the_update_ends() {
        let home = Home::with_revoke_taking("2");
        let (port, _) = serve(Fake {
            descriptor: descriptor("desktop-managed"),
            prepare: prepared("0.0.46-nightly.20261012.3021"),
            commit: vec![Reply::Close],
        })
        .await;
        let ticks = Arc::new(AtomicU64::new(0));
        let ticker = {
            let ticks = ticks.clone();

            tokio::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_millis(20)).await;
                    ticks.fetch_add(1, Ordering::SeqCst);
                }
            })
        };
        let started = Instant::now();

        let updated = update_app(&home.path(), port, "0.0.46", idle).await;

        ticker.abort();
        assert_eq!(updated, Ok("0.0.46-nightly.20261012.3021".into()));
        assert!(started.elapsed() >= Duration::from_secs(2));
        assert!(ticks.load(Ordering::SeqCst) >= 10);
        home.assert_revoked();
    }

    #[tokio::test]
    async fn fails_with_the_reason_t3_code_gives() {
        let home = Home::new();
        let (port, seen) = serve(Fake {
            descriptor: descriptor("desktop-managed"),
            prepare: vec![Reply::Send(json!({
                "_tag": "Exit",
                "requestId": "1",
                "exit": {
                    "_tag": "Failure",
                    "cause": [{
                        "_tag": "Fail",
                        "error": {"_tag": "ServerSelfUpdateError", "reason": "T3 Code is already up to date."},
                    }],
                },
            }))],
            commit: Vec::new(),
        })
        .await;

        let updated = update_app(&home.path(), port, "0.0.46", idle).await;

        assert_eq!(updated, Err("T3 Code is already up to date.".into()));
        ended(&seen).await;
        assert!(
            seen.lock()
                .unwrap()
                .requests("server.commitDesktopUpdate")
                .is_empty()
        );
        home.assert_revoked();
    }

    #[tokio::test]
    async fn refuses_a_prepared_update_without_a_result() {
        let home = Home::new();
        let (port, seen) = serve(Fake {
            descriptor: descriptor("desktop-managed"),
            prepare: vec![Reply::Send(success("1"))],
            commit: vec![Reply::Close],
        })
        .await;

        let updated = update_app(&home.path(), port, "0.0.46", idle).await;

        assert_eq!(updated, Err(UNSUPPORTED.into()));
        ended(&seen).await;
        assert!(
            seen.lock()
                .unwrap()
                .requests("server.commitDesktopUpdate")
                .is_empty()
        );
        home.assert_revoked();
    }

    #[tokio::test]
    async fn refuses_an_offered_version_that_is_not_newer() {
        let home = Home::new();
        let (port, seen) = serve(Fake {
            descriptor: descriptor("desktop-managed"),
            prepare: prepared("0.0.45-nightly.20261001.2539"),
            commit: vec![Reply::Close],
        })
        .await;

        let updated = update_app(&home.path(), port, "0.0.46", idle).await;

        assert_eq!(
            updated,
            Err("T3 Code's app offered 0.0.45-nightly.20261001.2539, which isn't newer than 0.0.45-nightly.20261001.2539.".into())
        );
        ended(&seen).await;
        assert!(
            seen.lock()
                .unwrap()
                .requests("server.commitDesktopUpdate")
                .is_empty()
        );
        home.assert_revoked();
    }

    #[tokio::test]
    async fn does_not_commit_when_a_thread_starts_working() {
        let home = Home::new();
        let (port, seen) = serve(Fake {
            descriptor: descriptor("desktop-managed"),
            prepare: prepared("0.0.46-nightly.20261012.3021"),
            commit: vec![Reply::Close],
        })
        .await;
        let working =
            async || Err("T3 Code is running 1 thread. Try again when it finishes.".to_string());

        let updated = update_app(&home.path(), port, "0.0.46", working).await;

        assert_eq!(
            updated,
            Err("T3 Code is running 1 thread. Try again when it finishes.".into())
        );
        ended(&seen).await;
        assert!(
            seen.lock()
                .unwrap()
                .requests("server.commitDesktopUpdate")
                .is_empty()
        );
        home.assert_revoked();
    }

    #[tokio::test]
    async fn fails_when_the_server_closes_before_the_commit_is_sent() {
        let home = Home::new();
        let mut prepare = prepared("0.0.46-nightly.20261012.3021");

        prepare.push(Reply::Close);

        let (port, seen) = serve(Fake {
            descriptor: descriptor("desktop-managed"),
            prepare,
            commit: Vec::new(),
        })
        .await;
        let closed = seen.lock().unwrap().connection_ended.clone();
        let closing = async || {
            closed.notified().await;
            tokio::time::sleep(Duration::from_millis(10)).await;
            Ok(())
        };

        let updated = update_app(&home.path(), port, "0.0.46", closing).await;

        assert_eq!(updated, Err(CLOSED_EARLY.into()));
        assert!(
            seen.lock()
                .unwrap()
                .requests("server.commitDesktopUpdate")
                .is_empty()
        );
        home.assert_revoked();
    }

    #[tokio::test]
    async fn revokes_its_session_when_the_update_is_abandoned() {
        let home = Home::new();
        let (port, seen) = serve(Fake {
            descriptor: descriptor("desktop-managed"),
            prepare: vec![Reply::Send(chunk(
                json!([{"type": "progress", "stage": "downloading"}]),
            ))],
            commit: Vec::new(),
        })
        .await;

        let requested = seen.lock().unwrap().prepare_requested.clone();
        let path = home.path();

        tokio::select! {
            updated = update_app(&path, port, "0.0.46", idle) => {
                panic!("the update finished without its preparation: {updated:?}");
            }
            () = requested.notified() => {}
        }

        assert_eq!(
            seen.lock()
                .unwrap()
                .requests("server.updateServerWithProgress")
                .len(),
            1
        );
        home.assert_revoked();
    }

    #[tokio::test]
    async fn refuses_a_server_that_does_not_offer_desktop_updates() {
        let home = Home::new();
        let (port, seen) = serve(Fake {
            descriptor: descriptor("boot-service"),
            prepare: prepared("0.0.46-nightly.20261012.3021"),
            commit: vec![Reply::Close],
        })
        .await;

        let updated = update_app(&home.path(), port, "0.0.46", idle).await;

        assert_eq!(updated, Err(UNSUPPORTED.into()));
        assert!(seen.lock().unwrap().received.is_empty());
        home.assert_revoked();
    }

    #[tokio::test]
    async fn needs_t3_codes_command_line_tool() {
        let home = std::env::temp_dir().join("fleetfrog-t3code-app-missing");

        assert_eq!(
            update_app(&home.to_string_lossy(), 1, "0.0.46", idle).await,
            Err(format!(
                "Couldn't find T3 Code's command-line tool at {}/bin/t3.",
                home.display()
            ))
        );
    }

    #[test]
    fn compares_versions_as_the_hub_does() {
        assert!(is_newer(
            "0.0.46-nightly.20261012.3021",
            "0.0.46-nightly.20261011.2980"
        ));
        assert!(is_newer("0.0.47", "0.0.46"));
        assert!(is_newer("0.0.46", "0.0.46-nightly.20261012.3021"));
        assert!(is_newer("1.0.0-alpha.1", "1.0.0-alpha"));
        assert!(is_newer("1.0.0-alpha.beta", "1.0.0-alpha.1"));
        assert!(is_newer("1.0.0-rc.10", "1.0.0-rc.9"));
        assert!(!is_newer("0.0.46-nightly.20261012.3021", "0.0.46"));
        assert!(!is_newer("0.0.46", "0.0.46"));
        assert!(!is_newer("0.0.45", "0.0.46"));
        assert!(!is_newer("latest", "0.0.46"));
        assert!(!is_newer("0.0.47+build", "0.0.46"));
    }
}
