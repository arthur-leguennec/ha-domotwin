# People in their rooms

DomoTwin shows who is home and in which room: each person stands as a figure in their colour, with
their name above, and walks through the doors to the next room when they move. The room's panel
says who is there, the storey buttons how many people are upstairs, and Assist answers "where is
Alex?".

![The demo apartment in the neon look: Sam in the living room and Alex in the kitchen, each a glowing figure in their colour with their name above](figures/screenshot-people.png)

## What says where someone is

DomoTwin places a person from entities that already say which room they are in:

- the area sensors of [Bermuda](https://github.com/agittins/bermuda) (Bluetooth, with ESPHome
  proxies or Shelly devices), whose state is an area's name and which carry its `area_id`;
- the room sensors of ESPresense (MQTT room);
- any entity whose state is the name of an area (or one of its aliases) or of a room of the plan: a
  template sensor, a helper.

A room is found by its area (the room's binding, else the area with its name: see
[bindings](bindings.md)), then by its name. A name two rooms have (a bathroom on each storey) is
not guessed. When several entities place a person, the one that changed last wins: a watch that just
walked into the kitchen says more than a phone left on the desk since the morning. A person is
placed only while Home Assistant says they are `home`.

DomoTwin's own Bluetooth locating, from Home Assistant's Bluetooth receivers without Bermuda, is
the next milestone (see the [roadmap](ROADMAP.md)).

## Setting it up

In the panel, the **People** button (administrators): for each person of Home Assistant,

- **Shown in their room**, then the entities that say where they are. Those on the device of the
  person's phone or watch (their device trackers) are suggested; any entity can be added by its
  id. Ten at most a person.
- A **colour** (each person gets one of their own otherwise).

And for everyone: **who sees the people** (everyone, or administrators only) and how they are
**drawn** (a figure or a pin). A card's `people: false` option shows nobody on that card.

## In the 3D view

- People stand around the middle of their room, clear of its walls, its furniture and its name,
  each keeping their place while others come and go.
- When someone changes rooms, they walk there through the doors (on another storey, they fade out
  and in again upstairs). Under *reduce motion* they are there at once.
- A tap on a name opens the person's sheet: where they are, since when, what said so, and their
  room's panel a tap away.
- The room's panel lists who is there; each storey button shows how many people are on it.
- While the plan, its pieces or its links are edited, nobody is drawn.

## Hiding

Anyone can hide themselves from DomoTwin: **Hide me** in their own sheet. They show themselves
again from the layer menu (**Show me again**); administrators can hide or show anyone. Hidden
people are not drawn, nor named by `domotwin.where`, nor framed by `domotwin.show`.

**Administrators only**: the other users see nobody in DomoTwin's views, and Assist tells nobody
where anyone is (a voice question runs as an automation, whoever asks; an administrator's own
action call is answered). Home Assistant has no per-entity permissions: the room sensors below and
the persons' own entities stay readable by every user in Home Assistant itself.

## Sensors

Each person placed gets `sensor.domotwin_<person>_room` (`person.alex` gives
`sensor.domotwin_alex_room`): the room's name, `not_home` when away, unknown when home in a room not
known. Attributes: `person`, `room_id`, `area_id`, `storey_id`, `storey`, `since` (when they came
in) and `source` (the entity that said so). They are kept as long as the person is placed, for
automations; hiding someone does not stop them. A sensor is named after its person when it is
created: a person renamed in Home Assistant gets their new name once DomoTwin reloads.

The light follows someone into a room:

```yaml
triggers:
  - trigger: state
    entity_id: sensor.domotwin_alex_room
actions:
  - action: light.turn_on
    target:
      area_id: "{{ state_attr('sensor.domotwin_alex_room', 'area_id') }}"
```

## Asking where someone is

`domotwin.where` answers in Home Assistant's language (English or French), as an action with a
response:

```yaml
action: domotwin.where
data:
  name: Alex   # a first name is enough; a letter off is forgiven in names of five letters or more
  show: true   # also frame their room on the DomoTwin screens
response_variable: where
# where.text: "Alex is in the Kitchen."  where.people: [{person, name, home, room, room_id, storey, since}]
```

Without a name it answers for everyone at home ("Alex is in the Kitchen, Sam in the Living room.").
`domotwin.show` takes a `person` too: their room is framed.

The blueprint [`where_by_voice.yaml`](../blueprints/automation/domotwin/where_by_voice.yaml) does it
by voice: "where is Alex?", "who is home?" (and in French "où est Alex ?", "qui est à la maison ?").
Import it from Home Assistant's blueprints, as the one that shows a room.

## Where the settings are kept

In a store of their own, `.storage/domotwin.people` (who is placed from what, their colours, who
sees the people, how they are drawn, who hid themselves): an older DomoTwin leaves it alone.
Diagnostics count the people placed, their sources, those located and hidden; never names, entities
or rooms.

See `DECISIONS.md`, D-034, for the reasons behind these choices.
