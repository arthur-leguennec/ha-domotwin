# Bluetooth locating

DomoTwin finds the room a phone, a watch or a tag is in from what Home Assistant's Bluetooth
receivers hear of it: its own adapter, ESPHome Bluetooth proxies, Shelly devices. No Bermuda, no
ESPresense, nothing to flash on the receivers. It works from the first minute, from the plan, and
gets surer as it learns. The phones and watches then place their owners ([people in their
rooms](people.md)); a tag on the keys says where the keys are, and when they were left behind.

![The Bluetooth settings over the demo apartment: three receivers and how each is placed, Alex's phone and keys followed in the kitchen, a watch heard that may be followed](figures/screenshot-bluetooth.png)

## What it needs

- Home Assistant's [Bluetooth](https://www.home-assistant.io/integrations/bluetooth/), with at
  least one receiver. Two or more help; one in each main room is best. ESPHome proxies and Shelly
  Gen2 devices are cheap ones.
- Devices that say who they are:
  - **a phone or a watch** (iPhone, Apple Watch, Android): add it to Home Assistant's
    [Private BLE Device](https://www.home-assistant.io/integrations/private_ble_device/) first, with
    its identity key. Its address changes every few minutes; the key finds it again;
  - **an Android phone** with the companion app's *Bluetooth transmitter* on: known by the iBeacon
    it sends, whatever address it sends from;
  - **a tag** (keys, a bag) with a fixed address.

## Receivers that hear more

The more often each receiver hears a device, the surer and the quicker the room. Two settings
count most, both outside DomoTwin:

- **ESPHome proxies listen most of the time.** A receiver hears a device only while it listens,
  and an ESP32 shares its one radio with its Wi-Fi. Let it listen 300 ms of every 320 ms, about
  94 % of the time, and leave the rest to the Wi-Fi, so that it does not drop:

  ```yaml
  esp32_ble_tracker:
    scan_parameters:
      interval: 320ms
      window: 300ms
      active: true
  ```

  Do not copy the older tip of a `window` as long as the `interval`, at 1 100 ms: ESPHome 2026.10
  warns that scan windows over 600 ms starve the Wi-Fi on the same radio. Proxies wired with
  Ethernet (the Olimex ESP32-PoE-ISO, for instance) have the radio to themselves and are the
  steadiest receivers; the same settings suit them.
- **Shelly devices in Auto.** In Home Assistant, **Settings › Devices & services › Shelly**, the
  device's **Configure** › **Bluetooth scanner mode**: **Auto** (*Disabled* by default; Gen2 and
  later, on mains, firmware 1.5.1 or later). The Shelly then listens passively and scans actively
  for short moments when needed. A Shelly listens in short slices only, so it hears less often than
  an ESP32: a good second receiver, not the only one in a room.
- **Active or passive.** Since Home Assistant 2026.6, Home Assistant chooses how each ESPHome proxy
  and its own adapter scan: **Auto** by default (in the ESPHome integration's **Configure**, and
  under **Settings › Bluetooth** for the adapter). Leave it there.

What it changes: a receiver that listens most of the time hears a phone several times a second
rather than now and then, so DomoTwin weighs each device on many readings, not on one or two, and
the room told changes less when someone stands still.

## What to expect

- **One receiver**: near it or far from it, not much more. Enough to say whether a phone is home,
  or that the keys are by the door.
- **One receiver in each main room**: the room, most of the time, after a few seconds. Two rooms
  side by side are told apart best once each is taught. A receiver per storey helps the storey.
- **In between** (two or three receivers for four rooms): the rooms near a receiver are surer than
  the others.
- **A presence sensor in each room** (mmWave, or a motion sensor that holds) may be all you need to
  light the room someone is in: Bluetooth says *who*, a presence sensor says *someone*, and says it
  faster. DomoTwin's presence layer shows them, and they weigh in when it locates a phone (below).

DomoTwin does not yet publish measured figures of its own: it records them (below), with
Bermuda's beside where it runs, and the maintainer's go here once measured.

## How well the rooms are found

**Bluetooth settings › How well the rooms are found** (administrators) shows, for each device
followed, since the figures started:

| Row | What it says |
| --- | --- |
| Hours measured | How long it was followed. |
| Room changes / h | How often its room changed. Someone at a desk stays put: a high figure is a room that flaps. |
| Storey changes / h | The same between storeys, where both rooms' storeys are known. |
| Stays < 30 s | Rooms held less than half a minute before another: flickers. A moment in no room does not end a stay. |
| Time in no room | The share of the time it was not heard, or not placed. |
| Right when witnessed | While its owner is the one person at home and one room alone has its presence sensor on, the phone or watch is taken to be in that room: the share of that time the room found was that one, and how long that was. A phone left on a charger in another room counts against it, so read it as a floor. Never for a thing (a tag). DomoTwin weighs those same presence sensors for what people carry, so its share here is not independent of the witness; Bermuda's is. |
| Same as Bermuda | The share of the time the two said the same area, when both said one. |

**Beside Bermuda.** Where [Bermuda](https://github.com/agittins/bermuda) runs too, choose the
same device's area sensor in its row (*Bermuda's sensor of this device*; one device's at most):
Bermuda's figures sit beside DomoTwin's, counted the same way on the same ticks. Bermuda says an
area, not a room, so a third column, **DomoTwin (areas)**, counts DomoTwin's rooms by their Home
Assistant area as Bermuda's are: two rooms of one area (an open kitchen and living room) are one
place there. Compare Bermuda with that column; DomoTwin's own stays by room. Bermuda's storey is
the area's when all of the area's rooms are on one storey. Pairing another sensor, or none, starts
Bermuda's figures again.

The figures are counted every two seconds, with the locating; a pause of more than ten seconds
(Home Assistant busy or restarting) is not counted. For a minute after a start, and after a device
is first followed, the rooms settle: the time counts, not the changes. They are kept across
restarts until **Start again** (asked twice); a device no longer followed, or known another way,
starts again. **Copy as a table** copies them as a Markdown
table, the devices numbered, without names: ready to publish. The diagnostics carry the same
figures.

To compare fairly: the same devices, the same receivers, the same days, and a note of how many
receivers and rooms; a few days rather than a few hours, the home lived in as usual.

## An iPhone's identity key

An iPhone changes its Bluetooth address every few minutes; its identity key (IRK) finds it again.
Home Assistant's [Private BLE Device](https://www.home-assistant.io/integrations/private_ble_device/)
takes it, as 32 hexadecimal characters or as the base64 a Mac gives, with the phone on and heard
when it is added. To get it:

- **With a Mac** signed in to the same Apple account: **Keychain Access** (*Local Items* on macOS
  26, *iCloud* before), search *Bluetooth*, open the item whose account reads `Public` followed by
  the iPhone's Bluetooth address (**Settings › General › About**), show its password and copy the
  **Remote IRK** value as it is.
- **Without a Mac**, with an ESP32 for ten minutes:
  - *irk-capture* (MIT), an ESPHome package, explained in Home Assistant's community guide
    [Grabbing your Phone/Watch Bluetooth IRKs](https://community.home-assistant.io/t/guide-grabbing-your-phone-watch-bluetooth-irks-2026-edition/968791):
    flash it with ESPHome, pair the iPhone with it from **Settings › Bluetooth**, and the key
    appears on the ESPHome device's page, ready for Private BLE Device. The board cannot be a
    proxy at the same time; flash it back afterwards.
  - [ESPresense](https://espresense.com/beacons/apple) (AGPL-3.0), installed from its web page:
    **Enroll** on the node, then pair the iPhone; it publishes the key, which Private BLE Device
    takes as it is (with `irk:` before it, as ESPresense's page shows, or without).
- Bermuda's wiki keeps a [longer list](https://github.com/agittins/bermuda/wiki/How-to-get-the-IRK-%28Identity-Resolving-Keys%29-for-iOS,-Android-etc),
  Android included.

**Then, in DomoTwin**: **Bluetooth settings › Devices to follow › An iPhone or an Apple Watch**
(administrators). Paste the key as the tool gave it: 32 hexadecimal digits (spaces, colons or
dashes between them are fine), `irk:` and the digits, or the Mac's base64. DomoTwin hands it to
Private BLE Device's own setup, which keeps it, and follows the device it now knows: choose its
kind (phone or watch) and its owner, then save. It is named after Private BLE Device's entry, or
"iPhone" when that entry is named only by an address; rename it there if you like. DomoTwin keeps
nothing of the key and writes it nowhere; it never shows it again (the field hides it without
being a password field a password manager would offer to keep, and is emptied once the key is
taken) and never says it in an error. Keep the phone unlocked near a receiver while adding it:
Private BLE Device takes a key only when Home Assistant hears the device it belongs to ("Home
Assistant does not hear a device with this key"). A key Private BLE Device already has is
followed as it is, without a second entry. Without Bluetooth in Home Assistant the field is not
shown; with 30 devices followed already, one must be removed before the key is sent.

## Setting it up

In the panel, the **Bluetooth** button (administrators):

- **Receivers.** Each one is placed in the room of its Home Assistant device's area, or at the
  piece linked to its device (the network map's or the link editor's *device*), or in the room you
  choose. A receiver not placed still helps once rooms are taught.
- **Devices followed.** **Look for devices** lists the Private BLE Device entries (by their title:
  the key never leaves Home Assistant), the iBeacons and the named tags heard now. For each device
  followed: its name, its kind (phone, watch or thing) and whose it is. A phone or a watch with an
  owner places them: the owner is added to the people shown in their room, if they were not.
- **Teach a room.** Hold a device in a room for half a minute and press **Teach**: DomoTwin learns
  what each receiver hears there. Not needed to start; each room taught makes it surer, the rooms
  side by side most of all.
- **Learn from presence sensors** (on by default): while a phone or a watch is surely in a room
  whose presence or occupancy sensor is on, what is heard there is learned too, a little at a time.
  **Forget what was learned** starts again from the plan (after moving a receiver, say).

## How a room is found

1. **What the plan says.** For each room and each receiver, DomoTwin works out what the receiver
   should hear of a phone held in that room, from the plan: the signal falls with the distance
   (2.2 times faster than in open air, as indoors), about 4 dB a wall, less for a door, nothing for
   a side left open, 15 dB a floor (only where one storey lies over the other: a split level's half
   level beside the entry level is a wall away, not a floor, D-078). A receiver that does not hear
   a device says something too: the device is far from it.
2. **What was learned** takes over room by room, receiver by receiver, as rooms are taught and
   presence sensors agree.
3. **Devices differ.** A tag whispers, a phone shouts: each device's own loudness is learned, so a
   loud phone far away is not taken for a quiet one close by.
4. **Rooms lead to rooms.** Someone stays put most of the time, goes through a door to the next
   room, takes the stairs; they do not cross the home in two seconds, and they reach another
   storey by its stairs only (where the plan has stairs that lead there, D-079). The room told
   changes only once DomoTwin is sure enough twice in a row (or very sure once), so that a phone
   on a desk by a wall does not flap between two rooms.
5. **Presence sensors weigh in** for what people carry: a room whose presence sensor is on is more
   likely, one empty for half a minute less. Keys lying on a shelf are left alone.

A device is weighed every two seconds, from what it sent in the last six. Not heard for two
minutes, it is no longer located.

To read further on the way a phone is followed from what receivers hear, room by room and spot by
spot, the article [Bluetooth trilateration](https://jumacabo.com/blog/bluetooth-trilateration/)
walks through a setup of the kind and what it measured; several of DomoTwin's choices (a grid of
spots, rooms that lead to rooms, a storey changed by its stairs, measuring short stays) are close
to it.

## Where in the room

Within the room told, DomoTwin also works out where the device is (D-079). The plans are cut into
cells of half a metre (larger in a very large home), and each receiver's expected signal is worked
out for every cell, as for the rooms, what was learned of a room moving its cells too. Around the
room told (that room and the rooms it leads to), a cloud of likely cells follows the device: a few
cells at a time, through the doors, up and down the stairs, never through a wall. The spot told is
the middle of the cloud in the room told; how far the cloud spreads says how sure it is. A room
narrower than a cell tells no spot.

- On the sensor: `x` and `y` (metres on the storey's plan, from its origin), `z` (metres, the
  height of a hand held on that storey) and `accuracy` (metres around the spot). They are told
  again once the spot moved a metre or the accuracy changed by a quarter, and are not kept in Home
  Assistant's history.
- A person placed by their phone stands at its spot in the views, and walks there as it moves.
- With one receiver, or receivers whose place is not known, the spot says little: the cloud stays
  as wide as the room. Three or more receivers placed on the plan, around the rooms, find it best.
- It is the plan's estimate, said to be one: a metre or two off is usual, more in a large open
  room or a garden.

## Presence radars

A presence radar (mmWave) sees people, not who they are, and fast; Bluetooth says whose phone it
is. DomoTwin merges the two into one picture of who is where (D-080).

- **Place it on the plan.** Put a piece where the radar is (a small sensor from the catalogue, or
  the furniture it sits on), turn it so its front faces the way the radar looks, and link it to the
  radar's device or to its entities (*Link entities*). The link's angle of view and reach are the
  radar's field (120° and 6 m unless you set them). The Bluetooth settings then list it: its room,
  what it says, how many people it sees now.
- **What each radar gives.** An Everything Presence Lite or an LD2450 through ESPHome gives up to
  three targets' places (its `Target 1 X` / `Target 1 Y` sensors and so on): DomoTwin turns them
  into the plan's coordinates. An LD2410 gives how far its target is and whether someone is there:
  a ring around it. An Aqara FP2 through HomeKit gives an occupancy for each zone and nothing of
  where: each zone counts as a presence sensor of its room, so give each zone's entity the area of
  its room in Home Assistant. A radar's zones (an EP Lite's, an LD2450's) are presence sensors
  too.
- **Mirrored.** Some radars count their targets across the other way (an EP Lite has a setting for
  it): if the people it sees show on the wrong side of it, tick *Mirrored* in the Bluetooth
  settings.
- **Who each person is.** Someone a radar sees in a room is the person whose phone or watch is told
  there, the nearest within 2.5 m (a phone and a watch are one person; a device left behind is no
  one's): their spot is then the radar's, to about 40 cm, and moves with them every half metre.
  The person a radar sees stays who they were unless their phone says, by a metre, that it is
  someone else.
  Anyone else is *someone*: drawn as a grey figure in the views (where people are shown, to whom
  they are), and listed by `sensor.domotwin_people_seen`.
- **Behind a wall.** A radar sees through thin walls; DomoTwin keeps only the people it sees in its
  own room (and a room open on it), within its field.
- **Nobody there.** In the field of a radar whose presence is off, a phone's spot moves away from
  it; one whose presence is on but that sees nobody near (someone sitting still it lost) says
  nothing.

`sensor.domotwin_people_seen` (while a radar is on the plan) counts the people the radars see; its
`seen` attribute lists those no device names (their room, where on the plan in metres, a number
that follows them), not recorded in the history. Nothing of a private room is in it.

## Sensors

Each device followed gets `sensor.domotwin_<device>_bluetooth` (`alex_phone` gives
`sensor.domotwin_alex_phone_bluetooth`): the room's name, unknown when not heard. Attributes:
`device_name`, `kind`, `person`, `left_behind`, `room_id`, `area_id`, `storey_id`, `storey`,
`since`, and where in the room (`x`, `y`, `z`, `accuracy`, [above](#where-in-the-room)). It is
written when the room changes, the spot moves a metre (half a metre where a radar sees its owner)
or its accuracy changes by a quarter, not at every reading: the history stays small.

A device with an owner also gets `binary_sensor.domotwin_<device>_left_behind`: on while it is
heard at home and its owner has been away for two minutes (going from one zone to another is still
away). Notify yourself:

```yaml
triggers:
  - trigger: state
    entity_id: binary_sensor.domotwin_keys_left_behind
    to: "on"
actions:
  - action: notify.mobile_app_alex_phone
    data:
      message: "The keys are still in the {{ state_attr('binary_sensor.domotwin_keys_left_behind', 'room') }}."
```

## In the views

- A phone or a watch with an owner places them: their figure walks there ([people](people.md)),
  to where in the room it is.
- A person's sheet lists their devices and where each is, those left behind first.
- A room's panel lists the devices heard in it ("Things here").
- The devices of someone hidden, or of everyone when people are shown to administrators only, are
  shown to those who may see them only.

## Asking where

`domotwin.where` finds devices by name too: "where are my keys?" answers "I hear Keys in the
Hall." (in French, "J'entends Keys dans la pièce Hall."). A person and their phone named alike
("Alex", "Alex's phone"): the person is meant. The voice blueprint
[`where_by_voice.yaml`](../blueprints/automation/domotwin/where_by_voice.yaml) asks "where are …"
and "où sont …" too.

## Where the settings are kept

In two stores of their own: `.storage/domotwin.locating` (where the receivers are, the devices
followed, the Bermuda sensor paired with each) and `.storage/domotwin.locating_learned` (what was
learned, saved a minute after it changes, and the measurements, saved ten minutes after they are
taken at most; both written when Home Assistant stops). No identity key is stored: a device known
by one keeps its Private BLE Device entry's id. Diagnostics count receivers, devices by kind and
rooms learned, and give the measurements' figures without the devices' ids; never addresses, keys,
names or rooms.

See `DECISIONS.md`, D-035, for the reasons behind these choices.
