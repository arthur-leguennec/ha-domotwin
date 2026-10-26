#!/usr/bin/env node
// Screenshots of the fictional demo apartment for the docs: docs/figures/screenshot-*.png.
//   scripts/build.sh && node scripts/screenshots.mjs   (needs `npm ci` in frontend/)
// Software WebGL2 (SwiftShader), High quality, so the pictures are the same on every machine.
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "frontend", "package.json"));
const { chromium } = require("@playwright/test");

const server = spawn(
  process.execPath,
  [join(root, "frontend", "e2e", "serve.mjs")],
  {
    stdio: "ignore",
  },
);
try {
  for (let i = 0; i < 50; i += 1) {
    const ok = await fetch("http://127.0.0.1:4173/health").then(
      (response) => response.ok,
      () => false,
    );
    if (ok) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  const browser = await chromium.launch({
    args: [
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
    ],
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 860 },
    deviceScaleFactor: 2,
  });
  await page.goto("http://127.0.0.1:4173/?mode=panel");
  await page.waitForFunction(
    () => window.__view?.()?.debugState().summary,
    null,
    {
      timeout: 60_000,
    },
  );
  const shots = [
    ["screenshot-3d.png", "view.overview()"],
    ["screenshot-plan.png", "view.setPlanView(true)"],
  ];
  for (const [name, action] of shots) {
    const png = await page.evaluate(async (action) => {
      const view = window.__view();
      view.options = {
        quality: "high",
        view: "3d",
        cutaway: "auto",
        lighting: "day",
      };
      await view.updateComplete;
      new Function("view", action)(view);
      return view.captureFrame();
    }, action);
    const out = join(root, "docs", "figures", name);
    await import("node:fs/promises").then((fs) =>
      fs.writeFile(out, Buffer.from(png.slice(png.indexOf(",") + 1), "base64")),
    );
    console.log(`docs/figures/${name}`);
  }
  // The four moods of the day, side by side.
  const moods = await page.evaluate(async () => {
    const view = window.__view();
    view.setPlanView(false);
    const labels = {
      morning: "Morning",
      day: "Day",
      evening: "Evening",
      night: "Night",
    };
    const shots = [];
    for (const mood of Object.keys(labels)) {
      view.options = {
        quality: "high",
        view: "3d",
        cutaway: "auto",
        lighting: mood,
      };
      await view.updateComplete;
      view.overview();
      const image = new Image();
      image.src = view.captureFrame();
      await image.decode();
      shots.push([labels[mood], image]);
    }
    const w = 1280;
    const crop = { x: 160, y: 40, w: 960, h: 760 };
    const canvas = document.createElement("canvas");
    canvas.width = crop.w * 2 + 30;
    canvas.height = crop.h * 2 + 30;
    const g = canvas.getContext("2d");
    g.fillStyle = "#f1f5f9";
    g.fillRect(0, 0, canvas.width, canvas.height);
    shots.forEach(([label, image], i) => {
      const x = 10 + (i % 2) * (crop.w + 10);
      const y = 10 + Math.floor(i / 2) * (crop.h + 10);
      const sx = image.width / w;
      g.drawImage(
        image,
        crop.x * sx,
        crop.y * sx,
        crop.w * sx,
        crop.h * sx,
        x,
        y,
        crop.w,
        crop.h,
      );
      g.fillStyle = "rgba(255,255,255,0.88)";
      g.beginPath();
      g.roundRect(x + 20, y + 20, 200, 56, 28);
      g.fill();
      g.fillStyle = "#0f172a";
      g.font = "600 30px Inter, sans-serif";
      g.fillText(label, x + 44, y + 59);
    });
    return canvas.toDataURL("image/png");
  });
  await import("node:fs/promises").then((fs) =>
    fs.writeFile(
      join(root, "docs", "figures", "screenshot-moods.png"),
      Buffer.from(moods.slice(moods.indexOf(",") + 1), "base64"),
    ),
  );
  console.log("docs/figures/screenshot-moods.png");

  // Live control (M2), with the demo home's states: the panels over the scene, in the evening.
  const live = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  await live.goto("http://127.0.0.1:4173/?mode=panel&live=1");
  await live.waitForFunction(() => window.__view?.()?.debugState().summary, null, {
    timeout: 60_000,
  });
  await live.evaluate(async () => {
    const view = window.__view();
    view.options = { quality: "high", view: "3d", cutaway: "auto", lighting: "evening" };
    await view.updateComplete;
    view.showElement("living");
    view.settle();
  });
  const stage = await live.locator("domotwin-view .stage").boundingBox();
  const pointOn = (id) =>
    live.evaluate(
      ({ id, box }) => {
        const view = window.__view();
        const c = view.elementPoint(id);
        for (let r = 0; r <= 24; r += 3)
          for (let dy = -r; dy <= r; dy += 3)
            for (let dx = -r; dx <= r; dx += 3)
              if (view.elementAt(c.x + dx, c.y + dy)?.id === id)
                return [box.x + c.x + dx, box.y + c.y + dy];
        return [box.x + c.x, box.y + c.y];
      },
      { id, box: stage },
    );
  const longPress = async (id) => {
    const [x, y] = await pointOn(id);
    await live.mouse.move(x, y);
    await live.mouse.down();
    await live.waitForTimeout(700);
    await live.mouse.up();
    await live.waitForTimeout(300);
    await live.evaluate(() => window.__view().settle());
  };
  const pictures = [];
  await longPress("floor-lamp");
  pictures.push(await live.screenshot());
  await live.keyboard.press("Escape");
  await longPress("living");
  pictures.push(await live.screenshot());
  await live.keyboard.press("Escape");
  await live.getByTestId("link-mode").click();
  const [lx, ly] = await pointOn("table-lamp");
  await live.mouse.click(lx, ly);
  await live.waitForTimeout(300);
  await live.evaluate(() => window.__view().settle());
  const fs = await import("node:fs/promises");
  await fs.writeFile(join(root, "docs", "figures", "screenshot-link.png"), await live.screenshot());
  console.log("docs/figures/screenshot-link.png");
  const pair = await live.evaluate(async (images) => {
    const decoded = await Promise.all(
      images.map(async (base64) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        return image;
      }),
    );
    const labels = ["Long press: the lamp's controls", "Long press on the floor: the room"];
    const canvas = document.createElement("canvas");
    const [w, h] = [decoded[0].width, decoded[0].height];
    canvas.width = w * 2 + 30;
    canvas.height = h + 20;
    const g = canvas.getContext("2d");
    g.fillStyle = "#f1f5f9";
    g.fillRect(0, 0, canvas.width, canvas.height);
    decoded.forEach((image, i) => {
      const x = 10 + i * (w + 10);
      g.drawImage(image, x, 10);
      g.fillStyle = "rgba(255,255,255,0.92)";
      g.beginPath();
      g.roundRect(x + 16, 72, 430, 44, 22);
      g.fill();
      g.fillStyle = "#0f172a";
      g.font = "600 22px Inter, sans-serif";
      g.fillText(labels[i], x + 36, 101);
    });
    return canvas.toDataURL("image/png");
  }, pictures.map((png) => png.toString("base64")));
  await fs.writeFile(
    join(root, "docs", "figures", "screenshot-live.png"),
    Buffer.from(pair.slice(pair.indexOf(",") + 1), "base64"),
  );
  console.log("docs/figures/screenshot-live.png");

  // IFC import (M1b): the storey picker of a two-storey file, and a fictional apartment imported.
  const ifc = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  await ifc.goto("http://127.0.0.1:4173/?mode=panel&plan=none");
  await ifc.waitForFunction(() => window.__element !== undefined);
  const pick = async (file) => {
    const chooser = ifc.waitForEvent("filechooser");
    await ifc.getByRole("button", { name: "Import plan" }).first().click();
    await (await chooser).setFiles(join(root, file));
  };
  await pick("crates/domotwin-import/tests/fixtures/house-ifc2x3.ifc");
  await ifc.getByTestId("import-storeys").waitFor();
  const picker = await ifc.screenshot();
  await ifc.getByRole("button", { name: "Cancel" }).click();
  await pick("examples/demo-apartment.ifc");
  await ifc.waitForFunction(() => window.__view?.()?.debugState().summary?.rooms === 6, null, {
    timeout: 60_000,
  });
  const imported = await ifc.evaluate(async () => {
    const view = window.__view();
    view.options = { quality: "high", view: "3d", cutaway: "auto", lighting: "day" };
    await view.updateComplete;
    view.overview();
    return view.captureFrame();
  });
  const ifcPair = await ifc.evaluate(
    async ([left, right]) => {
      const decode = async (src) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        return image;
      };
      const a = await decode(`data:image/png;base64,${left}`);
      const b = await decode(right);
      const canvas = document.createElement("canvas");
      canvas.width = a.width * 2 + 30;
      canvas.height = a.height + 20;
      const g = canvas.getContext("2d");
      g.fillStyle = "#f1f5f9";
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.drawImage(a, 10, 10);
      g.fillStyle = "#ffffff";
      g.fillRect(a.width + 20, 10, a.width, a.height);
      const scale = Math.min(a.width / b.width, a.height / b.height);
      g.drawImage(
        b,
        a.width + 20 + (a.width - b.width * scale) / 2,
        10 + (a.height - b.height * scale) / 2,
        b.width * scale,
        b.height * scale,
      );
      const labels = ["An IFC file: pick the storey", "Imported: rooms, doors, windows, furniture"];
      labels.forEach((label, i) => {
        const x = 10 + i * (a.width + 10);
        g.fillStyle = "rgba(255,255,255,0.92)";
        g.beginPath();
        g.roundRect(x + 16, 72, 470, 44, 22);
        g.fill();
        g.fillStyle = "#0f172a";
        g.font = "600 22px Inter, sans-serif";
        g.fillText(label, x + 36, 101);
      });
      return canvas.toDataURL("image/png");
    },
    [picker.toString("base64"), imported],
  );
  await fs.writeFile(
    join(root, "docs", "figures", "screenshot-ifc.png"),
    Buffer.from(ifcPair.slice(ifcPair.indexOf(",") + 1), "base64"),
  );
  console.log("docs/figures/screenshot-ifc.png");

  // Plans of other apps (M11): a Sweet Home 3D home, a DXF drawing and a room scan, imported.
  const others = [];
  for (const [file, label, rooms, picked] of [
    ["cottage.sh3d", "A Sweet Home 3D home", 4, true],
    ["studio.dxf", "A DXF drawing", 2, false],
    ["scan.usdz", "A room scan (RoomPlan)", 1, false],
  ]) {
    await ifc.goto("http://127.0.0.1:4173/?mode=panel&plan=none");
    await ifc.waitForFunction(() => window.__element !== undefined);
    await pick(`crates/domotwin-import/tests/fixtures/${file}`);
    if (picked) await ifc.getByTestId("import-storeys").locator("button.storey").first().click();
    await ifc.waitForFunction(
      (count) => window.__view?.()?.debugState().summary?.rooms === count,
      rooms,
      { timeout: 60_000 },
    );
    const frame = await ifc.evaluate(async () => {
      const view = window.__view();
      view.options = { quality: "high", view: "3d", cutaway: "auto", lighting: "day" };
      await view.updateComplete;
      view.overview();
      return view.captureFrame();
    });
    others.push([label, frame]);
  }
  const othersImage = await ifc.evaluate(async (shots) => {
    const images = await Promise.all(
      shots.map(async ([, src]) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        return image;
      }),
    );
    const [w, h] = [620, 440];
    const canvas = document.createElement("canvas");
    canvas.width = shots.length * (w + 10) + 10;
    canvas.height = h + 20;
    const g = canvas.getContext("2d");
    g.fillStyle = "#f1f5f9";
    g.fillRect(0, 0, canvas.width, canvas.height);
    images.forEach((image, i) => {
      const x = 10 + i * (w + 10);
      g.fillStyle = "#ffffff";
      g.fillRect(x, 10, w, h);
      const scale = Math.min(w / image.width, h / image.height);
      g.drawImage(
        image,
        x + (w - image.width * scale) / 2,
        10 + (h - image.height * scale) / 2,
        image.width * scale,
        image.height * scale,
      );
      g.fillStyle = "rgba(255,255,255,0.92)";
      g.beginPath();
      g.roundRect(x + 14, 24, 320, 40, 20);
      g.fill();
      g.fillStyle = "#0f172a";
      g.font = "600 20px Inter, sans-serif";
      g.fillText(shots[i][0], x + 32, 50);
    });
    return canvas.toDataURL("image/png");
  }, others);
  await fs.writeFile(
    join(root, "docs", "figures", "screenshot-imports.png"),
    Buffer.from(othersImage.slice(othersImage.indexOf(",") + 1), "base64"),
  );
  console.log("docs/figures/screenshot-imports.png");

  // Edit mode (M3): a piece dragged on the plan with its guides, and the catalogue.
  const edit = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  await edit.goto("http://127.0.0.1:4173/?mode=panel");
  await edit.waitForFunction(() => window.__view?.()?.debugState().summary, null, {
    timeout: 60_000,
  });
  await edit.evaluate(async () => {
    const view = window.__view();
    view.options = { quality: "high", view: "3d", cutaway: "auto", lighting: "day" };
    await view.updateComplete;
  });
  await edit.getByTestId("toggle-plan").click();
  await edit.evaluate(() => window.__view().settle());
  await edit.getByTestId("edit-mode").click();
  await edit.getByTestId("edit-status").waitFor();
  const editStage = await edit.locator("domotwin-view .stage").boundingBox();
  const [sx, sy] = await edit.evaluate(
    ({ box }) => {
      const view = window.__view();
      const c = view.elementPoint("sofa");
      return [box.x + c.x, box.y + c.y];
    },
    { box: editStage },
  );
  await edit.mouse.click(sx, sy);
  await edit.mouse.move(sx, sy);
  await edit.mouse.down();
  // Down to the wall: it snaps onto the wall face.
  for (let i = 1; i <= 12; i += 1) {
    await edit.mouse.move(sx - i * 0.4, sy + i * 6);
    await edit.evaluate(() => new Promise((done) => requestAnimationFrame(done)));
  }
  await edit.waitForTimeout(200);
  const dragging = await edit.screenshot();
  await edit.mouse.up();
  await edit.getByTestId("toggle-plan").click();
  await edit.evaluate(() => window.__view().settle());
  await edit.getByTestId("edit-add").click();
  await edit.getByTestId("catalogue").waitFor();
  await edit.waitForTimeout(200);
  const adding = await edit.screenshot();
  const editPair = await edit.evaluate(
    async (images) => {
      const decoded = await Promise.all(
        images.map(async (base64) => {
          const image = new Image();
          image.src = `data:image/png;base64,${base64}`;
          await image.decode();
          return image;
        }),
      );
      const labels = ["Drag: snapping and distances to the walls", "Add a piece from the catalogue"];
      const [w, h] = [decoded[0].width, decoded[0].height];
      const canvas = document.createElement("canvas");
      canvas.width = w * 2 + 30;
      canvas.height = h + 20;
      const g = canvas.getContext("2d");
      g.fillStyle = "#f1f5f9";
      g.fillRect(0, 0, canvas.width, canvas.height);
      decoded.forEach((image, i) => {
        const x = 10 + i * (w + 10);
        g.drawImage(image, x, 10);
        g.fillStyle = "rgba(255,255,255,0.92)";
        g.beginPath();
        g.roundRect(x + 16, 82, 470, 44, 22);
        g.fill();
        g.fillStyle = "#0f172a";
        g.font = "600 22px Inter, sans-serif";
        g.fillText(labels[i], x + 36, 111);
      });
      return canvas.toDataURL("image/png");
    },
    [dragging, adding].map((png) => png.toString("base64")),
  );
  await fs.writeFile(
    join(root, "docs", "figures", "screenshot-edit.png"),
    Buffer.from(editPair.slice(editPair.indexOf(",") + 1), "base64"),
  );
  console.log("docs/figures/screenshot-edit.png");

  // Your own 3D models (M3b): bar stools drawn from a GLB file, and the import of a glTF lamp.
  const models = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  await models.goto("http://127.0.0.1:4173/?mode=panel&models=1");
  await models.waitForFunction(() => window.__view?.()?.debugState().models?.drawMs.length, null, {
    timeout: 60_000,
  });
  await models.evaluate(async () => {
    const view = window.__view();
    view.options = { quality: "high", view: "3d", cutaway: "auto", lighting: "evening" };
    await view.updateComplete;
    view.engine.focusElement("living");
    view.settle();
  });
  await models.waitForTimeout(300);
  const shown = await models.screenshot();
  await models.getByTestId("edit-mode").click();
  await models.getByTestId("edit-status").waitFor();
  await models.getByTestId("edit-add").click();
  const chooser = models.waitForEvent("filechooser");
  await models.getByTestId("catalogue-import-model").click();
  await (await chooser).setFiles(join(root, "examples", "models", "lamp.gltf"));
  await models.getByTestId("model-import-sheet").waitFor();
  await models.waitForTimeout(200);
  const importing = await models.screenshot();
  const modelsPair = await models.evaluate(
    async (images) => {
      const decoded = await Promise.all(
        images.map(async (base64) => {
          const image = new Image();
          image.src = `data:image/png;base64,${base64}`;
          await image.decode();
          return image;
        }),
      );
      const labels = ["Bar stools drawn from a GLB file", "Import a glTF, OBJ, STL or 3MF file"];
      const [w, h] = [decoded[0].width, decoded[0].height];
      const canvas = document.createElement("canvas");
      canvas.width = w * 2 + 30;
      canvas.height = h + 20;
      const g = canvas.getContext("2d");
      g.fillStyle = "#f1f5f9";
      g.fillRect(0, 0, canvas.width, canvas.height);
      decoded.forEach((image, i) => {
        const x = 10 + i * (w + 10);
        g.drawImage(image, x, 10);
        g.fillStyle = "rgba(255,255,255,0.92)";
        g.beginPath();
        g.roundRect(x + 16, 82, 470, 44, 22);
        g.fill();
        g.fillStyle = "#0f172a";
        g.font = "600 22px Inter, sans-serif";
        g.fillText(labels[i], x + 36, 111);
      });
      return canvas.toDataURL("image/png");
    },
    [shown, importing].map((png) => png.toString("base64")),
  );
  await fs.writeFile(
    join(root, "docs", "figures", "screenshot-models.png"),
    Buffer.from(modelsPair.slice(modelsPair.indexOf(",") + 1), "base64"),
  );
  console.log("docs/figures/screenshot-models.png");

  // Layers (M4): the temperature heatmap, the power layer with the home's energy (D-049), a smoke
  // alert and the sun through the windows, with the legend, the values and the banner over the
  // view.
  const layerShots = [];
  for (const [label, query, options, script] of [
    ["Temperature", "", { lighting: "day", layer: "temperature" }, ""],
    ["Power and energy", "&energy=1", { lighting: "evening", layer: "power" }, ""],
    [
      "Smoke alert",
      "",
      { lighting: "day" },
      "window.__setState('binary_sensor.kitchen_smoke', 'on');" +
        "window.__setState('binary_sensor.living_room_motion', 'on');",
    ],
    [
      "Sun through the windows",
      "&sunpos=205,35&north=160",
      { lighting: "day", sun: "real" },
      "window.__setState('cover.living_room_curtains', 'open', { current_position: 100 });",
    ],
  ]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
    await page.goto(`http://127.0.0.1:4173/?mode=panel&live=1${query}`);
    await page.waitForFunction(() => window.__view?.()?.debugState().summary, null, {
      timeout: 60_000,
    });
    // States first: the panel gives the view its own options again when Home Assistant updates.
    await page.evaluate((script) => new Function(script)(), script);
    await page.waitForTimeout(200);
    await page.evaluate(
      async ([options]) => {
        const view = window.__view();
        view.options = { quality: "high", view: "3d", cutaway: "auto", ...options };
        await view.updateComplete;
        // Pulses held at their strongest look, so that the picture is the same every time.
        view.engine.setMotion(false);
        view.settle();
        view.requestFrame();
      },
      [options],
    );
    await page.waitForTimeout(500);
    layerShots.push([label, (await page.screenshot()).toString("base64")]);
    await page.close();
  }
  const layersPage = await browser.newPage();
  const layersImage = await layersPage.evaluate(async (shots) => {
    const decoded = await Promise.all(
      shots.map(async ([label, base64]) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        return [label, image];
      }),
    );
    const [w, h] = [decoded[0][1].width, decoded[0][1].height];
    const canvas = document.createElement("canvas");
    canvas.width = w * 2 + 30;
    canvas.height = h * 2 + 30;
    const g = canvas.getContext("2d");
    g.fillStyle = "#f1f5f9";
    g.fillRect(0, 0, canvas.width, canvas.height);
    decoded.forEach(([label, image], i) => {
      const x = 10 + (i % 2) * (w + 10);
      const y = 10 + Math.floor(i / 2) * (h + 10);
      g.drawImage(image, x, y);
      g.font = "600 22px Inter, sans-serif";
      const width = g.measureText(label).width + 40;
      g.fillStyle = "rgba(255,255,255,0.92)";
      g.beginPath();
      g.roundRect(x + w / 2 - width / 2, y + h - 120, width, 44, 22);
      g.fill();
      g.fillStyle = "#0f172a";
      g.fillText(label, x + w / 2 - width / 2 + 20, y + h - 91);
    });
    return canvas.toDataURL("image/png");
  }, layerShots);
  await fs.writeFile(
    join(root, "docs", "figures", "screenshot-layers.png"),
    Buffer.from(layersImage.slice(layersImage.indexOf(",") + 1), "base64"),
  );
  console.log("docs/figures/screenshot-layers.png");

  // The demo house (D-050): its morning, the robot out and the sun charging the battery, and
  // its evening, the lamps on and the family at home.
  const demoShots = [];
  for (const [label, minute, options] of [
    ["Morning: the robot cleans, the sun charges the battery", 9 * 60 + 5, { layer: "power" }],
    ["Evening: the lamps, the family, the TV", 21 * 60 + 15, {}],
  ]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
    await page.goto("http://127.0.0.1:4173/?mode=panel&plan=none");
    await page.locator("domotwin-panel").getByTestId("demo-try").click();
    await page.waitForFunction(() => window.__view?.()?.debugState().summary?.name === "Demo house", null, {
      timeout: 60_000,
    });
    await page.evaluate((minute) => {
      const demo = window.__element.demo;
      demo.play(false);
      demo.jump(minute);
    }, minute);
    // The moment's states first: the panel gives the view its own options again when they come.
    await page.waitForTimeout(500);
    await page.evaluate(async (options) => {
      const view = window.__view();
      view.options = { ...view.options, quality: "high", view: "3d", cutaway: "auto", ...options };
      await view.updateComplete;
      // At rest, the robot in the room it cleans, so that the picture is the same every time.
      view.engine.setMotion(false);
      view.settle();
      view.requestFrame();
    }, options);
    await page.waitForTimeout(1500);
    demoShots.push([label, (await page.screenshot()).toString("base64")]);
    await page.close();
  }
  const demoPage = await browser.newPage();
  const demoImage = await demoPage.evaluate(async (shots) => {
    const decoded = await Promise.all(
      shots.map(async ([label, base64]) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        return [label, image];
      }),
    );
    const [w, h] = [decoded[0][1].width, decoded[0][1].height];
    const canvas = document.createElement("canvas");
    canvas.width = w * 2 + 30;
    canvas.height = h + 20;
    const g = canvas.getContext("2d");
    g.fillStyle = "#f1f5f9";
    g.fillRect(0, 0, canvas.width, canvas.height);
    decoded.forEach(([label, image], i) => {
      const x = 10 + i * (w + 10);
      const y = 10;
      g.drawImage(image, x, y);
      g.font = "600 22px Inter, sans-serif";
      const width = g.measureText(label).width + 40;
      g.fillStyle = "rgba(255,255,255,0.92)";
      g.beginPath();
      // Under the demo bar: the energy card is at the bottom.
      g.roundRect(x + w / 2 - width / 2, y + 112, width, 44, 22);
      g.fill();
      g.fillStyle = "#0f172a";
      g.fillText(label, x + w / 2 - width / 2 + 20, y + 141);
    });
    return canvas.toDataURL("image/png");
  }, demoShots);
  await fs.writeFile(
    join(root, "docs", "figures", "screenshot-demo.png"),
    Buffer.from(demoImage.slice(demoImage.indexOf(",") + 1), "base64"),
  );
  console.log("docs/figures/screenshot-demo.png");

  // Devices (M5): badges in 3D, and what the living room's camera sees on the 2D plan.
  const deviceShots = [];
  for (const [label, view, script, focus = ""] of [
    [
      "Badges: lock, battery, TV, camera, washing machine",
      "3d",
      "window.__setState('lock.entrance_door', 'locked');" +
        "window.__setState('sensor.entrance_door_lock_battery', '12');" +
        "window.__setState('sensor.washing_machine_power', '450');",
    ],
    [
      "What the camera sees, tapped, recording",
      "2d",
      "window.__setState('camera.living_room', 'recording');",
      "bookcase",
    ],
  ]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
    await page.goto("http://127.0.0.1:4173/?mode=panel&live=1");
    await page.waitForFunction(() => window.__view?.()?.debugState().summary, null, {
      timeout: 60_000,
    });
    await page.evaluate((script) => new Function(script)(), script);
    await page.waitForTimeout(200);
    await page.evaluate(async (view) => {
      const element = window.__view();
      element.options = { quality: "high", view, cutaway: "auto", lighting: "day" };
      await element.updateComplete;
      element.settle();
      element.requestFrame();
    }, view);
    // The camera tapped once linked (the bindings come after the plan).
    if (focus) {
      await page.waitForFunction((id) => window.__view().engine.focusCamera(id) > 0, focus);
      await page.evaluate(() => window.__view().requestFrame());
    }
    await page.waitForTimeout(500);
    deviceShots.push([label, (await page.screenshot()).toString("base64")]);
    await page.close();
  }
  const devicesImage = await layersPage.evaluate(async (shots) => {
    const decoded = await Promise.all(
      shots.map(async ([label, base64]) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        return [label, image];
      }),
    );
    const [w, h] = [decoded[0][1].width, decoded[0][1].height];
    const canvas = document.createElement("canvas");
    canvas.width = w * 2 + 30;
    canvas.height = h + 20;
    const g = canvas.getContext("2d");
    g.fillStyle = "#f1f5f9";
    g.fillRect(0, 0, canvas.width, canvas.height);
    decoded.forEach(([label, image], i) => {
      const x = 10 + i * (w + 10);
      g.drawImage(image, x, 10);
      g.font = "600 22px Inter, sans-serif";
      const width = g.measureText(label).width + 40;
      g.fillStyle = "rgba(255,255,255,0.92)";
      g.beginPath();
      g.roundRect(x + w / 2 - width / 2, 10 + h - 120, width, 44, 22);
      g.fill();
      g.fillStyle = "#0f172a";
      g.fillText(label, x + w / 2 - width / 2 + 20, 10 + h - 91);
    });
    return canvas.toDataURL("image/png");
  }, deviceShots);
  await fs.writeFile(
    join(root, "docs", "figures", "screenshot-devices.png"),
    Buffer.from(devicesImage.slice(devicesImage.indexOf(",") + 1), "base64"),
  );
  console.log("docs/figures/screenshot-devices.png");

  // What a camera sees (D-038): the living room in neon, the view faint, then whole once the
  // camera is tapped.
  const cameraShots = [];
  for (const [label, focus] of [
    ["Faint", ""],
    ["Tapped: whole", "bookcase"],
  ]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("http://127.0.0.1:4173/?mode=panel&live=1&people=1&hometheme=neon&sun=45,1");
    await page.waitForFunction(() => window.__view?.()?.debugState().summary, null, {
      timeout: 60_000,
    });
    await page.evaluate(async (id) => {
      const element = window.__view();
      element.options = { ...element.options, quality: "high" };
      await element.updateComplete;
      element.settle();
      element.requestFrame();
    }, focus);
    // Tapped once the camera is linked (the bindings come after the plan).
    if (focus) {
      await page.waitForFunction((id) => window.__view().engine.focusCamera(id) > 0, focus);
      await page.evaluate(() => window.__view().requestFrame());
    }
    await page.waitForTimeout(800);
    const shot = await page.screenshot({ clip: { x: 230, y: 130, width: 560, height: 400 } });
    cameraShots.push([label, shot.toString("base64")]);
    await page.close();
  }
  const cameraImage = await layersPage.evaluate(async (shots) => {
    const decoded = await Promise.all(
      shots.map(async ([label, base64]) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        return [label, image];
      }),
    );
    const [w, h] = [decoded[0][1].width, decoded[0][1].height];
    const canvas = document.createElement("canvas");
    canvas.width = w * 2 + 30;
    canvas.height = h + 20;
    const g = canvas.getContext("2d");
    g.fillStyle = "#0b1220";
    g.fillRect(0, 0, canvas.width, canvas.height);
    decoded.forEach(([label, image], i) => {
      const x = 10 + i * (w + 10);
      g.drawImage(image, x, 10);
      g.font = "600 20px Inter, sans-serif";
      const width = g.measureText(label).width + 36;
      g.fillStyle = "rgba(15,23,42,0.88)";
      g.beginPath();
      g.roundRect(x + w / 2 - width / 2, 26, width, 40, 20);
      g.fill();
      g.fillStyle = "#e2e8f0";
      g.fillText(label, x + w / 2 - width / 2 + 18, 53);
    });
    return canvas.toDataURL("image/png");
  }, cameraShots);
  await fs.writeFile(
    join(root, "docs", "figures", "screenshot-camera-view.png"),
    Buffer.from(cameraImage.slice(cameraImage.indexOf(",") + 1), "base64"),
  );
  console.log("docs/figures/screenshot-camera-view.png");

  // Private rooms (D-039): the living room and the bedroom closed for the administrator viewing,
  // and the panel's settings of the private rooms.
  const privateShots = [];
  for (const [label, dialog] of [
    ["Closed for whoever may not see them", false],
    ["Private rooms, in the panel", true],
  ]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(
      "http://127.0.0.1:4173/?mode=panel&live=1&people=1&private=living,bedroom&privatefor=person.sam",
    );
    await page.waitForFunction(() => window.__view?.()?.debugState().summary, null, {
      timeout: 60_000,
    });
    await page.evaluate(async () => {
      const element = window.__view();
      element.options = { ...element.options, quality: "high", lighting: "day" };
      await element.updateComplete;
    });
    await page.waitForFunction(
      () => window.__view().debugState().stats.closedRooms?.length === 2,
    );
    if (dialog) {
      await page.evaluate(async () => {
        const panel = window.__element;
        panel.shadowRoot.querySelector('[data-testid="more"]').click();
        await panel.updateComplete;
        panel.shadowRoot.querySelector('[data-testid="privacy-settings"]').click();
      });
      await page.waitForFunction(() =>
        window.__element.shadowRoot.querySelector("domotwin-private-rooms"),
      );
    }
    await page.evaluate(() => {
      window.__view().settle();
      window.__view().requestFrame();
    });
    await page.waitForTimeout(600);
    privateShots.push([label, (await page.screenshot()).toString("base64")]);
    await page.close();
  }
  const privateImage = await layersPage.evaluate(async (shots) => {
    const decoded = await Promise.all(
      shots.map(async ([label, base64]) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        return [label, image];
      }),
    );
    const [w, h] = [decoded[0][1].width, decoded[0][1].height];
    const canvas = document.createElement("canvas");
    canvas.width = w * 2 + 30;
    canvas.height = h + 76;
    const g = canvas.getContext("2d");
    g.fillStyle = "#f1f5f9";
    g.fillRect(0, 0, canvas.width, canvas.height);
    decoded.forEach(([label, image], i) => {
      const x = 10 + i * (w + 10);
      g.drawImage(image, x, 10);
      g.font = "600 22px Inter, sans-serif";
      const width = g.measureText(label).width + 40;
      g.fillStyle = "rgba(255,255,255,0.92)";
      g.beginPath();
      // Under the picture: the dialog fills the second one.
      g.roundRect(x + w / 2 - width / 2, 20 + h, width, 44, 22);
      g.fill();
      g.fillStyle = "#0f172a";
      g.fillText(label, x + w / 2 - width / 2 + 20, 49 + h);
    });
    return canvas.toDataURL("image/png");
  }, privateShots);
  await fs.writeFile(
    join(root, "docs", "figures", "screenshot-private.png"),
    Buffer.from(privateImage.slice(privateImage.indexOf(",") + 1), "base64"),
  );
  console.log("docs/figures/screenshot-private.png");

  // The plan editor (M6): a corner of the living room dragged with its guides and lengths, and a
  // new room drawn beside the home.
  const planShots = [];
  for (const [label, draw] of [
    ["A corner dragged, lengths and guides", false],
    ["A room drawn beside the home", true],
  ]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
    await page.goto("http://127.0.0.1:4173/?mode=panel&view=2d");
    await page.waitForFunction(() => window.__view?.()?.debugState().summary, null, {
      timeout: 60_000,
    });
    await page.getByTestId("plan-mode").click();
    await page.locator("domotwin-plan-bar").waitFor();
    await page.evaluate(() => window.__view().settle());
    const box = await page.locator("domotwin-view").locator(".stage").boundingBox();
    if (!draw) {
      const sofa = await page.evaluate(() => window.__view().elementPoint("sofa"));
      await page.mouse.click(box.x + sofa.x, box.y + sofa.y);
      const corner = await page
        .locator("domotwin-view")
        .locator("circle.corner")
        .first()
        .boundingBox();
      const [cx, cy] = [corner.x + corner.width / 2, corner.y + corner.height / 2];
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let i = 1; i <= 10; i += 1) {
        await page.mouse.move(cx - i * 3, cy - i * 2);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      }
    } else {
      await page.locator("domotwin-plan-bar").getByTestId("plan-tool-room").click();
      const [sx, sy] = [box.x + box.width - 250, box.y + 110];
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      for (let i = 1; i <= 10; i += 1) {
        await page.mouse.move(sx + i * 19, sy + i * 16);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      }
    }
    await page.waitForTimeout(300);
    planShots.push([label, (await page.screenshot()).toString("base64")]);
    await page.mouse.up();
    await page.close();
  }
  const planImage = await layersPage.evaluate(async (shots) => {
    const decoded = await Promise.all(
      shots.map(async ([label, base64]) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        return [label, image];
      }),
    );
    const [w, h] = [decoded[0][1].width, decoded[0][1].height];
    const canvas = document.createElement("canvas");
    canvas.width = w * 2 + 30;
    canvas.height = h + 20;
    const g = canvas.getContext("2d");
    g.fillStyle = "#f1f5f9";
    g.fillRect(0, 0, canvas.width, canvas.height);
    decoded.forEach(([label, image], i) => {
      const x = 10 + i * (w + 10);
      g.drawImage(image, x, 10);
      g.font = "600 22px Inter, sans-serif";
      const width = g.measureText(label).width + 40;
      g.fillStyle = "rgba(255,255,255,0.92)";
      g.beginPath();
      g.roundRect(x + w / 2 - width / 2, 10 + h - 190, width, 44, 22);
      g.fill();
      g.fillStyle = "#0f172a";
      g.fillText(label, x + w / 2 - width / 2 + 20, 10 + h - 161);
    });
    return canvas.toDataURL("image/png");
  }, planShots);
  await fs.writeFile(
    join(root, "docs", "figures", "screenshot-plan-editor.png"),
    Buffer.from(planImage.slice(planImage.indexOf(",") + 1), "base64"),
  );
  console.log("docs/figures/screenshot-plan-editor.png");

  // Storeys: the fictional upper floor with its stairs and the switcher, and the storeys dialog.
  const storeyShots = [];
  for (const [label, dialog] of [
    ["The floor above, its stairs and the switcher", false],
    ["The storeys of the home", true],
  ]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
    await page.goto("http://127.0.0.1:4173/?mode=panel&storeys=2&lighting=day");
    await page.waitForFunction(() => window.__view?.()?.debugState().summary, null, {
      timeout: 60_000,
    });
    await page
      .locator("domotwin-view")
      .getByTestId("storeys")
      .locator('[data-storey="storey-2"]')
      .click();
    await page.waitForFunction(() =>
      window.__view().debugState().summary?.name.includes("upper floor"),
    );
    await page.evaluate(() => {
      const view = window.__view();
      view.options = { ...view.options, quality: "high" };
      view.settle();
    });
    if (dialog) await page.getByTestId("storeys-manage").click();
    await page.waitForTimeout(400);
    storeyShots.push([label, (await page.screenshot()).toString("base64")]);
    await page.close();
  }
  const storeyImage = await layersPage.evaluate(async (shots) => {
    const decoded = await Promise.all(
      shots.map(async ([label, base64]) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        return [label, image];
      }),
    );
    const [w, h] = [decoded[0][1].width, decoded[0][1].height];
    const canvas = document.createElement("canvas");
    canvas.width = w * 2 + 30;
    canvas.height = h + 20;
    const g = canvas.getContext("2d");
    g.fillStyle = "#f1f5f9";
    g.fillRect(0, 0, canvas.width, canvas.height);
    decoded.forEach(([label, image], i) => {
      const x = 10 + i * (w + 10);
      g.drawImage(image, x, 10);
      g.font = "600 22px Inter, sans-serif";
      const width = g.measureText(label).width + 40;
      g.fillStyle = "rgba(255,255,255,0.92)";
      g.beginPath();
      g.roundRect(x + w / 2 - width / 2, 10 + 76, width, 44, 22);
      g.fill();
      g.fillStyle = "#0f172a";
      g.fillText(label, x + w / 2 - width / 2 + 20, 10 + 105);
    });
    return canvas.toDataURL("image/png");
  }, storeyShots);
  await fs.writeFile(
    join(root, "docs", "figures", "screenshot-storeys.png"),
    Buffer.from(storeyImage.slice(storeyImage.indexOf(",") + 1), "base64"),
  );
  console.log("docs/figures/screenshot-storeys.png");

  // The looks (D-027): the panel in the evening, its lamps on, in neon (also alone, the README's
  // first picture), blueprint and day.
  const lookShots = [];
  for (const [look, label] of [
    ["neon", "Neon"],
    ["blueprint", "Blueprint"],
    ["day", "Day"],
  ]) {
    const scale = look === "neon" ? 1.5 : 1;
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: scale,
    });
    await page.goto(
      `http://127.0.0.1:4173/?mode=panel&live=1&lighting=evening&hometheme=${look}`,
    );
    await page.waitForFunction(() => window.__view?.()?.debugState().summary, null, {
      timeout: 60_000,
    });
    await page.evaluate(() => {
      const view = window.__view();
      view.options = { ...view.options, quality: "high" };
    });
    await page.waitForFunction(() => window.__view().debugState().quality === "high");
    await page.evaluate(() => window.__view().settle());
    await page.waitForTimeout(600);
    const shot = await page.screenshot();
    if (look === "neon") {
      await fs.writeFile(join(root, "docs", "figures", "screenshot-neon.png"), shot);
      console.log("docs/figures/screenshot-neon.png");
    }
    lookShots.push([label, shot.toString("base64"), scale]);
    await page.close();
  }
  const looksImage = await layersPage.evaluate(async (shots) => {
    const decoded = await Promise.all(
      shots.map(async ([label, base64, scale]) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        return [label, image, scale];
      }),
    );
    const [w, h] = [1280, 800];
    const canvas = document.createElement("canvas");
    canvas.width = w * 3 + 40;
    canvas.height = h + 20;
    const g = canvas.getContext("2d");
    g.fillStyle = "#f1f5f9";
    g.fillRect(0, 0, canvas.width, canvas.height);
    decoded.forEach(([label, image], i) => {
      const x = 10 + i * (w + 10);
      g.drawImage(image, x, 10, w, h);
      g.font = "600 26px Inter, sans-serif";
      const width = g.measureText(label).width + 44;
      g.fillStyle = "rgba(255,255,255,0.92)";
      g.beginPath();
      g.roundRect(x + w / 2 - width / 2, 10 + h - 110, width, 48, 24);
      g.fill();
      g.fillStyle = "#0f172a";
      g.fillText(label, x + w / 2 - width / 2 + 22, 10 + h - 77);
    });
    return canvas.toDataURL("image/png");
  }, lookShots);
  await fs.writeFile(
    join(root, "docs", "figures", "screenshot-looks.png"),
    Buffer.from(looksImage.slice(looksImage.indexOf(",") + 1), "base64"),
  );
  console.log("docs/figures/screenshot-looks.png");

  // Every storey at once (D-028): the panel in the evening, blueprint, both storeys spread apart
  // under their glass roof, with their labels and pictures.
  const homePage = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1.5,
  });
  await homePage.goto(
    "http://127.0.0.1:4173/?mode=panel&live=1&storeys=2&lighting=evening&hometheme=blueprint",
  );
  await homePage.waitForFunction(() => window.__view?.()?.debugState().summary, null, {
    timeout: 60_000,
  });
  await homePage.evaluate(() => {
    const view = window.__view();
    view.options = { ...view.options, quality: "high" };
  });
  await homePage.locator('domotwin-view .storey[data-storey="all"]').click();
  await homePage.waitForFunction(() => window.__view().debugState().stats?.storeys === 2);
  await homePage.locator("domotwin-view").getByTestId("storey-pictures").waitFor();
  await homePage.evaluate(() => window.__view().settle());
  await homePage.waitForTimeout(800);
  await fs.writeFile(
    join(root, "docs", "figures", "screenshot-home.png"),
    await homePage.screenshot(),
  );
  console.log("docs/figures/screenshot-home.png");

  // Walking (D-029): the panel in the evening, the day look, at eye level in the living room.
  const walkPage = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1.5,
  });
  await walkPage.goto(
    "http://127.0.0.1:4173/?mode=panel&live=1&lighting=evening&hometheme=day",
  );
  await walkPage.waitForFunction(() => window.__view?.()?.debugState().summary, null, {
    timeout: 60_000,
  });
  await walkPage.evaluate(() => {
    const view = window.__view();
    view.options = { ...view.options, quality: "high" };
  });
  await walkPage.locator("domotwin-view").getByTestId("walk").click();
  await walkPage.waitForFunction(() => window.__view().debugState().stats?.walking === true);
  await walkPage.evaluate(() => window.__view().settle());
  await walkPage.waitForTimeout(800);
  await fs.writeFile(
    join(root, "docs", "figures", "screenshot-walk.png"),
    await walkPage.screenshot(),
  );
  console.log("docs/figures/screenshot-walk.png");

  // The network map (D-031): the panel, the day look, the mesh with its health, a router tapped.
  const meshPage = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1.5,
  });
  await meshPage.emulateMedia({ reducedMotion: "reduce" });
  await meshPage.goto("http://127.0.0.1:4173/?mode=panel&live=1&zha=1&hometheme=day");
  await meshPage.waitForFunction(() => window.__view?.()?.debugState().summary, null, {
    timeout: 60_000,
  });
  await meshPage.evaluate(() => {
    const view = window.__view();
    view.options = { ...view.options, quality: "high" };
  });
  await meshPage.locator("domotwin-view").getByTestId("layers").click();
  await meshPage.locator('domotwin-view [data-layer="network"]').click();
  await meshPage.locator("domotwin-network .node").first().waitFor();
  await meshPage.locator('domotwin-network .node[data-device="00:12:4b:00:00:00:00:02"]').click();
  await meshPage.evaluate(() => window.__view().settle());
  await meshPage.waitForTimeout(800);
  await fs.writeFile(
    join(root, "docs", "figures", "screenshot-network.png"),
    await meshPage.screenshot(),
  );
  console.log("docs/figures/screenshot-network.png");

  // Automation wires (D-032): the panel, the day look, every automation of the demo apartment.
  const wiresPage = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1.5,
  });
  await wiresPage.emulateMedia({ reducedMotion: "reduce" });
  await wiresPage.goto("http://127.0.0.1:4173/?mode=panel&live=1&automations=1&hometheme=day");
  await wiresPage.waitForFunction(() => window.__view?.()?.debugState().summary, null, {
    timeout: 60_000,
  });
  await wiresPage.evaluate(() => {
    const view = window.__view();
    view.options = { ...view.options, quality: "high" };
  });
  await wiresPage.locator("domotwin-view").getByTestId("layers").click();
  await wiresPage.locator('domotwin-view [data-layer="automations"]').click();
  await wiresPage.locator("domotwin-wires .label").first().waitFor();
  await wiresPage.evaluate(() => window.__view().settle());
  await wiresPage.waitForTimeout(800);
  await fs.writeFile(
    join(root, "docs", "figures", "screenshot-automations.png"),
    await wiresPage.screenshot(),
  );
  console.log("docs/figures/screenshot-automations.png");

  // Upkeep cards (D-033): the panel, the day look, the upkeep layer of the demo apartment on a
  // fixed day, its list beside.
  const upkeepPage = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1.5,
  });
  await upkeepPage.clock.setSystemTime(new Date("2026-10-24T10:00:00"));
  await upkeepPage.emulateMedia({ reducedMotion: "reduce" });
  await upkeepPage.goto("http://127.0.0.1:4173/?mode=panel&live=1&upkeep=1&hometheme=day");
  await upkeepPage.waitForFunction(() => window.__view?.()?.debugState().summary, null, {
    timeout: 60_000,
  });
  await upkeepPage.evaluate(() => {
    const view = window.__view();
    view.options = { ...view.options, quality: "high" };
  });
  await upkeepPage.locator("domotwin-view").getByTestId("layers").click();
  await upkeepPage.locator('domotwin-view [data-layer="upkeep"]').click();
  await upkeepPage.locator("domotwin-upkeep-list li").first().waitFor();
  await upkeepPage.evaluate(() => window.__view().settle());
  await upkeepPage.waitForTimeout(800);
  await fs.writeFile(
    join(root, "docs", "figures", "screenshot-upkeep.png"),
    await upkeepPage.screenshot(),
  );
  console.log("docs/figures/screenshot-upkeep.png");
  // People in their rooms (D-034): the panel, the neon look, the fictional people of the harness
  // in the demo apartment, their names over them.
  const peoplePage = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1.5,
  });
  await peoplePage.emulateMedia({ reducedMotion: "reduce" });
  await peoplePage.goto("http://127.0.0.1:4173/?mode=panel&live=1&people=1&hometheme=neon");
  await peoplePage.waitForFunction(() => window.__view?.()?.debugState().summary, null, {
    timeout: 60_000,
  });
  await peoplePage.evaluate(() => {
    const view = window.__view();
    view.options = { ...view.options, quality: "high" };
  });
  await peoplePage.locator("domotwin-view .person-tag").first().waitFor();
  await peoplePage.evaluate(() => window.__view().settle());
  await peoplePage.waitForTimeout(800);
  await fs.writeFile(
    join(root, "docs", "figures", "screenshot-people.png"),
    await peoplePage.screenshot(),
  );
  console.log("docs/figures/screenshot-people.png");
  // Bluetooth locating (D-035): the panel's settings over the demo apartment in the day look,
  // the fictional receivers and devices of the harness, the devices heard that may be followed.
  const bluetoothPage = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1.5,
  });
  await bluetoothPage.emulateMedia({ reducedMotion: "reduce" });
  await bluetoothPage.goto("http://127.0.0.1:4173/?mode=panel&live=1&people=1&bluetooth=1");
  await bluetoothPage.waitForFunction(() => window.__view?.()?.debugState().summary, null, {
    timeout: 60_000,
  });
  await bluetoothPage.evaluate(() => {
    const view = window.__view();
    view.options = { ...view.options, quality: "high" };
  });
  await bluetoothPage.locator("domotwin-view .person-tag").first().waitFor();
  await bluetoothPage.evaluate(() => window.__view().settle());
  await bluetoothPage.getByTestId("more").click();
  await bluetoothPage.getByTestId("bluetooth-settings").click();
  await bluetoothPage.getByTestId("bluetooth-find").click();
  await bluetoothPage.locator("[data-candidate]").first().waitFor();
  await bluetoothPage.waitForTimeout(800);
  await fs.writeFile(
    join(root, "docs", "figures", "screenshot-bluetooth.png"),
    await bluetoothPage.screenshot(),
  );
  console.log("docs/figures/screenshot-bluetooth.png");

  // The radio coverage (D-059): the panel, the day look, Wi-Fi over the demo apartment from the
  // harness's access point in the kitchen, its devices' signals, the spots for the next one.
  const coveragePage = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    // Under the repository's 800 kB a picture (`.pre-commit-config.yaml`).
    deviceScaleFactor: 1.25,
  });
  await coveragePage.emulateMedia({ reducedMotion: "reduce" });
  await coveragePage.addInitScript(() => {
    localStorage.setItem("domotwin-coverage-radio", "wifi");
  });
  await coveragePage.goto(
    "http://127.0.0.1:4173/?mode=panel&live=1&bluetooth=1&radios=1&hometheme=day",
  );
  await coveragePage.waitForFunction(() => window.__view?.()?.debugState().summary, null, {
    timeout: 60_000,
  });
  await coveragePage.evaluate(() => {
    const view = window.__view();
    view.options = { ...view.options, quality: "high" };
  });
  await coveragePage.locator("domotwin-view").getByTestId("layers").click();
  await coveragePage.locator('domotwin-view [data-layer="coverage"]').click();
  await coveragePage.locator("domotwin-placement .marker.spot").first().waitFor();
  await coveragePage.evaluate(() => window.__view().settle());
  await coveragePage.waitForTimeout(800);
  await fs.writeFile(
    join(root, "docs", "figures", "screenshot-placement.png"),
    await coveragePage.screenshot(),
  );
  console.log("docs/figures/screenshot-placement.png");

  // The looks of D-036: the cartoon and the clay in the panel, in the light of the day.
  const toonShots = [];
  for (const [look, label] of [
    ["cartoon", "Cartoon"],
    ["clay", "Clay model"],
  ]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`http://127.0.0.1:4173/?mode=panel&live=1&people=1&sun=45,1&hometheme=${look}`);
    await page.waitForFunction(() => window.__view?.()?.debugState().summary, null, {
      timeout: 60_000,
    });
    await page.evaluate(() => {
      const view = window.__view();
      view.options = { ...view.options, quality: "high" };
    });
    await page.waitForFunction(() => window.__view().debugState().quality === "high");
    await page.locator("domotwin-view .person-tag").first().waitFor();
    await page.evaluate(() => window.__view().settle());
    await page.waitForTimeout(600);
    toonShots.push([label, (await page.screenshot()).toString("base64")]);
    await page.close();
  }
  const toonPage = await browser.newPage();
  const toonImage = await toonPage.evaluate(async (shots) => {
    const decoded = await Promise.all(
      shots.map(async ([label, base64]) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        return [label, image];
      }),
    );
    const [w, h] = [1280, 800];
    const canvas = document.createElement("canvas");
    canvas.width = w * 2 + 30;
    canvas.height = h + 20;
    const g = canvas.getContext("2d");
    g.fillStyle = "#f1f5f9";
    g.fillRect(0, 0, canvas.width, canvas.height);
    decoded.forEach(([label, image], i) => {
      const x = 10 + i * (w + 10);
      g.drawImage(image, x, 10, w, h);
      g.font = "600 26px Inter, sans-serif";
      const width = g.measureText(label).width + 44;
      g.fillStyle = "rgba(255,255,255,0.92)";
      g.beginPath();
      g.roundRect(x + w / 2 - width / 2, 10 + h - 110, width, 48, 24);
      g.fill();
      g.fillStyle = "#0f172a";
      g.fillText(label, x + w / 2 - width / 2 + 22, 10 + h - 77);
    });
    return canvas.toDataURL("image/png");
  }, toonShots);
  await toonPage.close();
  await fs.writeFile(
    join(root, "docs", "figures", "screenshot-cartoon-clay.png"),
    Buffer.from(toonImage.slice(toonImage.indexOf(",") + 1), "base64"),
  );
  console.log("docs/figures/screenshot-cartoon-clay.png");

  // Voice (D-041): the panel's voice settings, Assist without speech-to-text on a Supervisor,
  // the apps that hear to choose from, and the voice blueprints to add.
  const voicePage = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1.5,
  });
  await voicePage.emulateMedia({ reducedMotion: "reduce" });
  await voicePage.goto("http://127.0.0.1:4173/?mode=panel&live=1&voice=deaf&supervisor=1");
  await voicePage.waitForFunction(() => window.__view?.()?.debugState().summary, null, {
    timeout: 60_000,
  });
  await voicePage.evaluate(() => {
    const view = window.__view();
    view.options = { ...view.options, quality: "high" };
  });
  await voicePage.evaluate(() => window.__view().settle());
  await voicePage.getByTestId("more").click();
  await voicePage.getByTestId("voice-settings").click();
  await voicePage.locator('[data-blueprint="show_by_voice"]').waitFor();
  await voicePage.locator('input[value="speech-to-phrase"]').check();
  await voicePage.waitForTimeout(500);
  await fs.writeFile(
    join(root, "docs", "figures", "screenshot-voice.png"),
    await voicePage.screenshot(),
  );
  console.log("docs/figures/screenshot-voice.png");

  // The README's animation (D-042): the demo apartment turned with the keyboard,
  // then shown as its 2D plan and back. Frames taken one by one, put together by ffmpeg.
  const gifPage = await browser.newPage({
    viewport: { width: 960, height: 560 },
    deviceScaleFactor: 1,
  });
  await gifPage.goto("http://127.0.0.1:4173/?mode=card&live=1");
  await gifPage.waitForFunction(() => window.__view?.()?.debugState().summary, null, {
    timeout: 60_000,
  });
  await gifPage.evaluate(() => {
    const view = window.__view();
    view.options = { ...view.options, quality: "high" };
  });
  await gifPage.evaluate(() => window.__view().settle());
  const { mkdtemp, rm } = fs;
  const { tmpdir } = await import("node:os");
  const frames = await mkdtemp(join(tmpdir(), "domotwin-gif-"));
  const list = [];
  const card = gifPage.locator("domotwin-card");
  const frame = async (seconds) => {
    const file = join(frames, `${String(list.length).padStart(4, "0")}.png`);
    await card.screenshot({ path: file });
    list.push(`file '${file}'\nduration ${seconds}`);
  };
  await frame(1.2);
  await gifPage.locator("domotwin-view .stage").focus();
  for (let i = 0; i < 24; i += 1) {
    await gifPage.keyboard.press("ArrowRight");
    await gifPage.keyboard.press("ArrowRight");
    await gifPage.evaluate(() => window.__view().settle());
    await frame(0.08);
  }
  await frame(0.8);
  for (const kept of [1.4, 1.2]) {
    await gifPage.locator("domotwin-view").getByTestId("toggle-plan").click();
    for (let i = 0; i < 6; i += 1) {
      await gifPage.waitForTimeout(100);
      await frame(0.1);
    }
    await gifPage.evaluate(() => window.__view().settle());
    await frame(kept);
  }
  // ffmpeg's concat list repeats the last frame for its duration to be kept.
  list.push(list.at(-1).split("\n")[0]);
  await fs.writeFile(join(frames, "list.txt"), list.join("\n") + "\n");
  const { spawnSync } = await import("node:child_process");
  const gif = join(root, "docs", "figures", "demo.gif");
  const made = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      ...["-f", "concat", "-safe", "0", "-i", join(frames, "list.txt")],
      "-vf",
      // About 2 MB: small, few colours, an ordered dither that compresses well.
      "scale=480:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle",
      "-loop",
      "0",
      gif,
    ],
    { stdio: "inherit" },
  );
  await rm(frames, { recursive: true, force: true });
  if (made.status === 0) console.log("docs/figures/demo.gif");
  else console.error("ffmpeg is needed for docs/figures/demo.gif");
  await browser.close();
} finally {
  server.kill();
}
