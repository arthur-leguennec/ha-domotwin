# A workplace: an office or a shop

DomoTwin is made for a home, and it works for a small office or a shop on Home Assistant too. Turn
the home into a **workplace** and three things change: its people are counted, never named; the
Home tab says whether it is open and, once closed, what was left on; and closing up is suggested
as a shortcut.

## Setting it up

In the panel's settings (**⋮** → **Settings**, administrators), **A workplace**:

- **This is a workplace, an office or a shop**: on, the place is a workplace.
- **Opening hours**: a schedule of Home Assistant's, on while the place is open. Make one in
  **Settings** → **Devices & services** → **Helpers** → **Create helper** → **Schedule**: a span
  for each day, several in a day for a lunch break. Without one, the place has no hours in
  DomoTwin, and its people are still counted.

Nothing else is needed. The schedule is Home Assistant's own: your automations can use it too (arm
the alarm when it turns off, for instance).

## People counted, never named

Where people work, where each one is during the day is theirs. In a workplace:

- **The 3D view** draws each person DomoTwin places as a figure of no one's colour, without a name
  over it, and without a sheet that says who it is; the storeys' buttons say how many are on each.
  A figure does not walk from room to room: a room shows how many are in it, not who went where.
  The phones and watches followed by Bluetooth are not shown, nor, in the Bluetooth settings, the
  room they are in; things (keys, a bag) still are.
- **A room's panel** says how many people are in it ("2 people"), not who.
- **The Home tab** says how many are here ("3 here"), not who: the people placed and those the
  presence radars see without a name ([people](people.md), D-080); with nobody placed, those the
  radars see, or without radars Home Assistant's people at home.
- **`domotwin.where`** and the voice blueprint that uses it say how many are here, counted the
  same way, never where anyone is, whoever asks: a name like a person's, or like their phone's or
  watch's, gets the count. A thing (keys, a bag) is still found, unless its name is like a
  person's ("Alex's keys" would tell where Alex likely is). **`domotwin.show`** with a person
  shows nothing.
- **The People summary** on Home Assistant's Overview says how many are here, without rooms.
- **The rooms' sensors** (`sensor.domotwin_<room>_people`) keep their count, without the list of
  who is in the room.

When the people are shown to administrators only, the others see no count on the Home tab, and the
voice (which runs as an automation) counts only those the radars see without a name: as in a home,
they learn nobody.

A person placed from something else than DomoTwin's Bluetooth (Bermuda, an area sensor), in a room
a presence radar sees, is counted twice: the radar cannot tell it is them, as in a home where they
are drawn twice ([Bluetooth locating](bluetooth.md)). Follow their phone with DomoTwin's Bluetooth,
or place nobody and let the radars count.

This holds for everyone, administrators too. What Home Assistant itself keeps is still there for
whoever administers it: its `person` entities, and DomoTwin's room sensor of each person placed
(`sensor.domotwin_<person>_room`). To keep no one's room at all, place nobody in DomoTwin's
people settings: the presence radars then count people without knowing who they are.

## Open, closed, and what was left on

With opening hours, the Home tab shows **Open until 18:00**, or **Closed until 08:30**. Once
closed, it says what was left on, marked as a warning: **Closed: 3 left on**. A tap lists them,
each to turn off from there:

- the lamps on (the lamps of a light group, not the group);
- the doors, windows and gates open;
- the locks unlocked or open;
- the media players on or playing.

As everywhere in DomoTwin, what is in a private room the viewer may not see is left out.

## What it used while closed

With opening hours and Home Assistant's
[energy settings](https://www.home-assistant.io/docs/energy/), DomoTwin says what the place used
while it was closed (D-088): what it took from the grid, the sun and its battery, less what went
back, as Home Assistant's Energy page counts it.

- **On the Home tab**, a tap on the hours: *While closed, the last 7 days: 32 kWh (38% of all) ·
  While closed, this month: 126 kWh (36% of all)*. Read when you open it, again after ten minutes.
- **In the [weekly report](report.md)** (administrators): this week against the week before, and
  each room's, the rooms leading the most first. A fridge and a server are expected; a heater or
  a screen left on all night is what to look for.

The closed hours are read from the schedule's history, kept by Home Assistant's recorder; each
hour of the recorder's statistics counts for the part of it the place was closed (half of 18:00
to 19:00 for a closing at 18:30), as if what it used was used evenly over the hour. A schedule
left out of the recorder says nothing, nor a place without energy settings.

## Closing up

Among the shortcuts suggested on the Home tab ([shortcuts](shortcuts.md)), **Close up** takes the
place of *Good night* and *Leaving*: the lamps off, the media off, the shutters down, the doors
locked, the alarm armed away, the heating on eco, from what the place has. It asks before it runs.
Add it once, and it is a tap at closing time.

## Where the setting is kept

In the home's settings (`settings.workplace`, D-086), with the integration's storage: nothing is
sent anywhere.
