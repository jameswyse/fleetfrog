//! Collects Git's output for an action. Git redraws progress in place with carriage returns, so a
//! line is finished by `\n` and redrawn after `\r`, and only its final form is kept.

use std::collections::VecDeque;
use std::sync::Mutex;

/// How many of Git's last lines travel with an action's outcome.
const KEPT_LINES: usize = 50;

/// A line is cut here, so output with no line breaks can't grow without limit.
const LINE_LIMIT: usize = 64 * 1024;

/// Captured output stops here, so a remote's listing can't grow without limit.
const CAPTURED_LIMIT: usize = 8 * 1024 * 1024;

/// Appends to the text up to its limit, on a character boundary, and drops the rest.
fn push_capped(text: &mut String, more: &str, limit: usize) {
    let mut cut = more.len().min(limit.saturating_sub(text.len()));

    while !more.is_char_boundary(cut) {
        cut -= 1;
    }

    text.push_str(&more[..cut]);
}

/// Removes the user name and password a URL can carry, as `https://user:token@host/…` does, so a
/// line of Git's output never brings credentials to the hub.
pub fn redact_credentials(text: &str) -> String {
    let mut redacted = String::with_capacity(text.len());
    let mut rest = text;

    while let Some(start) = rest.find("://") {
        let after_scheme = start + "://".len();
        let end = rest[after_scheme..]
            .find(|character: char| {
                character == '/' || character == '@' || character.is_whitespace()
            })
            .map_or(rest.len(), |offset| after_scheme + offset);

        redacted.push_str(&rest[..after_scheme]);
        rest = if rest[end..].starts_with('@') {
            &rest[end + 1..]
        } else {
            &rest[after_scheme..]
        };
    }

    redacted.push_str(rest);
    redacted
}

#[derive(Default)]
struct Lines {
    /// Everything written, kept only for output that is read rather than shown.
    captured: Option<String>,
    finished: VecDeque<String>,
    current: String,
    /// The last complete drawing of the current line, kept while Git redraws it.
    drawn: String,
}

#[derive(Default)]
pub struct ActionOutput(Mutex<Lines>);

impl ActionOutput {
    pub fn new() -> ActionOutput {
        ActionOutput::default()
    }

    /// Output that keeps everything written, for a command whose output is read.
    pub fn capturing() -> ActionOutput {
        ActionOutput(Mutex::new(Lines {
            captured: Some(String::new()),
            ..Lines::default()
        }))
    }

    /// Everything written to output made with `capturing`.
    pub fn captured(&self) -> String {
        self.0.lock().unwrap().captured.clone().unwrap_or_default()
    }

    pub fn write(&self, text: &str) {
        let mut lines = self.0.lock().unwrap();
        let mut start = 0;

        if let Some(captured) = &mut lines.captured {
            push_capped(captured, text, CAPTURED_LIMIT);
        }

        for (index, character) in text.char_indices() {
            if character != '\n' && character != '\r' {
                continue;
            }

            push_capped(&mut lines.current, &text[start..index], LINE_LIMIT);
            start = index + 1;

            if character == '\n' {
                let line = if lines.current.is_empty() {
                    std::mem::take(&mut lines.drawn)
                } else {
                    std::mem::take(&mut lines.current)
                };

                if !line.is_empty() {
                    lines.finished.push_back(line);

                    if lines.finished.len() > KEPT_LINES {
                        lines.finished.pop_front();
                    }
                }

                lines.current.clear();
                lines.drawn.clear();
            } else if !lines.current.is_empty() {
                lines.drawn = std::mem::take(&mut lines.current);
            }
        }

        push_capped(&mut lines.current, &text[start..], LINE_LIMIT);
    }

    /// The line Git is drawing now, or the last one it finished, with any credentials removed.
    pub fn progress(&self) -> Option<String> {
        let lines = self.0.lock().unwrap();

        [&lines.current, &lines.drawn]
            .into_iter()
            .find(|line| !line.is_empty())
            .or_else(|| lines.finished.back())
            .map(|line| redact_credentials(line))
    }

    /// The last lines, including any unfinished one, with any credentials removed.
    pub fn tail(&self) -> Vec<String> {
        let lines = self.0.lock().unwrap();
        let pending = if lines.current.is_empty() {
            &lines.drawn
        } else {
            &lines.current
        };
        let mut tail: Vec<String> = lines
            .finished
            .iter()
            .map(|line| redact_credentials(line))
            .collect();

        if !pending.is_empty() {
            tail.push(redact_credentials(pending));
        }

        let skip = tail.len().saturating_sub(KEPT_LINES);

        tail.split_off(skip)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_final_drawing_of_each_line() {
        let output = ActionOutput::new();

        output.write("Cloning into 'x'...\nReceiving objects:  10%\rReceiving obj");
        assert_eq!(output.progress().as_deref(), Some("Receiving obj"));
        output.write("ects: 100%\r");
        assert_eq!(
            output.progress().as_deref(),
            Some("Receiving objects: 100%")
        );
        output.write("\ndone\n");
        assert_eq!(
            output.tail(),
            vec!["Cloning into 'x'...", "Receiving objects: 100%", "done"]
        );
        assert_eq!(output.progress().as_deref(), Some("done"));
    }

    #[test]
    fn keeps_the_last_fifty_lines() {
        let output = ActionOutput::new();

        for line in 0..60 {
            output.write(&format!("{line}\n"));
        }

        output.write("partial");

        let tail = output.tail();

        assert_eq!(tail.len(), 50);
        assert_eq!(tail.first().map(String::as_str), Some("11"));
        assert_eq!(tail.last().map(String::as_str), Some("partial"));
    }

    #[test]
    fn cuts_a_line_at_the_limit_and_keeps_the_next_whole() {
        let output = ActionOutput::new();

        // The two-byte character that straddles the limit is dropped whole, which leaves room for
        // one more byte of the line.
        output.write("a");
        output.write(&"é".repeat(LINE_LIMIT));
        output.write("more\nnext\n");

        let tail = output.tail();

        assert_eq!(tail.len(), 2);
        assert_eq!(tail[0].len(), LINE_LIMIT);
        assert!(tail[0].ends_with("ém"));
        assert_eq!(tail[1], "next");
    }

    #[test]
    fn stops_capturing_at_the_limit() {
        let output = ActionOutput::capturing();

        output.write(&"x".repeat(CAPTURED_LIMIT));
        output.write("y");

        assert_eq!(output.captured().len(), CAPTURED_LIMIT);
    }

    #[test]
    fn removes_credentials_from_lines_sent_to_the_hub() {
        assert_eq!(
            redact_credentials("fatal: unable to access 'https://user:token@github.com/x/y.git/'"),
            "fatal: unable to access 'https://github.com/x/y.git/'"
        );
        assert_eq!(
            redact_credentials("Cloning https://github.com/x/y.git"),
            "Cloning https://github.com/x/y.git"
        );
        assert_eq!(
            redact_credentials("git@github.com:x/y.git"),
            "git@github.com:x/y.git"
        );

        let output = ActionOutput::new();

        output.write("Fetching https://a:b@host/one\nhttps://c:d@host/two");
        assert_eq!(output.progress().as_deref(), Some("https://host/two"));
        assert_eq!(
            output.tail(),
            vec!["Fetching https://host/one", "https://host/two"]
        );
    }
}
