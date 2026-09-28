//! Redeeming a pairing string with the hub and saving the credentials it returns.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine;
use serde_json::{Value, json};
use url::Url;

use crate::audit::{self, AuditEntry};
use crate::config::{AgentConfig, ConfigUnavailable, ensure_config_writable, save_agent_config};
use crate::http::open_stream;
use crate::hub::{hub_endpoint, post_json, tls};
use crate::machine::{read_machine_info, suggest_discovery_roots};

pub enum PairError {
    Refused(String),
    InvalidPairingCode,
    CertificateMismatch,
    ConfigUnavailable(ConfigUnavailable),
    HubUnreachable(String),
}

const PREFIX: &str = "ffp1_";
const LOOPBACK_HOSTS: [&str; 3] = ["localhost", "127.0.0.1", "[::1]"];

/// Everything an agent needs to pair with a hub, packed into one pasteable string.
pub struct PairingInvite {
    pub agent_url: String,
    pub code: String,
    /// SHA-256 fingerprint of the hub's self-signed certificate, absent behind a public one.
    pub certificate_fingerprint: Option<String>,
}

pub fn decode_pairing_string(value: &str) -> Option<PairingInvite> {
    let engine = base64::engine::GeneralPurpose::new(
        &base64::alphabet::URL_SAFE,
        base64::engine::GeneralPurposeConfig::new()
            .with_decode_padding_mode(base64::engine::DecodePaddingMode::Indifferent),
    );
    let bytes = engine.decode(value.trim().strip_prefix(PREFIX)?).ok()?;
    let invite: Value = serde_json::from_slice(&bytes).ok()?;
    let text = |key: &str| invite.get(key)?.as_str().map(String::from);

    Some(PairingInvite {
        agent_url: text("agentUrl")?,
        code: text("code")?,
        certificate_fingerprint: match invite.get("certificateFingerprint")? {
            Value::Null => None,
            Value::String(fingerprint) => Some(fingerprint.clone()),
            _ => return None,
        },
    })
}

/// Fetches the hub's certificate without trusting it, then accepts it only if it matches the
/// fingerprint from the pairing string. Nothing is sent to the hub before that check.
async fn fetch_pinned_certificate(url: &Url, fingerprint: &str) -> Result<String, PairError> {
    let seen = Arc::new(Mutex::new(None));
    let connecting = open_stream(url, Some(tls::recording_config(seen.clone())));

    match tokio::time::timeout(Duration::from_secs(15), connecting).await {
        Err(_) => {
            return Err(PairError::HubUnreachable(
                "Timed out connecting to the hub".into(),
            ));
        }
        Ok(Err(message)) => return Err(PairError::HubUnreachable(message)),
        Ok(Ok(_)) => {}
    }

    let certificate = seen
        .lock()
        .unwrap()
        .take()
        .ok_or_else(|| PairError::HubUnreachable("The hub presented no certificate".into()))?;

    if tls::fingerprint(&certificate) == fingerprint {
        Ok(tls::to_pem(&certificate))
    } else {
        Err(PairError::CertificateMismatch)
    }
}

/// Redeems a pairing string with the hub and saves the resulting credentials. Returns the
/// machine's id.
pub async fn pair_with_hub(pairing_string: &str, insecure: bool) -> Result<String, PairError> {
    let invite = decode_pairing_string(pairing_string).ok_or_else(|| {
        PairError::Refused(
            "That is not a FleetFrog pairing string. Copy it again from the dashboard.".into(),
        )
    })?;
    let url = Url::parse(&invite.agent_url).ok().filter(|url| matches!(url.scheme(), "ws" | "wss")).ok_or_else(|| {
        PairError::Refused(format!(
            "The pairing string points at \"{}\", which is not a WebSocket address. Check FLEETFROG_AGENT_URL on the hub.",
            invite.agent_url
        ))
    })?;
    let host = url.host_str().unwrap_or("");

    if url.scheme() == "ws" && !LOOPBACK_HOSTS.contains(&host) && !insecure {
        let authority = match url.port() {
            Some(port) => format!("{host}:{port}"),
            None => host.to_string(),
        };

        return Err(PairError::Refused(format!(
            "The hub at {authority} does not use TLS. Pass --insecure only if the network path is already encrypted, such as over Tailscale."
        )));
    }

    let certificate_pem = match &invite.certificate_fingerprint {
        Some(fingerprint) if url.scheme() == "wss" => {
            Some(fetch_pinned_certificate(&url, fingerprint).await?)
        }
        _ => None,
    };

    // The code is spent on first use, so confirm the token can be saved before redeeming it.
    ensure_config_writable().map_err(PairError::ConfigUnavailable)?;

    let info = read_machine_info().await;
    let request = json!({
        "_tag": "Request",
        "id": 0,
        "tag": "Pair",
        "payload": { "code": invite.code, "info": info, "suggestedRoots": suggest_discovery_roots() },
        "headers": [],
    });
    let (status, body) = post_json(
        &hub_endpoint(&url, "pair"),
        certificate_pem.as_deref(),
        &request.to_string(),
    )
    .await
    .map_err(PairError::HubUnreachable)?;
    let responses = match serde_json::from_str::<Value>(&body) {
        Ok(Value::Array(responses)) => responses,
        Ok(response) => vec![response],
        Err(_) => {
            return Err(PairError::HubUnreachable(format!(
                "The hub answered with status {status}"
            )));
        }
    };
    let exit = responses
        .iter()
        .find(|response| response.get("_tag").and_then(Value::as_str) == Some("Exit"))
        .and_then(|response| response.get("exit"))
        .ok_or_else(|| {
            PairError::HubUnreachable(format!("The hub answered with status {status}"))
        })?;

    if exit.get("_tag").and_then(Value::as_str) != Some("Success") {
        let causes = exit
            .get("cause")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let invalid = causes.iter().any(|cause| {
            cause.pointer("/error/_tag").and_then(Value::as_str) == Some("InvalidPairingCode")
        });

        return Err(if invalid {
            PairError::InvalidPairingCode
        } else {
            PairError::HubUnreachable(format!("The hub couldn't pair this machine: {exit}"))
        });
    }

    let text = |key: &str| {
        exit.pointer(&format!("/value/{key}"))
            .and_then(Value::as_str)
            .map(String::from)
    };
    let (Some(machine_id), Some(token)) = (text("machineId"), text("token")) else {
        return Err(PairError::HubUnreachable(
            "The hub's answer has no credentials".into(),
        ));
    };

    save_agent_config(&AgentConfig {
        agent_url: invite.agent_url.clone(),
        machine_id: machine_id.clone(),
        token,
        certificate_pem,
    })
    .map_err(PairError::ConfigUnavailable)?;
    audit::write(AuditEntry::Paired {
        agent_url: invite.agent_url,
        machine_id: machine_id.clone(),
    });

    Ok(machine_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_pairing_strings() {
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(r#"{"agentUrl":"wss://192.168.1.10:7421","code":"c0de","certificateFingerprint":"AB:CD:EF"}"#);
        let invite = decode_pairing_string(&format!("  {PREFIX}{payload}\n")).unwrap();

        assert_eq!(invite.agent_url, "wss://192.168.1.10:7421");
        assert_eq!(invite.certificate_fingerprint.as_deref(), Some("AB:CD:EF"));
        assert!(decode_pairing_string(&payload).is_none());
        assert!(
            decode_pairing_string(&format!("{PREFIX}{}", &payload[..payload.len() - 4])).is_none()
        );
    }
}
