# Automations in plain words

Say what should happen ("when the last person leaves, switch the lights off and lock the door"):
Home Assistant's AI task writes the automation, DomoTwin says it back in plain words, has Home
Assistant check it and plays it in the [sandbox](sandbox.md) on the days you pick, and only then
saves it (`DECISIONS.md`, D-070). DomoTwin calls no model itself: the AI task you set up in Home
Assistant writes it.

## What it needs

- **Home Assistant 2025.8 or later, with an AI task** that generates data: an integration such as
  OpenAI, Google Gemini, Anthropic or Ollama, its AI task set up in *Settings › Devices &
  services*, and preferably chosen in *Settings › System › General › AI suggestions*. Without
  one, DomoTwin offers nothing.
- **An administrator**: Home Assistant saves automations for administrators only.

It is in the panel's **⋮** menu: **An automation in plain words**. It is not in the demo house,
which has no AI task, nor in the sandbox, a copy of your home.

## Writing it

Write what should happen, in your own words and your own language, and press **Write it**.
When Home Assistant has several AI tasks, **Written by** chooses the one; the one Home Assistant
prefers comes first.

Before it is sent, the dialog says what goes to the AI task:

- your request;
- what an automation is, in short, as Home Assistant's editor saves it;
- the names of your home: its areas (id and name) and its entities, each with its id, its name,
  its area and what helps write it (a sensor's kind and unit, a select's options, a thermostat's
  modes), and the actions of their domains, with those that tell someone something (`notify`,
  `persistent_notification`).

**Never their states**: nothing says who is home or what is on. Hidden entities, configuration
and diagnostic ones, and those of a [private room](privacy.md) you may not see are left out:
until DomoTwin has read which rooms are private, the dialog waits and sends nothing. At most
1 000 entities are named, those in an area first; name the others by their id if you need them.

Where the AI task sends it then is the AI task's: one that runs on a service on the internet sends
it there, one that runs at home (Ollama) keeps it there.

## Reading it back

DomoTwin reads the automation the AI task wrote and says it back in plain words, from its
configuration, never from what the model said of it:

- **When**: each trigger. "When nobody is left in Home, for 2 minutes", "30 minutes before
  sunset", "At 7:15 AM, on Saturday or Sunday", "When Living temperature goes above 24 °C".
- **Only if**: each condition. "Alex is away", "It is between 08:00 and 22:30".
- **Then**: each action, in order, and what it holds under it (a choice, an `if`, a repeat, what
  runs at once, a wait). "Switch off Floor lamp and Kitchen ceiling", "Wait 5 minutes", "Lock
  Entrance door".

Entities, areas and devices are said by their names, states as Home Assistant says them, times
and durations in words. What has no words of its own is said by its kind and its settings. What
Home Assistant does not have is marked *not in Home Assistant*, and a step switched off in the
editor *off*. What the AI task said of it (what it assumed, what it could not do) is shown apart,
as its words. What it wrote that Home Assistant's automations do not take (Home Assistant refuses
it) is left out, and said; so is `initial_state`, so that it is saved switched on. **Its whole
configuration** shows the automation as it would be saved.

## Checked with Home Assistant

Home Assistant checks its triggers, conditions and actions (`validate_config`), as its own editor
does; each refusal is shown where it is. Home Assistant's check does not look at names, so
DomoTwin does: every entity, area, device and floor it names, and every action it calls, is looked
up, and what Home Assistant does not have is listed (labels are said by their id). It is checked
again when the dialog opens again, so a helper you have just added counts, and on **Check
again**.

## Changing it

- **What to change**: say it ("wait five minutes before locking the door") and press **Change
  it**. The AI task gets the request, the draft and the change, and writes the whole automation
  again; it is then checked and played again.
- **Name**: change the name by hand.
- **Copy**: copies its configuration, to paste in **Home Assistant's editor** (⋮ › *Edit in
  YAML*) if you would rather finish it there.
- **Start over** forgets the draft.

## Playing it in the sandbox

**Play it in the sandbox** opens the [sandbox](sandbox.md) with the draft added to the copy of
your home as an automation of its own, switched on, beside your automations: they all play the
day, so the draft's effect on them, and theirs on it, show. Its wires are drawn on the plan, as
the [automation wires](automations.md) are, and pulse when it runs.

The sandbox's bar says it is a draft and what it did on the day played; its report puts it
first: its runs and what each action changed, or why it never ran, and what it worked against.
Pick other days in **The day** (a weekend, a rainy day, someone home all day): each day played is
kept with what the draft did, the latest ten; what you do by hand in the sandbox is that day's,
played again. **Back to the draft** goes back to the dialog, which lists them.

## Saving it

**Save** is offered once Home Assistant finds nothing wrong, every name is one Home Assistant
has, and the draft, as it is now, was played in the sandbox at least once. DomoTwin saves it as
Home Assistant's editor does, through its configuration API (`POST
/api/config/automation/config/<id>`, a new id from the time), switched on: Home Assistant checks
it again, writes it in `automations.yaml` and loads it. Its description is your request, with
each change you asked. When Home Assistant refuses, its words are shown and nothing is saved.

Then **Open in Home Assistant's editor** opens it there. The [configuration
history](config-history.md) keeps each change of it from then on.

## Privacy

- DomoTwin sends nothing anywhere itself: it hands your request and the names above to Home
  Assistant's AI task, which you set up and chose.
- The draft is kept in the page while the panel is open, across the sandbox and back, and gone
  when the page is closed. DomoTwin stores nothing of it, and nothing of it is in the integration
  or the diagnostics.
