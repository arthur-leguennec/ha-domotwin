# Looks

DomoTwin draws your home in one of five looks. All five show the same live home: lights, covers,
layers, devices, people and alerts work the same way in each.

![The demo apartment in the evening, in the neon, blueprint and day looks](figures/screenshot-looks.png)

- **Neon**: the home at dusk. It stands in a deep violet on a ground of dots fading into the dark;
  the tops of its walls are lit strips in the accent colour (amber unless you choose another), the
  furniture keeps its colours under a violet light, and lamps and screens shine.
- **Blueprint**: white lines on blue, like an architect's drawing in 3D.
- **Day**: the home as it is, its furniture, floors and paint, in the light of the time of day
  (morning, day, evening, night) with the sun's shadows. It stands on a ground that dims at night.
- **Cartoon**: flat bright colours in two steps of sunlight, black ink around the walls, the
  furniture and the people, under a blue sky on a lawn. It follows the time of day.
- **Clay model**: the home as an architect's model in matte clay, every piece the same warm colour,
  in soft light with the sun's shadows. Lamps still glow at night. It follows the time of day.

![The demo apartment in the day, in the cartoon and clay looks](figures/screenshot-cartoon-clay.png)

**Automatic**, the default, shows neon when Home Assistant is in dark mode, and day otherwise.

The 2D plan follows the look too: glowing wall outlines on violet floors in neon, white walls on blue
in blueprint, thick dark walls on bright floors in cartoon, and the same clay throughout in the clay
model.

![The neon look in the panel: the home at dusk, the tops of its walls lit in amber, the rooms' names on their floors, lamps on in the living room and the kitchen](figures/screenshot-neon.png)

## Choosing

- **For the home**: in the panel, the cog opens the settings. **Look** and **Accent colour** apply
  to the panel and to every card that does not choose its own. The view changes as you choose;
  **Save** keeps the choice and **Cancel** goes back.
- **For a card**: the visual editor's **Look** and **Accent colour**, or in YAML:

```yaml
type: custom:domotwin-card
theme: neon        # auto, day, neon, blueprint, cartoon or clay; absent: the home's look
accent: "#ff2d95"  # the accent colour; absent: the home's, else the look's own
names: true        # the rooms' names on their floors (true by default)
small_rooms: false # closets' and small rooms' names too (false by default)
```

The accent tints neon's wall tops and dots, and the buttons of the view in neon. Each look has its
own: amber in neon, cyan in the others. In the settings, **Default** goes back to the look's own.

## What makes them

- **Outlines**: the tops and corners of the walls, the frames of doors and windows and the
  outlines of the floors are drawn as lines a few pixels wide, whatever the zoom, lowered with the
  walls when they are cut away. In day they are thin and dark; in blueprint they glow; in neon,
  the level ones glow as lit strips (the tops of the walls, the floors' outlines, the heads and
  sills of doors and windows) and the upright ones are left out;
  in cartoon they are thick black ink; in the clay model, faint.
- **Glass walls** (blueprint): you see into every room from any angle, and a tap goes
  through a wall to what is behind it. The tops of the walls stay solid.
- **Bloom**: lamps that are on, their halos, screens, outlines and the grid glow. It is drawn on
  GPUs that can afford it: from the Balanced quality for neon and blueprint, on High for day,
  cartoon and clay. On the Eco quality (old tablets) the looks are drawn without it, and still look
  the same otherwise.
- **Ink** (cartoon): besides the home's outlines, whatever stands in front of what is behind it
  (a sofa on the floor, a person, the home on the lawn) is inked along its edge. The ink is found
  in the depth of what is opaque, before glass, outlines, halos and wires are drawn over it, from
  the Balanced quality up, the same at any zoom and in the 2D plan. On Eco the cartoon keeps its outlines and a darker rim on curved pieces.
- **Pieces**: plants are drawn leaf by leaf, each leaf a folded blade seen from above and below;
  sofas, beds, cushions and the tops of tables have round edges that catch the light. They cost no
  more triangles than the boxes and balls they replaced (`docs/DECISIONS.md`, D-048).
- **The rooms' names** stand on their floors, well inside them (in an arm of an L-shaped room). A
  layer's values take their place while the layer is shown.

The view's buttons, menus and panels, and the panel's header and dialogs, take the look's colours
whatever the dashboard's theme: dark in neon and blueprint, light in cartoon and the clay model.
Day follows the dashboard.

## For developers

- `crates/domotwin-core/src/theme.rs`: the looks as data (colours, glass walls, outlines and how
  much of them rises, the ground's grid or dots, bloom, palette, light, bands, vividness, ink).
- `crates/domotwin-core/src/scene/mesh.rs`: the shapes the pieces are made of, among them the
  soft box (round edges) and the blade (a leaf); `scene/furniture.rs`: the pieces.
- `crates/domotwin-core/src/scene/lines.rs` and `scene/structure.rs`: the outlines of the home,
  built from the walls' layout.
- `crates/domotwin-render`: the background pass (sky, ground, grid), the glass walls pass, the
  lines, and the offscreen picture with MSAA, its bloom and the cartoon's ink from its depth
  (`docs/DECISIONS.md`, D-027 and D-036).
- The engine's `setTheme(look, accent)` and `roomLabels()`; the view's `look` attribute and
  `lookStyles` (`frontend/src/components/styles.ts`).
