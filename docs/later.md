# Actions done later

"Switch the lantern on tomorrow at 6:30, at full power, until 6:45": DomoTwin keeps actions like
this one and does them on time, even if Home Assistant restarts in between (`DECISIONS.md`,
D-046). A device is switched on, a light at the brightness you choose, and off again at a time or
after a while if you want. It can also just be switched off. Covers open and close. Lights,
switches, fans, input booleans, media players, climate, humidifiers and sirens can be switched
this way.

You can set one in three places: the piece's sheet, an automation or a script, and your voice
assistant.

## From the sheet

Long-press a lamp, or any piece linked to such a device. Its sheet has a **Later** section with
what is waiting, each with its time and a ✕ to cancel it. **Later…** adds one:

- **Switch on** or **Switch off**. A cover offers **Open** or **Close**.
- **At**: a time of day, the next one to come (06:30 set at 22:00 means tomorrow).
- **For** (switching on): until switched off, or 5 minutes to 8 hours.
- **Brightness** (lights switched on).

A clock over the piece shows the time of its next step; a tap on it opens the sheet. Only someone
who may control the devices may set or cancel an action on them, and each step is done in their
name, with their rights. Devices that cannot be switched are refused.

## From an automation or a script

```yaml
action: domotwin.schedule
data:
  entity_id: light.lantern
  at: "06:30:00"        # a time of day (the next one), or a date and time
  duration: "00:15:00"  # or until: "06:45:00"
  brightness: 100
```

- `action`: `on` (the default) or `off`.
- `at` or `delay` (after this long): when it starts.
- `until` or `duration`: when it ends, for `on`.
- `brightness`: 1 to 100 %, for lights.

The action answers with the action set and a sentence saying what will happen, in Home Assistant's
language ("Lantern will switch on at 100 % tomorrow at 06:30 and off at 06:45."), for a
notification or a voice reply. `domotwin.unschedule` cancels an action by its `id`, or every
action on some entities (`entity_id`).

## By voice

When your voice assistant is driven by a language model (a conversation agent that may control the
home), DomoTwin gives it three tools: set an action, list them, cancel one. You can then say "switch
the lantern on tomorrow at 6:30 until 6:45" or "what is set for later?". Only devices exposed to
the assistant can be named, and only the actions on them are listed or cancelled. Nothing needs
installing, but the tools need a Home Assistant recent enough to hand integrations' tools to its
assistants (DomoTwin was tried with 2026.10); an older one leaves them out, and everything else
works.

Home Assistant's built-in agent, without a language model, cannot use tools. With it, use the sheet,
or an automation started by your own sentence.

## When Home Assistant was stopped

Once Home Assistant has started again:

- Switching off is always done, however late: it is the safe way.
- Switching on is done if it was missed by less than 15 minutes, or if the device should be on by
  now (its end is still to come).
- Steps missed together are done in the order they were due.
- Anything else missed is dropped, as is an action whose whole time on passed meanwhile.

A device that cannot be switched off (unavailable, or failing) is tried again every minute for an
hour.

## Limits

At most 100 actions wait at once, each on 10 devices at most. An action is set at most a year
ahead, and leaves a device on for a week at most. Diagnostics count the actions waiting, never
which devices or when.
