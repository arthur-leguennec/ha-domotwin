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

- **ESPHome proxies listen all the time.** A receiver hears a device only while it listens, and an
  ESP32 shares its one radio with its Wi-Fi. Since ESPHome 2026.8, a proxy on Wi-Fi built with the
  ESP-IDF it recommends already listens whenever its Wi-Fi does not need the radio (its scan
  `window` equals its `interval`, 320 ms): leave them as they are. A proxy wired with Ethernet
  keeps a 30 ms window unless told otherwise; let it listen all the time:

  ```yaml
  esp32_ble_tracker:
    scan_parameters:
      interval: 320ms
      window: 320ms
      connection_scan_window: 30ms   # keeps its connections to devices alive
  bluetooth_proxy:
    active: true
  ```

  On Wi-Fi with an ESPHome older than 2026.8, use `interval: 320ms` and `window: 300ms`, without
  `connection_scan_window`, which it does not know.

  Long windows (1 100 ms, often copied from older guides) are fine on Ethernet but starve the Wi-Fi
  of an ESP32 on Wi-Fi: since 2026.9 ESPHome warns above 600 ms. Ethernet proxies (the Olimex
  ESP32-PoE-ISO, for instance) are the steadiest receivers.
- **Shelly devices in Auto.** In Home Assistant, **Settings › Devices & services › Shelly**, the
  device's **Configure** › **Bluetooth scanner mode**: **Auto** (*Disabled* by default; Gen2 and
  later, on mains, firmware 1.5.1 or later). The Shelly then listens passively and scans actively
  for short moments when needed. A Shelly listens in short slices only, so it hears less often than
  an ESP32: a good second receiver, not the only one in a room.
- **Active or passive.** Since Home Assistant 2026.6, Home Assistant chooses how each ESPHome proxy
  and its own adapter scan: **Auto** by default (in the ESPHome integration's **Configure**, and
  under **Settings › Bluetooth** for the adapter). Leave it there.

What it changes: a receiver that listens all the time hears a phone several times a second rather
than now and then, so DomoTwin weighs each device on many readings, not on one or two, and the
room told changes less when someone stands still.

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

DomoTwin does not yet publish measured figures of its own: the roadmap's *Locating measured*
(M41) records them, with the same figures for Bermuda where it runs, so that they can be put
here.

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

A helper in DomoTwin's own Bluetooth dialog, which points to these and takes the key in any of
these forms, is on the roadmap (M45).

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
   a side left open, 15 dB a floor. A receiver that does not hear a device says something too: the
   device is far from it.
2. **What was learned** takes over room by room, receiver by receiver, as rooms are taught and
   presence sensors agree.
3. **Devices differ.** A tag whispers, a phone shouts: each device's own loudness is learned, so a
   loud phone far away is not taken for a quiet one close by.
4. **Rooms lead to rooms.** Someone stays put most of the time, goes through a door to the next
   room, takes the stairs; they do not cross the home in two seconds. The room told changes only
   once DomoTwin is sure enough twice in a row (or very sure once), so that a phone on a desk by a
   wall does not flap between two rooms.
5. **Presence sensors weigh in** for what people carry: a room whose presence sensor is on is more
   likely, one empty for half a minute less. Keys lying on a shelf are left alone.

A device is weighed every two seconds, from what it sent in the last six. Not heard for two
minutes, it is no longer located.

## Sensors

Each device followed gets `sensor.domotwin_<device>_bluetooth` (`alex_phone` gives
`sensor.domotwin_alex_phone_bluetooth`): the room's name, unknown when not heard. Attributes:
`device_name`, `kind`, `person`, `left_behind`, `room_id`, `area_id`, `storey_id`, `storey`,
`since`. It is written when the room changes, not at every reading: the history stays small.

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

- A phone or a watch with an owner places them: their figure walks there ([people](people.md)).
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
followed) and `.storage/domotwin.locating_learned` (what was learned, saved a minute after it
changes, and when DomoTwin stops). No identity key is stored: a device known by one keeps its
Private BLE Device entry's id. Diagnostics count receivers, devices by kind and rooms learned;
never addresses, keys, names or rooms.

See `DECISIONS.md`, D-035, for the reasons behind these choices.
