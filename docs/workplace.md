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
  While closed, this month: 126 kWh (36% of all)*. Read as you open it, and again every ten
  minutes while it stays open (a wall screen's).
- **In the [weekly report](report.md)** (administrators): this week against the week before, and
  each room's, the rooms using the most first. A fridge and a server are expected; a heater or
  a screen left on all night is what to look for.

The closed hours are read from the schedule's history, kept by Home Assistant's recorder; each
hour of the recorder's statistics counts for the part of it the place was closed (half of 18:00
to 19:00 for a closing at 18:30), as if what it used was used evenly over the hour. A schedule
left out of the recorder says nothing, nor a place without energy settings.

The recorder keeps that history ten days by default: *this month* is then counted from the first
day it still has, and said so (*While closed, since October 16: …*). To have the whole month, keep
it at least 31 days in Home Assistant's `configuration.yaml`:

```yaml
recorder:
  purge_keep_days: 31
```

The weekly report's week before is the one last week's report said, so it needs nothing more.

## Meeting rooms

In the settings, under the workplace, tick the rooms kept for meetings and, for each, the calendar
of Home Assistant's it is booked in, if one: a [Local
Calendar](https://www.home-assistant.io/integrations/local_calendar/) made for the room, or one of
the calendars your bookings already go to (D-089).

The Home tab then counts them, *2 of 3 meeting rooms free*, and a tap lists each:

- **Booked until 10:45** (or *Booked all day*): an event of its calendar is under way;
- **Occupied**: nothing booked, but its presence sensors (motion, occupancy, presence, in the
  room's area) see someone;
- **Free**, else;

with **Next booking: 12:00** (or *tomorrow 09:00*) when its calendar has one to come.

A room whose calendar takes new events (a Local Calendar does) is booked from there, now, for
30 minutes or an hour: never over its next booking (the button then says *Book until 10:20*).
The event is named *Booked from DomoTwin*, with nobody's name in it, as people are named nowhere
in a workplace. A calendar that reads its server now and then (CalDAV) says the booking a while
later: the screen it was made on says the room booked meanwhile.

A private room the viewer may not see is left out; a calendar or a sensor they may not see is not
read, and a calendar they may not use is not booked from there (their [rights](rights.md)). A
calendar that cannot be read (its server down) says nothing: the room is said free or occupied
from its sensors alone.

## Several sites

One Home Assistant may run several buildings or shops: a shop in the town and its stockroom by
the harbour, two offices. In the settings, under **Sites**, add one for each and tick its storeys
(D-090): the first site has every storey until some are given to another, and a storey is in one
site alone (taken from another, it is the first's again). A site of a workplace may have its own
opening hours, a schedule of its own; else the workplace's. A new site shows once it has a
storey: draw or import its first one (it goes to the site shown), then tick it under its site.

With two sites or more, a list at the top of DomoTwin chooses the one shown, and this screen
remembers it; an alert's tap, a link to a room of the other site or `domotwin.show` show that
site too. Everything then follows it:

- **the 3D view**: its storeys alone, numbered from its own ground floor; *All storeys* stacks
  them, not the other site's;
- **the Home tab**: the people counted on its storeys, its lamps on and what is open, its opening
  hours, its meeting rooms;
- **the Rooms tab**: the areas of its rooms. An area no room of the plans has, and what is in no
  area, show on every site.

The alerts stay the whole home's (smoke at the other site matters here too), named with their
site, and so do a doorbell's ring, the weekly report, the energy and the voice. People without a room of the plans (no placement, no
radar) count on the first site, where Home Assistant's home zone is. What the place used while
closed (above) is worked out with the workplace's hours: a site with hours of its own does not
show it.

A storey drawn or imported while a site is shown is that site's; a storey removed leaves its
site. Replacing every storey from an IFC file numbers them afresh: they are then all the first
site's, until given to their sites again.

## Closing up

Among the shortcuts suggested on the Home tab ([shortcuts](shortcuts.md)), **Close up** takes the
place of *Good night* and *Leaving*: the lamps off, the media off, the shutters down, the doors
locked, the alarm armed away, the heating on eco, from what the place has. It asks before it runs.
Add it once, and it is a tap at closing time.

## Where the setting is kept

In the home's settings (`settings.workplace`, D-086; `settings.sites`, D-090), with the
integration's storage: nothing is sent anywhere. The site a screen shows is kept by its browser.
