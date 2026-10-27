# Safety: cameras, the doorbell, the alarm, alerts

The DomoTwin panel has a **Safety** tab, next to *Home*, *Rooms* and *3D*: the alerts of the
home, the alarm, the doorbells and the cameras side by side. A doorbell that rings shows full
screen, whatever the tab. Every control is Home Assistant's own card; where Home Assistant has its
own **Security** page, DomoTwin opens it rather than copying it.

## The alerts, on every tab

The alerts the 3D view shows in its banner ([layers](../README.md#features): smoke, gas, carbon
monoxide, a water leak, a safety sensor, an alarm going off, a window open in the rain, CO₂ too
high) now show above the *Home* and *Rooms* tabs too, those of every storey, dangers in red first.
A tap on one opens the 3D view on its room, its storey shown first. Past two, **and 2 more** opens
the *Safety* tab, which lists them all.

On a device that cannot draw in 3D, a tap opens the room's page instead: its area's page in Home
Assistant's Overview (2026.2 and later), else the room in *Rooms*.

### Home Assistant's own alerts

Since Home Assistant 2026.9, an administrator chooses entities on its **Security** page that are
alerts when they are on: a door left open, a lock unlocked, a leak (the page's pencil, *Edit
security and safety page*, **Active alert entities**). DomoTwin reads that choice and shows those
alerts too, in the same banner on every tab, in the 3D view as well: red for the severity
*Alert*, amber for *Warning*, as Home Assistant colours them; without a severity chosen, an alarm
and the smoke, gas, carbon monoxide, water, safety and glass-break sensors are red, the rest
amber. Home Assistant says when one is on: an alarm going off, a cover open, a lock jammed, unlocked
or open, anything else on. A tap opens Home Assistant's Security page. An entity that already
raised a room's alert is said once, as the room's.

Change the choice on Home Assistant's page: DomoTwin follows it at once. Nothing is chosen in
DomoTwin itself.

## The Safety tab

From the top:

- **Alerts**: every alert of the home, or *No alert: all is calm.*
- **Alarm**: each alarm panel of Home Assistant (`alarm_control_panel`), with Home Assistant's own
  alarm card: its modes, its keypad.
- **Doorbells**: each doorbell and when it last rang.
- **Cameras**: every camera side by side, the doorbells' first (the one rung last first), each
  labelled with its doorbell, then the others by name. Each is Home Assistant's picture card: a
  picture it refreshes every ten seconds; a tap opens its dialog with the live stream. Live
  streams are kept for that dialog and the doorbell's full screen, to spare a phone's data and a
  small host.
- **Locks**, only where Home Assistant has no Security page (before 2025.12): each lock as a tile
  with its buttons.
- **Home Assistant's Security page** (2025.12 and later): the locks, the doors and windows, the
  sensors and what happened, as Home Assistant shows them, a tap away.

A home with no alarm, camera or doorbell in Home Assistant says so.

Hidden entities and those Home Assistant shows as settings or diagnostics are left out. A camera,
a lock, an alarm or a doorbell in a [private room](privacy.md) you may not see is not shown, as in
the rest of DomoTwin.

To open DomoTwin on it, on a wall tablet by the front door for example: **Your choices** ›
**DomoTwin opens on** › *Safety*, for you or for this device only.

## The doorbell, full screen

Home Assistant's doorbells are its `event` entities of the *doorbell* class: UniFi Protect, Ring,
Nest, DoorBird, August and Yale, Axis, SwitchBot, HomeKit devices and others give one, and an ESPHome device
can declare one. A doorbell given only as a binary sensor (Reolink's *visitor*) is not one. When
one rings, the panel shows, over whatever tab:

- **Someone is at the door**, the doorbell and the time it rang;
- its camera, live: the camera of the doorbell's own device, else the only camera in its area;
- the lock of its door, with its buttons to unlock it: the lock of the doorbell's own device, else
  the only lock in its area;
- **Close**.

It goes after two minutes, or when closed (or Escape); a new ring shows it again. It shows for
rings while DomoTwin is open, at most two minutes old: not the last ring Home Assistant gives
back when it starts, nor one heard while a phone slept. "Two minutes old" is read with the
device's clock, as Home Assistant's own "5 minutes ago" are: a wall tablet whose clock is more
than two minutes off Home Assistant's misses the rings, so keep its time set automatically. Its
screen is loaded the first time a doorbell rings.

It does not show over the demo house or the sandbox, which are homes of their own; leave them to
answer the door. A doorbell in a private room you may not see does not ring here.

A dashboard card does not show it yet: the wall screen (M26) will.

## In the demo house

The demo house has no camera, doorbell or alarm: its *Safety* tab shows its alerts. Home
Assistant's cards stand as DomoTwin's own plain rows there, as on the other tabs.
