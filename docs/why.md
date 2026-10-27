# Why?

Ask a lamp who or what switched it on: DomoTwin follows its last change back to what started it,
as a chain, and draws it in the home. The hall's lamp, switched on by an automation, set off by
the hall's motion sensor; or by someone in the app; or on the lamp's own switch.

## In a device's sheet

A long press on a piece opens its controls. Under them, **Why** has a button, **Who or what
changed it?**. DomoTwin asks Home Assistant then, not before, and lists the chain from what
started it down to the device, each step with when it happened:

- **Someone**: a person signed in to Home Assistant, named as their `person` is (or as Home
  Assistant names its users, for an administrator), with the action they asked for
  (`light.turn_on`).
- **An action, with nobody signed in**: an action called by something that is no one's (a voice
  satellite, an integration).
- **A change of state**: a sensor that sensed, a helper, another device; followed back in turn
  when it was itself the doing of something else.
- **An automation or a script that ran**, with, for an administrator, a link to its **trace** in
  Home Assistant.
- **What set an automation off**: a time, the sun, Home Assistant starting or stopping, an event,
  or another trigger in Home Assistant's own words.
- **Nobody, as far as Home Assistant knows**: the change began with itself, on the device itself
  or by its integration (a switch on the wall, a remote paired with the bulb).
- **Not in the logbook**: Home Assistant's logbook does not say what did it, or no longer keeps
  it (it keeps ten days by default).

**Show in 3D** closes the sheet and draws the chain; **Open in Activity** opens Home Assistant's
own Activity on the same entities, around the same time: since Home Assistant 2026.9, a row of it
opens the same chain as a list. The chain is asked again if the device changes while it shows.

## In the home

The chain is drawn with the wires of the automations (`automations.md`): a wire from each step to
the next, through the automations and scripts that ran between them, in the colour the first of
them has on its own wires (another colour when no automation ran: someone, an action). Its ends
are marked as an automation's are: a lightning bolt for what set it off, a target for what
changed; what has no piece floats as a label above its room or the home (a person, a time, an
action); what is not in the logbook has a dashed outline. A light pulse runs along the wires one
after the other, from the start to the device (they flash instead with *reduce motion*). A tap on
a wire names the automations it went through; the cross in the chip at the top hides it all.
Walking hides it, as it does the automations' wires.

## Where it comes from

Only from what Home Assistant recorded, as its own Activity reads it:

- **The state's context**: what each state was written in, who asked for it, and, for an
  automation's run, the context of the change that set it off.
- **The logbook** (`logbook/get_events`, open to every user): the rows of a context, and of an
  entity around a time.
- **The traces** (`trace/contexts`, administrators only): the run each context belongs to.

DomoTwin explains the device's last change of **state** (on, off, open, heating…), as Home
Assistant's Activity lists them: a change of its attributes alone (a lamp's brightness) is not
one. A sensor that measures (with a unit, a state class, or a kind that is a number) is not in
Home Assistant's logbook: it has no **Why**. Without Home Assistant's logbook (not loaded, or in the sandbox's copy of the home), there is no
**Why**. It follows the chain back through the state changes
that set automations off, the automations that ran others, and what was done in another's name
(a thermostat switching its heater on for whoever set it), up to six changes; what came before is
in the Activity. What ran after the change in the same context (a notification sent a moment
later) is not among its causes.

## Who sees what

Everyone sees the chain: the logbook is open to every user. The traces' links, and the names of
Home Assistant's users who are not a `person`, are for administrators. What a private room holds
(`privacy.md`) is said to be "in a private room", left out of the Activity's link and not drawn.

## Limits

- What an integration or a trigger says in its own words (an event's name, a trigger Home
  Assistant describes as it likes) is shown as it is.
- Voice: Home Assistant records a sentence said to Assist as the action it called, by the person
  signed in when it was said in the app, by nobody from a voice satellite. DomoTwin says what was
  recorded, not that it was said.
- Scripts run in the context of what started them: an automation's scripts are listed after it,
  and a script someone ran from the app is theirs.
- The demo house has a logbook of its own: what the visitor does, its automations and its day.
  Home Assistant's Activity and the traces are the home's, not the demo's: they are not offered
  there.
- Why something did **not** happen is not in a logbook: it is the sandbox's, later (M29).

See `DECISIONS.md`, D-059, for the reasons behind these choices.
