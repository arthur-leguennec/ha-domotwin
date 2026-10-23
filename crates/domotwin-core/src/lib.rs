//! DomoTwin core.
//!
//! Pure Rust, no GPU and no web APIs: the plan model and its reader, geometry, the binding model and
//! the mapping from Home Assistant states to visuals. Every function that reads user input returns a
//! [`Result`] with a stable [`error::ErrorCode`]; nothing here panics on bad input.

#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]

pub mod camera;
pub mod error;
pub mod geometry;
pub mod plan;
pub mod scene;

pub use error::{ErrorCode, ReadError};
pub use plan::{Plan, PlanSummary, read_plan, summarize_plan};
