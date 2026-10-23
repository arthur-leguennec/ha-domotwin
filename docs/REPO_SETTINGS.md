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

## Who can change the repository

On a public repository only the owner and the collaborators they add can push. Everyone else can only
fork and open pull requests, which the owner reviews and merges or closes.

- Settings → Collaborators: keep it empty (or give *Read* / *Triage* roles only).
- Turn on **two-factor authentication** on the owner account: it protects the repository more than
  any setting below.
- Settings → Moderation options → Interaction limits: temporary limits if spam ever appears.

## General

- Features: Issues on, Discussions optional, Wiki off, Projects off.
- Pull requests: allow **squash merging** only (default message: pull request title and
  description), disable merge commits and rebase merging, enable "Always suggest updating pull
  request branches" and "Automatically delete head branches".

## Branch protection for `main` (Settings → Rules → Rulesets)

- Target: the default branch. Enforcement: *Active*.
- **Bypass list:** *Repository admin* only (the owner, for emergencies).
- Restrict deletions and block force pushes.
- Require a pull request before merging: **0 required approvals** while there is a single maintainer
  (GitHub does not let authors approve their own pull requests; raise it to 1 when a second
  maintainer joins), dismiss stale approvals on new commits, require conversation resolution.
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

### Tags (optional)

A second ruleset targeting tags `v*`: restrict creations, updates and deletions, with *Repository
admin* and the *GitHub Actions* app in the bypass list (release-please creates the release tags).

## Actions (Settings → Actions → General)

- Allow actions from GitHub and the actions pinned in the workflows.
- **Approval for running fork pull request workflows:** *Require approval for all external
  contributors*, so that strangers cannot run workflows without the owner's approval.
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
