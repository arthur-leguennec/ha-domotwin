# Security policy

## Supported versions

Security fixes go into the latest release. Before 1.0, only the latest minor version is supported.

## Reporting a vulnerability

Please report vulnerabilities **privately** through GitHub:
[Security → Report a vulnerability](https://github.com/arthur-leguennec/ha-domotwin/security/advisories/new).
Do not open a public issue. Include what you found, how to reproduce it with the fictional demo plan
if possible, and the versions of DomoTwin and Home Assistant. You will get an answer within a week.

In scope: the integration (`custom_components/domotwin`), its websocket API and stored data, the
frontend and the WebAssembly engine (for example a plan file that crashes or hangs the engine).

## Secrets in this public repository

DomoTwin is developed in public. The repository must never contain secrets or personal data:
tokens, passwords, API keys, Home Assistant addresses or IP addresses, e-mail addresses, real names,
real addresses or real floor plans.

How this is enforced:

- **gitleaks in CI** on every push and pull request (the full history on `main`), with the project
  rules of [`.gitleaks.toml`](.gitleaks.toml) added to gitleaks' defaults: Home Assistant tokens and
  addresses, private IP addresses, e-mail addresses.
- **gitleaks in `pre-commit`**, so that a secret is caught before it is even committed
  (`pre-commit install` once per clone).
- **CI uses only the built-in `GITHUB_TOKEN`** with least-privilege permissions. The repository has
  no secrets to steal.
- **GitHub secret scanning with push protection.** The maintainer enables it in Settings → Code
  security: *Secret scanning* and *Push protection*. A push containing a recognised secret is then
  blocked before it reaches GitHub. If GitHub blocks your push, remove the secret from the commit
  (amend or rebase your local branch) rather than bypassing the protection.

### If a secret was pushed anyway

1. **Revoke it first** (for a Home Assistant token: Profile → Security → Long-lived access tokens →
   delete). Rewriting history does not un-leak a secret: forks, clones and caches may have it.
2. Tell the maintainer privately (see above).
3. Remove it from the history with `git filter-repo` and force-push, then ask GitHub support to purge
   cached views if needed.
