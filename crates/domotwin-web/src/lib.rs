//! DomoTwin WebAssembly glue: the only crate that knows about JavaScript.
//!
//! The API is deliberately small and typed on the TypeScript side (`frontend/src/engine/`).
//! Structured results are returned as JSON strings, which keeps the glue small.

#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]

// The engine only exists in the browser; on other targets the crate is empty so that
// `cargo test --workspace` and `cargo clippy --workspace` work natively.
#[cfg(target_arch = "wasm32")]
mod engine;
#[cfg(target_arch = "wasm32")]
pub use engine::*;
