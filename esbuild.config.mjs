import esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

const production = process.argv[2] === "production";

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "child_process", "node:readline", "@excalidraw/utils"],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "dist/main.js",
  platform: "node",
  loader: { ".md": "text" },
});

mkdirSync("dist", { recursive: true });

if (production) {
  await ctx.rebuild();
  await ctx.dispose();
  for (const f of ["manifest.json", "styles.css"]) {
    copyFileSync(`src/${f}`, `dist/${f}`);
  }
  copyFileSync("src/manifest.json", "manifest.json");
  console.log("dist/ updated: main.js, manifest.json, styles.css; root manifest.json synced");
} else {
  for (const f of ["manifest.json", "styles.css"]) {
    copyFileSync(`src/${f}`, `dist/${f}`);
  }
  copyFileSync("src/manifest.json", "manifest.json");
  await ctx.watch();
}
