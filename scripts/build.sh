#!/usr/bin/env bash
# Builds the WebAssembly engine and the frontend bundle into custom_components/domotwin/frontend/.
#
# Needs: the Rust toolchain of rust-toolchain.toml, wasm-bindgen-cli (same version as the
# wasm-bindgen crate), wasm-opt (binaryen) and Node.js 22 with `npm ci` done in frontend/.
#   scripts/build.sh          release build
#   scripts/build.sh --dev    faster build with source maps, no wasm-opt
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mode="release"
[[ "${1:-}" == "--dev" ]] && mode="dev"

pkg="$root/frontend/src/engine/pkg"
wasm_target="$root/target/wasm32-unknown-unknown"

expected="$(sed -n 's/^wasm-bindgen = "=\(.*\)"$/\1/p' "$root/Cargo.toml")"
actual="$(wasm-bindgen --version | awk '{print $2}')"
if [[ "$expected" != "$actual" ]]; then
  echo "wasm-bindgen $actual found, $expected needed: cargo install wasm-bindgen-cli --version $expected --locked" >&2
  exit 1
fi

if [[ "$mode" == "release" ]]; then
  cargo build --locked -p domotwin-web --target wasm32-unknown-unknown --release
  wasm="$wasm_target/release/domotwin_web.wasm"
else
  cargo build --locked -p domotwin-web --target wasm32-unknown-unknown
  wasm="$wasm_target/debug/domotwin_web.wasm"
fi

mkdir -p "$pkg"
wasm-bindgen --target web --out-dir "$pkg" --out-name domotwin_web "$wasm"

if [[ "$mode" == "release" ]]; then
  # The features match what Rust 1.97 emits for wasm32-unknown-unknown.
  wasm-opt -Oz --strip-debug --strip-producers \
    --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext \
    --enable-mutable-globals --enable-reference-types --enable-multivalue \
    -o "$pkg/domotwin_web_bg.wasm" "$pkg/domotwin_web_bg.wasm"
fi

(cd "$root/frontend" && node build.mjs $([[ "$mode" == "dev" ]] && echo --dev))
