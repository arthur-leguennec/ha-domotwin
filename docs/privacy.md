# Private rooms

A room can be kept private: closed to everyone, or kept for some people, always or only while an
entity is on. Whoever may not see it sees it closed, on every card and in the panel: nothing
inside, no controls, nobody in it, and the voice answers say "in a private room".

![The demo apartment with the living room and the bedroom private: their floors frosted and hatched, empty, their names with a lock](figures/screenshot-private.png)

## Setting it up

In the panel, the **Private rooms** button (the lock; administrators): each room of every storey
is **open to everyone** (the default) or **private**. A private room is:

- **kept for** the people chosen, among Home Assistant's `person` entities. None chosen: it is
  kept for nobody;
- private **always**, or **while an entity is on**: an `input_boolean` "Guests", a switch, a
  binary sensor, a schedule. An automation can then close the bedrooms when guests come, and open
  them when they leave. An entity unavailable or unknown keeps the room private.

The settings are saved with the home's (`domotwin/settings/save`) and every screen follows at
once. A screen shows the home only once it has read them: until then, it says it is loading.

## Who sees it

A viewer is one of the people chosen through the Home Assistant **user** of their `person` (the
`person`'s *Allow person to login* in Home Assistant). So:

- on Alex's phone, logged in as Alex, a room kept for Alex is open;
- on a shared wall tablet, logged in as a user nobody is, it stays private;
- administrators are not among the people unless chosen: they see it closed too, except in the
  **edit** and **plan** modes and while **linking**, where they see the whole home to change it.

## What a closed room shows

- **Its floor**, under a frosted, hatched cover, and its **name** with a lock. Its walls follow
  the cut-away like the others', so the rooms behind it stay in sight.
- **Nothing in it**: no furniture, lamps, badges, layer values, camera views (D-038) or people;
  its doors and windows (the door to the hall too) are drawn as in the plan, whatever their
  sensors say, with no badge and no control. Its **dangers** still show (smoke, gas, carbon
  monoxide, a leak, an alarm going off): they matter more than privacy. Not its warnings: the
  CO₂ would tell someone is in, the rain a window open.
- **No controls**: a tap does nothing; a long press opens its panel, which only says it is
  private. Its lights are not counted in its storey's label.
- **No way in**: walking at eye level does not go through its doors, and people's figures go
  round it when another way exists.
- **People and things** in it are at home, "in a private room", in their sheets.
- **"Why?"** (`why.md`) says "in a private room" for a step of what it holds, leaves it out of
  the link to Home Assistant's Activity and does not draw it.

## Voice

`domotwin.where` (and the voice blueprints) answers "Alex is in a private room." for someone in a
room the one asking may not see, and does not show it on the screens; `domotwin.show` does not show
someone's room when it is private. A question asked by voice runs as nobody's user: rooms kept
for some people stay private there. And each screen does nothing for a room its own viewer may
not see, or something in it, whoever asked: not even show its storey.

## The limit

DomoTwin closes **its own** views, controls and answers. Home Assistant gives every user every
entity in its other dashboards and its API (its permissions are by user, not by entity), and
DomoTwin's sensors of each person's room (`sensor.domotwin_<person>_room`) say the room. A private
room is private on a shared screen, not behind a security barrier.

[Rights](rights.md) go further for those who are not administrators: a room or a device only
seen or not seen, for each person or everyone; a room not seen is closed as a private one.

A [guest pass](guests.md) is the other way round: its page is DomoTwin's own, and shows only the
rooms and devices the pass gives, the other rooms closed as private rooms are; DomoTwin enforces
it, since the guests have no Home Assistant user.
