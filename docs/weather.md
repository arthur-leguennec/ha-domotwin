# The weather around the home

DomoTwin draws the weather of a Home Assistant `weather` entity around the home in 3D: rain,
snow, hail, fog, a grey sky and a storm's flashes. It falls **around** an apartment, never inside
it, and **on the roof** of a house whose roof is shown. Nothing is fetched: the weather is the one
Home Assistant already has.

## What is drawn

| Home Assistant's condition | What DomoTwin draws |
| --- | --- |
| `sunny`, `clear-night` | Nothing: the home as it is. |
| `partlycloudy`, `cloudy`, `windy`, `windy-variant`, `exceptional` | A greyer sky and a dimmer sun, more so as the clouds thicken. Nothing falls. |
| `fog` | A veil over the home, thicker around it, where the ground fades into the sky. |
| `rainy`, `pouring` | Rain in streaks, splashing where it lands; more of it when it pours. |
| `lightning`, `lightning-rainy` | The storm's flashes, every few seconds; rain too with `lightning-rainy`. |
| `snowy` | Snow in flakes, drifting down slowly. |
| `snowy-rainy` | Rain and snow together. |
| `hail` | Hard, fast grains. |

- **The wind** slants what falls the way it blows, from the entity's `wind_speed` (in its
  `wind_speed_unit`, Beaufort too) and `wind_bearing` (a number of degrees or a point of the
  compass such as `SW`), turned with the
  home's north (the **Settings**' north). Strong winds slant it no more than a fixed amount, so
  that it stays around the home.
- **On a house**, rain runs off the eaves too. **In an apartment** or a house whose roof is hidden,
  nothing falls where the home is seen, so that it falls outside its walls.
- **The demo house** has its own fictional weather: a fine day that clouds over after lunch, a
  shower and a storm around three, and a clear night.
- **Walking through the home**, what falls outside shows through the windows.
- The light of the looks that follow the time of day greys under the clouds; the night looks
  (neon, blueprint) keep their own light, and the weather falls over it in a pale tint.
- **In 2D** (the plan view) nothing is drawn.

## Choosing the entity

DomoTwin follows the same weather as the Home tab: `weather.home` when there is one, else the
first `weather` entity that says something. To choose another one, open the panel's **⋮** menu,
**Settings**, **The weather around the home**:

- **Automatic** follows the usual entity (its name is shown);
- one of your `weather` entities;
- **None** draws no weather at all, in the panel and in every card.

The choice is shown as soon as it is picked, and kept on **Save**. When the entity chosen is
unavailable or unknown, nothing is drawn until it says something again; on **Automatic**, the next
`weather` entity that says something is drawn meanwhile.

## Turning it off on one card

The card's `weather` option (**The weather around the home** in the card's editor) is on unless
turned off:

```yaml
type: custom:domotwin-card
weather: false
```

A wall screen that should stay still, or a card that shows the home small, may do without it.

## On slow devices

- What falls is drawn by the graphics card, a few thousand particles at most, fewer on the
  **Eco** quality: about 1 200 raindrops on Eco, 3 000 on Balanced, 6 000 on High when it pours.
- While something falls or a storm flashes, the view is drawn at the layers' slower pace (24
  frames a second), and not at all while the page is hidden. Clouds and fog are still: once drawn,
  nothing more.
- With **reduce motion** turned on in the system, what falls holds still (a picture of the rain)
  and the storm does not flash.

Measurements are in [`PERFORMANCE.md`](PERFORMANCE.md) (M40).
