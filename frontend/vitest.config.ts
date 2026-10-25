import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The generated WebAssembly packages exist only after scripts/build.sh.
    alias: [{ find: /^\.\/pkg\/domotwin_\w+\.js$/, replacement: "/tests/stubs/wasm.ts" }],
  },
  define: {
    __DOMOTWIN_VERSION__: JSON.stringify("0.0.0-test"),
    __DOMOTWIN_WASM__: JSON.stringify("domotwin_web_bg.wasm"),
    __DOMOTWIN_IMPORT_WASM__: JSON.stringify("domotwin_import_bg.wasm"),
    __DOMOTWIN_MODELS_WASM__: JSON.stringify("domotwin_models_bg.wasm"),
    __DOMOTWIN_PLANNER_WASM__: JSON.stringify("domotwin_planner_bg.wasm"),
    __DOMOTWIN_ANALYSIS_WASM__: JSON.stringify("domotwin_analysis_bg.wasm"),
    __DOMOTWIN_FONT__: JSON.stringify("fonts/inter-variable.woff2"),
  },
  test: {
    environment: "happy-dom",
    include: ["tests/**/*.test.ts"],
  },
});
