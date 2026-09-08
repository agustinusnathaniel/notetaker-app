import { defineConfig } from "tsdown";

export default defineConfig({
  entry: "./src/index.ts",
  format: "esm",
  outDir: "./dist",
  clean: true,
  deps: {
    alwaysBundle: [/@notetaker-app\/.*/],
    neverBundle: ["cloudflare:workers"],
  },
});
