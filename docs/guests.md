# Guest access

A guest pass opens chosen rooms and devices to your guests, for a while: a friend staying the
weekend, a sitter, the tenants of a holiday let. Its link, or its QR code, opens them on their
phones, in 3D, without a Home Assistant account; it ends on its own. The home's Wi-Fi comes with
it if you like.

## Making a pass

In the panel's **⋮** menu, **Guest access**. It is for administrators. **New pass**:

- **Who it is for**: shown to the guests ("Sam and Lee", "The neighbours").
- **From** and **until**: at most 31 days. The pass opens at its start and ends on its own.
- **Rooms it opens**: they are opened on the plan; the others are closed, empty and unnamed.
- **Devices**: those of the rooms chosen are listed and ticked, except locks, garage doors and
  gates, which you tick if you want to. **Another device** adds one from elsewhere: a scene, a
  script, the front door's lock in the hall. A pass gives lights, switches, covers, valves, fans,
  thermostats, water heaters, humidifiers, media players, locks, robot vacuums and mowers, scenes,
  scripts, buttons, sensors and the weather: never a person, a tracker, a camera, an alarm panel or
  an automation.
- **The guests may use them**: otherwise they only look.
- **Show the home's Wi-Fi**: the one given in [the Wi-Fi for guests](wifi.md).
- **Also from outside the home's network**: see [where a pass opens](#where-a-pass-opens).

**Save** shows the pass's link and its QR code: point the guests' phone camera at it, or **copy**
or **share** the link. **Change** opens the form again, **New link** replaces the link (the old
one no longer opens anything), **Remove** ends the pass at once. An ended pass stays listed for 30
days, then goes.

## What the guests see

The link opens a page of DomoTwin's own, in the guests' language (English or French):

- **the home in 3D**, with the rooms the pass opens; the others are closed as
  [private rooms](privacy.md) are: frosted, empty and unnamed;
- **their devices**, room by room, with DomoTwin's own controls: a lamp's switch and brightness,
  the blinds, the TV's volume, the thermostat. Those of other rooms are apart. A tap on a lamp in 3D
  switches it, as on a dashboard;
- **the home's Wi-Fi**, when the pass shows it, with its QR code for their other devices;
- until the pass ends; then the page says it ended. Before it starts, it says when it opens.

Nothing else: no other room's devices, no history, no automations, no camera, nobody's place,
no Home Assistant page. They have no Home Assistant account.

## Where a pass opens

By default, a pass opens **only on the home's network**: on the home's Wi-Fi or another device of
it, not through the internet or Home Assistant Cloud, as Home Assistant's own local-only users.
Guests join the Wi-Fi first (its own QR code), then open the link. Its address is Home
Assistant's own on the home's network.

**Also from outside the home's network** lets the link open from anywhere Home Assistant can be
reached (its external address, or Home Assistant Cloud): to open the gate before they arrive.
Whoever has such a link uses its devices from anywhere until the pass ends.

## Who did what

Each action of a guest is written in Home Assistant's logbook under the pass's name, as it is
asked ("Sam and Lee asked lock.unlock through a guest pass": Home Assistant may still refuse it),
and "Why?" ([`why.md`](why.md)) says it too.

## Privacy and safety

- **A pass's link is its key.** Whoever has it opens these rooms and devices until the pass ends.
  Give it to your guests only; **New link** if it went elsewhere, **Remove** when they leave
  early. Give a lock or a garage door only to a pass you would give a key to.
- DomoTwin checks every request of the guests' page against the pass: its time, where it comes
  from, the devices it gives and what may be done with each (a lock is locked and unlocked, never
  with a code; a script runs without variables). At most 20 actions in 5 seconds.
- The page loads DomoTwin's own files only, is never kept by the browser or indexed, and sends its
  address nowhere. The link stays in the guests' browser history: it opens nothing once the pass
  has ended.
- The rooms' outlines are seen; the names of the rooms the pass does not open, what is in them and
  what they link are not.
- Passes are kept in a store of their own on your Home Assistant (`.storage/domotwin.guests`),
  never in the plan, its export or DomoTwin's diagnostics (which only count them). Removing
  DomoTwin deletes them.

## The limit

The guests' page is DomoTwin's, outside Home Assistant's sign-in: DomoTwin enforces what a pass
gives, not Home Assistant, whose permissions are by user, not by device. To give a guest a Home
Assistant account instead (which sees every device), Home Assistant's own users, and the
Guest Mode integration for temporary sign-in links, are the way.
