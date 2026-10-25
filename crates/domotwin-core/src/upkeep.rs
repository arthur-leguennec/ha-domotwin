//! Upkeep (`DECISIONS.md`, D-033): when a piece's recurring tasks are next due, whether each one
//! is due soon or overdue, and whether the piece's warranty ends soon.
//!
//! Dates are calendar days, with neither a time nor a time zone: the caller gives today's date
//! where the home is. The integration works the same out in Python for its sensor; both read the
//! cases of `tests/fixtures/upkeep-due.json`.

use std::fmt;

use serde_json::{Map, Value, json};

/// A task due within this many days is due soon, unless the home sets another lead.
pub const LEAD_DAYS: u32 = 14;
/// Leads a home can set (days).
pub const MAX_LEAD_DAYS: u32 = 365;
/// A warranty ending within this many days is shown.
pub const WARRANTY_DAYS: i64 = 30;
/// Longest intervals between two times a task is done.
pub const MAX_EVERY_DAYS: u32 = 3_650;
pub const MAX_EVERY_MONTHS: u32 = 120;

/// A calendar day.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Date {
    year: i32,
    month: u8,
    day: u8,
}

const fn is_leap(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

/// The days of `month` (1 to 12) in `year`.
const fn days_in_month(year: i32, month: u8) -> u8 {
    match month {
        2 if is_leap(year) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

impl Date {
    /// The last day of the calendar.
    pub const LAST: Self = Self {
        year: 9999,
        month: 12,
        day: 31,
    };

    /// A day of the calendar, if it is one (years 1 to 9999).
    pub const fn new(year: i32, month: u8, day: u8) -> Option<Self> {
        if year < 1 || year > 9999 || month < 1 || month > 12 {
            return None;
        }
        if day < 1 || day > days_in_month(year, month) {
            return None;
        }
        Some(Self { year, month, day })
    }

    /// Reads `YYYY-MM-DD`, alone, with a time zone (`YYYY-MM-DDZ`, `…+01:00`, as an `xs:date`
    /// may have) or starting a date and time (`YYYY-MM-DDT…`).
    pub fn parse(text: &str) -> Option<Self> {
        let bytes = text.as_bytes();
        if bytes.len() < 10
            || (bytes.len() > 10 && !matches!(bytes[10], b'T' | b' ' | b'Z' | b'+' | b'-'))
        {
            return None;
        }
        if bytes[4] != b'-' || bytes[7] != b'-' {
            return None;
        }
        let number = |range: std::ops::Range<usize>| -> Option<u32> {
            let digits = text.get(range)?;
            digits
                .bytes()
                .all(|b| b.is_ascii_digit())
                .then(|| digits.parse().ok())?
        };
        let year = i32::try_from(number(0..4)?).ok()?;
        let month = u8::try_from(number(5..7)?).ok()?;
        let day = u8::try_from(number(8..10)?).ok()?;
        Self::new(year, month, day)
    }

    /// Days since 1970-01-01 (negative before).
    pub fn days(self) -> i64 {
        // Howard Hinnant's `days_from_civil`.
        let year = i64::from(self.year) - i64::from(self.month <= 2);
        let era = year.div_euclid(400);
        let of_era = year - era * 400;
        let month = i64::from(self.month);
        let of_year =
            (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + i64::from(self.day) - 1;
        let of_era_days = of_era * 365 + of_era / 4 - of_era / 100 + of_year;
        era * 146_097 + of_era_days - 719_468
    }

    /// The day `days` after 1970-01-01, kept within years 1 to 9999.
    pub fn from_days(days: i64) -> Self {
        // Howard Hinnant's `civil_from_days`.
        let z = days.clamp(-719_162, 2_932_896) + 719_468;
        let era = z.div_euclid(146_097);
        let of_era = z - era * 146_097;
        let year_of_era = (of_era - of_era / 1460 + of_era / 36_524 - of_era / 146_096) / 365;
        let of_year = of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
        let mp = (5 * of_year + 2) / 153;
        let day = of_year - (153 * mp + 2) / 5 + 1;
        let month = if mp < 10 { mp + 3 } else { mp - 9 };
        let year = year_of_era + era * 400 + i64::from(month <= 2);
        Self {
            year: i32::try_from(year).unwrap_or(1),
            month: u8::try_from(month).unwrap_or(1),
            day: u8::try_from(day).unwrap_or(1),
        }
    }

    /// The day `days` later (earlier when negative).
    pub fn add_days(self, days: i64) -> Self {
        Self::from_days(self.days().saturating_add(days))
    }

    /// The same day `months` later, or the month's last day when it is shorter (a month after
    /// 31 January is the end of February).
    pub fn add_months(self, months: u32) -> Self {
        let index = i64::from(self.year) * 12 + i64::from(self.month) - 1 + i64::from(months);
        let Ok(year) = i32::try_from(index.div_euclid(12)) else {
            return Self::LAST;
        };
        if year > Self::LAST.year {
            // Past the end of the calendar: its last day.
            return Self::LAST;
        }
        let month = u8::try_from(index.rem_euclid(12) + 1).unwrap_or(12);
        let day = self.day.min(days_in_month(year, month));
        Self { year, month, day }
    }
}

impl fmt::Display for Date {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:04}-{:02}-{:02}", self.year, self.month, self.day)
    }
}

/// How often a task is done.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Every {
    Days(u32),
    Months(u32),
}

impl Every {
    /// `count` of `unit` (`days` or `months`), within the longest intervals.
    pub fn new(count: u32, unit: &str) -> Option<Self> {
        match unit {
            "days" if (1..=MAX_EVERY_DAYS).contains(&count) => Some(Self::Days(count)),
            "months" if (1..=MAX_EVERY_MONTHS).contains(&count) => Some(Self::Months(count)),
            _ => None,
        }
    }

    /// The day this long after `date`.
    pub fn after(self, date: Date) -> Date {
        match self {
            Self::Days(days) => date.add_days(i64::from(days)),
            Self::Months(months) => date.add_months(months),
        }
    }
}

/// Whether a task waits, is due soon, or is overdue (the most urgent last).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum State {
    Fine,
    Due,
    Overdue,
}

impl State {
    pub const fn name(self) -> &'static str {
        match self {
            Self::Fine => "fine",
            Self::Due => "due",
            Self::Overdue => "overdue",
        }
    }
}

/// When a task is next due: an interval after it was last done; never done, an interval after
/// the piece was installed; neither known, today.
pub fn next_due(
    every: Every,
    last_done: Option<Date>,
    installed: Option<Date>,
    today: Date,
) -> Date {
    last_done
        .or(installed)
        .map_or(today, |date| every.after(date))
}

/// Where a task due on `due` stands `today`: overdue the day after, due from `lead` days before.
pub fn state(due: Date, today: Date, lead: u32) -> State {
    let left = due.days() - today.days();
    if left < 0 {
        State::Overdue
    } else if left <= i64::from(lead) {
        State::Due
    } else {
        State::Fine
    }
}

/// The days left before a warranty ending on `end` is over, when it ends within
/// [`WARRANTY_DAYS`] and is not over yet.
pub fn warranty_left(end: Date, today: Date) -> Option<i64> {
    let left = end.days() - today.days();
    (0..=WARRANTY_DAYS).contains(&left).then_some(left)
}

/// A recurring task of a card.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Task {
    pub id: String,
    pub every: Every,
    pub last_done: Option<Date>,
}

/// What upkeep needs of a piece's card.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Card {
    pub installed: Option<Date>,
    pub warranty_end: Option<Date>,
    pub tasks: Vec<Task>,
}

fn date_of(value: Option<&Value>) -> Option<Date> {
    Date::parse(value?.as_str()?)
}

/// A card as the integration stores it (`docs/upkeep.md`); tasks it cannot read are left out.
pub fn read_card(value: &Value) -> Card {
    let tasks = value
        .get("tasks")
        .and_then(Value::as_array)
        .map(|tasks| {
            tasks
                .iter()
                .filter_map(|task| {
                    let count = u32::try_from(task.get("every")?.as_u64()?).ok()?;
                    Some(Task {
                        id: task.get("id")?.as_str()?.to_owned(),
                        every: Every::new(count, task.get("unit")?.as_str()?)?,
                        last_done: date_of(task.get("last_done")),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Card {
        installed: date_of(value.get("installed")),
        warranty_end: date_of(value.get("warranty_end")),
        tasks,
    }
}

/// Where every card stands `today`, from the stored upkeep (`{"lead_days", "pieces": {id:
/// card}}`): JSON `{id: {"state": "fine" | "due" | "overdue" | null, "warranty": days left |
/// null, "tasks": [{"id", "due", "state", "days"}]}}`, `state` the most urgent of its tasks'
/// (null without tasks), `days` until the task is due (negative once overdue).
pub fn states(upkeep: &Value, today: Date) -> Value {
    let lead = upkeep
        .get("lead_days")
        .and_then(Value::as_u64)
        .and_then(|d| u32::try_from(d).ok())
        .filter(|d| *d <= MAX_LEAD_DAYS)
        .unwrap_or(LEAD_DAYS);
    let mut out = Map::new();
    let Some(pieces) = upkeep.get("pieces").and_then(Value::as_object) else {
        return Value::Object(out);
    };
    for (id, value) in pieces {
        let card = read_card(value);
        let mut worst: Option<State> = None;
        let tasks: Vec<Value> = card
            .tasks
            .iter()
            .map(|task| {
                let due = next_due(task.every, task.last_done, card.installed, today);
                let now = state(due, today, lead);
                worst = worst.max(Some(now));
                json!({
                    "id": task.id,
                    "due": due.to_string(),
                    "state": now.name(),
                    "days": due.days() - today.days(),
                })
            })
            .collect();
        let warranty = card.warranty_end.and_then(|end| warranty_left(end, today));
        out.insert(
            id.clone(),
            json!({
                "state": worst.map(State::name),
                "warranty": warranty,
                "tasks": tasks,
            }),
        );
    }
    Value::Object(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(text: &str) -> Date {
        Date::parse(text).unwrap()
    }

    #[test]
    fn dates_read_count_and_print() {
        assert_eq!(day("1970-01-01").days(), 0);
        assert_eq!(day("2000-03-01").days(), 11_017);
        assert_eq!(day("1969-12-31").days(), -1);
        for text in ["0001-01-01", "2024-02-29", "2100-12-31", "9999-12-31"] {
            assert_eq!(Date::from_days(day(text).days()).to_string(), text);
        }
        assert_eq!(day("2026-10-24T08:30:00+02:00"), day("2026-10-24"));
        assert_eq!(day("2026-10-24Z"), day("2026-10-24"));
        assert_eq!(day("2026-10-24+01:00"), day("2026-10-24"));
        for wrong in [
            "",
            "2025-02-29",
            "2025-13-01",
            "2025-00-10",
            "2025-1-01",
            "2025-01-01x",
            "+025-01-01",
            "0000-01-01",
            "2025-01-32",
        ] {
            assert_eq!(Date::parse(wrong), None, "{wrong}");
        }
        assert_eq!(day("2025-12-15").add_days(20).to_string(), "2026-01-04");
        assert_eq!(day("9999-12-31").add_days(10), day("9999-12-31"));
        assert_eq!(day("9999-12-31").add_months(120).to_string(), "9999-12-31");
        // Never before the day it counts from.
        assert_eq!(day("9999-12-31").add_months(1).to_string(), "9999-12-31");
        assert_eq!(day("9999-11-30").add_months(1).to_string(), "9999-12-30");
    }

    #[test]
    fn months_end_at_the_end_of_shorter_months() {
        assert_eq!(day("2025-01-31").add_months(1).to_string(), "2025-02-28");
        assert_eq!(day("2024-01-31").add_months(1).to_string(), "2024-02-29");
        assert_eq!(day("2024-02-29").add_months(12).to_string(), "2025-02-28");
        assert_eq!(day("2023-11-30").add_months(3).to_string(), "2024-02-29");
        assert_eq!(day("2025-08-31").add_months(1).to_string(), "2025-09-30");
        assert_eq!(day("2025-11-15").add_months(2).to_string(), "2026-01-15");
    }

    /// The cases the integration's sensor is tested on too.
    #[test]
    fn shared_cases() {
        let cases: Value =
            serde_json::from_str(include_str!("../../../tests/fixtures/upkeep-due.json")).unwrap();
        for case in cases.as_array().unwrap() {
            let every = Every::new(
                u32::try_from(case["every"].as_u64().unwrap()).unwrap(),
                case["unit"].as_str().unwrap(),
            )
            .unwrap();
            let today = day(case["today"].as_str().unwrap());
            let due = next_due(
                every,
                date_of(case.get("last_done")),
                date_of(case.get("installed")),
                today,
            );
            let lead = u32::try_from(case["lead_days"].as_u64().unwrap_or(14)).unwrap();
            assert_eq!(due.to_string(), case["due"].as_str().unwrap(), "{case}");
            assert_eq!(
                state(due, today, lead).name(),
                case["state"].as_str().unwrap(),
                "{case}"
            );
        }
    }

    #[test]
    fn every_card_where_it_stands() {
        let upkeep = json!({ "lead_days": 10, "pieces": {
            "hood": { "installed": "2024-05-02", "warranty_end": "2026-11-10", "tasks": [
                { "id": "filter", "name": "Change the filter", "every": 3, "unit": "months",
                  "last_done": "2026-08-01" },
                { "id": "grease", "name": "Clean the grease trap", "every": 30, "unit": "days" }
            ] },
            "sofa": { "make": "Fictional" },
            "washer": { "tasks": [{ "id": "drum", "every": 2, "unit": "weeks" }] },
            "kettle": { "tasks": [
                { "id": "descale", "name": "Descale", "every": 2, "unit": "months",
                  "last_done": "2026-09-20" }
            ] }
        } });
        let out = states(&upkeep, day("2026-10-24"));
        let hood = &out["hood"];
        // The filter: 1 November, within the lead; the grease trap, never done: 30 days after it
        // was installed, long gone.
        assert_eq!(hood["state"], "overdue");
        assert_eq!(hood["warranty"], 17);
        assert_eq!(hood["tasks"][0]["due"], "2026-11-01");
        assert_eq!(hood["tasks"][0]["state"], "due");
        assert_eq!(hood["tasks"][0]["days"], 8);
        assert_eq!(hood["tasks"][1]["due"], "2024-06-01");
        assert_eq!(hood["tasks"][1]["state"], "overdue");
        // No tasks: no state; a task with an interval it cannot read: left out.
        assert_eq!(out["sofa"]["state"], Value::Null);
        assert_eq!(out["washer"]["tasks"], json!([]));
        assert_eq!(out["kettle"]["state"], "fine");
        assert_eq!(out["kettle"]["warranty"], Value::Null);
        // Nothing stored: nothing.
        assert_eq!(states(&json!(null), day("2026-10-24")), json!({}));
    }
}
