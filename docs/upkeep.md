# Upkeep cards

Every appliance and piece of furniture can carry what is needed to look after it: who made it, its
model and serial number, when it was installed, when its warranty ends, its manual, notes, and the
tasks that come back (change a filter every 3 months, descale every 2 months). The 3D view shows
what is due.

![The upkeep layer of the demo apartment: the washing machine red (its filter is late), the fridge amber (its coils are due soon), the fan and the hob green, and the list of tasks by date with Done buttons](figures/screenshot-upkeep.png)

## A piece's card

A long press on a piece opens its card:

- on a linked piece, under its controls;
- on a piece linked to nothing, in a sheet of its own, with a button to its room's panel. Without a
  card, only administrators get this sheet (to write one); others still get the room's panel.

The card shows the make, model and serial number, the install date, the warranty's end (and how
many days are left when it ends within 30 days), the expected service life, a link to the manual
and the notes. Each task says how often it is done, when it is next due and when it was last
done, with a **Done** button for everyone.

Administrators write the card with **Add an upkeep card**, then change it with **Edit**:

- **Manual**: a path of Home Assistant (`/local/manuals/washer.pdf`, a file under `<config>/www/`)
  or a web address. DomoTwin never opens or fetches it itself; the browser does when you tap it.
- **Tasks**: a name, every so many days (up to 3 650) or months (up to 120), and when it was last
  done. Up to 20 tasks a card.

## When a task is due

- A task is next due an interval after it was last done. Never done, it counts from the install
  date; neither known, it is due now.
- A month after the 31st is the last day of a shorter month: a task done on 31 January every month
  is next due on 28 February (29 in a leap year).
- It is **due soon** from 14 days before (set another lead in the upkeep list, 0 to 365 days), and
  **overdue** the day after.
- Days are counted where the home is: Home Assistant's time zone.

## In the 3D view

- **Badges**: a wrench on a piece with a task due soon (amber) or overdue (red), a shield on one
  whose warranty ends within 30 days. They join the devices' badges, two at most a piece, the most
  urgent first. A tap on them opens the piece's card.
- **The upkeep layer** (layer menu, **Upkeep**) tints the pieces with tasks: green when all are
  fine, amber when one is due soon, red when one is overdue. Its list shows every task of the
  storey by date, the late first, with **Done**, and the warranties ending soon. A tap on a line
  frames its piece.

## From an IFC file

Importing an IFC file fills the cards of its pieces from what it says, in the standard property
sets (on the piece or on its type):

| Card            | Read from                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------- |
| Make            | `Pset_ManufacturerTypeInformation.Manufacturer`                                              |
| Model           | `Pset_ManufacturerTypeInformation.ModelLabel`, else `.ModelReference`                        |
| Serial number   | `Pset_ManufacturerOccurrence.SerialNumber`                                                   |
| Installed       | an `InstallationDate` property, else the `IncorporationDate` of its `IfcAsset`, else `Pset_ManufacturerOccurrence.AcquisitionDate` |
| Warranty until  | `Pset_Warranty.WarrantyEndDate`, else `.WarrantyStartDate` plus `.WarrantyPeriod`            |
| Service life    | `Pset_ServiceLife.ServiceLifeDuration`, in years                                             |

IFC4 dates and durations (`P2Y`) and IFC2x3's (a calendar date, a period in seconds) are read. What
a card already says stays: the file only fills what it lacks, and never touches the tasks.

## For automations

The integration adds one entity, `sensor.domotwin_upkeep_due`: the number of tasks due soon or
overdue. Its `tasks` attribute lists them, the soonest first (50 at most), each with `piece` (its
id), `piece_name`, `task`, `due` (`YYYY-MM-DD`) and `state` (`due` or `overdue`). It changes when a
card does and when the day does, just after midnight. A notification when something falls due:

```yaml
triggers:
  - trigger: numeric_state
    entity_id: sensor.domotwin_upkeep_due
    above: 0
actions:
  - action: notify.notify
    data:
      message: >
        {{ state_attr('sensor.domotwin_upkeep_due', 'tasks')
           | map(attribute='task') | join(', ') }}
```

## Where the cards are kept

In the integration's storage (`.storage/domotwin.data`, `upkeep`), by piece id, as the bindings
are: not in the plan. Exporting a plan from the panel offers its pieces' cards as a file of their
own, `<plan>.upkeep.json`:

```json
{
  "format": "domotwin-upkeep",
  "version": 1,
  "lead_days": 14,
  "pieces": {
    "washer": {
      "make": "Fictional Appliances",
      "model": "W-100",
      "installed": "2024-03-15",
      "warranty_end": "2026-11-10",
      "tasks": [
        { "id": "filter", "name": "Clean the filter", "every": 3, "unit": "months", "last_done": "2026-07-20" }
      ]
    }
  }
}
```

Diagnostics count the cards and tasks; they never include makes, serial numbers, links or notes.

## Who does what

Everyone sees the cards and marks tasks done. Administrators write, change and remove cards, and
set the lead.

See `DECISIONS.md`, D-033, for the reasons behind these choices.
