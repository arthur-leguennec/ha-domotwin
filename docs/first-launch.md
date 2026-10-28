# The first launch

From the install to your own home in 3D in five minutes (`DECISIONS.md`, D-083). Home Assistant
already knows your floors, your areas and the devices in each: DomoTwin draws a first plan from
them, places your devices in it and links them, and then lists what is left to do.

## Draw it from Home Assistant's areas

1. Open **DomoTwin** in the sidebar. With no plan yet, an administrator sees **Draw it from Home
   Assistant's areas** next to *Import plan*, *Draw a plan* and the demo house. It is offered when
   Home Assistant has areas and the home has no plan.
2. The dialog lists your floors, by level, each with its areas and how many of their devices
   DomoTwin can draw. Untick an area to leave it out, or a floor's box to leave out the whole
   floor. Areas on no floor go on the ground floor; with no floors, the home is one storey.
3. Choose whether to **Place their devices** and to **Furnish the rooms**, then **Draw my home**.

What you get:

- **A storey per floor**, 280 cm above the one below for each level, the lowest on the ground (a
  floor without a level goes above the others).
- **A room per area**, named and linked to it, at a usual size for what it is: a kitchen
  360 × 300 cm, a living room 520 × 420, a bedroom 360 × 340, a bathroom 260 × 220, a toilet
  160 × 130… What a room is comes from its name (*Kitchen*, *Chambre*…), else from its area's icon
  (`mdi:sofa`, `mdi:bed`, `mdi:stove`…). A garden or a terrace is a place outside.
- **Side by side**: a floor's rooms in rows, as wide as the floor, so it is a rectangle but for
  its last row.
- **Doors** joining every room to the others, an **entrance** on the ground floor (into the hall,
  else the living room…, the garage only when there is nothing else, on the street's side rather
  than the garden's), and a
  **window** on each room's longest outer wall, clear of the doors.
- **The devices placed and linked**, each as what its entities say:

  | Its entities | Drawn as |
  | --- | --- |
  | a vacuum | the robot's dock (its robot drawn moving, D-049) |
  | a media player that is a TV | a TV on its stand |
  | another media player | a speaker |
  | a thermostat (heating) | a radiator |
  | a thermostat that cools | a heat pump |
  | a water heater | a water heater |
  | a fan (with a light: a ceiling fan) | a fan |
  | a humidifier or dehumidifier | one |
  | a camera | a camera on a wall |
  | a curtain cover | a curtain before a window |
  | a smoke, gas or carbon monoxide sensor | a smoke detector on the ceiling |
  | a motion, occupancy or presence sensor | a motion sensor on a wall |
  | a light | a ceiling light |
  | a temperature or humidity sensor | a sensor on a wall |

  A device is linked to its entities that fit what it is drawn as (a TV to its media player and
  its power switch). A device whose entities say nothing DomoTwin draws (a plug, a door's contact,
  a button) is left for you to place; hidden and configuration entities and light groups too.
- **The furniture**, if asked: a bed, a wardrobe and a nightstand in a bedroom; a sofa, a coffee
  table and an armchair in a living room; a counter, a fridge and a stove in a kitchen; a bath (a
  shower in a small bathroom), a basin and a toilet in a bathroom; a desk, a chair and a bookcase
  in an office…

Each piece stands against a wall, its back to it, or free in the room, clear of the doors and of
the other pieces. A device that finds no space is left out, and the message says how many: place
them in *Arrange*. In a garden or on a terrace, a light is a garden light on its post, and what
would hang from a wall or a ceiling (a camera, a sensor) is left for you to place. A device is
placed once, in the room of its most telling entity.

## Getting started

After drawing, and at any time from the ⋮ menu (**Getting started**), the steps that make DomoTwin
your home's. Each opens where it is done, and says whether it is done where DomoTwin can tell:

| Step | Where |
| --- | --- |
| A plan of your home | done once the storey has rooms |
| Shape the rooms: their real size, the doors and windows | the plan editor |
| Each room linked to its area | link mode; how many rooms have none |
| Their devices placed | **Place them**: the devices of the rooms' areas not placed yet |
| Each piece where it stands | *Arrange* |
| People in their rooms | the people settings |
| The energy | the settings |

**Place them** works on any plan, imported or drawn: it places the devices of the areas the
storey's rooms are linked to, or named as, that are not linked yet (a device counts as placed once
one of its entities is linked), the same way, around your pieces as you arranged them.

## What it does not do

- The rooms' real sizes and shapes: Home Assistant does not know them. Drag their corners in the
  plan editor, or import your plan (IFC, Sweet Home 3D, a robot's map…).
- Stairs between the storeys, and appliances told by their names (a washing machine).
