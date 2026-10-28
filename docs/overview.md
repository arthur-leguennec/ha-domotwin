# DomoTwin and Home Assistant's Overview

Since 2026.2, Home Assistant opens on its own **Overview**: summaries of the lights, the climate,
security, media and energy, your favourites, and a page for each area. DomoTwin joins it rather
than copying it.

## A room tapped in 3D opens its area's page

In the DomoTwin panel, tap a room in the 3D view: where Home Assistant has the Overview (2026.2
and later), its area's page opens, the one at `/home/areas-<area>`, with Home Assistant's own
cards. Its back button brings you back to the 3D view. The room's own actions stay in the 3D view:
a long press on the room opens its panel.

Before 2026.2, and in the demo house or the sandbox, the room's page in DomoTwin's **Rooms** tab
opens instead, as before.

A room's area is the one you linked it to, else the area named as the room (see
[bindings](bindings.md)).

## What DomoTwin knows, on the area pages

Each room of your plan has a device of its own, **DomoTwin · \<room\>**, put in the room's area.
Home Assistant shows its two sensors on that area's page, and you can make them favourites of the
Overview (*Edit Overview*):

| Sensor | Says | Attributes |
| --- | --- | --- |
| `sensor.domotwin_<room>_people` | How many people are at home in the room ([people](people.md)), not counting those who hid themselves. Unknown while the room is [private](privacy.md), so that who is in it is not said. | `people` (their `person` entities), or `private` |
| `sensor.domotwin_<room>_upkeep_due` | How many [upkeep](upkeep.md) tasks are due soon or overdue for the pieces in the room. | `tasks`, the soonest first |

Both also say the room (`room`, `room_id`), its area (`area_id`) and its storey. A piece is in the
room it follows since it was moved in edit mode, else the room it names in the plan, else the room
its centre is in, as the 3D view finds it.

Home Assistant has no permissions per entity: these sensors are readable by every user, even when
only administrators see the people in DomoTwin. A person who hid themselves is left out of them;
their own room sensor still says where they are, for automations.

When you link a room to another area, its device moves there, as soon as that area exists. A
device in no area goes into its room's. A device you move yourself stays where you put it until the
room's area changes again; renaming an area moves nothing. A room removed from the plan
takes its device and sensors with it; put back, its device goes to the room's area.

A room's sensors are named after its id. Two ids that differ only by case, or by `-` and `_`
(`living-room`, `living_room`), give the same name: Home Assistant adds `_2` to the second.

The weak spots of the radio mesh and the robots are not sensors: the mesh is worked out in your
browser from ZHA's tables, and the robots are drawn moving in the 3D view, not reported by Home
Assistant. Their summaries below say what DomoTwin knows of them.

## DomoTwin's summaries

A **DomoTwin summary** card sums up one thing in the Overview's manner, on one line. A tap opens
the 3D view on it.

| Summary | Says | Opens |
| --- | --- | --- |
| `people` | Who is at home, and the rooms they are in: only those of the people you may see in DomoTwin. | the 3D view |
| `network` | The Zigbee devices, the weak links and the devices not heard from (administrators, with ZHA). | the network layer |
| `automations` | How many automations are on, and how many ran today. | the automations layer |
| `upkeep` | How many upkeep tasks are due, and the soonest. | the upkeep layer |
| `robots` | What the robot vacuums are doing. | the 3D view |

For someone who has no DomoTwin panel (left out of the sidebar, or kept for administrators), a
summary only says what it sums up: a tap opens nothing.

Add one from a dashboard's **Add card** (*DomoTwin summary*), or in YAML:

```yaml
type: custom:domotwin-summary-card
summary: upkeep
```

The **Home** tab of the DomoTwin panel takes them too: **Your choices** › **Add a summary**.

A layer the person may not see (the network and the automations are for administrators) is not
shown: the 3D view opens without it.

## DomoTwin among the Overview's shortcuts

Since 2026.5, the Overview has shortcuts. To put DomoTwin there:

1. Open the Overview, then **Edit Overview** (administrators).
2. In **Shortcuts**, add one whose path is `/domotwin` (or `/domotwin/3d` for the 3D view).
3. Save.

DomoTwin does not write the Overview's settings itself: they are Home Assistant's own, shared by
every user.

## A room's device opens DomoTwin on the room

Each room's device links to DomoTwin (D-087): on its page (**Settings** → **Devices & services** →
**Devices**, or from the area's settings), Home Assistant's link opens DomoTwin's panel with the
room framed in 3D, on its storey. A private room you may not see is not framed. The link is there
while the panel is in the sidebar (the integration's options): without the panel there is no page
to open.

## What the Overview cannot take

The Overview has no place for a card that is not its own, on its home page or on its area pages.
DomoTwin's 3D view cannot sit at their top, and an area's page cannot open DomoTwin on its room:
both need Home Assistant itself. The room's device has the link instead (above), and the 3D view
stays in DomoTwin's panel and its cards (D-087).
