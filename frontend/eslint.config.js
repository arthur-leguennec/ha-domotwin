// @ts-check
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "src/engine/pkg/",
      "src/import/pkg/",
      "src/models/pkg/",
      "src/planner/pkg/",
      "src/analysis/pkg/",
      "node_modules/",
      "test-results/",
      "playwright-report/",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        projectService: { allowDefaultProject: ["*.js", "*.mjs", "e2e/*.mjs"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],
      // The privacy promise: no network calls outside the user's own Home Assistant.
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message: "Use the Home Assistant connection or a same-origin URL helper.",
        },
        { name: "XMLHttpRequest", message: "No network calls outside Home Assistant." },
        { name: "WebSocket", message: "Use the Home Assistant connection." },
      ],
    },
  },
  {
    // Tests and their harness may fetch local fixtures.
    files: ["e2e/**", "tests/**"],
    rules: { "no-restricted-globals": "off" },
  },
  {
    files: ["*.js", "*.mjs", "e2e/**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: { ...globals.node } },
  },
);
