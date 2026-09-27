//! Collects Git's output for an action. Git redraws progress in place with carriage returns, so a
//! line is finished by `\n` and redrawn after `\r`, and only its final form is kept.

use std::collections::VecDeque;
use std::sync::Mutex;

/// How many of Git's last lines travel with an action's outcome.
const KEPT_LINES: usize = 50;

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
            captured.push_str(text);
        }

        for (index, character) in text.char_indices() {
            if character != '\n' && character != '\r' {
                continue;
            }

            lines.current.push_str(&text[start..index]);
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

        lines.current.push_str(&text[start..]);
    }

    /// The line Git is drawing now, or the last one it finished.
    pub fn progress(&self) -> Option<String> {
        let lines = self.0.lock().unwrap();

        [&lines.current, &lines.drawn]
            .into_iter()
            .find(|line| !line.is_empty())
            .cloned()
            .or_else(|| lines.finished.back().cloned())
    }

    /// The last lines, including any unfinished one.
    pub fn tail(&self) -> Vec<String> {
        let lines = self.0.lock().unwrap();
        let pending = if lines.current.is_empty() {
            &lines.drawn
        } else {
            &lines.current
        };
        let mut tail: Vec<String> = lines.finished.iter().cloned().collect();

        if !pending.is_empty() {
            tail.push(pending.clone());
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
}
