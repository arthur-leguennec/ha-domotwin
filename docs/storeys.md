# Storeys

A home can have several storeys: a cellar, the ground floor, the floors above, an attic. Each
storey is a plan of its own, with its own furniture arranged in edit mode, drawn in the plan editor
or imported. Links to entities and rooms' areas work the same on every storey. Stairs lead from
one storey to the next.

![The floor above with its stairs and the storey switcher; the storeys dialog](figures/screenshot-storeys.png)

## Seeing them

With two storeys or more, the view's tools get one button per storey, the highest on top: **0**
for the ground floor, **1**, **2**… above it, **−1** below it. A tap on a button shows that storey.
A tap on **stairs** (the `stairs` kind of furniture, with nothing linked to it) goes to the storey
above, or from the top storey to the one below. One storey is shown at a time.

**Alerts follow you.** The alerts of every storey's rooms (smoke, gas, water, alarm, a window open
in the rain) show in the banner whichever storey is shown, with the storey they are on: "Smoke in
Office (Floor 1)". The switcher's button of a storey with an alert has a dot (red for a danger),
and a tap on the alert shows that storey and frames the room.

The ground floor is the storey whose floor is nearest the ground (elevation 0): the panel and a
card open on it unless told otherwise. A card's **`storey`** option (the visual editor lists the
storeys) opens it on another one; a card naming a storey that was removed shows the ground floor.

## Managing them

In the panel, **Storeys** (administrators only) lists the storeys, highest first:

- **Name**: empty, a storey is called by its place (Ground floor, Floor 1, Basement 1…).
- **Floor height**, in metres above the ground floor's, from −100 to 1 000 m. It orders the storeys;
  a value not understood is marked and not kept.
- **Remove** (the cross) asks first, then removes the storey with its plan and overlay. The last
  storey stays.
- **Import a plan as a new storey**: a House Maquette plan or one storey of an IFC file.
- **Draw a new storey**: the [plan editor](plan-editor.md) on a new plan; saving it adds the
  storey.

A new storey goes 2.8 m above the highest one, or on the ground (0) when that is within 1 m of it
(a home with only a cellar).

**Import plan** in the toolbar replaces the plan of the storey shown, as before; **Edit plan** and
**Arrange** work on the storey shown. What is drawn or arranged and not saved is kept by the
browser for its storey, and offered again on that storey only.

### An IFC file with several storeys

When the storeys of an IFC file have spaces, the import asks which one to import into the storey
shown, or offers **Import every storey**: each storey of the file with spaces becomes a storey of
the home, with its name and elevation, and they **replace every storey of the home** in one save
(every plan is checked first: all of them are stored, or none). Their ids are given in order
(`storey-1`, `storey-2`…), so a card set to show the floor above still does after the same
building is imported again. Heights are measured from the file's storey nearest elevation 0 when
one is within 2 m of it, else from its lowest storey.

## Ids

An element's id is the home's, not only its storey's: links and rooms' areas are kept by id, so no
two storeys may use the same id (`duplicate_id`), nor the pieces added in edit mode. A plan imported
as a new storey, or every storey of an IFC file, has its ids changed first where another storey
uses them (`living` becomes `living-2`, and the furniture in it follows). The plan editor and edit
mode never give a new element an id another storey uses.

## Stored

Each storey is `{id, name, elevation, plan, layout}` in Home Assistant's `.storage` (see
[ARCHITECTURE.md](ARCHITECTURE.md)). The plan of a home stored before storeys becomes its first
storey, `storey-1`, at elevation 0. A home has 20 storeys at most.

Exporting from the panel exports the plan of the storey shown, named after the storey.

## Limits

One storey is drawn at a time: the storeys are not stacked in one 3D view yet, and the stairs are
a piece of furniture, not an opening in the floor above. The heatmap, presence and the power layer
are those of the storey shown; only the alerts come from every storey.
