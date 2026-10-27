<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-neon.png" alt="DomoTwin: a fictional apartment in the neon look, at dusk in deep violet, the tops of its walls lit in amber, its lamps on, the rooms named on their floors" width="100%">
</p>

<p align="center"><b>Your home as a live 3D twin in Home Assistant.</b><br>
Tap a lamp to switch it on, tap a room to control it, and watch your sensors come alive on the plan.<br>
Local, fast, Rust + WebAssembly.</p>

<p align="center">
  <a href="https://my.home-assistant.io/redirect/hacs_repository/?owner=arthur-leguennec&repository=ha-domotwin&category=integration"><img src="https://my.home-assistant.io/badges/hacs_repository.svg" alt="Open your Home Assistant instance and add this repository to HACS."></a>
</p>

<p align="center"><a href="https://github.com/arthur-leguennec/ha-domotwin/blob/main/README.fr.md">Lire en français</a></p>

> [!NOTE]
> **Status: early development, version 0.4.0.** DomoTwin is built milestone by milestone
> ([roadmap](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/ROADMAP.md)), and
> everything under *Features* works today. Since 0.4.0 came the sandbox, history as reports, "Why?",
> the Wi-Fi QR code for guests, the configuration history, Hydro-Québec's peaks, more imports (robot
> vacuum maps, Floorplanner, mesh scans), the radio coverage, guest passes, safety (the cameras, the
> doorbell, the alarm, the alerts on every tab), each room's graphs with Home Assistant's Energy
> page a tab away, automations in plain words, played in the sandbox before they are saved, and the
> weather around the home, and DomoTwin joined Home Assistant's own Overview; the wall screen comes
> next, towards 0.5.0. The submission to HACS's default list waits on measurements on real devices.

## What sets it apart

- **Your real plan.** Import an IFC model (Revit, ArchiCAD, FreeCAD…) or a Sweet Home 3D home,
  every storey at once, rather than drawing your home again.
- **Free, all of it.** Every feature is in the MIT-licensed code: nothing to buy, no account.
- **The network map.** Your Zigbee mesh drawn on the plan: which device talks through which, the
  weak links, and the rooms short of a router.
- **The sandbox.** A day of your automations played on a copy of the home, to see what they do
  before they do it, and an automation said in plain words played there before it is saved.

## Features

- **A demo house to try first.** Before drawing anything, open DomoTwin and **Try the demo
  house**: a fictional family home of two storeys, with its lamps, curtains, TVs, thermostats,
  sensors, a robot vacuum, solar panels and a battery, three people and eight automations, living
  a spring day a minute a second. Go to the morning, midday, evening or night, tap anything, edit
  it: nothing touches your home. A card with `demo: true` shows it on a dashboard.
- **Home, Rooms, Safety and 3D.** The panel's *Home* tab shows the home at a glance (who is in,
  the lamps on, the doors and windows open, the weather), your favourite scenes as big buttons and
  your favourites; *Rooms* lists Home Assistant's floors and areas, each room's devices as Home
  Assistant's own tile cards, with a search; *Safety* has the alarm and the cameras side by side;
  *3D* is the 3D view, where a room tapped opens its room. The alerts show above every tab. Star
  what you use most; choose the tab DomoTwin opens on, for you or for one screen, and an agenda or
  a list for your Home tab.
- **Safety.** The alerts of every room (smoke, water, the alarm…) and those you chose on Home
  Assistant's Security page, above every tab, a tap from the room in 3D. The *Safety* tab has the
  alarm's keypad, the doorbells and every camera side by side, the doorbell's first, and Home
  Assistant's Security page a tap away. When the doorbell rings, it shows full screen, whatever
  the tab: its camera live and the door's lock. See
  [safety](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/safety.md).
- **Each room's graphs, the home's energy.** *Graphs*, on a room's page or its panel in 3D: what
  its sensors measured over the last day or week (temperature, humidity, CO₂, power, the meters
  hour by hour, the doors and windows, presence) as Home Assistant's own graphs, the same as a
  table or in Home Assistant's History a tap away. *Energy* opens Home Assistant's own Energy
  page, whose back arrow leads back to DomoTwin. See
  [graphs](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/graphs.md).
- **Your floor plan in 3D and 2D.** Draw it in the panel, or import it: an IFC model (`*.ifc`,
  from Revit, ArchiCAD, Bonsai, FreeCAD…), a Sweet Home 3D home (`*.sh3d`), a DXF drawing, a room
  scanned with an iPhone or iPad with LiDAR (`*.usdz`, RoomPlan's JSON), a Floorplanner plan
  (`*.fml`), a mesh scan (OBJ, PLY, GLB, STL from Polycam, Scaniverse, Matterport…), your robot
  vacuum's map (Valetudo's, straight from Home Assistant, its dock linked) or a DomoTwin plan
  (`*.domotwin.json`), one storey or all of them, and see it as a clean 3D model. The
  walls facing the camera are lowered automatically, like an open dollhouse. Switch to a crisp 2D
  plan with a smooth animation.
- **Pieces that look made.** Plants leaf by leaf, sofas and beds with soft edges, at no cost in
  speed.
- **Five looks.** **Neon**: the home at dusk in deep violet, the tops of its walls lit in amber,
  lamps and screens that shine; **blueprint**: white lines on blue; **day**: the home as it is, in
  the light of the time of day; **cartoon**: flat bright colours inked in black, under a blue sky;
  **clay model**: the home in matte clay, like an architect's model. Automatic: neon in Home
  Assistant's dark mode. See
  [looks](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/looks.md).
- **Tap to control.** Tap a lamp to toggle it; a bubble over it shows what it did, its
  brightness, and a way to everything else. Tap a TV for its power and volume, a robot vacuum to
  send it cleaning. Tap a room for its lights, blinds and its own buttons (a scene, a script);
  long-press it for every light, scene, cover, climate and media player there, and to switch its
  lights later. Linking a device offers what it does in words (volume up, open, dimmer), with an
  advanced mode for any action.
- **Live.** Lamps light their room in their real colour and brightness, the TV glows, blinds and
  curtains move, doors and windows open with their contact sensors.
- **The weather around the home.** Rain, snow, hail, fog, grey skies and a storm's flashes, from
  your weather entity, drawn in 3D: around an apartment and never in it, on the roof of a house,
  slanted by the wind. See [the
  weather](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/weather.md).
- **Layers.** An animated heatmap of temperature, humidity, CO₂ or fine particles read from the
  sensors of each room's area, safety alerts that pulse in their room (smoke, gas, water leak,
  alarm, a window open in the rain), the rooms someone is in, the real sun coming in through your
  windows, and what each appliance draws, with the home's energy: the sun, the grid and the
  battery around the home, the power flowing between them.
- **Hydro-Québec's peaks.** For a home on Flex D or the winter credit, with
  [hydroqc](https://github.com/hydroqc/hydroqc-ha) or
  [HydroPeak](https://github.com/Beat-YT/hydropeak-ha) installed: the next peak and its pre-heating
  on the Home tab, in 3D the rooms that pre-heat, shed or still heat during it, with what they
  draw, and tomorrow's announced peak played in the sandbox first. Nothing shown without them.
- **Robot vacuums.** Its robot leaves its dock when it cleans, sweeps the rooms one by one and goes
  home, on the plan.
- **Devices.** Badges over your devices (a lock's state, a camera recording, what plays, a battery
  running low, the washing machine running), and what each camera sees drawn on the floor of its
  room, behind the furniture, faint until you tap the camera; tap for the live picture.
- **Network map.** Your Zigbee mesh drawn over the home: each device at its piece, each link an arc
  coloured by its quality, light running towards the coordinator, and the rooms that hang on a weak
  link named, with *a router here would help*. Tap a device or a link for the details, rescan,
  and place the devices the map cannot find. For administrators, with ZHA. See [the network
  map](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/network.md).
- **A sandbox for your automations.** Pick a day, its weather and who goes out and comes back
  when, and watch your own automations, scripts and scenes play it on a copy of your home, in 3D
  and on a timeline, an hour a second if you like. A report says what each one did and when, what
  never ran and why, which ones work against each other, and what could not be played. Nothing
  in the sandbox reaches a device. See [the
  sandbox](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/sandbox.md).
- **Automations in plain words.** Say what should happen ("when the last person leaves, switch
  the lights off and lock the door"): Home Assistant's own AI task, the one you set up, writes the
  automation; DomoTwin says it back in plain words, has Home Assistant check it, plays it in the
  sandbox on the days you pick, and only then saves it, Home Assistant's editor a tap away. For
  administrators, with an AI task in Home Assistant (2025.8 and later): DomoTwin calls no model
  itself. See [automations in plain
  words](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/plain-words.md).
- **The Wi-Fi for guests.** Give your Wi-Fi once, and DomoTwin draws the QR code a phone's camera
  joins it with, in the page; or shows your router's own code. For administrators, and on the wall
  screens you choose; the password stays in DomoTwin's private storage. See [the Wi-Fi for
  guests](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/wifi.md).
- **Guest access.** A pass opens chosen rooms and devices to your guests for a few days: its link
  or QR code opens them on their phones, in 3D, without a Home Assistant account, with the Wi-Fi if
  you like, and ends on its own. By default it opens only on the home's network; DomoTwin checks
  every request against the pass. See [guest
  access](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/guests.md).
- **Into Home Assistant's Overview.** A room tapped in 3D opens its area's page of the Overview
  (2026.2 and later). Each room's area page shows who is in it and the upkeep due, and DomoTwin's
  summary cards (the people, the network, the automations, the upkeep, the robots) open the 3D view
  on what they sum up. See [DomoTwin and the
  Overview](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/overview.md).
- **Automation wires.** Long-press a lamp: its panel lists the automations that involve it, with
  their switch and when they last ran. Show their wires, from what sets them off to what they act
  on, and watch a pulse run along them when one runs. Or every automation of the home at once.
  See [automation
  wires](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/automations.md).
- **Why?** Long-press a lamp and ask who or what changed it: the automation that switched it on,
  the motion that set the automation off, or the person who did it in the app, or nobody (its
  own switch), as Home Assistant recorded it. Drawn in the home as a wire from where it started,
  with the run's trace for administrators and Home Assistant's Activity a tap away. See
  [Why?](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/why.md).
- **Upkeep cards.** Every appliance and piece of furniture can carry its make, model, serial
  number, warranty, manual and the tasks that come back (change the filter every 3 months). A
  wrench badge shows what is due, the upkeep layer tints the pieces green, amber or red, and a
  list by date has a **Done** button for everyone. An IFC file fills the cards; one sensor,
  `sensor.domotwin_upkeep_due`, is there for your notifications. See [upkeep
  cards](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/upkeep.md).
- **People in their rooms.** Everyone at home stands in their room as a figure in their colour,
  their name above, and walks through the doors when they move. DomoTwin places them from what
  already says where they are (Bermuda's or ESPresense's room sensors, or any entity naming a
  room); the room's panel says who is there, and Assist answers "where is Alex?". Anyone can hide
  themselves. See [people in their
  rooms](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/people.md).
- **Bluetooth locating.** No Bermuda? DomoTwin finds the room of a phone, a watch or a tag itself,
  from what Home Assistant's Bluetooth receivers hear (its adapter, ESPHome proxies, Shelly
  devices). It starts from the plan (distances, walls, doors, floors), so it works from the first
  minute, and learns as rooms are taught and presence sensors agree. Phones place their owners;
  keys left behind are told; "where are my keys?" by voice. See [Bluetooth
  locating](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/bluetooth.md).
- **Radio coverage.** Where the next Bluetooth proxy, Zigbee router or Wi-Fi access point helps
  most: each room coloured by how well your receivers, your mesh or your access points reach it,
  and the best spots numbered on the plan, each with the rooms it raises. Worked out from the
  plan's walls, doors and floors, and checked against what your radios measured, which comes
  first. For administrators. See [radio
  coverage](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/placement.md).
- **Private rooms.** Keep a bedroom or an office for some people, always or while a "Guests"
  switch is on: anyone else sees it closed, its floor frosted, nothing and nobody inside, no
  controls, and the voice answers say "in a private room". See [private
  rooms](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/privacy.md).
- **Plan editor.** No plan to import? Draw one in the panel: rooms as polygons with their lengths,
  partitions, doors and windows placed on the walls, with snapping and undo. See [plan
  editor](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/plan-editor.md).
- **Storeys.** A cellar, floors above, an attic: one plan each, a switcher in the view, stairs that
  take you up a tap at a time, and the alerts of every storey wherever you are. Or the whole home
  at once, its storeys spread apart under a roof, each with its label and a picture, live on every
  floor. See
  [storeys](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/storeys.md).
- **Edit mode.** Move, rotate and stack furniture with snapping, guides and undo, add pieces from
  a catalogue, link any object to entities (with suggestions from your areas), and add your own
  furniture or appliance with its 3D model (glTF/GLB, OBJ, STL or 3MF). See
  [edit mode](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/edit-mode.md).
- **Walk through it, hang it on the wall, ask for it.** Walk through your home at eye level, from
  room to room through the doors. On a wall tablet, a card goes back to its view when left alone,
  turns slowly and dims at night. Say "show the kitchen" to Assist and your screens show it. See
  [walking, kiosks and your voice](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/kiosk.md).
- **Later.** "Switch the lantern on tomorrow at 6:30 until 6:45": from a lamp's sheet, an
  automation (`domotwin.schedule`) or a voice assistant, DomoTwin does it on time, even across a
  restart, and shows a clock over the lamp meanwhile. See [actions done
  later](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/later.md).
- **History as reports.** "When was the bedroom above 24 °C for more than an hour?" Long-press a
  device or a room for its **History**: Home Assistant's history as a table, a row for each change
  or each hour, filtered by value and by how long, or its logbook searched by value; as CSV. Read
  only, from Home Assistant's own history, statistics and logbook. See [history as
  reports](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/history.md).
- **Configuration history.** Each change of an automation, a script, a scene or a dashboard is
  kept, by item and date, inside Home Assistant: what changed, in words ("Trigger 1 › offset:
  -00:30:00 → -00:20:00", "Action 2 added"), and one item put back as it was, through the commands
  Home Assistant's own editors use. For administrators; no add-on, no Git. See [configuration
  history](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/config-history.md).
- **Your voice.** A microphone button opens Home Assistant's Assist already listening, on a wall
  tablet as on a phone. When Assist cannot hear yet, DomoTwin sets up local voice with your
  consent: Whisper or Speech-to-Phrase and Piper, installed through the Supervisor, nothing
  leaving your home. The voice blueprints are added in one tap. See [your
  voice](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/voice.md).
- **Light and smooth.** Rust compiled to WebAssembly, rendering only when something changes, quality
  presets for old wall tablets. The first load is budgeted at 1.2 MB, checked by CI.
- **Yours.** English and French, follows your Home Assistant theme, works in the companion apps.
  Its own font (Inter, served by your Home Assistant), and everything in reach of the keyboard and
  screen readers: the rooms and their controls, the menus, the dialogs.

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/demo.gif" alt="The demo apartment: the view turns around the home, then shows it as a 2D plan and goes back to 3D" width="480">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-demo.png" alt="The demo house: in the morning its robot vacuum cleans the living room while Sam works in the office and the sun charges the battery, shown with the power layer and the home's energy; in the evening its lamps are on in the living room, where the family watches TV" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-looks.png" alt="The demo apartment in the evening in three looks: neon, blueprint and day" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-cartoon-clay.png" alt="The demo apartment in the day in the cartoon look, its furniture and people inked in black on bright floors under a blue sky, and in the clay model look, all in one warm matte clay" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-3d.png" alt="The fictional demo apartment in 3D: walls facing the camera are lowered, furniture in every room" width="49%">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-plan.png" alt="The same apartment as a 2D plan seen from above" width="49%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-edit.png" alt="Edit mode: a piece dragged on the 2D plan snaps onto a wall, with the distances to the other walls; the catalogue of pieces to add" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-live.png" alt="Live control in the evening: a long press on a lamp opens its controls, a long press on a room's floor opens the room panel" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-layers.png" alt="Layers: the temperature of each room as a heatmap with its legend, the power drawn by the appliances with the home's energy flowing from the sun to the home, the battery and the grid, a smoke alert pulsing in the kitchen, and the sun coming in through the windows" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-devices.png" alt="Devices: badges over the entrance door, the TV, the camera and the washing machine, and what the living room's camera sees, a fan with a ring every metre on the floor of the 2D plan" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-network.png" alt="The network map: the Zigbee devices of the demo apartment on their pieces, linked by arcs in green, amber and red, and a sheet with a router's details, the mesh's health and a sensor not placed in the home" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-automations.png" alt="Automation wires: every automation of the demo apartment drawn from the TV and the entrance door to the lamps and curtains, with labels floating above the home for the sun, a time, a notification and what a template decides" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-people.png" alt="People in their rooms: the demo apartment in the neon look, Sam a glowing blue figure in the living room and Alex a pink one in the kitchen, each with their name above" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-bluetooth.png" alt="Bluetooth locating: the settings over the demo apartment, three receivers and how each is placed, Alex's phone and keys followed in the kitchen, a watch heard that may be followed" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-placement.png" alt="Radio coverage: Wi-Fi over the demo apartment from the kitchen's access point, the bathroom in orange, the hall in yellow, three numbered spots for the next access point, and the sheet with what each changes" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-upkeep.png" alt="The upkeep layer: the washing machine of the demo apartment in red as its filter is late, the fridge in amber as its coils are due soon, the fan and the hob in green, beside the list of tasks by date with Done buttons" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-plan-editor.png" alt="The plan editor: a corner of the living room dragged with the lengths of its sides, and a room drawn beside the home" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-storeys.png" alt="Storeys: the floor above the demo apartment with its stairs and the storey switcher, and the dialog listing the storeys with their names and floor heights" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-home.png" alt="Every storey at once: the demo apartment's two storeys spread apart under a glass roof in the blueprint look, each with its label (rooms, lights on) and a picture of each storey on the left" width="100%">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/screenshot-walk.png" alt="Walking through the demo apartment's living room at eye level in the evening, its lamps on, with the walk pad in the corner" width="100%">
</p>

## Quick start

1. **Install.** Use the button above, or in HACS add
   `https://github.com/arthur-leguennec/ha-domotwin` as a custom repository of type *Integration*,
   install **DomoTwin** and restart Home Assistant.
2. **Add the integration.** Settings → Devices & services → Add integration → **DomoTwin**. No YAML.
3. **Draw or import your plan.** Open **DomoTwin** in the sidebar → **Draw a plan**, or
   **Import plan** and pick a DomoTwin plan (`*.domotwin.json`), an IFC file (`*.ifc`, see [IFC
   import](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/ifc-import.md)), a Sweet
   Home 3D home, a DXF drawing, a room scan, a Floorplanner plan or a mesh scan (see [plans from
   other apps](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/imports.md)); a
   robot vacuum running Valetudo gives its map with **Import a robot's map**. No plan
   yet? **Try the demo house** in the panel, or import the fictional
   [`examples/demo-apartment.domotwin.json`](https://github.com/arthur-leguennec/ha-domotwin/blob/main/examples/demo-apartment.domotwin.json)
   or
   [`examples/demo-apartment.ifc`](https://github.com/arthur-leguennec/ha-domotwin/blob/main/examples/demo-apartment.ifc),
   or **Draw a plan** in the app.

Then add the **DomoTwin** card to any dashboard from the card picker.

## Configuration

Everything is set from the user interface: the integration options and the visual card editor.
YAML is never required. For reference, the card options are:

| Option        | Values                              | Default    | Description                               |
| ------------- | ----------------------------------- | ---------- | ----------------------------------------- |
| `type`        | `custom:domotwin-card`              | required   |                                           |
| `title`       | text                                | none       | Card header.                              |
| `view`        | `3d`, `2d`                          | `3d`       | View shown when the card opens.           |
| `height`      | CSS length (`400px`, `60vh`…)       | 4:3 ratio  | Fixed height; in sections the grid decides. |
| `quality`     | `auto`, `eco`, `balanced`, `high`   | `auto`     | Rendering quality; `auto` adapts to the device. |
| `cutaway`     | `auto`, `always`, `off`             | `auto`     | How walls facing the camera are lowered.  |
| `lighting`    | `auto`, `morning`, `day`, `evening`, `night` | `auto` | The light of the scene. `auto` follows the sun of your Home Assistant (`sun.sun`), or the clock without it. |
| `storey`      | a storey id (`storey-2`…), `all`    | ground floor | Storey shown when the card opens, `all` for every storey at once; the switcher changes it. |
| `spread`      | `true`, `false`                     | `true`     | Every storey at once: spread apart, or stacked. |
| `roof`        | `true`, `false`                     | `true`     | Every storey at once: the roof over the top one. |
| `room`        | a room id of the plan               | none       | Room to focus on when the card opens.     |
| `layer`       | `off`, `temperature`, `humidity`, `co2`, `pm25`, `power`, `peak`, `network`, `coverage`, `automations`, `upkeep` | `off` | Layer shown when the card opens; the layer menu changes it. `peak` shows where hydroqc or HydroPeak reads Hydro-Québec's peaks, `network` to administrators with ZHA only, `coverage` and `automations` to administrators. |
| `alerts`      | `true`, `false`                     | `true`     | Safety alerts of the rooms (smoke, gas, water, alarm, a window open in the rain). |
| `presence`    | `true`, `false`                     | `true`     | The rooms someone is in glow softly.      |
| `people`      | `true`, `false`                     | `true`     | The people in their rooms, as figures.    |
| `sun`         | `fixed`, `real`                     | `fixed`    | `real`: the sun lights from where it is (`sun.sun`), through the windows. |
| `weather`     | `true`, `false`                     | `true`     | The weather around the home: rain, snow, fog and storms. |
| `badges`      | `true`, `false`                     | `true`     | Badges over the devices: locks, cameras, what plays, low batteries, appliances running. |
| `cameras`     | `true`, `false`                     | `true`     | What the linked cameras see, drawn on the floor. |
| `theme`       | `auto`, `day`, `neon`, `blueprint`, `cartoon`, `clay` | the home's | The look; `auto` is neon in dark mode. |
| `accent`      | a colour `#rrggbb`                  | the home's | Accent of the look (neon's lit wall tops); else the look's own. |
| `names`       | `true`, `false`                     | `true`     | The rooms' names on their floors.         |
| `small_rooms` | `true`, `false`                     | `false`    | The names of small rooms too (closets, rooms under 2.5 m²). |
| `idle`        | seconds (0 to 86400)                | `0`        | Kiosk: back to this view after this long untouched (0: never). |
| `orbit`       | `true`, `false`                     | `false`    | Kiosk: a slow turn around the home meanwhile. |
| `night_dim`   | `true`, `false`                     | `false`    | Kiosk: dimmed at night meanwhile (unless an alert shows). |
| `tools`       | `true`, `false`                     | `true`     | The view's buttons.                       |
| `voice`       | `true`, `false`                     | `true`     | The microphone button, when Assist is there. |
| `screen`      | a name (`hallway`…)                 | none       | This screen's name, for `domotwin.show`.  |
| `font_family` | a font family, `theme`              | bundled    | Font of the card's texts; `theme`: your theme's. |
| `demo`        | `true`, `false`                     | `false`    | The demo house and its day instead of your home; nothing of your home is touched. |

Integration options (Settings → Devices & services → DomoTwin → Configure): show the panel in the
sidebar, and show it to administrators only. Only administrators can import plans, edit and bind.
The panel's settings (the cog) set where north points on the plan, for the real sun.

**Layers read your areas.** A room's heatmap value is the mean of the temperature, humidity, CO₂ or
PM2.5 sensors of its Home Assistant area (the area linked to the room, or the area with the room's
name); its alerts and presence come from the smoke, gas, carbon monoxide, moisture, safety,
occupancy, motion and presence sensors of that area, and its alarm panel. The power layer uses the
power sensors linked to each piece. The network map places each Zigbee device at the piece linked
to its device or to one of its entities.

## How it works

<p align="center">
  <img src="https://raw.githubusercontent.com/arthur-leguennec/ha-domotwin/main/docs/figures/architecture.png" alt="How DomoTwin works: the Home Assistant integration, the frontend and the WebAssembly engine" width="100%">
</p>

A thin Python integration stores your plan, your edits and your bindings in Home Assistant and
serves the frontend. The frontend (TypeScript) talks to Home Assistant; the engine (Rust compiled to
WebAssembly) reads the plan, builds the geometry and draws it with WebGL2. More in
[`docs/ARCHITECTURE.md`](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/ARCHITECTURE.md).

## How DomoTwin is built

DomoTwin is written with [Claude Code](https://claude.com/claude-code), an AI coding assistant.
Its maintainer decides what is built and in which order, and tries it at home. Every change of the
code goes through a pull request, where it is checked by:

- its tests, run by the continuous integration: about 260 Python tests against a real Home
  Assistant, 340 frontend unit tests, 320 Rust tests and 210 end-to-end tests in a browser;
- two automated code reviews, each finding fixed or answered in the pull request;
- `clippy` with every warning an error, and fuzzing of every reader of files from elsewhere (plans,
  IFC, the other apps' plans, 3D models, layouts, automations, upkeep cards) when one changes;
- CodeQL on the Python, TypeScript and Rust code, `cargo deny` on every dependency's licence and
  source, and gitleaks on every commit;
- a size budget: the build fails if what a browser loads first goes past 1.2 MB.

Some rules never move: no network call outside your Home Assistant, and no shop, no licence key,
no paid tier, ever. The decisions and their reasons are kept in
[`docs/DECISIONS.md`](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/DECISIONS.md).

## FAQ

**Which plan formats does DomoTwin read?** Its own plan format, documented in
[`docs/plan-format.md`](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/plan-format.md)
with its JSON Schema; IFC files (ISO 16739, exported by FreeCAD, Blender with Bonsai, ArchiCAD
or Revit), one storey or every storey at once: see [IFC
import](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/ifc-import.md); Sweet Home
3D homes, DXF drawings, room scans made with Apple's RoomPlan (USDZ or JSON), robot vacuum maps
(Valetudo's, from Home Assistant or a file; Roborock's own), Floorplanner plans (FML) and mesh
scans (OBJ, PLY, GLB, STL): see [plans from other
apps](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/imports.md). DWG files,
binary USD, FBX and point clouds are not read.

**Can I put it on a wall tablet, or ask for a room by voice?** Yes: the `idle`, `orbit`,
`night_dim` and `tools` options make a card a kiosk, and the `domotwin.show` action (with a
blueprint for Assist) shows a room on your screens. See [walking, kiosks and your
voice](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/kiosk.md).

**My home has several floors.** Each floor is a storey with its own plan: **Storeys** in the panel
adds one (imported or drawn), names it and sets its height; the view switches between them or
shows them all at once, and a card can open on any of them or on the whole home. See
[storeys](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/storeys.md).

**Can I draw my home without another program?** Yes: **Draw a plan** in the panel (or **Edit
plan** to change one), see [plan
editor](https://github.com/arthur-leguennec/ha-domotwin/blob/main/docs/plan-editor.md).

**Can I use my own furniture?** Yes: in edit mode, **Import a 3D model** takes a glTF/GLB, OBJ, STL
or 3MF file up to 8 MB. Give its real size; it is placed, stacked and linked like any piece, kept
by Home Assistant and included in **Export plan**.

**Does it need an internet connection?** No. See
[Privacy](https://github.com/arthur-leguennec/ha-domotwin#privacy).

**Will it run on my wall tablet?** It needs WebGL2, available in current browsers and in the Home
Assistant companion apps. On old devices DomoTwin picks the Eco preset and renders only when
something changes, so an idle view costs almost nothing.

**Who can change the plan?** Everyone can view and use DomoTwin; only administrators can import a
plan, edit it and change bindings.

**What happens to my data if I remove the integration?** The stored plan, edits, bindings and 3D
model files are deleted. Use **Export plan** first to keep a copy (it includes the 3D files).

## Privacy

DomoTwin talks only to your own Home Assistant. It makes no other network call: no CDN, no
telemetry, no analytics, no web fonts. Every file it uses (JavaScript, WebAssembly, fonts,
materials) is served by the integration. Diagnostics contain counts only, never names, entity ids,
device ids, Zigbee addresses or geometry. An automation asked for in plain words is written by
Home Assistant's own AI task, the one you set up: DomoTwin hands it your request and the names of
your areas and entities, never their states, and where it goes then is that AI task's.

## Contributing

Contributions are welcome: see
[`CONTRIBUTING.md`](https://github.com/arthur-leguennec/ha-domotwin/blob/main/CONTRIBUTING.md).
Security issues: see
[`SECURITY.md`](https://github.com/arthur-leguennec/ha-domotwin/blob/main/SECURITY.md).

## Licence

[MIT](https://github.com/arthur-leguennec/ha-domotwin/blob/main/LICENSE). The plan format
specification and schema are reused under the MIT licence, and the bundled third-party components
are listed in
[`THIRD_PARTY_NOTICES.md`](https://github.com/arthur-leguennec/ha-domotwin/blob/main/THIRD_PARTY_NOTICES.md).
