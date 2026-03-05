import { build } from "esbuild";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));

await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/arbiter.js",
  banner: {
    js: "#!/usr/bin/env node",
  },
  external: [],
  minify: false,
  sourcemap: false,
  define: {
    "process.env.ARBITER_VERSION": JSON.stringify(pkg.version),
  },
});

console.log(`Built dist/arbiter.js (v${pkg.version})`);
