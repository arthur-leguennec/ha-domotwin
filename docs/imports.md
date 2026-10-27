# Plans from other apps

**Import plan**, in the DomoTwin panel, reads more than DomoTwin's own plans (`*.domotwin.json`).
It also reads the plans of the apps people draw their homes with, and turns them into ordinary
plans (`plan-format.md`):

| File | From | Storeys |
| --- | --- | --- |
| `.ifc` | building models (FreeCAD, Bonsai, ArchiCAD, Revit…): see [IFC import](ifc-import.md) | the file's storeys |
| `.sh3d` | [Sweet Home 3D](#sweet-home-3d) homes | the home's levels |
| `.dxf` | [DXF drawings](#dxf-drawings) (LibreCAD, QCAD, AutoCAD, DraftSight…) | one |
| `.usdz`, `.json` | [room scans](#room-scans) made with a phone's LiDAR (Apple's RoomPlan) | the scan's stories |
| `.json`, `.png`, `.gz` | [robot vacuum maps](#robot-vacuum-maps): Valetudo's, Roborock's | one |
| `.fml` | [Floorplanner plans](#floorplanner), and the apps that export to it | the project's floors |
| `.obj`, `.ply`, `.glb`, `.stl` | [mesh scans](#mesh-scans) (Polycam, Scaniverse, 3D Scanner App, Matterport…) | the scan's floors |

![Three fictional homes imported: a Sweet Home 3D cottage, a DXF studio and a scanned living room](figures/screenshot-imports.png)

![Three more: a robot vacuum's map, a Floorplanner plan and a house scanned as a mesh](figures/screenshot-more-imports.png)

The import runs in your browser, in a separate WebAssembly module downloaded only when you pick
one of these files. Dashboards never load it, and nothing leaves your Home Assistant. The format
comes from what the file holds, not from its name. A file with several storeys asks which one
to import, or imports them all (`storeys.md`).

Every import then works the same way. Rooms are widened to meet in the middle of the walls between
them, openings go on the room sides they sit in, and the plan is moved next to the origin. A
message lists what was left out. [IFC import](ifc-import.md#what-changes-on-the-way) says how.
Once imported, the plan is yours to finish in the [plan editor](plan-editor.md): names, floors,
a door that went missing.

## Sweet Home 3D

Homes saved by Sweet Home 3D 5.3 or later, which store an XML description (`Home.xml`) in the
`.sh3d` file. An older home says so (`sh3d_old`): open it in a recent Sweet Home 3D and save it
again.

| Sweet Home 3D | Becomes | Notes |
| --- | --- | --- |
| level | a storey | Name and elevation. Heights are measured from the level nearest 0. |
| room | a room | Its points and name. A level drawn with walls and no rooms gets the rooms its walls enclose, without names. |
| wall | wall thicknesses | Partitions: the gaps between rooms, as in an IFC file, else the walls' usual thickness. Façades: the thickest wall. |
| door or window | a door or a window | It is a door when its name or catalogue says so (door, porte, Tür, puerta, porta…), a window likewise. Without a word in its name, it is a door when it starts within 30 cm of the floor and is at least 1.70 m tall. The hinge side and the side it opens to come from its first sash. |
| piece, light, group | furniture | Each piece of a group on its own. Kind from the name and catalogue id (English, French and German words), else a box of its size; a light is a lamp, by its height. Hidden pieces are left out. |

Elements keep the home's own ids (written since Sweet Home 3D 6.4). Importing an updated home
again keeps your links. Not read: textures, colours, the pieces' 3D models (DomoTwin draws each
kind its own way; your own model can be added in [edit mode](edit-mode.md)), dimension lines,
labels, the compass. Curved walls are straight.

## DXF drawings

ASCII DXF files (AutoCAD R12 to 2018). A binary DXF says so (`dxf_binary`): save it as ASCII
DXF. DWG files are not read: export them as DXF.

A drawing is only lines. DXF does not say which lines are walls or which block is a door. The
names of its layers and blocks do, in English, French, German or Spanish:

| Layer or block named like | Is |
| --- | --- |
| wall, mur, cloison, Wand, muro, partition | walls (when no layer is, every line is, except on the layers below) |
| door, porte, Tür, puerta | doors |
| window, fenêtre, Fenster, ventana, glazing | windows |
| furniture, mobilier, Möbel, mueble, sanitary, kitchen | furniture |
| room, space, pièce, Raum, zone, area | rooms (their closed polylines) |
| dimension, cote, hatch, grid, axis, annotation, title | left out |

- **Units**: the drawing's `$INSUNITS` (millimetres, centimetres, metres, decimetres, inches,
  feet). When it has none: millimetres for a drawing over 4 000 units wide, metres under 150,
  centimetres between. A drawing placed on a map, far from its origin, is read as well.
- **Rooms**: the closed polylines of a room layer. Without them, the spaces the wall lines
  enclose, each door closing its wall's gap. A space under 65 cm wide is the inside of a wall
  (old stone walls are up to 60 cm thick), not a room. Neither is the outline around every
  room, nor a small closed shape inside a room (a table or a stair well drawn with lines). A
  room is named by the text written inside it, not by a note, a dimension or an area such as
  "12 m²".
- **Doors**: a door block's swing, the arc its leaf draws: the hinge is the arc's centre, the
  width its radius, and the leaf line says which side it opens to. Two leaves as wide, hinged
  at both ends, make a double door.
- **Windows and furniture**: their block's extent and rotation. The kind of a piece comes from
  its block's name (bed, sofa, lit, canapé…), else it is a box of its size. Circles count (a
  round table); a block that draws nothing read is listed as left out.
- Blocks within blocks are read up to 8 deep, mirrored ones too, and 200 000 entities at most.
  The layouts (paper space) are left out: their frames and title blocks are not the plan.

Elements are numbered in the order of the drawing (`room-1`, `door-1`…). After importing an
updated drawing, check the links. Not read: hatches, dimensions, splines, ellipses, 3D solids,
external references.

## Room scans

Scans made with Apple's **RoomPlan** (iPhone and iPad Pro with LiDAR), which most room-scanning
apps use. They export a **USDZ** file, or RoomPlan's **JSON** (`CapturedRoom` for one room,
`CapturedStructure` for a home of several rooms and stories). A USDZ in USD's binary format says
so (`scan_usdc`), and so does a root `.usda` layer alone without the layers it references
(`scan_usdz`): export the USDZ as the app gives it, or the JSON.

| RoomPlan | Becomes | Notes |
| --- | --- | --- |
| story | a storey | Named by its place (ground floor, floor 1…), its elevation from its floor. A USDZ does not say its stories: they are the levels its floors and walls stand at, more than 1.5 m apart. |
| floor | a room | Its outline. A story scanned without floors gets the rooms its walls enclose, their corners closed when they stop within 50 cm of each other. |
| section | the room's name | Living room, bedroom, bathroom, kitchen, dining room: in your language. |
| wall | wall thicknesses | A scan sees walls from the inside, without thickness: the gaps between two rooms scanned together give the partitions. |
| door, opening, window | doors (an opening without a leaf) and windows | |
| object | furniture | By category, below. |

| Category | Kind |
| --- | --- |
| sofa | sofa (an armchair when it seats one) |
| chair | chair (an office chair when it swivels) |
| table | coffee table, dining table or side table, by its type or its size |
| bed, sink, toilet, bathtub, dishwasher, stairs | the same |
| refrigerator, stove and oven, washer-dryer, television | fridge, stove, washer, TV |
| storage | a counter when a sink or a hob is in it or on it, else a bookcase (shelves), a wall cabinet (above 1 m), a tall cabinet (1.50 m or more) or a dresser |
| fireplace, others | a box of its size |

A scan follows where the phone pointed: the plan is turned so that its walls run along the axes.
Elements are numbered (`room-1`, `piece-1`…): after importing a new scan, check the links. A scan
exported as a mesh (OBJ, PLY…) is read as a [mesh scan](#mesh-scans).

## Robot vacuum maps

A robot vacuum maps the home as it cleans: its rooms, the walls its laser sees, its dock. DomoTwin
reads the map of robots running [Valetudo](https://valetudo.cloud) (many Roborock, Dreame, Xiaomi
and Viomi robots), and Roborock's own map. Nothing reaches the robot.

- **From Home Assistant**: with Valetudo's MQTT and Home Assistant's discovery on, each robot has a
  *Map data* camera. **Import a robot's map**, in the panel's ⋮ menu (or beside *Import plan* on a
  home without a plan), reads it through Home Assistant and links the dock to the robot's vacuum.
  With several robots, it asks which.
- **From a file**: the map Valetudo's REST API gives (`http://<robot>/api/v2/robot/state/map`,
  saved as `.json`), what it publishes over MQTT (`MapData/map-data`, deflated), or the camera's
  picture (`.png`). Roborock's own map as Valetudo RE serves it (`/api/map/latest`) or as the
  Xiaomi Cloud Map Extractor stores it (`store_map_raw`), gzipped (`.gz`).

| Map | Becomes | Notes |
| --- | --- | --- |
| segment | a room | Kept by its id (`segment-16`): importing the map again keeps your links. Named as in Valetudo. A map without segments is one room. |
| its pixels | the room's outline | Closed over what the robot went round (chair and table legs, gaps under 30 cm), squared to the walls; the map is turned so that they run along the axes. Furniture the robot could not go behind (a sofa against a wall) leaves its notch: finish it in the plan editor. |
| two rooms touching | a door | Where they touch with no wall between them, as wide; wider than 1.6 m, an opening. It opens into the room with fewer doors (a bedroom off the hall). |
| floor material | the room's floor | Tiles, wood and its direction (Valetudo's, when the robot knows them). |
| dock | a robot vacuum's dock | Its back to the nearest wall, facing into the room. |

A robot's map has no windows and no furniture: it is the floor the robot reached. Other robots
keep their map in their maker's app and cloud; their integrations show it as a picture, whose rooms
are colours, not outlines. A picture is refused (`picture`).

## Floorplanner

Projects of [Floorplanner](https://floorplanner.com) in FML 3.0 (`.fml`, JSON, in centimetres),
which Floorplanner exports, and which apps exporting to Floorplanner write (magicplan, iGUIDE…).
The older FML in XML is refused (`fml_xml`): export it again from Floorplanner.

| FML | Becomes | Notes |
| --- | --- | --- |
| floor | a storey | Its name, its level; its height sets the storeys above. The first design of each floor is read. |
| area | a room | Its outline (inside its walls) and name, else the text of a label inside it. A floor without areas gets the rooms its walls enclose. |
| wall | wall thicknesses | Partitions and façades, as drawn. Curved walls are straight. |
| opening | a door, a window or an opening | Centred at its place along its wall (`t`), its width; the hinge and the side it opens to from its mirroring. |
| item | furniture | Its place, size, height above the floor and rotation. Its kind from its name, else a box of its size (Floorplanner's catalogue ids say nothing). |

Not read: surfaces (a terrace), lines, dimensions, cameras, the drawing behind the plan.
Elements are numbered in their order (`room-1`, `door-1`…).

## Mesh scans

A mesh is triangles: a scanning app's export (Polycam, Scaniverse, 3D Scanner App, Matterport's
OBJ…) as OBJ, PLY (text or binary), GLB or STL. A mesh does not say which triangles are walls and
which are furniture, so DomoTwin reads it where furniture is not (D-062):

- **Up and unit**: `y` is up (`z` for STL), unless another axis holds twice as much horizontal
  surface at one height (a floor). GLB is in metres; another file's unit is the one that makes a
  storey's height (floor to ceiling) between 1.9 and 4.5 m, else a home's size.
- **Storeys**: the floors, the heights holding the most surface facing up, more than 1.8 m apart;
  each with the ceiling above it, when it was scanned.
- **Turned square** by the directions of the walls.
- **Rooms**: the spaces under the ceiling (or over the floor where the ceiling was not scanned)
  that the walls enclose between 2.1 m and the ceiling, above the doors, where furniture does not
  reach: a wall cabinet or a wardrobe is left in its room. Cut in cells of 5 cm; a space narrower
  than 60 cm is a cupboard or the inside of a wall, not a room.
- **Doors** where the wall between two rooms, or to the outside, is open at 0.4, 1.0 and 1.5 m;
  **windows** where a wall to the outside is open at 1.0 and 1.5 m over a sill at 0.4 m.

What a scan did not see is not there: a door scanned closed is a wall, a window whose glass was
scanned is a wall, a room scanned without its ceiling stops at its furniture. Rooms have no names
and furniture is not read: a mesh does not say what a piece is (your own 3D models can be added in
[edit mode](edit-mode.md)). Refused with what to do instead: points without faces (a point cloud,
`mesh_points`), a glTF with its data in other files (`mesh_gltf`), FBX (`mesh_fbx`), compressed
GLB (`unsupported`), and USD's binary format (`scan_usdc`).

## Limits

Files up to 200 MB. A Sweet Home 3D home holds at most 20 000 elements, a scan 5 000, a drawing
200 000 entities, a Floorplanner project 20 000 elements, a robot's map 4 million pixels and 100
rooms, a mesh 5 million triangles (64 MB once unpacked, for what comes packed); a plan keeps 500
elements (rooms first, then doors and windows, then the largest pieces). Reading and converting
take well under a second for a home, a few seconds for a large mesh (`PERFORMANCE.md`).

## For developers

- Crate `crates/domotwin-import`: `lib.rs` (`PlanFile`: the format from the content), `build.rs`
  (the plan builder every reader gives a `Draft`), `convert.rs`, `step.rs`, `model.rs` (IFC),
  `sh3d.rs` (Sweet Home 3D, with the ZIP and XML readers of `domotwin-models`), `dxf.rs`,
  `scan.rs` and `usda.rs` (RoomPlan), `faces.rs` (rooms from lines), `kinds.rs` (furniture
  kinds), `robot.rs` (robot vacuum maps), `fml.rs` (Floorplanner), `meshes.rs` and
  `mesh_scan.rs` (mesh scans), `grid.rs` (rooms from cells: distances, parts, outlines, squaring),
  `unpack.rs` (zlib, gzip, a PNG's text). Its wasm API (`web.rs`) is wrapped by
  `frontend/src/import/import.ts`; `frontend/src/import/files.ts` says which files go to it and
  `frontend/src/live/robot-maps.ts` finds the robots' maps in Home Assistant.
- `cargo run -p domotwin-import --example import -- file [storey] > out.domotwin.json` converts a
  file on the command line.
- The test files in `crates/domotwin-import/tests/fixtures/` are fictional, written by
  `python3 scripts/make-import-fixtures.py` (the IFC ones by `scripts/make-ifc-fixtures.py`).
  Real plans and scans never go in the repository.
- The readers are fuzzed (`fuzz/fuzz_targets/plan_import.rs`, `ifc_reader.rs`).
