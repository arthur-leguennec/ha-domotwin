# HACS submission checklist

Filled in at milestone M11. The submission to the HACS default repository list is made by the
maintainer.

## Before submitting

- [ ] The repository is public, has a description and the topics of `REPO_SETTINGS.md`.
- [ ] `hacs.json` declares `name`, `render_readme`, `homeassistant`, `zip_release` and `filename`.
- [ ] A full GitHub release exists (not only a tag) with `domotwin.zip` attached, and the zip
      contains the files of `custom_components/domotwin/` at its root.
- [ ] The HACS action passes **without** `ignore:` entries (brands included).
- [ ] `hassfest` passes.
- [ ] The integration is in the [home-assistant/brands](https://github.com/home-assistant/brands)
      repository (`custom_integrations/domotwin/icon.png`, `logo.png`, and their `@2x` versions).
- [ ] The README explains what the integration does, how to install and configure it.
- [ ] The README's images and links are absolute URLs: HACS shows it inside Home Assistant, where
      relative paths do not resolve (`tests/test_readme.py`).
- [ ] Install test as a HACS custom repository on a clean Home Assistant succeeded.

## Submission

Open a pull request on `hacs/default` adding `arthur-leguennec/ha-domotwin` to the `integration`
list, in alphabetical order, following the template of that repository.
