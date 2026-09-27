//! The agent's authenticated WebSocket client. The hub is always the server: the agent sends
//! requests, streams its `Connect` request's commands, answers each chunk with an acknowledgement
//! so the hub sends the next, and pings every five seconds, treating a missed pong as a dropped
//! connection.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use url::Url;

use crate::config::AgentConfig;
use crate::process::Cancel;

use super::{hub_endpoint, open_stream, tls};

const PING_INTERVAL: Duration = Duration::from_secs(5);
/// As long as Effect's WebSocket waits for the hub to accept the connection.
const OPEN_TIMEOUT: Duration = Duration::from_secs(10);
const CLOSE_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, Clone)]
pub enum RpcError {
    /// The handler failed with this encoded error, such as `{"_tag":"Unauthorised"}`.
    Failure(Value),
    Defect(String),
    Disconnected,
}

impl RpcError {
    pub fn is_tagged(&self, tag: &str) -> bool {
        matches!(self, RpcError::Failure(error) if error.get("_tag").and_then(Value::as_str) == Some(tag))
    }
}

impl std::fmt::Display for RpcError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RpcError::Failure(error) => write!(formatter, "{error}"),
            RpcError::Defect(message) => formatter.write_str(message),
            RpcError::Disconnected => formatter.write_str("The connection to the hub closed"),
        }
    }
}

/// An item of a streamed response.
pub enum StreamItem {
    Value(Value),
    End(Result<(), RpcError>),
}

enum Pending {
    Call(oneshot::Sender<Result<Value, RpcError>>),
    Stream(mpsc::UnboundedSender<StreamItem>),
}

#[derive(Default)]
struct State {
    next_id: u64,
    pending: HashMap<u64, Pending>,
    closed: bool,
}

pub struct HubClient {
    outgoing: mpsc::UnboundedSender<Message>,
    state: Arc<Mutex<State>>,
    /// Cancelled once the socket drops.
    pub dropped: Cancel,
    tasks: Mutex<Vec<tokio::task::JoinHandle<()>>>,
}

/// How a response's exit reads: its value, or why it failed.
fn read_exit(exit: &Value) -> Result<Value, RpcError> {
    if exit.get("_tag").and_then(Value::as_str) == Some("Success") {
        return Ok(exit.get("value").cloned().unwrap_or(Value::Null));
    }

    let causes = exit
        .get("cause")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    if let Some(error) = causes
        .iter()
        .find(|cause| cause.get("_tag").and_then(Value::as_str) == Some("Fail"))
    {
        return Err(RpcError::Failure(
            error.get("error").cloned().unwrap_or(Value::Null),
        ));
    }

    match causes.iter().find_map(|cause| cause.get("defect")) {
        Some(defect) => Err(RpcError::Defect(
            defect
                .as_str()
                .map(String::from)
                .unwrap_or_else(|| defect.to_string()),
        )),
        None => Err(RpcError::Defect("The hub interrupted the request".into())),
    }
}

fn request_id(message: &Value) -> Option<u64> {
    let id = message.get("requestId")?;

    id.as_u64().or_else(|| id.as_str()?.parse().ok())
}

impl State {
    fn close(&mut self) {
        self.closed = true;

        for (_, pending) in self.pending.drain() {
            match pending {
                Pending::Call(reply) => {
                    let _ = reply.send(Err(RpcError::Disconnected));
                }
                Pending::Stream(items) => {
                    let _ = items.send(StreamItem::End(Err(RpcError::Disconnected)));
                }
            }
        }
    }

    /// Routes one message from the hub, returning an acknowledgement to send for a stream chunk.
    fn receive(&mut self, message: &Value) -> Option<Message> {
        match message.get("_tag").and_then(Value::as_str)? {
            "Chunk" => {
                let id = request_id(message)?;

                if let Some(Pending::Stream(items)) = self.pending.get(&id) {
                    for value in message
                        .get("values")
                        .and_then(Value::as_array)
                        .into_iter()
                        .flatten()
                    {
                        let _ = items.send(StreamItem::Value(value.clone()));
                    }
                }

                Some(Message::text(
                    json!({"_tag": "Ack", "requestId": id}).to_string(),
                ))
            }
            "Exit" => {
                let id = request_id(message)?;
                let result = read_exit(message.get("exit").unwrap_or(&Value::Null));

                match self.pending.remove(&id)? {
                    Pending::Call(reply) => {
                        let _ = reply.send(result);
                    }
                    Pending::Stream(items) => {
                        let _ = items.send(StreamItem::End(result.map(|_| ())));
                    }
                }

                None
            }
            "Defect" => {
                let defect = message
                    .get("defect")
                    .map(Value::to_string)
                    .unwrap_or_default();

                for (_, pending) in self.pending.drain() {
                    match pending {
                        Pending::Call(reply) => {
                            let _ = reply.send(Err(RpcError::Defect(defect.clone())));
                        }
                        Pending::Stream(items) => {
                            let _ =
                                items.send(StreamItem::End(Err(RpcError::Defect(defect.clone()))));
                        }
                    }
                }

                None
            }
            _ => None,
        }
    }
}

impl HubClient {
    /// Opens the WebSocket, sending the agent's token with the upgrade request.
    pub async fn connect(config: &AgentConfig) -> Result<HubClient, String> {
        let agent_url = Url::parse(&config.agent_url).map_err(|error| error.to_string())?;
        let url = hub_endpoint(&agent_url, "agent");
        let tls = if url.scheme() == "wss" {
            Some(tls::client_config(config.certificate_pem.as_deref())?)
        } else {
            None
        };
        let stream = open_stream(&url, tls).await?;
        let mut request = url
            .as_str()
            .into_client_request()
            .map_err(|error| error.to_string())?;
        let authorization = HeaderValue::from_str(&format!("Bearer {}", config.token))
            .map_err(|error| error.to_string())?;

        request.headers_mut().insert("authorization", authorization);

        let upgrade = tokio_tungstenite::client_async(request, stream);
        let (socket, _) = tokio::time::timeout(OPEN_TIMEOUT, upgrade)
            .await
            .map_err(|_| "Timed out opening the connection to the hub".to_string())?
            .map_err(|error| error.to_string())?;
        let (mut sink, mut source) = socket.split();
        let (outgoing, mut queued) = mpsc::unbounded_channel::<Message>();
        let state = Arc::new(Mutex::new(State::default()));
        let dropped = Cancel::new();
        let ponged = Arc::new(AtomicBool::new(true));
        // Pings run on their own, so a send stalled on a dead network still meets the deadline.
        let pinger = {
            let dropped = dropped.clone();
            let state = state.clone();
            let ponged = ponged.clone();
            let outgoing = outgoing.clone();

            tokio::spawn(async move {
                let mut pings = tokio::time::interval_at(
                    tokio::time::Instant::now() + PING_INTERVAL,
                    PING_INTERVAL,
                );

                loop {
                    tokio::select! {
                        () = dropped.cancelled() => break,
                        _ = pings.tick() => {}
                    }

                    // The previous ping went unanswered, so the connection is gone.
                    if !ponged.swap(false, Ordering::SeqCst) {
                        state.lock().unwrap().close();
                        dropped.cancel();
                        break;
                    }

                    let _ = outgoing.send(Message::text(r#"{"_tag":"Ping"}"#));
                }
            })
        };
        let writer = {
            let dropped = dropped.clone();
            let state = state.clone();

            tokio::spawn(async move {
                loop {
                    let message = tokio::select! {
                        biased;
                        () = dropped.cancelled() => break,
                        message = queued.recv() => match message {
                            Some(message) => message,
                            None => break,
                        },
                    };
                    let closing = matches!(message, Message::Close(_));
                    let sent = tokio::select! {
                        biased;
                        () = dropped.cancelled() => break,
                        sent = sink.send(message) => sent,
                    };

                    if sent.is_err() || closing {
                        break;
                    }
                }

                state.lock().unwrap().close();
                dropped.cancel();
                let _ = tokio::time::timeout(CLOSE_TIMEOUT, sink.close()).await;
            })
        };
        let reader = {
            let dropped = dropped.clone();
            let state = state.clone();
            let outgoing = outgoing.clone();

            tokio::spawn(async move {
                loop {
                    let frame = tokio::select! {
                        frame = source.next() => frame,
                        _ = dropped.cancelled() => break,
                    };
                    let text = match frame {
                        Some(Ok(Message::Text(text))) => text.to_string(),
                        Some(Ok(Message::Binary(bytes))) => {
                            String::from_utf8_lossy(&bytes).into_owned()
                        }
                        Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                        Some(Ok(_)) => continue,
                    };
                    let Ok(decoded) = serde_json::from_str::<Value>(&text) else {
                        crate::log::warning_only("Ignored a message from the hub that isn't JSON");
                        continue;
                    };
                    let messages = match decoded {
                        Value::Array(messages) => messages,
                        message => vec![message],
                    };

                    for message in messages {
                        if message.get("_tag").and_then(Value::as_str) == Some("Pong") {
                            ponged.store(true, Ordering::SeqCst);
                            continue;
                        }

                        let reply = state.lock().unwrap().receive(&message);

                        if let Some(reply) = reply {
                            let _ = outgoing.send(reply);
                        }
                    }
                }

                state.lock().unwrap().close();
                dropped.cancel();
            })
        };

        Ok(HubClient {
            outgoing,
            state,
            dropped,
            tasks: Mutex::new(vec![pinger, writer, reader]),
        })
    }

    fn send_request(
        &self,
        tag: &str,
        payload: Option<Value>,
        pending: Pending,
    ) -> Result<(), RpcError> {
        let mut state = self.state.lock().unwrap();

        if state.closed {
            return Err(RpcError::Disconnected);
        }

        let id = state.next_id;
        // Effect's JSON codec writes a request without a payload as null.
        let request = json!({
            "_tag": "Request",
            "id": id,
            "tag": tag,
            "payload": payload.unwrap_or(Value::Null),
            "headers": [],
        });

        state.next_id += 1;
        state.pending.insert(id, pending);
        self.outgoing
            .send(Message::text(request.to_string()))
            .map_err(|_| RpcError::Disconnected)
    }

    /// Sends a request and waits for its result.
    pub async fn call(&self, tag: &str, payload: Option<Value>) -> Result<Value, RpcError> {
        let (reply, result) = oneshot::channel();

        self.send_request(tag, payload, Pending::Call(reply))?;
        result.await.unwrap_or(Err(RpcError::Disconnected))
    }

    /// Sends a streaming request, whose values and end arrive on the returned channel.
    pub fn stream(
        &self,
        tag: &str,
        payload: Value,
    ) -> Result<mpsc::UnboundedReceiver<StreamItem>, RpcError> {
        let (items, received) = mpsc::unbounded_channel();

        self.send_request(tag, Some(payload), Pending::Stream(items))?;

        Ok(received)
    }

    /// Closes the connection and stops its tasks.
    pub async fn close(&self) {
        let _ = self.outgoing.send(Message::Close(None));
        let tasks = std::mem::take(&mut *self.tasks.lock().unwrap());

        for task in tasks {
            let _ = tokio::time::timeout(Duration::from_secs(2), task).await;
        }

        self.dropped.cancel();
    }
}
