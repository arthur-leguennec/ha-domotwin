# Plan editor

Administrators draw and change the plan itself from the DomoTwin panel: rooms as polygons,
partitions, doors and windows placed on the rooms' sides, with snapping, lengths and undo. A home
can be drawn from nothing, without any other software. Furniture is arranged in
[edit mode](edit-mode.md).

![The plan editor: a corner of the living room dragged with the lengths of its sides, and a room drawn beside the home](figures/screenshot-plan-editor.png)

## Using it

In the panel, **Edit plan** opens the plan editor (administrators only); without a plan, **Draw a
plan** starts a new one with one room of 4 × 3 m. The view shows the 2D plan; the header gets
**Cancel** and **Save**, and a bar appears at the bottom with the tools, Undo, Redo and Remove.

- **Select and move**: tap a room, a partition, a door or a window (a piece of furniture selects
  its room). Drag the selection to move it: a room moves with everything in it, a door or a window
  slides along the rooms' sides. Dragging anywhere else pans the plan.
- **Corners**: a selected room shows its corners and the length of each side. Drag a corner to
  reshape the room; the **+** in the middle of a side adds a corner there; the corner grabbed last
  can be removed from the bar (a room keeps three corners at least). The doors and windows stay on
  their side, as near their place as they fit, opening the same way.
- **Draw a room**: drag a rectangle, or tap to drop a room of 3 × 3 m. Its size shows while you
  draw.
- **Draw a partition**: drag from one end to the other.
- **Place a door** or **a window**: tap near a side of a room (within 60 cm). It is centred there,
  kept within the side, and a door opens into the room. Doors are 83 cm wide, windows 120 cm.
- **Fields of the selection**, in the bar: the name of everything; a room's floor; a door's width,
  kind (hinged, glazed, double, folding, sliding, barn, opening without a door, closed for good) and
  the side it opens to; a window's width; a partition's thickness. A value out of range is marked
  and not kept; a door or a window wider than its side is refused.
- **Remove**: the bin of the bar. A room takes its doors and windows with it; the furniture that
  stood in it stays, in no room.
- **Undo** and **Redo**: the bar, or Ctrl+Z and Ctrl+Shift+Z (Ctrl+Y). 100 steps are kept; a drag
  is one step.
- **Save** stores the plan; **Cancel** asks before discarding changes.

Keys, when no text field has the focus and no dialog is open: Delete or Backspace removes the
selection, Escape clears it.

### Snapping

A corner being dragged, the corner of a room being moved, and the ends of what you draw go onto a
**corner of another room** within 12 cm, else line up with the corners of the other rooms within
8 cm (a dashed guide shows the line), else onto a **5 cm grid**.

### What is checked

Every change is read again by the plan reader before it is kept, as an imported plan is: a room
that crosses itself or is too small, a width out of range… is refused and the editor says
why. While dragging, a refused place only stops the drag there.

## Saving

**Save** sends the whole plan with the revision the editor started from: if the plan was saved on
another device meanwhile, saving is refused. The plan is saved with the furniture as arranged in
edit mode, and the edit overlay is emptied: the plan is DomoTwin's from then on. Importing a file
again replaces it, as before.

A plan not saved is kept in the browser's local storage for the revision it started from, on the
device only, and offered again when the plan editor opens.

Links to entities follow the elements by id: an element moved, reshaped or renamed keeps its links;
the links of an element removed stay stored and do nothing, and a new element never takes an id that
has links.

## Limits

Sides without a wall (`open`), per-side wall thicknesses and finishes, a room's colour, wall
style and materials, and a side's length typed in are not edited here yet: they are kept as the
plan has them.

## Storeys

The plan editor edits the storey shown; **Draw a new storey**, in the panel's **Storeys**, opens it
on a new plan that is saved as a new storey above the others ([storeys](storeys.md)). New elements
never take an id another storey uses. A plan not saved is kept for its storey.

## For developers

- `crates/domotwin-core/src/structure.rs`: the draft (`Draft`): rooms drawn and reshaped, partitions,
  doors and windows on the rooms' sides, snapping, the history. Plain Rust, tested without a GPU
  and fuzzed (`fuzz/fuzz_targets/plan_draft.rs`: every change kept leaves a plan the reader
  accepts).
- `crates/domotwin-planner/`: the draft for JavaScript, in plan centimetres, its own wasm module
  (`frontend/src/planner/`), loaded only when the plan editor opens.
- `crates/domotwin-web/src/plan_editor.rs`: what the plan editor needs from the engine: the plan
  shown with its overlay (`shownPlan`), showing each version of the draft with the selection marked
  (`showDraft`), screen points to plan points and back.
- Frontend: `components/plan-editor.ts` (the tools, drags, handles and lengths over the view,
  loaded with the planner), `plan-bar.ts` (the bar and the fields), `<domotwin-view>`
  (`planEditing`, `planTool`), the panel (save, cancel, the draft in `live/draft.ts`).
