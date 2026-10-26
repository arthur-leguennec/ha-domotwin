# Radio coverage

The **radio coverage** layer colours each room by how well a radio reaches it, for your Bluetooth
receivers, your Zigbee mesh or your Wi-Fi access points, and names the spots where the next
Bluetooth proxy, Zigbee router or Wi-Fi access point would help most, each with what it would
change. It works the plan out (walls, doors, floors) and checks it against what your radios
measured: what was measured comes first.

![Radio coverage over the demo apartment: Wi-Fi from the kitchen's access point, the bathroom in orange, the hall in yellow, three numbered spots, and the sheet with what each changes](figures/screenshot-placement.png)

## Who sees it

Administrators: only they may read the Bluetooth receivers and the Zigbee mesh. The layer is in the
layer menu as **Radio coverage**; its sheet chooses the radio: **Bluetooth**, **Zigbee** (with
ZHA set up) or **Wi-Fi**. Nothing leaves Home Assistant: the coverage is worked out in the page.

## Reading it

- **The rooms' colours.** Green is good, yellow fair, orange weak, red out of reach.
- **Measured first.** A room is measured when something there measured the radio, and the sheet
  says by what:
  - Bluetooth: a receiver learned the room ([Bluetooth locating](bluetooth.md): a room taught, or
    presence sensors agreeing) from at least eight readings; the best receiver's signal, the
    device's own loudness taken away;
  - Zigbee: an end device placed in the room ([the network map](network.md)) has a link to the
    coordinator or a router heard from in the last day; its best link, good from LQI 150, fair
    from 80, weak below. A room with the coordinator or a router is covered by it; how well that
    one reaches the rest of the mesh is the network map's health;
  - Wi-Fi: a device placed in the room reports its Wi-Fi signal (ESPHome's *WiFi Signal*, a Shelly
    or Tasmota device's signal, WLED's); the best of them.

  The other rooms show what the model predicts.
- **The spots.** Up to three, numbered on the plan and in the sheet, each with the rooms it raises
  ("Bathroom: weak → good") and the piece it stands by. Each spot is for the next radio alone:
  the first is the best one to add, the others are alternatives, not more to add. Tap one to see
  the rooms as they would be with it; tap it again to see them as they are. *Every room is
  covered well* means no spot would raise a room.
- **The radios.** Each one placed is marked on the plan. Those that cannot be placed are listed.

Spots are marked on the storey shown; with every storey at once, the sheet lists them. A private
room you may not see ([private rooms](privacy.md)) shows nothing of its coverage, and no spot in
it.

## The radios

- **Bluetooth receivers** stand where the locating places them: at the piece linked to their
  device, in their device's area, or where you set them in the Bluetooth settings. A receiver
  placed nowhere is listed, with a button to the Bluetooth settings (in the panel).
- **The Zigbee coordinator and routers** stand at their pieces, as on the network map; place them
  from the map's *Not placed in the home*. A router not heard from for a day relays for no one and
  is left out.
- **Wi-Fi access points**: Home Assistant does not know where they are. In the panel, **Place an
  access point**, then tap the floor where it stands, on the storey shown; up to 16. Remove one
  with its ✕. They are kept in DomoTwin's settings.

A Zigbee router joins the mesh through its neighbours, and a Wi-Fi access point without a cable
through the first one: their spots are only where one already there reaches them fairly. An
access point with a cable can go farther than the spots say.

## The model

For each room, what a device held at 110 cm hears of each radio, over a few points of the room
(the same as the locating's): the signal falls with the distance (2.2 times faster than in open
air), about 4 dB a wall, less for a door, nothing for a side left open, 15 dB a floor. A room's
signal is the best radio's, on average over its points. The radios differ in how loud they are and
in what is good enough:

| Radio                                | At 1 m  | Good       | Fair       | Weak        |
| ------------------------------------ | ------- | ---------- | ---------- | ----------- |
| Bluetooth: a phone, by a receiver    | −59 dBm | −80 or more | −90 or more | −100 or more |
| Zigbee: a device, by a router        | −45 dBm | −75 or more | −85 or more | −95 or more  |
| Wi-Fi: an access point, by a device  | −35 dBm | −67 or more | −75 or more | −85 or more  |

Below *weak*, out of reach. These are guides, not measures.

**Checked against what was measured.** Where a signal was measured (a Bluetooth room learned, a
Wi-Fi device), the sheet says how far off the model is there. From two measurements, the
predictions are moved by their median error (12 dB at most) and the sheet says by how much. Zigbee
measures its links' quality, not a signal: the sheet says in how many rooms the measured and the
predicted levels agree.

## Limits

- It is a model: furniture, what the walls are made of and how thick they are, a fridge, a mirror
  and the outdoors are not in it. A room measured shows what was measured.
- Wi-Fi is 2.4 GHz as most devices of a home use it; 5 and 6 GHz go less far through walls.
- Thread and Matter, Zigbee2MQTT and Z-Wave are not read yet.
- The Bluetooth receivers' places and what they learned are read when the layer opens; the Wi-Fi
  signals as they change, at most every 30 seconds.
- In a home of more than 24 rooms, each room is weighed from four of its points and offers its
  middle alone as a spot, so that the advice stays quick.

See `DECISIONS.md`, D-057, for the reasons behind these choices.
