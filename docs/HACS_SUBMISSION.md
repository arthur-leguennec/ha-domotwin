# HACS submission checklist

Filled in at milestone M13, with release 0.2.0; 0.1.0 is released before it, without the
submission (`ROADMAP.md`). The submission to the HACS default repository list is made by the
maintainer.

## Before submitting

- [x] The repository is public, has a description and the topics of `REPO_SETTINGS.md`.
- [x] `hacs.json` declares `name`, `render_readme`, `homeassistant`, `zip_release` and `filename`.
- [x] A full GitHub release exists (not only a tag) with `domotwin.zip` attached, and the zip
      contains the files of `custom_components/domotwin/` at its root: 0.1.0's, made by
      `release-please.yml`, which makes 0.2.0's and 0.3.0's the same way.
- [x] The HACS action passes **without** `ignore:` entries (brands included).
- [x] `hassfest` passes.
- [x] Brand images: the integration ships its own in `custom_components/domotwin/brand/`
      (`icon.png`, `logo.png`, `dark_logo.png` and their `@2x` versions, `tests/test_brand.py`),
      which Home Assistant shows from 2026.3 on and HACS's brands check accepts. The
      [home-assistant/brands](https://github.com/home-assistant/brands) folder for custom
      integrations is legacy since then (D-044).
- [x] The README explains what the integration does, how to install and configure it.
- [x] The README's images and links are absolute URLs: HACS shows it inside Home Assistant, where
      relative paths do not resolve (`tests/test_readme.py`).
- [x] Install test on a clean Home Assistant from the release zip: the zip extracted into a fresh
      configuration's `custom_components/` (Home Assistant 2026.10). The smoke test
      (`scripts/ha-smoke.mjs`) passes, then the panel and a dashboard with the card work in a
      browser, with no request outside Home Assistant (D-044).
- [ ] Install test as a HACS custom repository, through HACS's own pages (the maintainer: HACS
      signs in to GitHub with the maintainer's account).
- [ ] Measurements on real devices (`PERFORMANCE.md`): a recent phone, a wall tablet, a laptop
      (the maintainer, with the panel's **Measure performance**, D-053).

## Submission

Open a pull request on `hacs/default` adding `arthur-leguennec/ha-domotwin` to the `integration`
list, in alphabetical order, following the template of that repository.
