#!/usr/bin/env bash
# Builds the WebAssembly modules (the engine; the plan import, loaded only to import a file; the 3D
# model reader, loaded only for plans with pieces drawn from 3D files; the plan editor; the analysis
# of the network map and the automations, loaded only when they are shown) and the frontend bundle
# into custom_components/domotwin/frontend/.
#
# Needs: the Rust toolchain of rust-toolchain.toml, wasm-bindgen-cli (same version as the
# wasm-bindgen crate), wasm-opt (binaryen) and Node.js 22 with `npm ci` done in frontend/.
#   scripts/build.sh          release build
#   scripts/build.sh --dev    faster build with source maps, no wasm-opt
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mode="release"
[[ "${1:-}" == "--dev" ]] && mode="dev"

wasm_target="$root/target/wasm32-unknown-unknown"

expected="$(sed -n 's/^wasm-bindgen = "=\(.*\)"$/\1/p' "$root/Cargo.toml")"
actual="$(wasm-bindgen --version | awk '{print $2}')"
if [[ "$expected" != "$actual" ]]; then
  echo "wasm-bindgen $actual found, $expected needed: cargo install wasm-bindgen-cli --version $expected --locked" >&2
  exit 1
fi

# build_module <crate> <output name> <package directory>
build_module() {
  local crate="$1" name="$2" pkg="$3" wasm
  if [[ "$mode" == "release" ]]; then
    cargo build --locked -p "$crate" --target wasm32-unknown-unknown --release
    wasm="$wasm_target/release/$name.wasm"
  else
    cargo build --locked -p "$crate" --target wasm32-unknown-unknown
    wasm="$wasm_target/debug/$name.wasm"
  fi
  mkdir -p "$pkg"
  wasm-bindgen --target web --out-dir "$pkg" --out-name "$name" "$wasm"
  if [[ "$mode" == "release" ]]; then
    # The features match what Rust 1.97 emits for wasm32-unknown-unknown.
    wasm-opt -Oz --strip-debug --strip-producers \
      --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext \
      --enable-mutable-globals --enable-reference-types --enable-multivalue \
      -o "$pkg/${name}_bg.wasm" "$pkg/${name}_bg.wasm"
  fi
}

build_module domotwin-web domotwin_web "$root/frontend/src/engine/pkg"
build_module domotwin-import domotwin_import "$root/frontend/src/import/pkg"
build_module domotwin-models domotwin_models "$root/frontend/src/models/pkg"
build_module domotwin-planner domotwin_planner "$root/frontend/src/planner/pkg"
build_module domotwin-analysis domotwin_analysis "$root/frontend/src/analysis/pkg"

(cd "$root/frontend" && node build.mjs $([[ "$mode" == "dev" ]] && echo --dev))
