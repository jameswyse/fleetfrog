//! Log lines in the logfmt shape Effect's logger writes, on standard error.

use crate::time::Utc;

fn write(level: &str, message: &str, cause: Option<&str>) {
    let quoted = |text: &str| format!("{text:?}");
    let mut line = format!(
        "timestamp={} level={level} message={}",
        Utc::now().format_iso(),
        quoted(message)
    );

    if let Some(cause) = cause {
        line.push_str(&format!(" cause={}", quoted(cause)));
    }

    eprintln!("{line}");
    crate::service::rotate_log();
}

pub fn info(message: &str) {
    write("INFO", message, None);
}

pub fn warning(message: &str, cause: impl std::fmt::Display) {
    write("WARN", message, Some(&cause.to_string()));
}

pub fn warning_only(message: &str) {
    write("WARN", message, None);
}

pub fn error(message: &str, cause: impl std::fmt::Display) {
    write("ERROR", message, Some(&cause.to_string()));
}
