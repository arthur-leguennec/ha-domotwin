# Repository settings to apply on GitHub

These settings live on GitHub, not in the repository, so they are listed here to be applied by hand.

## About

- **Description:** DomoTwin: your home as a live 3D twin in Home Assistant. Tap to control lights and
  rooms, see sensors as living overlays. Local, fast, Rust + WebAssembly.
- **Website:** leave empty (or the HACS install link once listed).
- **Topics:** `home-assistant`, `hacs`, `hacs-integration`, `3d`, `floorplan`, `digital-twin`,
  `smart-home`, `webassembly`, `rust`, `webgl`, `lovelace`.

The HACS validation job checks them, with nothing ignored (see `HACS_SUBMISSION.md`).

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

## Branch protection for `main` (Settings → Rules → Rulesets → New branch ruleset)

- **Ruleset name:** `protect-main`. **Enforcement status:** *Active* (with *Disabled* nothing applies).
- **Bypass list:** *Add bypass* → *Roles* → *Repository admin*, mode **For pull requests only**: the
  owner can merge a pull request that does not meet the rules (for example the release pull
  request, see below), but nobody can push to `main` directly.
- **Target branches:** *Add target* → *Include default branch*.
- **Rules:**
  - *Restrict creations*, *Restrict updates*: off (restricting updates would block merges).
  - *Restrict deletions*: on.
  - *Require linear history*: on.
  - *Require signed commits*: on (squash merges made by GitHub are signed by GitHub).
  - *Require a pull request before merging*: on, **0 required approvals** while there is a single
    maintainer (GitHub does not let authors approve their own pull requests; raise it to 1 when a
    second maintainer joins), *Dismiss stale pull request approvals when new commits are pushed*,
    *Require conversation resolution before merging*, allowed merge methods: **Squash** only.
  - *Require status checks to pass*: on, with *Require branches to be up to date before merging*.
    The check names are the job names (of `.github/workflows/ci.yml` unless said otherwise). The
    CI runs only the jobs a change needs; a job skipped that way counts as passed, so a change of
    documentation alone is not blocked:
    - `rust`, `rust wasm tests`, `cargo deny`
    - `frontend`
    - `python`, `hassfest`, `HACS validation`
    - `bundle`, `e2e` (it passes when the four parts of the browser tests, `e2e (1/3)` to
      `e2e (3/3)` and `e2e (perf)`, all pass; they are not required themselves)
    - `gitleaks` (`security.yml`), `analyze (actions)`, `analyze (javascript-typescript)`,
      `analyze (python)`, `analyze (rust)` (`codeql.yml`, on every pull request)
    - `conventional commit title` (`pr-title.yml`)

    Not `changes` (it only says which jobs to run; when it fails, every job runs) nor `fuzz`: it
    only runs when the code it fuzzes changes and would block other pull requests.
  - *Block force pushes*: on.
  - *Require code scanning results*: on, tool **CodeQL**, security alerts **High or higher**.
  - *Require deployments*, code quality, code coverage, Copilot review: off.

Release pull requests opened by release-please use `GITHUB_TOKEN`, which does not start workflows,
so their required checks never report. The owner merges them through the bypass (or runs the checks
on the release branch from the Actions tab: every workflow has `workflow_dispatch`).

### Tags (optional)

A second ruleset, `release-tags`, targeting tags `v*` (*Include by pattern*): restrict creations, updates and deletions, with *Repository
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
