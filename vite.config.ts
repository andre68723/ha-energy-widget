import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// One self-contained ES module: Home Assistant (and HACS) load a single file as a dashboard resource.
export default defineConfig({
  define: { __VERSION__: JSON.stringify(version) },
  build: {
    target: "es2022",
    lib: {
      entry: "src/ha-energy-widget.ts",
      formats: ["es"],
      fileName: () => "ha-energy-widget.js",
    },
    minify: true,
    sourcemap: false,
    emptyOutDir: true,
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
