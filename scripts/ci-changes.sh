#!/usr/bin/env bash
# Which CI jobs a change needs (.github/workflows/ci.yml and fuzz.yml). Writes `job=true|false`
# lines to $GITHUB_OUTPUT (stdout when run by hand) and lists the changed files.
#
#   EVENT=pull_request BASE=<sha> HEAD=<sha> scripts/ci-changes.sh
#
# Everything runs for a manual run, when the base is unknown (a new or rewritten branch) and when
# the CI itself changes. The weekly run checks what changes without a commit: the Home Assistant
# validators and the RustSec advisories. A push to main runs the jobs that keep the caches warm
# for pull requests (the merged tree was already tested by its pull request), not the E2E.
set -euo pipefail

out="${GITHUB_OUTPUT:-/dev/stdout}"
event="${EVENT:-workflow_dispatch}"
base="${BASE:-}"
head="${HEAD:-HEAD}"

ci='^(\.github/workflows/ci\.yml|scripts/ci-changes\.sh)$|^\.github/actions/'
rust='^(crates/|\.cargo/|examples/)|^(Cargo\.(toml|lock)|rust-toolchain\.toml|rustfmt\.toml|clippy\.toml)$'
deny='^(Cargo\.(toml|lock)|deny\.toml|crates/[^/]+/Cargo\.toml)$'
frontend='^frontend/|^\.nvmrc$'
python='^(custom_components/|tests/|examples/|schema/|docs/)|^(requirements_test\.txt|pyproject\.toml|README(\.fr)?\.md)$'
integration='^custom_components/|^hacs\.json$'
build="$rust|$frontend|^scripts/(build\\.sh|check-bundle-size\\.mjs)$"
fuzz_core='^(crates/domotwin-core/|fuzz/|examples/)|^\.github/workflows/fuzz\.yml$'
fuzz_ifc='^(crates/domotwin-(core|ifc)/|fuzz/)|^\.github/workflows/fuzz\.yml$'

files=""
all=false
case "$event" in
  workflow_dispatch) all=true ;;
  schedule) ;;
  *)
    if [ -z "$base" ] || [ "$base" = 0000000000000000000000000000000000000000 ] ||
      ! git cat-file -e "$base^{commit}" 2>/dev/null; then
      all=true
    elif [ "$event" = pull_request ]; then
      files="$(git diff --name-only "$base...$head")"
    else
      files="$(git diff --name-only "$base" "$head")"
    fi
    ;;
esac
if [ -n "$files" ] && grep -qE "$ci" <<<"$files"; then all=true; fi

needs() {
  if [ "$all" = true ]; then echo true; return; fi
  if [ -n "$files" ] && grep -qE "$1" <<<"$files"; then echo true; else echo false; fi
}

weekly=false
if [ "$event" = schedule ]; then weekly=true; fi
rust_needed="$(needs "$rust")"
build_needed="$(needs "$build")"
e2e_needed="$build_needed"
if [ "$event" = push ] && [ "$all" != true ]; then e2e_needed=false; fi
{
  echo "rust=$rust_needed"
  echo "deny=$([ "$weekly" = true ] && echo true || needs "$deny")"
  echo "frontend=$(needs "$frontend")"
  echo "python=$(needs "$python")"
  echo "integration=$([ "$weekly" = true ] && echo true || needs "$integration")"
  echo "build=$build_needed"
  echo "e2e=$e2e_needed"
  echo "fuzz_core=$(needs "$fuzz_core")"
  echo "fuzz_ifc=$(needs "$fuzz_ifc")"
} >>"$out"

if [ "$all" = true ]; then
  echo "Everything runs (event: $event)." >&2
else
  echo "Changed files:" >&2
  printf '%s\n' "${files:-(none)}" >&2
fi
