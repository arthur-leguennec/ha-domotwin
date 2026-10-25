import { describe, expect, it, vi } from "vitest";

import { wasmLoader } from "../src/assets";

describe("wasm modules loaded on demand", () => {
  it("loads a module once, and again after a load that failed", async () => {
    const start = vi
      .fn<(init: { module_or_path: URL }) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const glue = vi.fn(() => Promise.resolve({ default: start }));
    const load = wasmLoader(glue, "module_bg.wasm");
    await expect(load()).rejects.toThrow("offline");
    const module = await load();
    expect(await load()).toBe(module);
    expect(glue).toHaveBeenCalledTimes(2);
    expect(start.mock.calls[1]?.[0].module_or_path.pathname).toBe(
      "/domotwin_static/module_bg.wasm",
    );
  });
});
