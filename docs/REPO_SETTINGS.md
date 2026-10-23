# Repository settings to apply on GitHub

These settings live on GitHub, not in the repository, so they are listed here to be applied by hand.

## About

- **Description:** DomoTwin: your home as a live 3D twin in Home Assistant. Tap to control lights and
  rooms, see sensors as living overlays. Local, fast, Rust + WebAssembly.
- **Website:** leave empty (or the HACS install link once listed).
- **Topics:** `home-assistant`, `hacs`, `hacs-integration`, `3d`, `floorplan`, `digital-twin`,
  `smart-home`, `webassembly`, `rust`, `webgl`, `lovelace`.

The HACS validation job ignores the `description` and `topics` checks until these are set; remove
`description topics` from `ignore:` in `.github/workflows/validate.yml` afterwards.

## General

- Features: Issues on, Discussions optional, Wiki off, Projects off.
- Pull requests: allow **squash merging** only (default message: pull request title and
  description), disable merge commits and rebase merging, enable "Always suggest updating pull
  request branches" and "Automatically delete head branches".

## Branch protection for `main` (Settings → Rules → Rulesets)

- Target: the default branch.
- Restrict deletions and block force pushes.
- Require a pull request before merging (1 approval if there are several maintainers; 0 otherwise),
  dismiss stale approvals on new commits, require conversation resolution.
- Require **linear history**.
- Require status checks to pass, with the branch up to date. The check names are the job names:
  - `rust`, `rust wasm tests`, `cargo deny`
  - `frontend`
  - `python`, `hassfest`, `HACS validation`
  - `bundle`, `e2e`
  - `gitleaks`, `analyze (actions)`, `analyze (javascript-typescript)`, `analyze (python)`
  - `conventional commit title`

Release pull requests opened by release-please use `GITHUB_TOKEN`, which does not start workflows.
Either let administrators bypass the required checks for those pull requests, or run the checks on
the release branch from the Actions tab (every workflow has `workflow_dispatch`).

## Actions (Settings → Actions → General)

- Allow actions from GitHub and the actions pinned in the workflows.
- Workflow permissions: **Read repository contents** by default (each workflow asks for more only
  where needed).
- Enable **Allow GitHub Actions to create and approve pull requests** (release-please needs it to
  open the release pull request).
- No repository secrets are needed. Do not add any.

## Code security (Settings → Code security)

- Dependency graph, Dependabot alerts and Dependabot security updates: on.
- **Secret scanning** and **push protection**: on (see `SECURITY.md`).
- Private vulnerability reporting: on.
- CodeQL: handled by `.github/workflows/codeql.yml` (do not enable the default setup as well).
