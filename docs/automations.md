# Automation wires

Tap a lamp and see which automations involve it, and how; draw them in the home as wires from
what sets them off to what they act on; watch them run. Or show every automation of the home at
once.

![Every automation of the demo apartment as wires: from the TV and the entrance door to the lamps and curtains, labels floating above the home for the sun, a time, a notification and what a template decides](figures/screenshot-automations.png)

## In a piece's panel

A long press on a piece opens its controls; a long press on a room, its panel. Both now end with
**Automations**: every automation Home Assistant relates to the piece's entities, its Home
Assistant device, or its room's area. Each row has:

- the automation's name, and how the piece takes part: **Sets it off** (a trigger), **Checked**
  (a condition) or **Acted on** (an action);
- when it last ran;
- a switch that turns it on or off;
- for administrators, a pencil that opens it in Home Assistant's automation editor.

**Show wires** closes the panel and draws those automations' wires. Above them, **Why** says
which of them, or who or what else, last changed the piece (`why.md`).

## The wires

- **One colour per automation**, kept from one view to the next.
- **From every trigger and every condition to every action.** Wires from a condition are dashed,
  and so are wires to an action whose target a template decides when it runs.
- **Ends are marked** by role: a lightning bolt for what sets it off, a diamond for what it
  checks, a target for what it acts on. An end at an entity linked to a piece is at that piece; at
  a device, at the piece linked to it or to one of its entities; at an area, in the middle of the
  room linked to that area; at a Home Assistant label, at every piece its entities are linked to.
- **What has no piece floats as a label** above its room (an entity of the room linked to no
  piece) or above the home: the sun, a time, a schedule, a template, a floor, a notification sent
  (`notify.phone`), what a template decides (with a dashed outline). Labels that would cover one
  another are lifted apart.
- **Tap a wire** to pick its automation out: its wires are drawn fully, the others lighter, and
  its name shows in the chip at the top. Where several wires pass, each tap picks out the next.
  A tap on a linked piece still does what it always does, wires over it or not. The cross in the
  chip hides the wires.
- **Walking** hides the wires: at eye level they would cross the view. They come back when you
  stop.

## Live

While wires are shown, an automation that runs sends a light pulse along its wires, from what set
it off to what it acted on, and the pieces it acted on that changed flash. With *reduce motion*
on, the wires flash instead. DomoTwin sees a run when the automation's `last_triggered` moves on,
which every user's dashboard already receives: nothing more is asked of Home Assistant, and
nothing runs while no wires are shown.

## Every automation of the home

**Automations** in the layer menu lists every automation of the home, beside the view (under the
house on a phone), by the room each is about (its first action's area, else what sets it off),
those about no room last. Each says in a line what sets it off and what it acts on ("Hall motion →
Hall light", the pieces by their names on the plan), and when it last ran; one turned off says so,
one that runs flashes. Above eight, a search finds one by its name or its line. An automation
with an end in a private room you may not see is not listed ([privacy](privacy.md)).

No wire is drawn until one is picked: a tap on an automation draws its wires alone, and opens what
it does in plain words (when, only if, then: [automations in plain words](plain-words.md)), with
what the marks on its ends mean and, for administrators, Home Assistant's editor. Another tap puts
it back; on a phone, the one picked is shown alone, *All the automations* bringing the list back.

**Every wire at once** (the button beside the list's title) draws them all, lighter, as before; a
tap on a wire picks its automation out. Above 30 automations the wires are bundled by room: one
wire between two rooms for all the automations that go from one to the other, drawn stronger the
more there are, and each tap on a bundle picks out the next of its automations.

## Who sees what

Every user sees the automations of a piece, their switches and when they ran. Drawing the wires
needs each automation's configuration, which recent Home Assistant versions keep for
administrators: where it does, only administrators get **Show wires**, and others read why. The
editor links and the layer of every automation are for administrators.

## Limits

- An automation is read as it is written: a step DomoTwin does not know (a new kind of trigger or
  action) is left out of its wires, not refused.
- Scripts and scenes called by an automation are ends of their own, not followed into.
- A `choose`, `if` or `repeat` is read whole: its branches' actions are all drawn, as the
  automation can take any of them.
- Up to 500 automations are drawn, 256 ends each.

See `DECISIONS.md`, D-032, for the reasons behind these choices.
