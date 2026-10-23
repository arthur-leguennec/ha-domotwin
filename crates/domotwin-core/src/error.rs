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
    /// `version` is missing or is not `1`.
    BadVersion,
    /// `unit` is missing or is not `"cm"`.
    BadUnit,
    /// `elements` is missing, empty or not an array.
    NoElements,
    /// More elements than the format allows.
    TooManyElements,
    /// The plan was written by a newer revision of the format.
    NewerRevision,
    /// `wallSettings` has a value out of range.
    WallThickness,
    /// An element without a valid id, type or name, or with a duplicate id.
    InvalidElement,
    /// Two elements share an id.
    DuplicateId,
    /// `x` or `y` out of range.
    PositionRange,
    /// A room frame out of range.
    RoomSize,
    /// A furniture footprint out of range.
    FurnitureSize,
    /// A furniture height out of range.
    FurnitureHeight,
    /// A furniture elevation out of range.
    ElevationRange,
    /// An `angle` that is not a number.
    InvalidAngle,
    /// A room polygon with a wrong number of vertices or vertices outside the frame.
    VertexCount,
    /// A room polygon that crosses itself.
    SelfIntersection,
    /// A room polygon smaller than 25 cm².
    MinArea,
    /// `openEdges` is not a list.
    InvalidOpenEdges,
    /// `openEdges` names a side that does not exist.
    OpenEdgeRange,
    /// `edgeThickness` does not match the sides or has a value out of range.
    InvalidEdgeThickness,
    /// A free wall out of range or shorter than 5 cm.
    InvalidWall,
    /// A door or window without a valid width or angle.
    InvalidOpening,
    /// A `parent` that is not the id of a room.
    MissingParent,
    /// A `custom` piece whose model is not in `models`.
    MissingModel,
    /// An invalid entry of `models`.
    InvalidModel,
    /// An invalid `site`.
    InvalidSite,
}

impl ErrorCode {
    /// The stable code sent to the frontend.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Empty => "empty",
            Self::TooLarge => "too_large",
            Self::NotJson => "not_json",
            Self::NotAnObject => "not_an_object",
            Self::BadVersion => "bad_version",
            Self::BadUnit => "bad_unit",
            Self::NoElements => "no_elements",
            Self::TooManyElements => "too_many_elements",
            Self::NewerRevision => "newer_revision",
            Self::WallThickness => "wall_thickness",
            Self::InvalidElement => "invalid_element",
            Self::DuplicateId => "duplicate_id",
            Self::PositionRange => "position_range",
            Self::RoomSize => "room_size",
            Self::FurnitureSize => "furniture_size",
            Self::FurnitureHeight => "furniture_height",
            Self::ElevationRange => "elevation_range",
            Self::InvalidAngle => "invalid_angle",
            Self::VertexCount => "vertex_count",
            Self::SelfIntersection => "self_intersection",
            Self::MinArea => "min_area",
            Self::InvalidOpenEdges => "invalid_open_edges",
            Self::OpenEdgeRange => "open_edge_range",
            Self::InvalidEdgeThickness => "invalid_edge_thickness",
            Self::InvalidWall => "invalid_wall",
            Self::InvalidOpening => "invalid_opening",
            Self::MissingParent => "missing_parent",
            Self::MissingModel => "missing_model",
            Self::InvalidModel => "invalid_model",
            Self::InvalidSite => "invalid_site",
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
