//! A named agent that runs beside the default one on the same machine, such as a development build
//! next to a release, with its own pairing, policy, action log and service. Both still share the
//! machine's checkouts, archive records and trash. `FLEETFROG_INSTANCE` names it, and the default
//! agent has no name.

use crate::paths;

pub const VARIABLE: &str = "FLEETFROG_INSTANCE";

/// The instance this agent runs as. `main` refuses to start when the name is not valid.
pub fn current() -> Option<String> {
    paths::env(VARIABLE)
}

/// Lowercase letters and digits in words joined by single hyphens, because the name becomes part
/// of folder names, a systemd unit and a launchd label.
pub fn is_valid(name: &str) -> bool {
    name.split('-').all(|word| {
        !word.is_empty()
            && word
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
    })
}

/// `base` followed by the instance's name, such as `fleetfrog-dev`, or `base` alone for the
/// default agent.
pub fn named(base: &str) -> String {
    match current() {
        Some(name) => format!("{base}-{name}"),
        None => base.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_names_safe_in_paths_and_service_names() {
        assert!(is_valid("dev"));
        assert!(is_valid("dev-2"));
        assert!(!is_valid(""));
        assert!(!is_valid("Dev"));
        assert!(!is_valid("dev-"));
        assert!(!is_valid("dev--2"));
        assert!(!is_valid("../dev"));
        assert!(!is_valid("dev.2"));
    }
}
