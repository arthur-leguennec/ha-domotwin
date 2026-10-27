# Contributing to DomoTwin

Thank you for helping. This page explains how to set up the project, run every check, and what a
pull request needs to be merged.

## The one rule: this repository is public

Never commit (or paste in an issue, a pull request, a commit message or a screenshot) a token, a
password, an API key, a Home Assistant address or IP address, an e-mail address, a real name, a real
address or a real floor plan.

- Keep your own plan, photos and textures in `private/` or `_input/`: both are ignored by git, and so
  is any `*.domotwin.json` outside `examples/` and the test fixtures.
- Tests, examples and screenshots use the **fictional** demo apartment of `examples/` (or another
  fictional plan you create).
- `pre-commit` runs gitleaks on every commit and CI scans every push. If something slips through,
  see [`SECURITY.md`](SECURITY.md): revoke the secret first.

## Set up

| Tool         | Version                                   | Why                                    |
| ------------ | ----------------------------------------- | -------------------------------------- |
| Rust         | from `rust-toolchain.toml` (rustup does it) | engine                               |
| wasm-bindgen | same as the crate: `cargo install wasm-bindgen-cli --version 0.2.129 --locked` | JS glue |
| binaryen     | 133 or newer (`wasm-opt`)                 | release size                           |
| Node.js      | 22 (`.nvmrc`)                             | frontend, E2E                          |
| Python       | 3.14                                      | integration tests                      |
| Python       | 3.12                                      | compile check of the integration       |
| pre-commit   | any recent                                | local checks                           |

```sh
cd frontend && npm ci && npx playwright install chromium && cd ..
python3.14 -m venv .venv && . .venv/bin/activate && pip install -r requirements_test.txt
pre-commit install
scripts/build.sh            # builds the wasm modules and the frontend into custom_components/domotwin/frontend
```

To try it in Home Assistant, link or copy `custom_components/domotwin` into the `custom_components`
folder of a test instance (never your production one) and restart it.

## Checks

The same commands run in CI:

```sh
# Rust
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo clippy -p domotwin-web -p domotwin-import -p domotwin-models -p domotwin-planner -p domotwin-analysis --target wasm32-unknown-unknown --all-targets -- -D warnings
cargo test --workspace
(cd crates/domotwin-web && CHROMEDRIVER=/path/to/chromedriver cargo test --target wasm32-unknown-unknown)
cargo deny check

# Frontend
cd frontend && npm run lint && npm run format:check && npm run typecheck && npm test
npx playwright test         # needs scripts/build.sh first; --project=perf: the measurements alone

# Python
python3.12 -m compileall -q custom_components/domotwin   # it must parse on the oldest Python
ruff check custom_components tests && ruff format --check custom_components tests
mypy && pytest

# Budget
node scripts/check-bundle-size.mjs
```

`cargo fuzz run plan_reader` (in `fuzz/`, nightly toolchain) fuzzes the plan reader
(`edit_layout`: the edit overlay, `ifc_reader`: the IFC import, `plan_import`: the other imports,
`model_file`: the 3D model readers);
CI runs the targets a pull request concerns for a minute each, and all of them weekly.

The fictional test files are written by scripts: `python3 scripts/make-ifc-fixtures.py` (IFC),
`python3 scripts/make-import-fixtures.py` (Sweet Home 3D, DXF, room scans, robot vacuum maps,
Floorplanner, mesh scans) and
`python3 scripts/make-model-fixtures.py` (the 3D models of `examples/models/`).

Visual-regression snapshots compare only the canvas pixels rendered by software WebGL2. After an
intended visual change, update them with `npx playwright test --update-snapshots` and look at the
new images before committing them.

## Code

- **Where things go.** Logic and geometry in `domotwin-core` (pure Rust, unit tested, never panics on
  input), drawing in `domotwin-render`, the JavaScript API in `domotwin-web`, Home Assistant and UI in
  `frontend/`, storage and the websocket API in `custom_components/domotwin` (keep it thin). See
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
- **Strings.** Every visible string goes through `t()` with keys in `frontend/src/i18n/en.ts` and
  `fr.ts` (the compiler and the tests check that both have the same keys). Integration strings live
  in `custom_components/domotwin/translations/`.
- **No network.** Nothing may be fetched from the internet: no CDN, no web fonts, no telemetry.
- **Dependencies.** Exact versions only. New Rust crates must pass `cargo deny`. Keep an eye on the
  bundle budget (`docs/PERFORMANCE.md`).
- **Decisions.** Anything that changes the architecture is written in `docs/DECISIONS.md` first.

## Pull requests

- One topic per pull request. Open it as a draft until the checks pass.
- The title follows [Conventional Commits](https://www.conventionalcommits.org/) with a lower-case
  subject: `feat: add the room panel`, `fix(core): keep open edges when rotating`. The title becomes
  the squash commit and the changelog line; `feat` and `fix` drive the next version (SemVer, via
  release-please).
- Fill in the pull request template, including the privacy checklist.
- Pull requests are squash-merged into `main`, which keeps a linear history.

## Releases

release-please keeps a release pull request open with the next version and the changelog. Merging
it tags the version and creates the GitHub release; CI then attaches `domotwin.zip` (the content of
`custom_components/domotwin` with the built frontend), which is what HACS installs.
