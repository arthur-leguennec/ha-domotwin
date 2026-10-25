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
above, or from the top storey to the one below. The button above the storeys shows them all at
once (see below).

**Alerts follow you.** The alerts of every storey's rooms (smoke, gas, water, alarm, a window open
in the rain) show in the banner whichever storey is shown, with the storey they are on: "Smoke in
Office (Floor 1)". The switcher's button of a storey with an alert has a dot (red for a danger),
and a tap on the alert shows that storey and frames the room.

The ground floor is the storey whose floor is nearest the ground (elevation 0): the panel and a
card open on it unless told otherwise. A card's **`storey`** option (the visual editor lists the
storeys) opens it on another one; a card naming a storey that was removed shows the ground floor.

## Every storey at once

![The demo apartment's two storeys spread apart under their roof, with their labels and pictures](figures/screenshot-home.png)

The **every storey** button (three layers, above the storeys' buttons) shows the whole home: each
storey at its height, **spread apart** so that you see into each one, and a **roof** over the top
storey. Two buttons in the view's tools stack the storeys back on each other (and spread them again)
and take the roof off (and put it back); both are animated.

- **Each storey's label** stands beside it: its name, its rooms and how many lights are on in it. A
  tap on it shows that storey alone.
- **A picture of each storey**, seen from above, in the look shown, lines up on the left, the
  highest on top (in views wider than 560 pixels). A tap on one shows that storey alone.
- **Everything is live**, on every storey: lamps light their storey, a tap on any lamp toggles it,
  a long press opens its controls, the walls facing the camera are lowered storey by storey, and
  the layers (heatmap, alerts, presence, power), the badges and what the cameras see show on
  every storey.
- **The roof** is a gable roof over the top storey's walls, its ridge along the longer side. It is
  of glass in the neon and blueprint looks, tiled in day. A tap goes through it to what is under it.
- **On the 2D plan**, the storeys lie side by side, the ground floor on the left (down the view in
  a view taller than wide, the highest on top), each with its label over it.

A storey added but not drawn yet is left out of the whole home until it has a plan.

A card shows every storey with **`storey: all`**, the storeys spread apart and the roof on unless
**`spread: false`** or **`roof: false`** (the visual editor offers all three with two storeys or
more). In the panel, **Arrange**, linking and **Edit plan** work on one storey: the one last shown
alone is shown alone while they run, and the whole home comes back when they end.

## Managing them

In the panel, **Storeys** (administrators only) lists the storeys, highest first:

- **Name**: empty, a storey is called by its place (Ground floor, Floor 1, Basement 1…).
- **Floor height**, in metres above the ground floor's, from −100 to 1 000 m. It orders the storeys;
  a value not understood is marked and not kept.
- **Remove** (the cross) asks first, then removes the storey with its plan and overlay. The last
  storey stays.
- **Import a plan as a new storey**: a DomoTwin plan (`*.domotwin.json`) or one storey of a file
  of another app ([IFC](ifc-import.md), [Sweet Home 3D, DXF, a room scan](imports.md)).
- **Draw a new storey**: the [plan editor](plan-editor.md) on a new plan; saving it adds the
  storey.

A new storey goes 2.8 m above the highest one, or on the ground (0) when that is within 1 m of it
(a home with only a cellar).

**Import plan** in the toolbar replaces the plan of the storey shown, as before; **Edit plan** and
**Arrange** work on the storey shown. What is drawn or arranged and not saved is kept by the
browser for its storey, and offered again on that storey only.

### A file with several storeys

When several storeys of a file have rooms (an IFC file's storeys, a Sweet Home 3D home's levels, a
scan's stories), the import asks which one to import into the storey shown, or offers **Import
every storey**: each storey of the file with rooms becomes a storey of the home, with its name and
elevation, and they **replace every storey of the home** in one save
(every plan is checked first: all of them are stored, or none). Their ids are given in order
(`storey-1`, `storey-2`…), so a card set to show the floor above still does after the same
building is imported again. Heights are measured from an IFC file's storey nearest elevation 0
when one is within 2 m of it (else from its lowest storey), a Sweet Home 3D home's level nearest 0,
a scan's lowest story.

## Ids

An element's id is the home's, not only its storey's: links and rooms' areas are kept by id, so no
two storeys may use the same id (`duplicate_id`), nor the pieces added in edit mode. A plan imported
as a new storey, or every storey of a file, has its ids changed first where another storey
uses them (`living` becomes `living-2`, and the furniture in it follows). The plan editor and edit
mode never give a new element an id another storey uses.

## Stored

Each storey is `{id, name, elevation, plan, layout}` in Home Assistant's `.storage` (see
[ARCHITECTURE.md](ARCHITECTURE.md)). The plan of a home stored before storeys becomes its first
storey, `storey-1`, at elevation 0. A home has 20 storeys at most.

Exporting from the panel exports the plan of the storey shown, named after the storey.

## Limits

The stairs are a piece of furniture, not an opening in the floor above: with the storeys stacked,
the floor above covers them. The roof is a gable over the smallest rectangle around the top
storey; a home of several wings or with a flat, hipped or imported roof gets the same simple roof
(`roof: false` hides it). With one storey shown, the heatmap, presence and the power layer are
those of that storey; only the alerts come from every storey.
