<!--
  Copied from the House Maquette project (same author), MIT licence: see THIRD_PARTY_NOTICES.md.
  Only references to the original app's source files were removed and the example points to
  DomoTwin's own fictional plan. The format rules are unchanged.
-->

> **About this copy.** DomoTwin reads the House Maquette plan format natively. This page is the format's
> reference, copied from House Maquette under the MIT licence (see
> [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md)). `validate()` names the reader of the
> original app; DomoTwin's own reader is `domotwin-core`. How DomoTwin uses the format (overlay of
> edits, bindings, unsupported parts) is in [DomoTwin notes](#domotwin-notes) at the end.

# Plan format (`*.plan.json`)

A House Maquette plan is a UTF-8 JSON file (at most 32 000 000 bytes; a leading byte order mark is
ignored). It holds the rooms, free walls, doors, windows and furniture of one apartment, the saved
3D viewpoints and, optionally, what surrounds the apartment (`site`) and the user's own 3D models
(`models`). The format is the one of _Atelier Plan_ v9 plus the `site` object, the light settings
of light fittings and the user models; files of both apps load in House Maquette.

- Machine-readable reference: [`schema/plan.schema.json`](../schema/plan.schema.json) (JSON Schema
  draft 2020-12). Point your editor at it for completion and checks.
- Example: [`examples/demo-apartment.plan.json`](../examples/demo-apartment.plan.json) (DomoTwin's own
  fictional apartment).

A minimal plan:

```json
{
  "version": 1,
  "layoutRevision": 10,
  "unit": "cm",
  "elements": [
    { "id": "living", "type": "room", "name": "Living room", "x": 0, "y": 0, "w": 480, "h": 400 },
    { "id": "kitchen", "type": "room", "name": "Kitchen", "x": 480, "y": 0, "w": 300, "h": 400 },
    { "id": "d1", "type": "door", "name": "Door", "x": 480, "y": 150, "w": 90, "angle": 90 },
    {
      "id": "sofa",
      "type": "furniture",
      "name": "Sofa",
      "kind": "sofa",
      "x": 20,
      "y": 100,
      "w": 90,
      "h": 210,
      "z": 85,
      "parent": "living"
    }
  ]
}
```

## Units and axes

- Every length is in **centimetres**; `unit` must be `"cm"`.
- Plan axes are those of the 2D view: **x grows to the right, y grows down** the screen.
- Angles are **degrees**; the app stores them normalised to [0, 360). Because y points down, a
  positive angle turns **clockwise** on screen.
- In 3D, x = plan x, **z = plan y** and y is the height above the floor. Orbit viewpoints store 3D
  points as `[x, height, plan y]`.
- Walk viewpoints store their yaw and pitch in **radians**.

## How the app reads a file

`validate()` is lenient where Atelier Plan was, so that old or hand-written files keep loading:

- unknown fields are dropped;
- an invalid optional value gets its default (an unknown colour, role, floor, kind, style…);
- texts are cut to their maximum length;
- files of older revisions are migrated (see [Revisions](#revisions-and-migrations)).

It **rejects** the whole file, with a French message (to be translated with the i18n milestone),
when a required value is missing or out of range. The file written back always has every field
in its canonical form, which is what the JSON Schema describes.

## Top level

| Field            | Type                   | Default             | Notes                                                     |
| ---------------- | ---------------------- | ------------------- | --------------------------------------------------------- |
| `version`        | `1`                    | required            | Format version.                                           |
| `layoutRevision` | integer 1–10           | 1                   | Format revision; saved as 10. See below.                  |
| `unit`           | `"cm"`                 | required            |                                                           |
| `title`          | string ≤ 100           | `""` (untitled)     | Shown in the header; names the exported file.             |
| `referenceName`  | string ≤ 100           | `""`                | Free reference (e.g. the source file name).               |
| `wallSettings`   | object                 | see [Walls](#walls) | Default wall thicknesses and the reflow option.           |
| `elements`       | array, 1–500 elements  | required            | Rooms, free walls, doors, windows, furniture.             |
| `views`          | array, ≤ 40 viewpoints | `[]`                | Saved 3D viewpoints, see [Views](#views).                 |
| `site`           | object                 | none                | Building exterior, see [Site](#site).                     |
| `models`         | object, ≤ 50 models    | none                | User 3D models, see [below](#user-3d-models-revision-10). |

`wallSettings`: `interior` 1–100 (default 10), `exterior` 1–100 (default 20), `spacing` 0–100
(default 0, the largest thickness the layout already leaves room for), `reflow` boolean (default
false, « Répercuter sur la disposition »).

## Common element fields

| Field    | Type         | Notes                                            |
| -------- | ------------ | ------------------------------------------------ |
| `id`     | string ≤ 100 | Unique in the plan.                              |
| `type`   | string       | `room`, `wall`, `door`, `window` or `furniture`. |
| `name`   | string       | Cut to 100 characters.                           |
| `x`, `y` | number       | Between −50 000 and 50 000.                      |
| `parent` | string       | Not for rooms; `""` (default) for none.          |

Furniture, doors, windows and free walls may name a room in `parent`: they follow it when it moves
or turns. A non-empty `parent` must be the id of a room.

Text lengths (`id`, `name`, `title`, …) are counted in characters (Unicode code points), as JSON
Schema's `maxLength` counts them: an emoji is one character. A text cut to its limit is never cut
inside a character.

## Rooms

A room is a polygon given **relative to its frame** `x, y, w, h`: vertex `[u, v]` (each 0–1) is the
plan point `[x + u·w, y + v·h]`. Side _i_ joins vertex _i_ and vertex _i + 1_ (the last side closes
the polygon).

| Field            | Type                 | Default                     | Notes                                                                 |
| ---------------- | -------------------- | --------------------------- | --------------------------------------------------------------------- |
| `w`, `h`         | number 5–10 000      | required                    | Frame width and depth (along y).                                      |
| `angle`          | number               | 0                           | Rotation last applied; the polygon itself is stored turned.           |
| `color`          | `#rrggbb`            | `#e5e9dc`                   | Fill colour on the plan.                                              |
| `estimated`      | boolean              | false                       | Dimensions still to be measured (listed in the checks panel).         |
| `role`           | string               | `piece`                     | `piece`, `placard` (closet: short label « Plac. »), `circulation`.    |
| `floor`          | string               | `uni`                       | Floor covering, see below.                                            |
| `floorAngle`     | number               | 0                           | Direction of the floor pattern.                                       |
| `wallStyle`      | string               | `blanc`                     | `blanc`, `vert-blanc` (green wainscot), `cimaise` (chair rail).       |
| `wallColor`      | `#rrggbb`            | none                        | Paint of the inner wall faces (stored lower case).                    |
| `cornice`        | `true`               | none                        | Crown moulding under the ceiling.                                     |
| `casing`         | `"arrondi"`          | none (square)               | Rounded door casings.                                                 |
| `materialSource` | string ≤ 300         | « Revêtement à confirmer. » | Note about the materials.                                             |
| `vertices`       | 3–64 points `[u, v]` | the frame rectangle         | Must not cross itself; area > 25 cm²; a 1e-7 tolerance outside 0–1.   |
| `openEdges`      | side indices         | `[]`                        | Sides without a wall; stored sorted and unique.                       |
| `edgeThickness`  | array, one per side  | all `null`                  | `null` = automatic, else 1–100 cm.                                    |
| `edgeFinish`     | array, one per side  | none                        | `"metro"`, `#rrggbb` or `null`; see below.                            |
| `bevel`          | number ≥ 0           | 0                           | Legacy: cut of the bottom-right corner, used only without `vertices`. |

**Per-side finishes** (`edgeFinish`) override `wallStyle` on that side: `"metro"` for subway
tiles, `#rrggbb` for paint, `null` for none; the array is kept only when one side has a finish.

**Floor coverings:** `uni` (plain), `bois-gris`, `bois-chene`, `bois-peint` (planks),
`carrelage-beige`, `carrelage-blanc` (tiles), `photo-stratifie`, `photo-carrelage`,
`photo-bois-gris`, `photo-stratifie-gris`, `photo-lattes` (photo textures).

**Legacy `bevel`.** Atelier Plan rooms without `vertices` but with `bevel` are trapezoids whose
bottom-right corner is cut by `bevel` cm: vertices `[0,0] [1,0] [1 − bevel/w, 1] [0,1]`. They load
with exactly that polygon; `bevel` itself is kept, clamped to 0…w − 5.

## Walls

Room walls are implicit: every closed side of every room polygon gets one.

- The parts of a side that face another room (probed up to ~53 cm away) are **interior
  partitions**, `wallSettings.interior` thick (10 cm by default), **centred on the limit shared
  with the neighbour**: each room draws its half. When the rooms are separated by a gap narrower
  than the wall, the partition is centred on the middle of the gap.
- The rest of the side is **façade**, `wallSettings.exterior` thick (20 cm by default), lying
  **entirely outside** the room polygon. Outer corners between two façade walls are filled.
- `edgeThickness[i]` overrides both for side _i_; sides listed in `openEdges` have no wall.
- Doors and windows cut the walls they sit on; their 2D mask and 3D frame take the depth of those
  walls.
- With `reflow` on, changing a thickness moves the neighbouring rooms (with their children) so that
  inner dimensions never change; `spacing` then records the largest thickness in use.

**Free walls** (`type: "wall"`, « Cloison ») are separate partitions from `(x, y)` to `(x2, y2)`
(each within ±50 000), centred on that segment, `thickness` 1–100 cm, at least 5 cm long, with an
optional `parent`. They appear in 2D and in the SVG fallback only.

## Doors and windows

| Field   | Type                                       | Notes                                       |
| ------- | ------------------------------------------ | ------------------------------------------- |
| `w`     | number: 20–300 (doors), 20–1 000 (windows) | Width of the opening.                       |
| `angle` | number, required                           | Direction of the opening along the wall.    |
| `swing` | `1` (default) or `−1`                      | Side the leaf opens to (unused by windows). |
| `style` | doors only, default `battante`             | See below.                                  |
| `open`  | doors only, integer 0–100                  | See below.                                  |

**Geometry.** The opening runs from the hinge point `P0 = (x, y)` to `P0 + w·u`, with
`u = (cos a, sin a)`. Let `n = (−sin a, cos a)` (u turned +90° in plan coordinates). The leaf of a
single door is hinged at `P0` and closes along +u; it opens towards the side **`swing · n`**. With
an opening fraction f, its tip is at `P0 + w·(cos(f·90°)·u + swing·sin(f·90°)·n)`. A double door
has a second leaf hinged at the far end. In 3D the closed leaf sits on the wall face of the swing
side; doors are 207 cm high, windows go from a 90 cm sill to a 215 cm head.

**Styles:** `battante` (hinged), `vitree` (hinged, glazed), `double` (two leaves), `pliante`
(folding from `P0`), `pliante-double` (folding from both ends), `coulissante` (sliding along −u
inside the wall face), `grange` (barn door sliding 5 cm out of the wall), `passage` (no door),
`condamnee` (closed for good). Unknown styles are read as `battante`.

**`open` (doors).** 0 = closed, 1–99 = partly open (percent); absent = **fully open** (100 is not
stored). Values are rounded and values below 0 become 0; a value from 99.5 to 99.99 rounds to a
stored 100, which also means fully open.

## Furniture

| Field         | Type              | Default                                          | Notes                                               |
| ------------- | ----------------- | ------------------------------------------------ | --------------------------------------------------- |
| `w`, `h`      | number 1–10 000   | required                                         | Footprint: width and depth (along local y).         |
| `z`           | number 1–300      | required                                         | Height.                                             |
| `elevation`   | number 0–300      | none (on the floor)                              | Height of the underside; stored only when above 0.  |
| `angle`       | number            | 0                                                | Rotation about the centre of the box.               |
| `kind`        | string            | `desk`                                           | See the list below; unknown kinds become `desk`.    |
| `model`       | string            | none                                             | Kind `custom` only: id of a model of `models`.      |
| `variant`     | string            | none                                             | Alternative model, only among those of the kind.    |
| `color`       | `#rrggbb`         | `#e5e9dc`                                        |                                                     |
| `role`        | string            | `piece`                                          | As for rooms.                                       |
| `estimated`   | boolean           | true                                             | Always true: furniture dimensions are estimates.    |
| `source`      | string ≤ 300      | « Implantation proposée ; dimensions estimées. » | Note.                                               |
| `locked`      | `true`            | none                                             | Fixed item: cannot be moved or rotated on the plan. |
| `open`        | integer 0–100     | none                                             | Curtains only, see below.                           |
| `lightOff`    | `true`            | none (on)                                        | Light kinds only: switched off.                     |
| `lightColor`  | `#rrggbb`         | none (default warm white)                        | Light kinds only (revision 9): colour of the light. |
| `lightKelvin` | integer 1800–6500 | none                                             | Light kinds only (revision 9): colour temperature.  |
| `lightPower`  | integer 10–200    | none (100 %)                                     | Light kinds only (revision 9): % of the intensity.  |

**Position and orientation.** `x, y` is the **top-left corner of the unrotated box** and `angle`
turns the box about its centre `(x + w/2, y + h/2)`. The **front is local +y** (the `y + h` side):
at angle 0 a piece faces +y, down the screen. `sofa`, `armchair` and `tv` items with **h > w are
"vertical"**: the model is built with width and depth swapped and turned so that its front faces
local −x.

**Kinds.** `sofa`, `armchair`, `table`, `tv`, `plant`, `bed`, `nightstand`, `dresser`, `desk`,
`chair`, `bookcase`, `counter`, `sink`, `stove`, `fridge`, `dining`, `bathtub`, `vanity`, `linen`,
`toilet`, `washer`, `dryer`, `bin`, `cabinet`, `shelf`, `cart`, `dishwasher`, `hood`, `soffit`,
`backsplash`, `shoecab`, `heater`, `curtain`, `frame`, `gallery`, `mirror`, `chandelier`,
`pendant`, `spot`, `lamp`, `ceilinglight`, `fan`, `tablelamp`, `lantern`, `desklamp`, `barrister`,
`openshelf`, `trunk`, `stand`, `officechair`, `roundtable`, `console`, `printer`, `conduit`,
`printer3d`.

**User models (revision 10).** A piece of kind `custom` shows the user 3D model named by its
`model` (an id of the plan's `models`, required for this kind and dropped from the others). It has
no variant and no light settings; the checks see its box like any other piece's.

**Variants** (absent = the default model): `plant` monstera, pothos, dracaena · `bed` metal ·
`nightstand` 3-tiroirs, 1-tiroir · `dresser` ancien · `linen` armoire · `tv` mural · `sofa`,
`armchair` cuir · `openshelf` metal · `stand` marbre, epingle · `mirror` blanc · `frame` gravure,
portrait, bd, carte, affiche · `pendant` cylindre · `ceilinglight` fleurons · `curtain` ferme ·
`printer3d` sans-bobine, enclosure, enclosure-sans-bobine.

**3D printer (`printer3d`).** A Creality Ender-3 V3 SE, 35 × 36 × 49 cm by default (added with
revision 10: House Maquette 0.4.1 refuses such a plan instead of reading the kind as `desk`). `color` is the filament's (the spool); the
machine stays black. The variant says what is shown: absent, the machine with its spool;
`sans-bobine`, without the spool; `enclosure`, inside its enclosure (48 × 60 × 72 cm at the default
size), with the spool; `enclosure-sans-bobine`, inside it without the spool. The model is scaled to
`w`, `h` and `z`; its spool rises above `z` and its enclosure goes beyond the footprint, but the
conflict checker uses the piece's box, as for any piece. The 2D plan also draws, dashed, the depth
the bed needs while printing (50 cm at the default depth: 7 cm in front and 7 cm behind) and the
enclosure's footprint: drawings only, never checked.

**`open` (curtains).** 0 = drawn closed, 100 = gathered open, rounded and clamped to 0–100. When
absent, curtains of variant `ferme` are closed and the others open.

**`lightOff`.** `true` = switched off; absent = on. Only for the light kinds `chandelier`,
`pendant`, `spot`, `lamp`, `nightstand`, `ceilinglight`, `fan`, `tablelamp`, `lantern`,
`desklamp`. The UI switches the spots of one room together.

**Light settings (revision 9).** Light fittings (the same kinds) may say how they light:

- `lightColor`: the colour of the light, `#rrggbb` (written in lower case), picked by the user;
- `lightKelvin`: a colour temperature in kelvin, 1800–6500 (rounded and clamped); the colour is
  computed from it with Tanner Helland's black-body approximation: 2700 K is a warm white
  (`#ffa757`), 4000 K a neutral white (`#ffcea6`), 6500 K daylight (`#fffefa`);
- `lightPower`: the intensity in percent of the fitting's default, 10–200 (rounded and clamped);
  100 is the default and is not written.

A fitting has a colour or a temperature, never both: picking a colour removes the temperature and
the other way round (a file with both keeps the colour). Without either, the fitting gives the app's
default warm white (`#ffd6a0`). The fields are dropped from other kinds and when invalid.

## Conflict checker

The « Points à vérifier » panel
reports, in this order:

1. **Overlapping rooms**: two room polygons overlap. Shared sides and touching corners are fine.
2. **Openings off contour**: a door or window whose whole width is not within 6 cm of the sides of
   some room. Free walls do not count as contours.
3. **Furniture outside its room**: an item with a parent room has a corner, pulled 0.6 cm towards its
   centre, outside that room. Items without a parent are not checked.
4. **Overlapping furniture**: two items whose height ranges `[elevation, elevation + z]` overlap by
   more than 1 cm and whose footprints overlap by more than 1 cm. Allowed pairs: `sink`/`counter`,
   `stove`/`counter`, `dishwasher`/`counter`, `sink`/`vanity`.
5. **Blocked doors**: the swept area of a door overlaps (> 1 cm) an item whose height range meets
   0–205 cm. The fully open sweep is used whatever `open` says.
6. **Clashing doors**: the swept areas of two doors overlap by more than 5 cm.

**Swept areas:** `battante`, `vitree`: a quarter disc of radius `w` hinged at `P0` on the swing
side; `double`: two quarter discs of radius `w/2` hinged at both ends; `pliante`: the folded panel
quadrilateral `(0,0) (w,0) (w/2, s·w/2) (0, s·w/2)` in the door frame (local x along u, local y along
n, `s = swing`); `pliante-double`: two such shapes of width `w/2`; sliding doors, passages and
blocked doors: none.

**Soft kinds** are ignored by checks 4 and 5 (they still count for check 3): `curtain`, `spot`,
`chandelier`, `pendant`, `backsplash`, `frame`, `gallery`, `mirror`, `ceilinglight`, `fan`,
`tablelamp`, `lantern`, `desklamp`, `conduit`.

The panel also lists the rooms marked `estimated` and the plan assumptions (wall thicknesses,
locked items).

## Views

At most 40 viewpoints are read; invalid ones are dropped.

- **Walk:** `{ id, name, mode: "walk", x, y, yaw, pitch, eye }`: plan position (|x|, |y| < 50 000),
  `yaw` in radians (0 looks towards −y, up the screen), `pitch` in radians (clamped to ±1.3), `eye`
  height 60–200 cm (default 160; seated views use 112).
- **Orbit:** `{ id, name, mode: "orbit", p, t }`: camera position and target `[x, height, plan y]`,
  each coordinate strictly between −100 000 and 100 000.

`id` is a string shorter than 80 characters (otherwise a new one is generated); `name` is cut to 60
characters, and an empty name becomes « Vue ». Both kinds may have a `thumb`: a picture of the
view taken when it was saved, as a `data:image/jpeg;base64,…` URL of at most 20 480 characters
(≈ 15 KB of JPEG); a thumbnail that is not such a URL is dropped (the view is kept).

## Site

`site` describes what surrounds the apartment in 3D: the building shell, the street, neighbours,
trees. It is optional; `validate()` checks it and stores it with its defaults filled in. `null`
counts as absent. Its fields are described by the `site` definition of the schema.

## User 3D models (revision 10)

`models` holds the plan's own 3D models, by id: furniture (or anything else) imported by the user
without a new release of the app, either a **3D file** (GLB / glTF, OBJ, STL, 3MF) or a **kit** of
primitive parts (the `kit` definition of the schema). The catalogue lists them in « Mes modèles »
(« My models »); every piece of kind `custom` names one in `model`. A model that no piece uses is
kept (it stays in « Mes modèles »).

```json
"models": {
  "m-0c3e…": {
    "name": "Bar stool",
    "size": [38, 38, 71],
    "color": "#a0714a",
    "kit": { "parts": [{ "shape": "cylinder", "at": [0, 0, 62], "size": [38, 38, 4], "material": "accent:wood" }] }
  },
  "m-9a41…": {
    "name": "Armchair",
    "size": [80, 85, 95],
    "file": { "format": "glb", "hash": "3f1b…(64 hex digits)", "bytes": 734211, "up": "y" }
  }
}
```

| Field   | Type         | Default       | Notes                                                                                          |
| ------- | ------------ | ------------- | ---------------------------------------------------------------------------------------------- |
| id      | object key   | required      | 1–64 letters, digits, `-`, `_`, starting with a letter or a digit (the app writes `m-<uuid>`). |
| `name`  | string ≤ 100 | « Modèle 3D » | Shown in « Mes modèles », on the plan and in the inspector.                                    |
| `size`  | `[w, d, h]`  | required      | Real size in cm (w, d 1–10 000; h 1–300): the size of a new piece.                             |
| `color` | `#rrggbb`    | none          | Colour of new pieces (`#b8ad9a` without it); written in lower case.                            |
| `kit`   | object       | —             | `{ size?, parts }`, see the schema's `kit`; exactly one of `kit` and `file`.     |
| `file`  | object       | —             | An imported file, see below.                                                                   |

**Files.** `file` is `{ format, hash, bytes, up, data? }`:

- `format`: `glb` (binary glTF), `gltf` (glTF with its buffers and images embedded as data URLs),
  `obj`, `stl` or `3mf`;
- `hash`: the SHA-256 of the file, 64 lower-case hexadecimal digits;
- `bytes`: its size, 1–8 000 000; the files of one plan total at most 20 000 000 bytes;
- `up`: the axis of the file that points up: `y` (glTF, most OBJ files) or `z` (STL, 3MF, CAD
  software; default for those formats);
- `data`: **in exported files only**, the file itself as a `data:<type>;base64,…` URL.

On the device, the bytes are stored in IndexedDB under their hash and the plan (autosaved to local
storage, too small for 3D files) keeps only the reference; the JSON export embeds every file in
`data`, so that the plan opens with its models on another device, and the import stores them back
(computing the hash from the bytes). A piece whose file is not on the device (site data cleared, a
plan copied without its export) is drawn as a box of its size, and « Points à vérifier » says so.

**Drawing.** A piece fits its model into its own `w × h × z`: a kit's box (its parts' box and its
design `size`), or the bounding box of the file turned so that `up` points up. A model's front is
the kit's +y side (the `y + h` side of the piece, as for every kind), or the file's +z side (Y up)
or −y side (Z up, the usual front of CAD software). Parts of STL and OBJ files take the piece's
colour; GLB, glTF and 3MF files keep their own materials and embedded textures (external files and
web addresses are refused).

**Limits**: 50 models per plan,
8 MB per file, 20 MB of files per plan (an export embeds them as base64: about 27 MB), 150 000
triangles per file, 200 parts per kit, 1 MB per kit file. A file is also refused when its
structure is invalid or too large for the app to read safely (glTF nodes that do not form a tree,
accessors outside their data, more than 5 000 meshes once nodes or components are expanded,
pictures above 4 096 × 4 096 pixels, a 3MF archive that is not strictly valid or unpacks to more
than 32 MB); importing a plan whose embedded file is refused fails with the model's name and the
reason.

## Revisions and migrations

`layoutRevision` is the revision of the format. When a plan is loaded, `validate()` first brings it
to the current revision by running, one after the other, the versioned migrations, then checks
it with the current rules. A
missing or invalid `layoutRevision` (anything but an integer 1–10) counts as 1. Plans are always
saved with `layoutRevision: 10`. A file of a higher revision (written by a newer House Maquette) is
refused with « Ce plan a été enregistré par une version plus récente… » rather than loaded without
the fields this version does not know.

| Revision | Written by     | Change                                                   | Migration to the next revision |
| -------- | -------------- | -------------------------------------------------------- | ------------------------------ |
| 1–6      | Atelier Plan   | Successive layouts of the original app's reference plan. | none: same format              |
| 7        | Atelier Plan   | Last revision of the original app.                       | 7 → 8: none (data unchanged)   |
| 8        | House Maquette | Optional `site` object.                                  | 8 → 9: none (data unchanged)   |
| 9        | House Maquette | Optional `lightColor`, `lightKelvin`, `lightPower` (M8). | 9 → 10: none (data unchanged)  |
| 10       | House Maquette | User 3D models: `models`, furniture kind `custom`.       | current                        |

In Atelier Plan, `layoutRevision` numbered the successive layouts of the owner's apartment, not
format changes: the app replaced a stored plan of a lower revision by its new reference plan. The
format only grew, and every field added over time (`wallSettings`, `views`, `vertices`,
`openEdges`, `edgeThickness`, `edgeFinish`, door `style` and `open`, curtain `open`, `lightOff`,
`variant`, `elevation`…) is optional with a default in every revision. Old files therefore load
with identical geometry. A plan of revision 1–7 that already contains a `site` (for example
combined by a script) keeps it.

Revision 9 changes no existing data: its migration is empty. It exists so that House Maquette
0.3 (revision 8) refuses a plan with light settings instead of silently dropping them. Revision 10
is the same for the user models: House Maquette 0.4 (revision 9) refuses a plan that may hold
models instead of loading their pieces as desks. To change the format in the future, add revision
11 with a migration that takes a revision 10 plan (raw JSON) and returns a revision 11 plan, bump
`PLAN_REVISION`, and update the schema and this document.

## Fixed 3D dimensions

Door height 207 cm; window sill 90 cm, head 215 cm; standing eye 160 cm, seated 112 cm; cut-away
walls 38 cm; chair rail 90 cm; default ceiling 265 cm (slider 0–300).

## DomoTwin notes

These notes are DomoTwin's, not part of the copied reference.

- **Revisions.** DomoTwin reads revisions 1 to 10 with the same lenient rules and refuses a higher
  revision with a translated message.
- **Never modified in place.** The imported plan is stored as it was read. Edit mode writes an
  overlay keyed by element id (position, rotation, elevation, support, added or removed pieces) and
  the bindings live beside it, so re-importing an updated plan keeps both. **Export plan** writes a
  revision 10 plan with the overlay applied.
- **User models.** `custom` pieces made from a kit are drawn from M1; pieces whose model is a 3D
  file are drawn as a box of their size until M3 brings the 3D file import (`DECISIONS.md`, D-013).
- **Not drawn.** `site` is kept for the export but not drawn, and walk viewpoints are kept but
  DomoTwin has no walk mode.
- **Photo floors.** DomoTwin ships no photo textures. `photo-*` floors use the matching procedural
  material until the user uploads a picture for that key.
- **Messages.** Rejection messages are translated (English and French) instead of French only.
- **Other inputs.** An IFC file (ISO 16739) can be imported: one storey is converted to this format
  (see [`ifc-import.md`](ifc-import.md)).
