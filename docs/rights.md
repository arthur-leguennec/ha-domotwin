# Rights

What each person uses, only sees or does not see in DomoTwin, room by room and device by device,
set in one place. The children's tablet shows their own rooms and lets them switch their lights;
the living room's lamps they only look at; the office is closed to them. A shared screen in the
hall shows everyone's.

## Setting them

In the panel's **⋮** menu, **Rights**. It is for administrators. **For** chooses whose rights are
shown:

- **Everyone**: everyone without rights of their own, a shared screen's user too, and what a
  person's own leave as they are;
- a **person**, among Home Assistant's `person` entities: their own rights. Left **as it is**, a
  room or a device has everyone's level, shown in brackets.

Each room of every storey is given a level:

- **Uses** (the default): seen and used, as without rights;
- **Only sees**: seen, its devices' states and values too, but not used;
- **Does not see**: closed as a [private room](privacy.md) is: frosted and empty, its name with a
  lock; closed on the Rooms tab, nothing of it on the Home tab.

A room's **devices** are listed under it (those linked to it or to its pieces, doors and
windows, and those of its area), each with a level of its own when it needs one: the living room
only seen, but its floor lamp used; the kitchen used, but its oven only seen. **Other devices**
adds one in no room: a scene, a script.

The sentence at the top says what the person uses, only sees and does not see, and how many
devices are set apart. **Save** keeps the rights with the home's settings; every screen follows
at once.

## Whose rights apply

- A person's, through the Home Assistant **user** of their `person` (*Allow person to login*).
  A person with no user: nobody signs in as them, so their rights apply once they have one.
- Everyone's, for a user who is nobody's (a wall tablet's) and for anything a person's own leave
  as it is.
- **Administrators** see and use everything, whatever is set: they set the rights, and Home
  Assistant gives them everything. The dialog says so next to their name.
- A device's level is its own when it has one (the person's, else everyone's), else the
  strictest of the rooms it is in. A room that is not seen hides everything in it, a device given
  its own level too; so does a [private room](privacy.md) closed to the viewer.

## What someone sees and does

- **A room not seen** is closed on the plan, as a private room: nothing in it, nobody in it, no
  control, no camera view; "in a private room" in the people's sheets and the voice answers.
  The Rooms tab lists it closed, as a private room, with nothing in it; its devices are on
  neither tab.
- **A device not seen** is not linked: no badge, no glow, no tap on its piece; not on the tabs,
  in a room's panel, in the history reports' search, in "Why?" nor among the actions set for
  later.
- **What is only seen** shows its state, its badges, its values. A tap on its piece opens
  DomoTwin's own panel with its controls shown disabled ("You may look at this device, not use
  it."), not Home Assistant's dialog; its card on the Home and Rooms tabs does nothing on a tap;
  the room's commands (lights on, blinds closed) and its own actions leave it out, and so does
  "Lights off" on the Home tab. Nothing is set for later on it, nor cancelled. A room's own
  action that names labels or `all`, which DomoTwin cannot tell device by device, is not offered
  to someone whose rights see only or hide anything.
- **DomoTwin's own services** check them too: an action set for later (`domotwin.schedule`, a
  room's or a piece's sheet, the voice assistants) on a device someone may not use is refused;
  the actions waiting on what they do not see are not listed to them; `domotwin.where` does not
  say a room hidden from them. A question by voice on a satellite is nobody's: everyone's rights
  apply. An automation's or a script's `domotwin.schedule` is Home Assistant's own: no one's
  rights hold it back.
- The DomoTwin room sensors (`sensor.domotwin_<room>_people`) are everyone's: a room hidden from
  everyone does not say who is in it, as a private room kept for nobody.

## The limit

DomoTwin hides and refuses in **its own** views, controls and services. Home Assistant still lets
every user use every entity in its other dashboards, its API and its voice assistants: its
permissions are by user (administrator or not), not by entity, and DomoTwin does not change them.
Rights keep a shared screen or a child's tablet to what is theirs, not behind a security barrier;
the rights themselves are read by every user, as the home's other settings. To give someone only
some devices for real, without a Home Assistant user, a [guest pass](guests.md) is the way:
DomoTwin's own page enforces it.
