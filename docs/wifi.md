# The Wi-Fi for guests

DomoTwin shows the QR code a phone's camera joins your Wi-Fi with: guests point their phone at a
screen, or at your own phone, and they are on the network. The code is drawn in the page by
DomoTwin itself: nothing is fetched, nothing leaves your Home Assistant.

## Giving it

In the panel's **⋮** menu, **Wi-Fi for guests**. It is for administrators. The first time, the
form opens straight away:

- **What to show**: a network you type, or your router's own code. Some routers already give their
  guest network's QR code to Home Assistant as an image entity (FRITZ!Box and UniFi do): pick that
  entity, and its picture is shown as it is, password and all, without DomoTwin keeping any.
- **Network name**: up to 32 bytes, as Wi-Fi allows (fewer letters when they carry accents).
- **Security**: WPA (for WPA2 and WPA3 too), WEP for old networks, or none for an open network.
- **Password**: what the network takes. A WPA password is 8 to 63 characters, or 64 hexadecimal;
  a WEP key 5 or 13 characters, or 10 or 26 hexadecimal. Left empty when you change something
  else, the one kept stays.
- **Hidden network**: when the network does not say its name; the code joins it all the same.
- **Screens that show it**: the `screen` of the DomoTwin cards that may show it (see
  [the kiosk](kiosk.md)), separated by commas, such as `hall`. Upper and lower case are the
  same, as for `domotwin.show`.

**Save** draws the code. **Change** opens the form again, and **Forget it** removes it all.

## Showing it

- **Administrators** see a Wi-Fi button among the view's buttons, in the panel and in every
  DomoTwin card, once the Wi-Fi is given.
- **A screen you chose** shows the same button to anyone in front of it: a DomoTwin card whose
  `screen` is among the screens you gave (a tablet on the wall of the hall), even when whoever
  signed in there is not an administrator, and even when the card hides its tools (`tools: false`)
  or cannot draw the home in 3D. Only administrators can change it.
- **A guest pass** that shows it ([guest access](guests.md)) gives it to its guests, on their
  page.
- Elsewhere, no button.

The button opens the code, the network's name, and the password hidden behind **Show the
password**. A wall screen left alone (`idle`) closes it as it goes back to its view.

## Privacy

- The Wi-Fi is kept in a store of its own on your Home Assistant (`.storage/domotwin.wifi`), which
  Home Assistant keeps private. It is never in the plan, its export, DomoTwin's diagnostics (which
  only say whether there is one) or its logs. Removing DomoTwin deletes it.
- The password goes to the page only when the dialog opens, for an administrator or on a screen
  you chose: to draw the code there. The button itself needs only the network's name.
- A screen's name is no secret: it is in the dashboard's configuration, which everyone signed in
  can read. Anyone who signs in to your Home Assistant can ask DomoTwin for the network as one of
  those screens would, from any device, as anyone in front of the screen can scan it. That suits a
  network meant for guests: give the Wi-Fi to screens only when it is one.
- Home Assistant's own debug logging of its connection, when someone turns it on, writes the
  messages it carries, the password among them; DomoTwin writes nothing of it.
