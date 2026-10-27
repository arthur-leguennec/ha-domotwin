# Configuration history

Home Assistant keeps no history of its own configuration: its editors' undo lasts one session, and
a backup puts back a whole part, not one automation. DomoTwin keeps each change of an automation,
a script, a scene and a dashboard, says what changed in words, and puts one item back as it was,
with Home Assistant's own configuration commands (`DECISIONS.md`, D-059). No add-on, no Git.

It is for administrators: the panel's ⋮ menu, **Configuration history**.

## What is kept

- **Automations, scripts and scenes** written by Home Assistant's editors (`automations.yaml`,
  `scripts.yaml`, `scenes.yaml`), read as its editors read them.
- **Those written in YAML files of your own** (`configuration.yaml`, packages), read as Home
  Assistant loaded them. They are shown, marked *Your YAML*, and put back by editing your files.
- **Dashboards** that have a configuration of their own, edited in Home Assistant or written in
  YAML. A dashboard Home Assistant makes by itself (one never edited) has nothing to keep.

Scenes made on the fly by `scene.create` are not configuration and are left out.

A version is kept:

- when DomoTwin starts, once Home Assistant has started: what changed while it was stopped, or
  by hand in the files, is kept then;
- after Home Assistant reloads its automations or scenes, and a few seconds after its scripts are
  reloaded, then again half a minute later (the editors reload after each save);
- when an automation, a script or a scene is deleted in its editor;
- when a dashboard is saved, or its configuration deleted;
- after DomoTwin puts an item back.

Only a real change makes a version: the same configuration with its keys in another order does
not. An item that is no longer there is kept as *removed*. When Home Assistant cannot read a file
(a typo in `automations.yaml`), DomoTwin leaves its items as they were rather than take them for
removed.

The history begins when DomoTwin first sees each item: what changed before is not known, and the
oldest version kept says so. Who made a change is not known either: Home Assistant's editors do
not say it.

## Looking through it

The dialog lists the items kept, the most recently changed first, with their kind, how many
versions there are and when the last change was. Pick a kind (automations, scripts, scenes,
dashboards) or search a name.

An item shows its versions, newest first. Open one to see **what it changed** from the one before
it, in words:

- *Changed* · Trigger 1 › offset · “-00:30:00” → “-00:20:00”
- *Added* · Action 2 · cover.close_cover · Living curtains
- *Removed* · Living lamp › brightness · 120
- *Added* · View “Kitchen” › Card 3 · tile · Kitchen light

The parts Home Assistant's editors name are said in words: the name, description and mode; the
triggers, conditions and actions of an automation; the steps and fields of a script; a scene's
entities, by their names, and their states; a dashboard's title, views, sections and cards.
Anything else is said by its place in the configuration. A list's items are matched first, so
that an action added reads as one action added, not as every action after it changed. At most 200
changes are listed, the rest counted.

Switch to **What putting it back changes** to compare a version with the current one. *Its whole
configuration* shows a version as it was kept.

## Putting a version back

**Put this version back**, then **Put back**: DomoTwin hands the version to Home Assistant through
the commands its own editors use, its configuration API for an automation, a script or a scene
(it checks the configuration, writes the file and reloads) and `lovelace/config/save` for a
dashboard. The version it replaces stays in the history, and the version put back becomes the
newest, said to be *the same as* the one it came from.

- An automation, a script or a scene that was deleted can be put back: it comes back with its id.
- A dashboard that was deleted can be put back once it exists again in Home Assistant.
- When Home Assistant refuses (an entity or an integration it no longer has), its words are shown
  and nothing changes.
- Not put back: what is written in your own YAML files, a removed version, and a version too large
  to keep.

**Open in Home Assistant** opens the item in its editor, or the dashboard.

## Size

The history is limited to 4 MB in all and 50 versions an item: past that, the oldest versions go
first, an item's newest version always kept. A version is kept up to 1 MB (a larger one keeps its
date, not its content). A removed item with nothing else kept is forgotten, and past 2 000 items
the removed ones are, the longest removed first. The dialog says how much is used.

## Privacy

- Administrators only: the commands refuse anyone else, as Home Assistant's own configuration does.
- Kept in Home Assistant's storage (`.storage/domotwin.config_history`), with Home Assistant's
  own files, and so in its backups. Nothing is sent anywhere.
- Never in the diagnostics, not even counted.
- Deleted when DomoTwin is removed; kept when it is only disabled or reloaded.

## In the demo house

The demo house has a history of its own: a few changes of its automations, a script deleted and
its dashboard. Putting a version back changes only the demo.
