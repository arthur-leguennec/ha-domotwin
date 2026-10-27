# History as reports

"When was the bedroom above 24 °C for more than an hour this week?" Home Assistant records what
every device did; its History page draws it as graphs and its Logbook lists it. DomoTwin reads the
same records as a table you can filter by value and by how long, search, and take away as CSV
(`DECISIONS.md`, D-058). It only reads: nothing is changed, kept or sent anywhere.

## Opening a report

- **A device**: long-press it on the plan; its sheet has **History**, a report of its entities (a
  lamp and its power sensor, a door's contact, lock and battery).
- **A room**: long-press its floor; when its area has air sensors (temperature, humidity, CO₂, fine
  particles), its panel has **History**, a report of them, temperature first.

In the report, **Add an entity** finds any other one (every word of its name, its id or its area's
name, accents and case aside), and the cross of each takes it away: eight at most. What is in a
private room you may not see is not offered, and leaves an open report when its room turns
private ([private rooms](privacy.md)).

## The period

The last 24 hours, 7 days, 30 days or year, or **Choose the dates**: from and to, where the home
is (Home Assistant's time zone). Not in the future.

Home Assistant keeps each change for 10 days unless its recorder is set otherwise
(`purge_keep_days`), and its hourly statistics for good. So *each change* and the *logbook* read
31 days at most, and the report says when the period goes further back than 10 days; *each hour*
reads a year or more.

## Three ways to read it

- **Each change**: a row each time an entity changed, with when, until when and how long it lasted;
  the last one until *now*. The latest first.
- **Each hour**: a row for each hour that ended. For a measurement with statistics (a sensor with
  a `state_class`), Home Assistant's own: the mean, with the lowest and the highest of the hour;
  for a meter, what it counted in the hour. For anything else, worked out from its changes (31
  days of them at most, as far back as Home Assistant keeps them, and the report says so): the
  mean of a number over the hour (weighted by time), or the state held longest and for how long
  ("On, 42 min").
- **Logbook**: Home Assistant's logbook for these entities, with what caused each change: an
  automation or a script by name, a person, an entity, an action. The search finds every word in
  the state (as Home Assistant shows it and as stored), the message, the name and the cause:
  "locked goodnight", "off Alex". Home Assistant leaves measurements (sensors with a unit) out of
  its logbook; the report says so.

## Filtering by value and by how long

- **Value**: above, below, equal to or not equal to a value. Numbers are compared as numbers;
  other states as stored (`on`) or as Home Assistant shows them (*On*, *Allumé*), accents and case
  aside. With several entities, **Of** says whose rows the value filters (the first one unless
  you choose), or all of them.
- **For at least**: minutes or hours.

With a value, rows in a row that match make one **period**: from, to, how long, and the lowest
and highest value in it. "The bedroom above 24 °C for more than an hour" is the bedroom's
temperature, **Above** 24, **For at least** 1 hour: each time it stayed above 24 °C that long, and
how long in all. Without a value, **For at least** keeps the changes (or hours) that lasted that
long: the front door **Equal to** `on`, **For at least** 10 minutes is every time it stayed open.

## CSV

**Download CSV** saves every row the filter keeps (not only the 500 the table shows), oldest
first. The columns stay the same in every language, the times are in UTC (ISO 8601), as in Home
Assistant's own export:

| Column | |
| --- | --- |
| `entity_id`, `name` | the entity, and its name |
| `start`, `end`, `duration_s` | the row's time, and how long it lasted (seconds) |
| `state` | the state as stored (`on`, `21.5`); of a period, when it kept one |
| `held_s` | for an hour of a state: how long it was held (seconds) |
| `mean`, `min`, `max` | of an hour or a period of numbers (a point, four decimals at most) |
| `change` | what a meter counted in the hour |
| `unit` | the entity's unit |

The logbook's CSV has `when`, `entity_id`, `name`, `state`, `message` and `caused_by`. A cell a
spreadsheet would read as a formula starts with `'`.

Where the companion app does not download files, **Copy** puts the same text on the clipboard;
where the clipboard is refused too, the text is shown selected, to copy by hand.

**Home Assistant's History** (or **Logbook**) opens Home Assistant's own page on the same entities
and period, for its graphs.

## Who sees what

Every user: Home Assistant gives its history, statistics and logbook to anyone signed in. In the
demo house, the history is its day, the same every day back ten days: what you change in it is
not in its history, only in its logbook, since it opened ([why?](why.md)). The sandbox has no **History**: its day has a report of its own
([the sandbox](sandbox.md)).
