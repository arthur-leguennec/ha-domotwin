# The sandbox

Play a whole day of your home's automations, scripts and scenes on a copy of your home, and see
what they do: on the 3D view as the day goes by, and in a report. Nothing in the sandbox reaches a
device.

## Opening it

In the panel's **⋮** menu, **Sandbox: play a day of your automations**. It is for administrators:
Home Assistant gives the configurations of automations, scripts and scenes to administrators
only.

DomoTwin then reads, once and only reads:

- the states of every entity, and Home Assistant's areas, floors, devices and labels;
- DomoTwin's own plan, links and settings;
- each automation's configuration (`automation/config`), each script's (`script/config`), each
  scene's (the scene editor's), and the entity registry (devices' triggers name entities by its
  ids);
- the energy settings, if there are some.

The panel then shows the copy, at seven in the morning of today, on the 3D view. A bar says it is
the sandbox, with the time, the day's line and the way back. **Leave the sandbox** goes back to
your home as it is: nothing done in the sandbox is kept, nothing was written.

## The day to play

**The day** opens what the day is:

- its **date** (today at first): the sun rises and sets as it does on that date where your home
  is (Home Assistant's latitude and longitude), times and weekdays are that date's;
- its **weather** (sunny, cloudy, rainy, snowy) and the **lowest and highest outdoor
  temperatures**: the weather entities say it, by day and by night, their temperature each hour;
- **who goes out and comes back**: for each of Home Assistant's people, home at midnight or not,
  and when they go out and come back (on a working day each goes out at half past eight and is
  back at six, at first). Their trackers go with them;
- what was **done by hand** (below), each with a way to forget it.

**Play this day** plays it again from midnight.

## Watching it

- **Play** lets the day go by, a minute, ten minutes or an hour a second; the 3D view shows the
  lamps, curtains, locks and everything linked as the day sets them, the people coming and going,
  the sun moving, and, with the automations layer on, their wires pulsing as they run.
- **The day's line** shows each run (a tick) and each pair of automations working against each
  other (a red mark). Drag along it, or use the arrow keys (five minutes), Page Up and Page Down
  (an hour), Home and End.
- **A tap in the sandbox** (switching a lamp off, opening the curtains) is done at the moment
  shown, and the day goes on with it: what it sets off runs, as it would at home. It is listed
  under **Done by hand**.

## The report

**Report** says what the day did. Its count is what needs a look: the automations working against
each other, and those that could not be played or that set themselves off over and over.

- **Working against each other**: an entity one automation set, and another set otherwise within
  two minutes (a lamp switched off as someone leaves and switched straight back on by another).
- **Back and forth**: an entity automations changed six times or more within ten minutes.
- **What ran**: each automation's runs, when, what set it off, what each of its actions changed or
  said (a notification's message), and how it ended when it did not end well (stopped by a
  condition in its actions, started again before its end, turned off before its end, stopped where
  it could not be played).
- **Never ran**: the automations that did not run that day, and why: set off but stopped by their
  conditions, set off while they were running already, or never set off.
- **Not played**: what the sandbox could not play, with why. Nothing is guessed.

A time in the report goes to that moment of the day.

## What is played

Played as Home Assistant plays them:

- **Triggers**: state (from, to, attribute, `for`, not from, not to), numeric state (above,
  below, attribute, value template, `for`, once as it crosses), time (a time, an input datetime, a
  timestamp sensor, weekdays), time pattern, sunrise and sunset with an offset, zone (entering,
  leaving), template (once as it becomes true, `for`), events sent by the day's automations and
  timers, and the common device triggers (on, off, changed, a binary sensor's motion, opening and
  the like, a sensor's level).
- **Conditions**: state (`for`, any or all), numeric state, template, time (after, before,
  weekdays, across midnight), sun (before, after, offsets), and, or, not, trigger id, zone, and the
  common device conditions.
- **Actions**: calling a service, delay, wait for a template or a trigger (with their time limit),
  choose, if, repeat (a count, while, until, for each), parallel, sequence, stop, a condition,
  variables, firing an event, a scene, and the common device actions.
- **Modes**: single (a run while one runs is not started), restart, queued, parallel, with their
  maximum. An automation that sets itself off more than sixty times a minute is stopped for the
  rest of the day, and said to.
- **What services do**: lamps (brightness, colour), switches, fans, curtains and covers, locks,
  thermostats (temperature, mode, preset; a temperature outside the thermostat's range is refused
  and stops the run, as Home Assistant does), media players, robot vacuums and lawn mowers, valves,
  sirens, alarms, humidifiers, water heaters, every helper (booleans, numbers, selects, texts,
  dates, buttons, counters, timers), scripts (called and waited for, or turned on beside), scenes,
  automations (turned on, off with what they are running, set off), and
  `homeassistant.turn_on`, `turn_off`, `toggle` (what has no such service is passed over).
  Notifications and voices are said, not sent.
- **Templates**: the usual ones: `states()`, `is_state()`, `state_attr()`, `has_value()`,
  `states.light.kitchen.state`, the time (`now()`, `today_at()`, `timedelta()`), what set the
  automation off (`trigger.…`), numbers and texts (`float`, `int`, `round`, `default`, `lower`…),
  areas (`area_entities()`, `area_name()`), comparisons and arithmetic.

## What is not

Said in the report, for each automation:

- what comes from outside the home's day: Home Assistant starting, MQTT, webhooks, tags,
  calendars, voice commands, an event nothing in the day sends, uncommon device triggers;
- templates beyond the usual (`{% … %}` blocks, functions the sandbox does not have);
- what an integration's own service does (`zwave_js.set_config_parameter`), and a scene whose
  states Home Assistant did not give (one written in YAML);
- an automation whose configuration Home Assistant did not give.

The copy is a model: sensors change only as the day makes them (the people, the weather, the sun)
and as automations or your taps set them; a motion sensor does not see someone come home unless
an automation or you say so.

## Privacy

The sandbox is read once from your own Home Assistant and kept in the page while it is open. It is
not stored, not sent anywhere, and gone when you leave it.
