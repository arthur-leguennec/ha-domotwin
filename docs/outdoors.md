# The outdoors: the garden, the terrace and the roofs

DomoTwin draws what is around the home as well as what is in it: a garden, a terrace, a balcony
with its railing, a path, the lawn as long as it has grown, the trees, the pool, the robot mower
going round, and the roofs over the house, their shape and colour your own. Nothing is fetched:
how long the grass is comes from the season where Home Assistant says the home is, and from when
the lawn was last mown.

## Places outside

A garden, a terrace, a balcony or a path is a room marked **Outside** (in the plan editor, select
it: **Outside**; in the plan file, `"outside": true`, [`plan-format.md`](plan-format.md)). A place
outside has no walls and no ceiling, and no roof covers it; the sides of the rooms beside it are
the house's façades.

- **Its ground**: a **lawn** (the default), **decking**, **paving**, **gravel** or **soil**. A
  lawn, gravel and soil lie a little under the floors, and what stands on them stands on them;
  decking and paving are just under the floors, with an edge.
- **A railing** of glass between posts runs along its free sides when it is a balcony
  (**Railing**, `"railing": true`), never against the house.
- **A garden drawn around the house** is fine: wherever a room and a place outside overlap, the
  room wins (what stands there is in it, a tap frames it, people stand in it), and a terrace drawn
  in the garden wins over the garden. The garden's name is written outside the house.
- People walk out through the garden door, and the robots, the radios' walls (the Bluetooth
  locating) and the weather know where the house ends.

## The garden's pieces

The catalogue (**Arrange**, **Add**) has a **Garden** group: trees (a conifer, a fruit tree, a
palm), shrubs, a hedge, planters, garden tables and chairs, sun loungers, a parasol, a barbecue, a
fire pit, garden lights (a lamp post, string lights), a pool (round, above-ground), a hot tub, a
robot mower's dock, a shed, a pergola, a greenhouse, a trampoline, a swing, a fence and a gate,
a mailbox. A garden piece may be up to 10 m tall.

They are linked as any piece is: a garden light to its `light` (it lights the garden at night), a
fire pit to its switch (it burns while it is on), a gate to its `cover` or its contact sensor (it
opens), a pool to its pump or its heating, a planter to its watering valve, a mailbox to its
sensor.

## The lawn

A lawn is drawn as long as it has grown since it was last mown: cut short (4 cm), then growing
with the season where the home is (Home Assistant's latitude: fastest in May and slowest in winter
in the north, the other way round in the south, all year round in the tropics), up to 20 cm. Just
mown, it shows a mower's stripes, which fade over four days. A lawn never said mown is drawn with
about a week's grass.

It is mown when:

- **someone says so**: open the lawn's panel (a long press on it, or its name once a tap has
  framed it), then **Just mowed** (anyone may); the panel also says how long the grass is and
  when it was last mown;
- **its robot mower stops mowing** (below): the integration notes it as soon as the mower leaves
  `mowing`, for the lawns that mower mows.

The integration keeps these times in `.storage/domotwin.garden` (100 lawns and 20 mowers at most):
nothing in them is private, room ids, entity ids and times.

## The robot mower

Place a **robot mower** from the Garden group where its dock is, and link it to your `lawn_mower`
entity. While it is `mowing`, its robot leaves the dock and mows the lawns of its storey it can
get to, lane by lane, and keeps out of the house (unless its dock is in the garage: it goes out
through the garage's door). `returning`, it goes home; `paused` or in `error`, it stays where it
is; `docked`, it is on its dock. As for robot vacuums, Home Assistant does not say where a mower
is: its way is drawn from the plan. With *reduce motion* it is drawn at rest. A robot vacuum keeps
in the house: it never goes out through the garden door.

## The roofs

Over each storey that nothing above covers, DomoTwin draws a roof over its rooms: an L-shaped
house gets two wings that meet, a T three, a house whose outline fits no wings gets one roof over
the whole. Choose their look in the panel's **⋮** menu, **Settings**, **Roof**:

- **Shape**: two slopes (**Gable**, the default), four (**Hip**), one (**Shed**) or **Flat**;
- **Slope**: from 5° to 60° (30° by default);
- **Colour**: the look's own, or one of yours.

The choice is shown as it is picked and kept on **Save**; the weather falls on the roofs as they
are. The roof button (**All storeys**) shows or hides them, as before.

## The demo house

The demo house has its garden: the terrace with its table, parasol and barbecue, the back lawn
with the pool, the trees, a hedge and a shed, the front lawn, the path and the driveway. Its robot
mower goes out late in the morning, the garden lights come on at dusk and the gate opens as the car
leaves and comes back.

## Not done yet

The ground is one level (a garden that slopes, a basement opening onto it, come with split levels,
M44); the grass does not brown in a dry summer or grow faster after rain; a mower's real position
is not read, nor the pattern a brand mows in.
