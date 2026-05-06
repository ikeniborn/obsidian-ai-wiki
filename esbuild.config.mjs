import esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

const production = process.argv[2] === "production";

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "node:child_process", "node:readline", "node:path", "node:fs"],
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
  console.log("dist/ updated: main.js, manifest.json, styles.css");
} else {
  for (const f of ["manifest.json", "styles.css"]) {
    copyFileSync(`src/${f}`, `dist/${f}`);
  }
  await ctx.watch();
}
