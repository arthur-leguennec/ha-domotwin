//! Errors returned to the frontend. The codes are stable: the frontend translates them
//! (`errors.plan.<code>` in the i18n dictionaries) and shows the element id when there is one.

use std::fmt;

/// Why a plan (or another input) was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    /// The file is empty.
    Empty,
    /// The input is larger than the format allows.
    TooLarge,
    /// The input is not valid UTF-8 JSON.
    NotJson,
    /// The top level is not a JSON object.
    NotAnObject,
    /// Not a DomoTwin plan (`format`, `version`, or a list that is not one).
    NotAPlan,
    /// A plan of a newer version of the format.
    NewerVersion,
    /// No element at all.
    NoElements,
    /// More elements than the format allows.
    TooManyElements,
    /// `wallThickness` has a value out of range.
    WallThickness,
    /// An element that is not an object or has no valid id.
    InvalidElement,
    /// Two elements share an id.
    DuplicateId,
    /// An item's place missing or out of range.
    PositionRange,
    /// A room's outline missing, of a wrong number of corners, out of range or too large.
    InvalidOutline,
    /// A room's outline that crosses itself.
    SelfIntersection,
    /// A room smaller than 25 cm².
    MinArea,
    /// An item's footprint missing or out of range.
    ItemSize,
    /// An item's height out of range.
    ItemHeight,
    /// A partition without both ends, or shorter than 5 cm.
    InvalidPartition,
    /// A door or window without both ends, or of a width out of range.
    InvalidOpening,
    /// A door or window wider than the side of its room (the plan editor's check).
    OpeningTooWide,
    /// A `room` that is not the id of a room.
    MissingRoom,
    /// An item whose model is not in `models`.
    MissingModel,
    /// An invalid entry of `models`.
    InvalidModel,
}

impl ErrorCode {
    /// The stable code sent to the frontend.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Empty => "empty",
            Self::TooLarge => "too_large",
            Self::NotJson => "not_json",
            Self::NotAnObject => "not_an_object",
            Self::NotAPlan => "not_a_plan",
            Self::NewerVersion => "newer_version",
            Self::NoElements => "no_elements",
            Self::TooManyElements => "too_many_elements",
            Self::WallThickness => "wall_thickness",
            Self::InvalidElement => "invalid_element",
            Self::DuplicateId => "duplicate_id",
            Self::PositionRange => "position_range",
            Self::InvalidOutline => "invalid_outline",
            Self::SelfIntersection => "self_intersection",
            Self::MinArea => "min_area",
            Self::ItemSize => "item_size",
            Self::ItemHeight => "item_height",
            Self::InvalidPartition => "invalid_partition",
            Self::InvalidOpening => "invalid_opening",
            Self::OpeningTooWide => "opening_too_wide",
            Self::MissingRoom => "missing_room",
            Self::MissingModel => "missing_model",
            Self::InvalidModel => "invalid_model",
        }
    }
}

/// An input refused by a reader: a code, the element concerned when there is one, and a detail
/// for logs (never shown untranslated).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadError {
    /// What went wrong.
    pub code: ErrorCode,
    /// Id of the element concerned (or `#<index>` when it has no valid id).
    pub element: Option<String>,
    /// Where or why, for logs and diagnostics.
    pub detail: Option<String>,
}

impl ReadError {
    /// An error without detail.
    pub const fn new(code: ErrorCode) -> Self {
        Self {
            code,
            element: None,
            detail: None,
        }
    }

    /// An error with a detail for logs.
    pub fn with_detail(code: ErrorCode, detail: impl Into<String>) -> Self {
        Self {
            code,
            element: None,
            detail: Some(detail.into()),
        }
    }

    /// The same error, about one element.
    #[must_use]
    pub fn at(mut self, element: impl Into<String>) -> Self {
        self.element = Some(element.into());
        self
    }

    /// The error as a small JSON object for the frontend: `{"code", "element"?}`.
    pub fn to_json(&self) -> String {
        let mut value = serde_json::json!({ "code": self.code.as_str() });
        if let (Some(element), Some(map)) = (&self.element, value.as_object_mut()) {
            map.insert("element".into(), element.clone().into());
        }
        value.to_string()
    }
}

impl fmt::Display for ReadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code.as_str())?;
        if let Some(element) = &self.element {
            write!(f, " ({element})")?;
        }
        if let Some(detail) = &self.detail {
            write!(f, ": {detail}")?;
        }
        Ok(())
    }
}

impl std::error::Error for ReadError {}
