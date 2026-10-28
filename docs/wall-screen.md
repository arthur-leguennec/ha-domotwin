# The wall screen

A tablet by the front door or in the kitchen, left on all day: DomoTwin opens it on its own tab
and, when nobody is there, shows the time, the weather and your photos. As soon as someone comes
(they touch it, press a key, a motion sensor sees them, the doorbell rings), it is back on its tab.
Everything comes from your own Home Assistant: its sensors, its weather, its media.

## Setting the screens

In the panel's **⋮** menu, **Wall screens** (administrators; on a home without a 3D plan, a
**Wall screens** button on the Home tab). Each screen has a name and a layout:

- **Name**: letters, digits, `-` and `_`, such as `hall` or `kitchen_wall`, the same as a card's
  `screen` (see [the kiosk](kiosk.md)); upper and lower case are the same. A screen keeps its name:
  the devices, cards and automations that name it keep naming it. To call it otherwise, add a new
  screen and remove the old one.
- **Opens on**: the tab it opens on and goes back to (Home, Rooms, Safety or 3D), or the device's
  own tab, else the user's.
- **Voice on this screen**: off, the panel on the screen has no microphone button, whatever its
  device says (see [your voice](voice.md#off-on-a-device)).
- **Screen saver**:
  - **Comes after**: how long with nothing touched and nobody moving (1 minute to 2 hours), or
    never.
  - **Woken by**: the motion, occupancy and presence sensors before the screen (10 at most).
    While one of them is on, the saver stays away.
  - **The weather**: the weather entity chosen for the 3D view, else the usual one (the Home
    tab's), its picture, temperature and words.
  - **Photos**: a folder of Home Assistant's media (**Choose a folder…** browses it: *My media*
    is Home Assistant's `media` folder), and how long each photo shows (10 seconds to 5 minutes).
    They come in another order each round; photos added to the folder come in the next round.
  - **At night, the clock alone, dimmed**: while the sun is down (Home Assistant's `sun.sun`).

Up to 20 screens. **Save** keeps a screen; **Remove** asks first. The screens shown change at once.

## Making a device a screen

On the device itself (the tablet), in **Your choices** (the button on the Home and Rooms tabs),
**This device is the wall screen**: pick its screen. Any user can, as a card's screen is set by
whoever edits the dashboard; it is kept on that device only, whoever signs in there. A screen
removed meanwhile is said *(removed)* until another is picked.

The device then:

- opens on the screen's tab;
- answers the `domotwin.show` requests that name the screen (as a card with that `screen` does),
  and those for every screen;
- shows the Wi-Fi for guests when the screen is one of its screens (see [the Wi-Fi for
  guests](wifi.md));
- runs the screen saver.

## The screen saver

It comes once the screen was quiet long enough, and takes the device back to its tab (a room or
a report left open is closed) for whoever comes next. It does not come while the plan is being
edited, pieces arranged or devices linked, while a doorbell rings, or in the demo house or the
sandbox.

It shows the time and the day in Home Assistant's language and time zone, moved a few pixels every
minute so that no spot stays lit for hours; the weather; and the photos, slowly brought closer and
cross-faded. Under it the 3D view is not drawn. With *reduce motion* set on the device, the photos
change without fading or moving.

It goes when:

- someone touches the screen (the touch only wakes it: it does not press what is under it) or
  presses a key;
- a sensor that wakes it turns on;
- a doorbell rings: its full screen shows, as on every tab (see [safety](safety.md));
- `domotwin.show` names the screen, or every screen.

## Good to know

- A web page cannot turn the screen's light off. Kiosk browsers can (Fully Kiosk Browser's
  *Screensaver* and motion detection settings, for instance), alongside DomoTwin's saver.
- The photos never leave Home Assistant: DomoTwin asks Home Assistant for each photo's address,
  signed for an hour, and the tablet fetches it from Home Assistant.
- The saver and the doorbell's full screen are the panel's: a DomoTwin card on a dashboard keeps
  its own kiosk options (see [the kiosk](kiosk.md)).
- The diagnostics count the screens and those with photos, never their names, sensors or folders.
