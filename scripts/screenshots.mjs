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
  await browser.close();
} finally {
  server.kill();
}
