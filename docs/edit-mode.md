# Edit mode

Administrators rearrange the furniture of the imported plan from the DomoTwin panel: move, turn,
stack, remove and add pieces, with undo. The plan as imported is never changed: the edits are an
**overlay** stored beside it (`layout`), so importing an updated plan later keeps the edits of the
pieces that still exist. Rooms, partitions, doors and windows are changed in the
[plan editor](plan-editor.md), or in your modelling software and imported again.

![Edit mode: a piece dragged on the 2D plan with its guides, and the library of pieces with their pictures](figures/screenshot-edit.png)

## Using it

In the panel, **Arrange** opens edit mode (administrators only). The header gets **Cancel** and
**Save**, and a bar appears at the bottom of the view.

- **Select**: tap a piece. **Select several** in the bar (or Ctrl, Cmd or Shift with the tap, or a
  long press) adds a piece to the selection or takes it out. A tap elsewhere clears the selection.
- **Move**: drag a selected piece. Dragging anywhere else still turns or moves the view.
- **Turn**: the two arrows of the bar turn the selection by 15°. One piece turns on itself onto
  the next step; several turn together around their middle.
- **Remove**: the bin of the bar.
- **Add a piece**: the catalogue is a library of the plan format's pieces (D-070), by room or use
  (living room, kitchen, bathroom, heating and air, smart home, pets…): each kind and each of its
  styles (a Chesterfield sofa, a soundbar, a wood stove…) with its own picture, drawn by DomoTwin in
  the look of the view, and its usual size. The search reads names, styles and other words in the
  language of the panel ("couch", "mini-split", « pompe à chaleur »), accents ignored. The new piece
  appears in the middle of the view, selected, ready to be dragged, at its style's size and in its
  colour.
- **Your own furniture or appliance**: see [Your own 3D models](#your-own-3d-models) below.
- **Undo** and **Redo**: the bar, or Ctrl+Z and Ctrl+Shift+Z (Ctrl+Y). 100 steps are kept.
- **Save** stores the overlay; **Cancel** asks before discarding changes.

Keys, when no text field has the focus and no dialog is open: Delete or Backspace removes, R turns
clockwise and Shift+R anticlockwise, Escape clears the selection.

The 2D plan (the toolbar of the view) is the easiest place to place pieces precisely; everything
works in 3D too.

### Snapping and guides

While a piece moves, each of its sides is pulled onto the nearest parallel **wall face** or
**edge of another piece** within reach (about 1.5 % of the view, in centimetres under the pointer,
so it is the same on a phone and on a wall tablet). With nothing to snap onto, a piece square to the
plan snaps onto a **5 cm grid**. The faces it snapped onto are drawn as dashed lines, and the free
**distances** from its four sides to the walls are written in centimetres.

### Stacking

Small objects stand on the piece they are dropped over: lamps, plants, screens, speakers, vases,
books, a kettle or a coffee machine, printers on tables, desks, chests, shelves, sideboards,
counters, a kitchen island, a TV stand…, a dryer on a washer. Moving a piece moves what
stands on it; turning it turns them too. Removing it puts them down on the floor. A piece fixed
higher than what is under it (a TV on a wall, a plant on a shelf the plan does not have) keeps its
height when it moves.

### Conflicts

A piece that overlaps another piece (at overlapping heights, one not standing on the other) or a
wall is drawn **red**, with the piece it overlaps, and the bar says so. Nothing is refused: plans
are approximate and you decide. Hanging, flat and ceiling pieces (rugs, curtains, pendants) never
conflict; wall decorations do not conflict with walls.

Fixed pieces (`locked` in the plan) can be selected but not moved, turned or removed.

## Your own 3D models

The catalogue starts with **My models**: the plan's own 3D models, to add more pieces of them, and
**Import a 3D model…** (`DECISIONS.md`, D-013 and D-021).

![Your own 3D models: bar stools drawn from a GLB file, and the import of a glTF lamp](figures/screenshot-models.png)

- **Files**: glTF 2.0 (`.glb`, or `.gltf` with its buffers and pictures embedded), `.obj`, `.stl`
  (binary or ASCII) and `.3mf`, up to 8 MB, 150 000 triangles and 5 000 meshes once nodes or
  components are expanded, pictures up to 4 096 × 4 096 pixels. A file that needs other files
  (an OBJ's material library, a glTF with a separate `.bin`) is refused, or drawn without them: export
  your model as a single GLB file.
- **Before importing**, give its name, the **unit** of the file (read from glTF and 3MF files,
  guessed for STL — millimetres — and OBJ files), the **up axis** (Y for glTF and most OBJ files, Z
  for STL, 3MF and CAD software) and its **real size**, filled in from the file. The model is fitted
  into that size; its front is the file's +z side (Y up) or −y side (Z up). Files without colours
  (STL, most OBJ) take a colour you choose.
- **Looks**: the colours, metal, glass and glowing (emissive) parts of glTF and 3MF materials are
  kept; the colours of pictures are taken at the vertices of the model, so a detailed texture on a
  few large faces is approximated.
- **Behaviour**: link the piece like any other. Linked to a light, it lights the room and its
  glowing parts light up; linked to a media player, it lights like a screen.
- The file is uploaded to Home Assistant at once, kept under its SHA-256 in
  `<config>/domotwin/models/` and served to signed-in users only. The model and its first piece are
  one change: Undo takes both away. A model imported in edit mode that no piece shows can be
  forgotten from My models (the bin next to it); a file nothing uses is deleted a day after its
  upload.
- Every view reads a plan's files once and draws their pieces as boxes until then, or when the files
  of a plan pass 600 000 triangles in all.

## Saving

**Save** sends the overlay with the revision edit mode started from. If the plan, the overlay or
the bindings were saved from another device in between, the save is refused with a message instead
of overwriting their work; cancel to see their version. Changes made while a save is on its way stay
in edit mode, to be saved too.

Until it is saved, the overlay is kept in this browser (local storage, on this device only) for the
revision it started from. If the tab closes or the connection drops, opening edit mode again offers
to **Restore** the changes; a draft is forgotten once the plan has been saved again.

**Export plan** writes the plan as it is now, with the overlay applied and the 3D files of its models
embedded as `data:` URLs, so that it opens with its models elsewhere; importing such a plan uploads
them again. Pieces added in edit mode get ids like `lamp-added-1`.

## The overlay

Stored by the integration in `layout`, keyed by element id (`domotwin-core::overlay`):

```json
{
  "sofa": { "at": [405, 155], "rotation": 90 },
  "plant-living": { "removed": true },
  "table-lamp": { "at": [205, 398], "lift": 75, "room": "living" },
  "floor-lamp-added-1": {
    "add": { "name": "Floor lamp", "kind": "floor-lamp", "color": "#f1e7d2", "size": [35, 35, 160] },
    "at": [57.5, 37.5], "room": "living"
  },
  "@model:m-6f1c…": {
    "model": { "name": "Bar stool", "size": [38, 38, 71],
               "file": { "format": "glb", "hash": "3f1b…", "bytes": 19012, "up": "y" } }
  },
  "model-added-1": {
    "add": { "name": "Bar stool", "model": "m-6f1c…", "color": "#a0714a", "size": [38, 38, 71] },
    "at": [139, 319], "room": "living"
  }
}
```

| Field | Meaning |
| --- | --- |
| `at` | The centre of its footprint, as in the plan format (cm). |
| `rotation` | Rotation, 0–360°. |
| `lift` | Height of the underside (cm, 0–300). |
| `room` | The room the piece now follows (set when a piece moves into another room). |
| `removed` | Taken out of the home. |
| `add` | A piece added in edit mode: its item, without `id` and its place (`name`, `kind` or `model`, `style` where it has one, `color`, `size`). |
| `model` | Keys `@model:<id>` only: a user model imported in edit mode, added to the plan's `models`. |

The overlay is applied to the plan's JSON before it is read, so the result is checked like any
plan; entries for pieces the plan no longer has, for elements that are not furniture, malformed
values, rooms the plan no longer has and added pieces past the 500 elements are ignored. When an
entry still makes the plan invalid (an updated plan), the entries are tried one by one and those the
plan refuses are left out; the view says how many. At most 1 000 entries.

## For developers

- `crates/domotwin-core/src/overlay.rs`: reading, writing and applying the overlay.
- `crates/domotwin-core/src/edit/`: footprints, snapping and guides, stacking, collisions, the
  history (`mod.rs`) and the session (`session.rs`: selection, drag, turn, remove, add, undo). All
  of it is plain Rust, tested on the demo plan without a GPU, and fuzzed with arbitrary overlays
  (`fuzz/fuzz_targets/edit_layout.rs`).
- `crates/domotwin-models/`: the readers of 3D files, their own wasm module
  (`frontend/src/models/`), fuzzed (`fuzz/fuzz_targets/model_file.rs`) and tested on the fictional
  models of `examples/models/` (`scripts/make-model-fixtures.py`). `domotwin-core::model_mesh` reads
  their meshes, `scene::imported` fits them into pieces.
- `crates/domotwin-web/src/editing.rs`: the session for JavaScript, in device pixels. While a piece
  is dragged, it and what stands on it are built with the moving parts and rebuilt alone at each
  pointer move; the whole scene is rebuilt when it is dropped. The selection and the conflicts are
  two flags of the element texture, tinted by the shader.
- Frontend: `<domotwin-view>` (`editing`, drags, keys, the SVG guides), `edit-bar.ts` (the bar and
  the catalogue, loaded when edit mode opens), the panel (save, cancel, draft in `live/draft.ts`).
- The catalogue's pictures (D-070): `PieceArtist` (`engine/engine.ts`) is a second engine on a
  hidden canvas, made when the catalogue opens and released when it closes; `piecePicture` builds
  a plan of the piece alone and `Renderer::piece_picture` draws it offscreen, framed on its
  bounds. The pieces shown come first, a few each frame (10 ms), and the pictures are kept for the
  session by look, accent and background. Without a second WebGL context, the pieces go without
  pictures.
