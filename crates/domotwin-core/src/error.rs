//! Errors returned to the frontend. The codes are stable: the frontend translates them
//! (`errors.plan.<code>` in the i18n dictionaries).

use std::fmt;

/// Why a plan (or another input) was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
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
}

impl ErrorCode {
    /// The stable code sent to the frontend.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::TooLarge => "too_large",
            Self::NotJson => "not_json",
            Self::NotAnObject => "not_an_object",
            Self::BadVersion => "bad_version",
            Self::BadUnit => "bad_unit",
            Self::NoElements => "no_elements",
            Self::TooManyElements => "too_many_elements",
            Self::NewerRevision => "newer_revision",
        }
    }
}

/// An input refused by a reader, with an optional detail for logs (never shown untranslated).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadError {
    /// What went wrong.
    pub code: ErrorCode,
    /// Where or why, for logs and diagnostics.
    pub detail: Option<String>,
}

impl ReadError {
    /// An error without detail.
    pub const fn new(code: ErrorCode) -> Self {
        Self { code, detail: None }
    }

    /// An error with a detail for logs.
    pub fn with_detail(code: ErrorCode, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: Some(detail.into()),
        }
    }
}

impl fmt::Display for ReadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.detail {
            Some(detail) => write!(f, "{}: {detail}", self.code.as_str()),
            None => f.write_str(self.code.as_str()),
        }
    }
}

impl std::error::Error for ReadError {}
