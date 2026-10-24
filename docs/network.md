# The network map

The **network** layer draws your Zigbee mesh over the home: each device at the piece it is linked
to, each link between two of them as an arc coloured by how well they hear each other, and a light
pulse running along the links towards the coordinator. It tells you at a glance which corner of the
home hangs on a single weak link, and where a mains-powered plug or bulb (a router) would help.

![The network map over the demo apartment: links in green, amber and red between the coordinator, two routers and a washing machine plug, and the panel's sheet with a router's details, the mesh's health and a sensor not placed in the home](figures/screenshot-network.png)

## Who sees it

The map reads ZHA, Home Assistant's own Zigbee integration, through the commands Home Assistant
keeps for administrators. The layer is offered in the layer menu only to administrators, and only
when ZHA is set up. Other users never see it, and nothing about the mesh leaves Home Assistant:
the map asks ZHA through the dashboard's own connection, as the rest of DomoTwin does.

Zigbee2MQTT and Thread are not read yet; the map takes its devices from a small source interface,
so they can come later without changing the map.

## Reading the map

- **Markers.** The coordinator is the large ring with an antenna, in your theme's colour; routers
  have a router icon, end devices (most battery sensors) a dot. A marker takes the colour of the
  quality of the last message heard from its device; a device not heard from for a day, or that
  ZHA counts unavailable, is drawn faded, its ring dashed. Devices at the same piece stand side
  by side.
- **Links.** Green is good (LQI 150 and above), amber fair (80 to 149), red weak (under 80), grey
  unknown (the neighbour tables gave no number). A link reported by both ends keeps the worse of
  the two. Links to a device not seen for a day are dashed.
- **Pulses.** Light runs along the links each device takes to the coordinator: the strongest way,
  the one whose weakest link is best, then the one with the fewest hops. As in Zigbee's own
  routing, a device hands its messages to one neighbour, which sends them on its own way, so the
  ways make a tree. A device not heard from relays for no one. Links no device takes (two routers
  that also hear each other, for example) are drawn lighter and still. With *reduce motion* on,
  nothing pulses.
- **Tap a marker** for the device: its type, the quality and strength of the last message heard
  from it, when that was, its hops to the coordinator (and through which device), and its
  neighbours, best first.
- **Tap a link** for its two ends, its quality, and the LQI each end reports for the other.

The **health** part of the sheet counts the devices, the weak links and the devices not heard from
for a day, and names each room that reaches the rest of the mesh only through weak links (or
through devices not heard from): *a router here would help*. The coordinator's own room is never
named.

**Rescan** asks ZHA to read every router's neighbour table again. That takes a few minutes; the
map reads the devices again every 30 seconds for three minutes.

## Devices not placed in the home

A device is placed at a piece when the piece is linked to its Home Assistant device, or else to
one of its entities. The ones that are not (and those linked to pieces of another storey) are
listed under **Not placed in the home**. In the panel, **Place** next to one asks you to tap the
piece, door or window where it is, then opens the link editor with its entities (not the hidden,
configuration or diagnostic ones) and its device filled in: save, and it is on the map. A
coordinator has no entities of its own: placing it links the piece to its device only. A piece
stands for one device at most; another device with entities can share it.

On the card the list is shown without buttons: placing is done in the panel.

## Limits

- The neighbour tables are what ZHA last read: a router that moved shows its old links until a
  rescan (ZHA also rescans on its own, every few hours by default).
- End devices do not report their neighbours; their link is the one their parent reports.
- The map shows the storey on screen, or every storey when all are shown. A link to a device on
  another storey is drawn when both ends are on screen. Walking at eye level, the map steps aside.
- Times are read in Home Assistant's time zone, as ZHA writes them.
- Up to 1 000 devices and 128 neighbours each are read.
- The diagnostics DomoTwin gives Home Assistant never hold IEEE or network addresses or device
  ids.

See `DECISIONS.md`, D-031, for the reasons behind these choices.
