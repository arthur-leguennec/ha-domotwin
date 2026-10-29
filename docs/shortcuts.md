# Shortcuts

Big buttons at the top of the *Home* tab, each your own, that do in one press what would take
many on the 3D plan: every lamp off, the shutters closed, a good night, the heating, the car's
battery read at a glance (`DECISIONS.md`, D-084). On a phone, DomoTwin opens on *Home*: the
shortcuts are the first thing under who is in and what is on; the 3D is a tab away.

## Your first shortcuts

With none yet, *Home* suggests three, drawn from your own devices, as dashed buttons: a press adds
one. **More suggestions** (or **Add a shortcut**, once you have some) lists everything your home
makes possible, by what it is about, each with how many devices it acts on:

| About | Suggested |
| --- | --- |
| Lights | All the lights off; the lights off on each floor |
| Several at once | Good night (the lights off, the shutters closed, the doors locked, the alarm for the night, asked first); Leaving home (the lights and the music off, the doors locked, the alarm armed, the heating in eco, asked first), from what your home has of them; in a workplace, Close up instead (the same with the shutters down, asked first, see [a workplace](workplace.md)) |
| Shutters and blinds | Close the shutters; open the shutters |
| Locks and alarm | Lock everything; arm the alarm (asked first); the alarm for the night (asked first) |
| Heating | Heating in eco (thermostats that have it); heating at 19 °C (66 °F) |
| Car | A car's battery: a battery sensor of a car's integration (Tesla, Renault, BMW, Volvo, Kia, Škoda…), or of a device whose name says it is a car (never a phone's) |
| Music and TV | Pause the music |
| Robots | Start the robot vacuum, or the robots |
| Scenes and scripts | A few of yours |

**Add** takes it as it is; **Adjust** opens it first. A suggestion already added is not suggested
again.

## What a shortcut does

A shortcut is one step or more. Each step says:

- **What**: the lights, the shutters and blinds, the locks, the heating, the music and TV, the robot
  vacuums, the alarm, or a scene or a script.
- **Does**: switch off, switch on (at a brightness of 1 to 100 %, or as it was), switch on or off
  together; close, open, set to a position (0 to 100 %); lock, unlock; eco, a temperature (−50 to
  150, in your unit), heat, switch off; pause, switch off; start, send back to its dock; arm away,
  at home or for the night; run. A number typed beyond its range is brought into it.
- **Where**: the whole home, a floor, a room (Home Assistant's floors and areas), or the devices you
  choose. It is read again at each press: a lamp you add to the living room is switched with it.

It acts only on what it can do something to: eco on a thermostat that has it, a temperature on one
that takes a single one, a position on a blind that takes one, never a garage door, a gate or a
window as a blind, pause on what plays and can pause, an alarm only in a way it can be armed. Never
a lock or an alarm that asks for a code: those are used from their keypad, on *Safety*. And only on
what your
rights in DomoTwin let you use (`rights.md`), never in a private room you may not see
(`privacy.md`). Its steps run one after the other; if Home Assistant refuses one, the others still
run, and the button says so.

### Undo

Once it has run, a bar under the shortcuts says it is done, with **Undo** for two minutes: the
lamps it touched are lit again as they were (their brightness), the shutters go back where they
were, the heating to its mode, preset or temperature, what played plays again. A lock, the alarm,
a robot, a scene or a script are not undone: a door unlocked or an alarm switched off by a tap
meant for something else is not wanted, and what a script did is not known. The lamps' **All off**
on *Home* (under the lamps on) can be undone the same way.

## More options

*More options* in the dialog adds:

- **Leave out**: devices of its place it should not touch (the night light in the hall).
- **Add a step**: several things in one press, up to six.
- **The button shows**: how many are on, open, unlocked or playing (the default: *3 on*, *All
  closed*, how warm it is where the thermostats are); the value of a device you pick (a car's
  battery, the home battery, the outside temperature), which a press then opens in Home
  Assistant's details; or nothing.
- **Ask before it acts**: a press asks *go ahead?* on the shortcut itself, **Yes** where the
  finger is; **No** or Escape leaves it.
- **Move earlier, later**: its place among the others.

## Changing them

**Change the shortcuts** turns the presses into changes: a press opens a shortcut to change its
name, icon, steps and options, or to delete it. A long press (a right click on a computer) opens one
too.

## Where they are kept

The integration keeps each person's shortcuts with their choices (`.storage/domotwin.users`, as their
favourites and the tab DomoTwin opens on), so they follow you from your phone to your computer.
Someone else has their own. Each change is kept on its own (one added, changed, deleted or moved):
one made on your phone stays when a wall screen open since yesterday changes another. If Home
Assistant refuses one, DomoTwin says so and shows what it keeps.

## Not done yet

Shortcuts shared by everyone, shortcuts on Home Assistant's own dashboards or on a wall screen's
layout, a shortcut done later or at a time (an automation does it), and conditions (only after
sunset).
