#!/usr/bin/env bash
# Which CI jobs a change needs (.github/workflows/ci.yml and fuzz.yml). Writes `job=true|false`
# lines to $GITHUB_OUTPUT (stdout when run by hand) and lists the changed files.
#
#   EVENT=pull_request BASE=<sha> HEAD=<sha> scripts/ci-changes.sh
#
# Each job runs when a changed file concerns it. A file that concerns no job is either known to need
# none (`quiet`: other workflows, templates, release files, documentation tools) or unknown, and an
# unknown file runs everything, as do a manual run, an unknown base (a new or rewritten branch) and
# a change of the CI itself. `cargo deny` runs every time (new advisories appear without a commit).
# The weekly run checks what changes without a commit: the Home Assistant validators and the
# advisories. A push to main runs the jobs that keep the caches warm for pull requests (the merged
# tree was already tested by its pull request), not the E2E.
set -euo pipefail

out="${GITHUB_OUTPUT:-/dev/stdout}"
event="${EVENT:-workflow_dispatch}"
base="${BASE:-}"
head="${HEAD:-HEAD}"

ci='^(\.github/workflows/ci\.yml|scripts/ci-changes\.sh)$|^\.github/actions/'
# The core's tests read the walls the integration counts (tests/fixtures/coverage-walls.json, D-059).
rust='^(crates/|\.cargo/|examples/)|^(Cargo\.(toml|lock)|rust-toolchain\.toml|rustfmt\.toml|clippy\.toml|deny\.toml|tests/fixtures/coverage-walls\.json)$'
frontend='^frontend/|^\.nvmrc$'
# The Python tests also check the README's links (every file at the root and in docs/), load the
# voice blueprints and check that the brand images are rendered from their sources (the font
# included).
python='^(custom_components/|tests/|examples/|schema/|docs/|blueprints/)|^(requirements_test\.txt|pyproject\.toml|[^/]+\.md|LICENSE|frontend/fonts/inter-variable\.woff2)$'
hassfest='^custom_components/'
# HACS shows and checks the README (render_readme).
hacs='^custom_components/|^(hacs\.json|README\.md)$'
build="$rust|$frontend|^scripts/(build\\.sh|check-bundle-size\\.mjs)$"
quiet='^\.github/(ISSUE_TEMPLATE/|PULL_REQUEST_TEMPLATE\.md$|CODEOWNERS$|dependabot\.yml$|workflows/(codeql|security|pr-title|release-please|nightly|fuzz)\.yml$)|^fuzz/|^(\.gitattributes|\.gitignore|\.gitleaks\.toml|\.pre-commit-config\.yaml|\.release-please-manifest\.json|release-please-config\.json)$|^scripts/(screenshots|render-figures|render-brand|ha-smoke|third-party-notices|lib/chromium)\.mjs$|^scripts/make-(ifc|model|import)-fixtures\.py$|^scripts/make-coverage-fixture\.py$'
fuzz_core='^(crates/domotwin-core/|fuzz/|examples/)|^(Cargo\.(toml|lock)|rust-toolchain\.toml|\.github/workflows/fuzz\.yml)$'
fuzz_ifc='^(crates/domotwin-(core|import|models)/|fuzz/)|^(Cargo\.(toml|lock)|rust-toolchain\.toml|\.github/workflows/fuzz\.yml)$'
fuzz_models='^(crates/domotwin-(core|models)/|fuzz/|examples/models/)|^(Cargo\.(toml|lock)|rust-toolchain\.toml|\.github/workflows/fuzz\.yml)$'

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
      # Without rename detection a moved file is listed at both paths: where it was matters too.
      files="$(git diff --no-renames --name-only "$base...$head")"
    else
      files="$(git diff --no-renames --name-only "$base" "$head")"
    fi
    ;;
esac
if [ -n "$files" ] && grep -qE "$ci" <<<"$files"; then all=true; fi
# A file no job knows about, and not known to need none: everything runs.
known="$rust|$frontend|$python|$hacs|$build|$quiet"
if [ -n "$files" ] && grep -vqE "$known" <<<"$files"; then
  echo "Not classified (everything runs):" >&2
  grep -vE "$known" <<<"$files" >&2
  all=true
fi

needs() {
  if [ "$all" = true ]; then echo true; return; fi
  if [ -n "$files" ] && grep -qE "$1" <<<"$files"; then echo true; else echo false; fi
}

weekly=false
if [ "$event" = schedule ]; then weekly=true; fi
build_needed="$(needs "$build")"
e2e_needed="$build_needed"
if [ "$event" = push ] && [ "$all" != true ]; then e2e_needed=false; fi
{
  echo "rust=$(needs "$rust")"
  echo "deny=true"
  echo "frontend=$(needs "$frontend")"
  echo "python=$(needs "$python")"
  echo "hassfest=$([ "$weekly" = true ] && echo true || needs "$hassfest")"
  echo "hacs=$([ "$weekly" = true ] && echo true || needs "$hacs")"
  echo "build=$build_needed"
  echo "e2e=$e2e_needed"
  echo "fuzz_core=$(needs "$fuzz_core")"
  echo "fuzz_ifc=$(needs "$fuzz_ifc")"
  echo "fuzz_models=$(needs "$fuzz_models")"
} >>"$out"

if [ "$all" = true ]; then
  echo "Everything runs (event: $event)." >&2
else
  echo "Changed files:" >&2
  printf '%s\n' "${files:-(none)}" >&2
fi
