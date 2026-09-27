//! Instants as epoch milliseconds, written as ISO 8601 in UTC the way Effect's `DateTimeUtc`
//! encodes them, such as `2026-09-27T04:05:00.000Z`.

use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Deserializer, Serialize, Serializer};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Utc(i64);

impl Utc {
    pub const EPOCH: Utc = Utc(0);

    pub fn now() -> Utc {
        let elapsed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();

        Utc(elapsed.as_millis() as i64)
    }

    pub fn from_millis(millis: i64) -> Utc {
        Utc(millis)
    }

    pub fn millis(self) -> i64 {
        self.0
    }

    pub fn format_iso(self) -> String {
        let days = self.0.div_euclid(86_400_000);
        let in_day = self.0.rem_euclid(86_400_000);
        let (year, month, day) = civil_from_days(days);
        let seconds = in_day / 1000;

        format!(
            "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
            seconds / 3600,
            seconds / 60 % 60,
            seconds % 60,
            in_day % 1000
        )
    }

    /// Parses an ISO 8601 date and time. One without an offset is read as UTC, as Effect does.
    pub fn parse(text: &str) -> Option<Utc> {
        let text = text.trim();
        let bytes = text.as_bytes();
        let number = |range: std::ops::Range<usize>| -> Option<i64> {
            let part = text.get(range)?;

            part.bytes()
                .all(|byte| byte.is_ascii_digit())
                .then(|| part.parse().ok())?
        };

        if bytes.len() < 10 || bytes[4] != b'-' || bytes[7] != b'-' {
            return None;
        }

        let (year, month, day) = (number(0..4)?, number(5..7)?, number(8..10)?);

        if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
            return None;
        }

        let mut millis = days_from_civil(year, month, day) * 86_400_000;
        let rest = &text[10..];

        if rest.is_empty() {
            return Some(Utc(millis));
        }

        let rest = rest.strip_prefix('T').or_else(|| rest.strip_prefix(' '))?;
        let time_end = rest.find(['Z', 'z', '+', '-']).unwrap_or(rest.len());
        let (time, zone) = rest.split_at(time_end);
        let mut parts = time.splitn(3, ':');
        let hour: i64 = parse_digits(parts.next()?)?;
        let minute: i64 = parse_digits(parts.next()?)?;
        let (second, fraction) = match parts.next() {
            None => (0, 0),
            Some(seconds) => {
                let (whole, fraction) = seconds.split_once('.').unwrap_or((seconds, ""));
                let fraction_digits: String = fraction.chars().take(3).collect();
                let fraction_millis = if fraction.is_empty() {
                    0
                } else {
                    parse_digits::<i64>(&format!("{fraction_digits:0<3}"))?
                };

                if !fraction.bytes().all(|byte| byte.is_ascii_digit()) {
                    return None;
                }

                (parse_digits(whole)?, fraction_millis)
            }
        };

        if hour > 24 || minute > 59 || second > 60 {
            return None;
        }

        millis += ((hour * 60 + minute) * 60 + second) * 1000 + fraction;

        let offset_minutes = match zone {
            "" | "Z" | "z" => 0,
            _ => {
                let sign = if zone.starts_with('-') { -1 } else { 1 };
                let digits: String = zone[1..].chars().filter(|c| *c != ':').collect();

                if !digits.bytes().all(|byte| byte.is_ascii_digit()) {
                    return None;
                }

                let (hours, minutes) = match digits.len() {
                    2 => (parse_digits::<i64>(&digits)?, 0),
                    4 => (
                        parse_digits::<i64>(&digits[..2])?,
                        parse_digits::<i64>(&digits[2..])?,
                    ),
                    _ => return None,
                };

                sign * (hours * 60 + minutes)
            }
        };

        Some(Utc(millis - offset_minutes * 60_000))
    }
}

fn parse_digits<T: std::str::FromStr>(text: &str) -> Option<T> {
    (!text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit()))
        .then(|| text.parse().ok())?
}

/// Days since 1970-01-01 for a proleptic Gregorian date, after Howard Hinnant's algorithm.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let day_of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;

    era * 146_097 + day_of_era - 719_468
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let days = days + 719_468;
    let era = days.div_euclid(146_097);
    let day_of_era = days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + if month <= 2 { 1 } else { 0 };

    (year, month, day)
}

/// A time such as 27/09/2026 14:05 in the machine's own time zone, for a stash message.
pub fn stash_date(now: Utc) -> String {
    let seconds = now.millis().div_euclid(1000) as _;
    // SAFETY: `localtime_r` writes only into the zeroed struct it is given.
    let parts = unsafe {
        let mut parts: libc::tm = std::mem::zeroed();

        libc::localtime_r(&seconds, &mut parts);

        parts
    };

    format!(
        "{:02}/{:02}/{} {:02}:{:02}",
        parts.tm_mday,
        parts.tm_mon + 1,
        parts.tm_year + 1900,
        parts.tm_hour,
        parts.tm_min
    )
}

impl Serialize for Utc {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.format_iso())
    }
}

impl<'de> Deserialize<'de> for Utc {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;

        Utc::parse(&text).ok_or_else(|| serde::de::Error::custom(format!("not a date: {text}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_like_effect() {
        assert_eq!(
            Utc::from_millis(1_700_000_000_000).format_iso(),
            "2023-11-14T22:13:20.000Z"
        );
        assert_eq!(Utc::EPOCH.format_iso(), "1970-01-01T00:00:00.000Z");
    }

    #[test]
    fn parses_offsets_fractions_and_zoneless_times() {
        assert_eq!(
            Utc::parse("2026-09-27T14:05:00+10:00")
                .map(Utc::format_iso)
                .as_deref(),
            Some("2026-09-27T04:05:00.000Z")
        );
        assert_eq!(
            Utc::parse("2026-09-27T14:05:00.123456+10:00")
                .map(Utc::format_iso)
                .as_deref(),
            Some("2026-09-27T04:05:00.123Z")
        );
        assert_eq!(
            Utc::parse("2026-09-27 14:05:00")
                .map(Utc::format_iso)
                .as_deref(),
            Some("2026-09-27T14:05:00.000Z")
        );
        assert_eq!(
            Utc::parse("1999-12-31T23:59:59.5-0130").map(Utc::millis),
            Some(946_690_199_500)
        );
        assert_eq!(Utc::parse("yesterday"), None);
        assert_eq!(Utc::parse("2026-09-27T14:05:00+1é1"), None);
    }
}
