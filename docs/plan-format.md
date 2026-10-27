# The DomoTwin plan format

A DomoTwin plan describes one storey of a home: its rooms (the walls follow from them), free
partitions, doors, windows, the pieces of furniture and appliances in it, saved viewpoints and the
3D files some pieces are drawn from. It is a JSON file (`*.domotwin.json`, UTF-8), written by the
plan editor, the IFC import and **Export plan**, and read by **Import plan**. The JSON Schema is
[`schema/plan.schema.json`](../schema/plan.schema.json).

```json
{
  "format": "domotwin-plan",
  "version": 1,
  "name": "Demo apartment",
  "wallThickness": { "interior": 10, "exterior": 20 },
  "rooms": [
    {
      "id": "living",
      "name": "Living room",
      "outline": [[0, 0], [520, 0], [520, 400], [0, 400]],
      "floor": { "material": "oak", "angle": 90 },
      "walls": { "finish": "plain", "paint": "#f3efe6", "moulding": true },
      "sides": [null, { "thickness": 20 }, null, { "open": true }]
    }
  ],
  "partitions": [],
  "doors": [
    { "id": "entrance", "from": [600, 400], "to": [690, 400], "opensTo": "left", "room": "hall" }
  ],
  "windows": [{ "id": "bay", "from": [120, 0], "to": [300, 0], "room": "living" }],
  "items": [
    { "id": "sofa", "name": "Sofa", "kind": "sofa", "at": [260, 300], "size": [210, 90, 85],
      "rotation": 0, "room": "living" }
  ],
  "views": [{ "id": "corner", "name": "From the corner", "eye": [40, 40, 260], "target": [300, 260, 0] }]
}
```

## Conventions

- **Lengths** are in centimetres. **Points** are `[x, y]` on the plan: `x` to the right, `y` down
  the page. In 3D, `x` stays, the plan's `y` goes into the depth and heights go up.
- **Angles** are in degrees, clockwise as seen on the plan (from `x` towards `y`).
- **Fractions** (how open a door is, a lamp's power…) are numbers, `1` meaning whole.
- **Colours** are `"#rrggbb"`.
- **Ids** are strings of 1 to 100 characters, unique in the plan (and, in a home of several
  storeys, in the whole home). Names are texts of up to 100 characters; they may be empty.
- Coordinates stay within ±50 000 cm.

## Reading

The reader is **strict on structure and lenient on values**:

- a file that is not JSON, not an object, not a DomoTwin plan (`format`), of a newer `version`,
  without any element, with more than 500 elements, with an element missing what defines it (a
  room's outline, an opening's ends, a piece's place and size) or with two elements sharing an id
  is refused, with a code and the element concerned;
- an optional value that is missing, of the wrong type or out of range takes its default; texts
  are cut to their longest; fields it does not know are not read (they stay in the stored plan
  and in exports as they are).

Nothing a file contains makes the reader fail otherwise: it is fuzzed.

## The plan

| Field           | Type                    | Default | |
| --------------- | ----------------------- | ------- | --- |
| `format`        | `"domotwin-plan"`       | —       | Required. |
| `version`       | `1`                     | —       | Required. A higher integer is a newer plan, refused with `newer_version`. |
| `name`          | text                    | `""`    | The home's or the storey's name. |
| `wallThickness` | `{interior, exterior}`  | 10, 20  | Default thickness of the walls between two rooms, and of the façades (1–100 cm). |
| `rooms`         | array of rooms          | `[]`    | |
| `partitions`    | array of partitions     | `[]`    | |
| `doors`         | array of doors          | `[]`    | |
| `windows`       | array of windows        | `[]`    | |
| `items`         | array of items          | `[]`    | Furniture, appliances, lamps, stairs. |
| `views`         | array of viewpoints     | `[]`    | At most 40 are read. |
| `models`        | object of 3D models     | `{}`    | At most 50. |

A plan has at least one element (a room, a partition, a door, a window or an item) and at most 500.

## Rooms and their walls

| Field     | Type            | Default   | |
| --------- | --------------- | --------- | --- |
| `id`      | id              | —         | Required. |
| `name`    | text            | `""`      | |
| `outline` | array of points | —         | Required: 3 to 64 corners, a simple polygon (its sides do not cross) of at least 25 cm². |
| `color`   | colour          | `#e5e9dc` | Its fill on the 2D plan. |
| `floor`   | object          |           | `material`: `plain` (default), `oak`, `grey-wood`, `painted-wood`, `beige-tiles` or `white-tiles`; `angle`: the direction of boards or tiles (default 0). |
| `walls`   | object          |           | `finish`: `plain` (default), `wainscot` (green panels below a rail) or `chair-rail`; `paint`: the colour of the inner faces; `moulding`: a crown moulding under the ceiling (`false`). |
| `sides`   | array           | `[]`      | One entry per side (side `i` runs from corner `i` to the next), `null` or an object: `open` (`true`: no wall on that side), `thickness` (1–100 cm), `finish` (`"tiles"` or a paint colour, for that side's inner face). |

**Walls follow from the rooms.** Every side of a room has a wall unless it is open. A side shared
with another room is one wall between them, `wallThickness.interior` thick and centred on the
shared line; a side on the outside is a façade, `wallThickness.exterior` thick and built outward,
so the room keeps its size inside. A side's `thickness` overrides either.

## Partitions

Free-standing walls, for a partition that does not follow a room's side.

| Field       | Type  | Default | |
| ----------- | ----- | ------- | --- |
| `id`        | id    | —       | Required. |
| `name`      | text  | `""`    | |
| `from`, `to`| point | —       | Required: its two ends, at least 5 cm apart. |
| `thickness` | cm    | `wallThickness.interior` | 1–100. |
| `room`      | id    | none    | The room it belongs to. |

## Doors and windows

An opening sits on a wall, from one end to the other.

| Field       | Type  | Default | |
| ----------- | ----- | ------- | --- |
| `id`        | id    | —       | Required. |
| `name`      | text  | `""`    | |
| `from`, `to`| point | —       | Required: its two ends along the wall (doors 20–300 cm apart, windows 20–1 000 cm; ends a quarter of a centimetre farther apart, from rounding, are read at the limit). A door's leaf hangs at `from`. |
| `opensTo`   | `"left"` or `"right"` | `"right"` | The side its leaf swings to, walking from `from` to `to` on the plan. |
| `room`      | id    | none    | The room it belongs to. |
| `style`     | door style | `hinged` | Doors only: `hinged`, `glazed`, `double`, `folding`, `double-folding`, `sliding`, `barn`, `opening` (a passage without a leaf) or `sealed` (drawn closed, the wall not cut). |
| `open`      | fraction | `1`  | Doors only: how open the leaf is drawn (0 closed). |

An opening whose line runs along a room's side is cut into that side's wall; the others are drawn
where they are.

## Items

Furniture, appliances, lamps and stairs: a box with a kind that tells how it is drawn and what it
does.

| Field      | Type      | Default | |
| ---------- | --------- | ------- | --- |
| `id`       | id        | —       | Required. |
| `name`     | text      | `""`    | |
| `kind`     | kind      | `box`   | One of the kinds below; an unknown kind is drawn as a plain box. |
| `at`       | point     | —       | Required: the centre of its footprint. |
| `size`     | `[width, depth, height]` | — | Required: width and depth 1–10 000 cm, height 1–300 cm. Its front is the side towards `+y` before turning. |
| `rotation` | degrees   | 0       | Clockwise, about its centre. |
| `lift`     | cm        | 0       | The height of its underside (0–300): a wall cabinet, a hanging lamp. |
| `color`    | colour    | the kind's | Its main colour. |
| `style`    | text      | none    | A variant of its kind (below). |
| `room`     | id        | none    | The room it belongs to. |
| `fixed`    | boolean   | `false` | Built in: edit mode does not move it. |
| `light`    | object    |         | Lamps only: `on` (`true`), `color` (a colour) or `kelvin` (1 800–6 500), `power` (0.1–2, a fraction of the kind’s usual light). |
| `open`     | fraction  | `1`     | Curtains only: how open they are drawn. |
| `model`    | id        | none    | A 3D model of `models`: the piece is drawn from it, fitted into its size. |

### Kinds

| Group | Kinds (styles) |
| --- | --- |
| Living room | `sofa` (`leather`, `chesterfield`), `corner-sofa` (`left`), `armchair` (`leather`, `wingback`), `rocking-chair`, `ottoman` (`round`), `coffee-table` (`round`, `glass`), `side-table` (`marble`, `hairpin`), `round-table`, `console`, `tv` (`wall-mounted`), `tv-stand`, `piano` (`digital`), `fireplace` (`stove`, `electric`), `chest`, `bench` (`upholstered`) |
| Dining | `dining-table` (`pedestal`), `chair` (`bistro`, `upholstered`), `bar-stool` (`backrest`), `sideboard` |
| Kitchen | `counter`, `kitchen-island` (`sink`, `hob`), `sink`, `stove` (`gas`), `oven` (`double`), `fridge` (`french-door`), `freezer` (`upright`), `wine-cooler`, `dishwasher`, `microwave`, `coffee-machine` (`espresso`), `kettle`, `toaster`, `hood`, `wall-cabinet`, `bulkhead`, `backsplash`, `trolley`, `bin` |
| Bedroom | `bed` (`metal`, `upholstered`, `four-poster`), `bunk-bed`, `crib`, `nightstand` (`three-drawers`, `one-drawer`), `dresser` (`antique`), `tall-cabinet` (`wardrobe`, `sliding`), `clothes-rack` |
| Bathroom | `bathtub` (`freestanding`), `shower` (`walk-in`, `quadrant`), `vanity` (`pedestal`, `double`), `toilet` (`wall-hung`), `towel-radiator`, `mirror` (`white`), `laundry-basket` |
| Laundry and utility | `washer`, `dryer`, `robot-vacuum` (its dock; its robot is drawn moving, D-049), `water-heater`, `boiler`, `furnace`, `electrical-panel`, `ev-charger`, `car` |
| Heating and air | `heat-pump`, `radiator`, `fan` (`tower`, `desk`), `air-purifier`, `dehumidifier`, `humidifier` |
| Smart home | `speaker` (`display`, `floor`, `soundbar`), `wall-tablet`, `thermostat`, `sensor` (`motion`), `smoke-detector`, `camera` (`wall`, `dome`), `router` (`mesh`), `access-point` |
| Office | `desk` (`standing`), `office-chair`, `monitor`, `computer`, `filing-cabinet`, `printer`, `3d-printer` (`enclosed`) |
| Storage | `bookcase`, `glazed-bookcase`, `open-shelving` (`metal`), `shelf`, `wall-shelf`, `shoe-cabinet`, `coat-rack` |
| Lights | `floor-lamp` (`arc`, `tripod`), `table-lamp`, `desk-lamp`, `wall-light` (`swing-arm`), `light-strip`, `lantern`, `pendant` (`cylinder`, `globe`, `dome`), `chandelier`, `ceiling-light` (`rosette`, `panel`), `track-light`, `spotlight`, `ceiling-fan` |
| Decoration and walls | `plant` (`monstera`, `pothos`, `dracaena`, `fiddle-leaf`, `snake-plant`), `vase` (`flowers`, `branches`), `books` (`upright`), `clock`, `rug` (`round`, `striped`), `aquarium`, `curtain` (`closed`), `picture` (`engraving`, `portrait`, `comic`, `map`, `poster`), `picture-wall` |
| Fitness | `treadmill`, `exercise-bike` |
| Pets | `pet-bed`, `cat-tree`, `litter-box` (`self-cleaning`), `pet-feeder` |
| Structure | `stairs`, `box` |

The groups are the catalogue's (D-072). The lights (the *Lights* row, `nightstand`, which has a
lamp, and `aquarium`, whose light is cool unless `light` says otherwise) light their room and can
be switched; a `fireplace` burns while what it is linked to is on or heats. A kind's usual size,
colour and lift, and a style's where it has its own (a `soundbar` is 90 × 10 × 7 cm, a
`chesterfield` oxblood), are used where edit mode's catalogue adds a piece; an item without
`color` takes its style's colour, else its kind's. An unknown style is drawn as its kind.

## Viewpoints

| Field    | Type  | |
| -------- | ----- | --- |
| `id`     | id    | Required (a viewpoint without one is given `view-<n>`). |
| `name`   | text  | Up to 60 characters. |
| `eye`    | `[x, y, height]` | Where the camera is. |
| `target` | `[x, y, height]` | What it looks at. |

A viewpoint without both points is left out.

## 3D models

`models` names the 3D files pieces are drawn from, by an id of 1 to 64 letters, digits, `-` and
`_`:

```json
"models": {
  "stool": {
    "name": "Bar stool",
    "size": [38, 38, 71],
    "file": { "format": "glb", "hash": "<sha256 of the file>", "bytes": 19012, "up": "y" }
  }
}
```

- `size` is the model's own size (1–10 000 cm, height up to 300); a piece fits it into its own.
- `file`: `format` (`glb`, `gltf`, `obj`, `stl` or `3mf`), `hash` (the SHA-256 of the file, which
  the integration stores, see [D-021](DECISIONS.md)), `bytes`, `up` (`y` or `z`).

A piece whose `model` is not in `models` is refused (`missing_model`). **Export plan** carries the
files a plan uses in `file.data`, as base64 `data:` URLs, so that it opens with its models
elsewhere; **Import plan** uploads them and keeps only their hash.

## Error codes

`empty`, `too_large`, `not_json`, `not_an_object`, `not_a_plan`, `newer_version`, `no_elements`,
`too_many_elements`, `wall_thickness`, `invalid_element`, `duplicate_id`, `position_range`,
`invalid_outline`, `self_intersection`, `min_area`, `item_size`, `item_height`,
`invalid_partition`, `invalid_opening`, `opening_too_wide` (the plan editor), `missing_room`,
`missing_model`, `invalid_model`. The interface translates each one and names the element.
