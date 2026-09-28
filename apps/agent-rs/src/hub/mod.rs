//! Talking to the hub with Effect RPC's JSON protocol: WebSocket for a paired agent, and one HTTPS
//! request for pairing. Requests, stream chunks, acknowledgements and pings follow
//! `effect/unstable/rpc` as the hub serves it.

pub mod rpc;
pub mod tls;

use url::Url;

use crate::http;

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
    let response = http::request(
        url,
        tls,
        "POST",
        &[("Content-Type", "application/json")],
        body.as_bytes(),
    )
    .await?;

    Ok((
        response.status,
        String::from_utf8_lossy(&response.body).into_owned(),
    ))
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
}
