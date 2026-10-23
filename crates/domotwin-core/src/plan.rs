//! The House Maquette plan format (`*.plan.json`), see `docs/plan-format.md`.
//!
//! M0 only reads the envelope of a plan and counts its elements. The full lenient reader, the model
//! and the migrations arrive with milestone M1.

use serde_json::Value;

use crate::error::{ErrorCode, ReadError};

/// Largest plan file the format allows, in bytes.
pub const MAX_PLAN_BYTES: usize = 32_000_000;
/// Largest number of elements in a plan.
pub const MAX_ELEMENTS: usize = 500;
/// Highest format revision this version of DomoTwin reads.
pub const PLAN_REVISION: u32 = 10;

/// What a plan contains, without its geometry.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PlanSummary {
    /// Format revision of the file (1 when missing or invalid, as the format says).
    pub revision: u32,
    /// Title of the plan (may be empty).
    pub title: String,
    /// Number of rooms.
    pub rooms: usize,
    /// Number of free walls.
    pub walls: usize,
    /// Number of doors.
    pub doors: usize,
    /// Number of windows.
    pub windows: usize,
    /// Number of furniture items.
    pub furniture: usize,
    /// Elements of an unknown type (ignored by the reader).
    pub unknown: usize,
}

impl PlanSummary {
    /// The summary as a small JSON object for the frontend.
    pub fn to_json(&self) -> String {
        serde_json::json!({
            "revision": self.revision,
            "title": self.title,
            "rooms": self.rooms,
            "walls": self.walls,
            "doors": self.doors,
            "windows": self.windows,
            "furniture": self.furniture,
            "unknown": self.unknown,
        })
        .to_string()
    }
}

/// Reads the envelope of a plan and counts its elements.
///
/// # Errors
///
/// Returns a [`ReadError`] when the input is too large, is not JSON, or when `version`, `unit` or
/// `elements` are missing or invalid, or when the plan comes from a newer revision of the format.
pub fn summarize_plan(bytes: &[u8]) -> Result<PlanSummary, ReadError> {
    if bytes.len() > MAX_PLAN_BYTES {
        return Err(ReadError::new(ErrorCode::TooLarge));
    }
    // A leading byte order mark is ignored, as the format says.
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    let value: Value = serde_json::from_slice(bytes)
        .map_err(|err| ReadError::with_detail(ErrorCode::NotJson, err.to_string()))?;
    let Value::Object(root) = value else {
        return Err(ReadError::new(ErrorCode::NotAnObject));
    };
    if root.get("version").and_then(Value::as_f64) != Some(1.0) {
        return Err(ReadError::new(ErrorCode::BadVersion));
    }
    if root.get("unit").and_then(Value::as_str) != Some("cm") {
        return Err(ReadError::new(ErrorCode::BadUnit));
    }
    let revision = read_revision(root.get("layoutRevision"));
    if revision > PLAN_REVISION {
        return Err(ReadError::with_detail(
            ErrorCode::NewerRevision,
            revision.to_string(),
        ));
    }
    let Some(elements) = root.get("elements").and_then(Value::as_array) else {
        return Err(ReadError::new(ErrorCode::NoElements));
    };
    if elements.is_empty() {
        return Err(ReadError::new(ErrorCode::NoElements));
    }
    if elements.len() > MAX_ELEMENTS {
        return Err(ReadError::new(ErrorCode::TooManyElements));
    }
    let mut summary = PlanSummary {
        revision,
        title: root
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .chars()
            .take(100)
            .collect(),
        ..PlanSummary::default()
    };
    for element in elements {
        match element.get("type").and_then(Value::as_str) {
            Some("room") => summary.rooms += 1,
            Some("wall") => summary.walls += 1,
            Some("door") => summary.doors += 1,
            Some("window") => summary.windows += 1,
            Some("furniture") => summary.furniture += 1,
            _ => summary.unknown += 1,
        }
    }
    Ok(summary)
}

/// `layoutRevision`: an integer 1–10; anything else counts as 1. Higher integers are returned as is
/// so that the caller can refuse them.
fn read_revision(value: Option<&Value>) -> u32 {
    value
        .and_then(Value::as_u64)
        .filter(|revision| *revision >= 1)
        .map_or(1, |revision| u32::try_from(revision).unwrap_or(u32::MAX))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn summarize(json: &str) -> Result<PlanSummary, ErrorCode> {
        summarize_plan(json.as_bytes()).map_err(|err| err.code)
    }

    const MINIMAL: &str = r#"{"version":1,"unit":"cm","elements":[{"id":"a","type":"room"}]}"#;

    #[test]
    fn reads_a_minimal_plan() {
        let summary = summarize(MINIMAL).unwrap();
        assert_eq!(summary.revision, 1);
        assert_eq!(summary.rooms, 1);
        assert_eq!(summary.title, "");
    }

    #[test]
    fn ignores_a_byte_order_mark() {
        let with_bom = format!("\u{feff}{MINIMAL}");
        assert!(summarize(&with_bom).is_ok());
    }

    #[test]
    fn refuses_bad_envelopes() {
        assert_eq!(summarize("not json"), Err(ErrorCode::NotJson));
        assert_eq!(summarize("[]"), Err(ErrorCode::NotAnObject));
        assert_eq!(
            summarize(r#"{"version":2,"unit":"cm","elements":[{}]}"#),
            Err(ErrorCode::BadVersion)
        );
        assert_eq!(
            summarize(r#"{"version":1,"unit":"mm","elements":[{}]}"#),
            Err(ErrorCode::BadUnit)
        );
        assert_eq!(
            summarize(r#"{"version":1,"unit":"cm","elements":[]}"#),
            Err(ErrorCode::NoElements)
        );
        assert_eq!(
            summarize(r#"{"version":1,"unit":"cm"}"#),
            Err(ErrorCode::NoElements)
        );
    }

    #[test]
    fn revisions_follow_the_format() {
        let plan = |revision: &str| {
            format!(r#"{{"version":1,"unit":"cm","layoutRevision":{revision},"elements":[{{}}]}}"#)
        };
        assert_eq!(summarize(&plan("10")).unwrap().revision, 10);
        assert_eq!(summarize(&plan("0")).unwrap().revision, 1);
        assert_eq!(summarize(&plan("\"7\"")).unwrap().revision, 1);
        assert_eq!(summarize(&plan("7.5")).unwrap().revision, 1);
        assert_eq!(summarize(&plan("11")), Err(ErrorCode::NewerRevision));
    }

    #[test]
    fn refuses_too_many_elements() {
        let elements = vec![r#"{"type":"room"}"#; MAX_ELEMENTS + 1].join(",");
        let json = format!(r#"{{"version":1,"unit":"cm","elements":[{elements}]}}"#);
        assert_eq!(summarize(&json), Err(ErrorCode::TooManyElements));
    }

    #[test]
    fn deep_nesting_is_an_error_not_a_crash() {
        let json = format!("{}{}", "[".repeat(100_000), "]".repeat(100_000));
        assert_eq!(summarize(&json), Err(ErrorCode::NotJson));
    }

    #[test]
    fn titles_are_cut_by_characters() {
        let title = "é".repeat(150);
        let json = format!(r#"{{"version":1,"unit":"cm","title":"{title}","elements":[{{}}]}}"#);
        assert_eq!(summarize(&json).unwrap().title.chars().count(), 100);
    }
}
