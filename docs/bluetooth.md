# Bluetooth locating

DomoTwin finds the room a phone, a watch or a tag is in from what Home Assistant's Bluetooth
receivers hear of it: its own adapter, ESPHome Bluetooth proxies, Shelly devices. No Bermuda, no
ESPresense, nothing to flash. It works from the first minute, from the plan, and gets surer as it
learns. The phones and watches then place their owners ([people in their rooms](people.md)); a tag
on the keys says where the keys are, and when they were left behind.

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
