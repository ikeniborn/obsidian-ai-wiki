import esbuild from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const production = process.argv[2] === "production";

// Obsidian reads versions.json to pick the newest plugin release an older app
// version may install. Every plugin listed in the community registry ships one,
// so keep it in step with the manifest instead of updating it by hand.
function syncVersions() {
  const { version, minAppVersion } = JSON.parse(readFileSync("src/manifest.json", "utf8"));
  const versions = JSON.parse(readFileSync("versions.json", "utf8"));
  if (versions[version] === minAppVersion) return;
  versions[version] = minAppVersion;
  writeFileSync("versions.json", `${JSON.stringify(versions, null, 2)}\n`);
}

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "child_process", "node:readline"],
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
  syncVersions();
  console.log("dist/ updated: main.js, manifest.json, styles.css; root manifest.json and versions.json synced");
} else {
  for (const f of ["manifest.json", "styles.css"]) {
    copyFileSync(`src/${f}`, `dist/${f}`);
  }
  copyFileSync("src/manifest.json", "manifest.json");
  await ctx.watch();
}
