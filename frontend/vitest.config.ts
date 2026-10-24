import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __DOMOTWIN_VERSION__: JSON.stringify("0.0.0-test"),
    __DOMOTWIN_WASM__: JSON.stringify("domotwin_web_bg.wasm"),
    __DOMOTWIN_IFC_WASM__: JSON.stringify("domotwin_ifc_bg.wasm"),
    __DOMOTWIN_MODELS_WASM__: JSON.stringify("domotwin_models_bg.wasm"),
  },
  test: {
    environment: "happy-dom",
    include: ["tests/**/*.test.ts"],
  },
});
