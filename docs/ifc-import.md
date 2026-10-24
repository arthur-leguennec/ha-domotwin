# IFC import

DomoTwin can start from an **IFC file** (ISO 16739), the open standard for building models, instead
of a House Maquette plan. In the DomoTwin panel, **Import plan** accepts `.ifc` files: DomoTwin reads
one storey and turns it into an ordinary plan (`plan-format.md`), stored like an imported plan in
the storey shown, or **imports every storey** of the file as the home's [storeys](storeys.md).
Everything else (3D and 2D views, bindings, live states, export) works the same.

![The storey picker of a two-storey file, and a fictional apartment imported](figures/screenshot-ifc.png)

The import runs in your browser, in a separate WebAssembly module downloaded only when you pick an
`.ifc` file: dashboards never load it, and nothing leaves your Home Assistant. Try it with the
fictional [`examples/demo-apartment.ifc`](../examples/demo-apartment.ifc).

## What is read

| IFC | Becomes | Notes |
| --- | --- | --- |
| `IfcBuildingStorey` | the plan | When several storeys have spaces, DomoTwin asks which one, or imports them all: each becomes a storey of the home with its name and elevation (measured from the storey nearest 0 when one is within 2 m of it, else from the lowest), and they replace the home's storeys in one save. |
| `IfcSpace` | a room | Its outline: the `FootPrint` curve, else the profile of its extruded body, else the lowest face of its brep, else the hull of its points. Name: `LongName`, else `Name`. |
| `IfcWall`, `IfcWallStandardCase` | wall thicknesses | Interior thickness: the gaps between facing spaces, else the internal walls' material layers or geometry. Exterior: walls with `IsExternal`. |
| `IfcDoor`, `IfcWindow` | doors and windows | Put on the room side they sit in. Width: `OverallWidth`, else the geometry. Hinge side, swing and style from the operation type (IFC4) or the door style or type (IFC2x3). |
| `IfcFurniture`, `IfcFurnishingElement`, `IfcSanitaryTerminal`, `IfcElectricAppliance`, `IfcAudioVisualAppliance`, `IfcLightFixture`, `IfcSpaceHeater`, `IfcFlowTerminal` | furniture | Size, position, rotation and height above the floor from the geometry. Kind from the name and type name (English, French and German words), else the class and predefined type. |
| `IfcBuildingElementProxy` | furniture, only when its name tells what it is | |

Schemas: IFC2x3, IFC4 and IFC4.3 (the parts above). Units: metres with any SI prefix, feet, inches.
Geometry: extrusions of rectangle, circle, I/L/T/U/C/Z, arbitrary and derived profiles, polylines,
indexed and composite curves, faceted breps, triangulated and polygonal face sets, mapped items,
boolean results, CSG blocks, bounding boxes.

## What changes on the way

- **Plan axes.** The plan is seen from above with y pointing down, so the model is mirrored
  front to back as a plan drawing is. It is moved next to the origin and **turned so that its main
  walls run along the axes** (a model placed at an angle or far away on a map still gives an upright
  plan).
- **Rooms meet in the middle of walls.** IFC spaces stop at the wall faces; in a plan, two rooms
  share a limit and the partition is drawn centred on it. Where two spaces face each other across a
  wall of up to 59 cm, both are widened to the middle of that wall (only along the part where they
  face each other). Exterior walls stay outside the rooms. Partitions of an unusual thickness keep
  it (`edgeThickness`).
- **Ids.** Elements keep their IFC `GlobalId` as plan id, so importing an updated model again keeps
  your bindings.
- **Floors.** Rooms named like a bathroom or a kitchen get tiles, living rooms and bedrooms wood.
  You can change them in House Maquette.

## What is left out (and said so)

After the import, a message lists what was left out:

- **outside or overall spaces**: spaces marked external or as a gross floor area (`GFA`), spaces
  drawn over other ones (where one holds the centre of another, the larger one goes), spaces larger
  than a plan room can be (100 m);
- **doors or windows off the walls**: openings more than 45 cm from any room side;
- **unknown or stray pieces**: elements without geometry, proxies whose name says nothing, and
  pieces more than 10 m away from every room (often left at the project origin);
- **elements past the 500 limit**: a plan holds 500 elements; rooms come first, then doors and
  windows, then the largest pieces.

Not imported: stairs, columns, slabs, roofs, the site, other storeys, colours and materials. Window
sills are the plan format's fixed 90 cm. Curved walls become straight segments (64 corners per room
at most).

A storey **without spaces** cannot be imported: the plan is made of rooms. Most modelling tools
create spaces (Revit "Rooms", ArchiCAD "Zones", Bonsai and FreeCAD "Spaces"); add them and export
again.

## Limits

Files up to 200 MB. The file is read in the browser's memory; a 10 MB file with 20 000 pieces takes
about two seconds (`PERFORMANCE.md`).

## For developers

- Crate `crates/domotwin-ifc`: `step.rs` (STEP physical file reader: one pass to index, attributes
  parsed on demand), `model.rs` (units, placements, relations, geometry), `convert.rs` (storey →
  plan), `kinds.rs` (furniture kinds). Its wasm API (`web.rs`) is wrapped by
  `frontend/src/ifc/ifc.ts`.
- `cargo run -p domotwin-ifc --example ifc2plan -- file.ifc [storey] > out.plan.json` converts a
  file on the command line.
- The test files in `crates/domotwin-ifc/tests/fixtures/` and `examples/demo-apartment.ifc` are
  fictional and written by `python3 scripts/make-ifc-fixtures.py`. Real IFC files never go in the
  repository (`.gitignore`).
- The reader and the conversion are fuzzed (`fuzz/fuzz_targets/ifc_reader.rs`).
