import esbuild from "esbuild";
import builtins from "builtin-modules";
import fs from "node:fs";
import process from "node:process";

const mode = process.argv[2] || "development";

if (mode === "test") {
  fs.rmSync(".test-dist", { recursive: true, force: true });
  fs.mkdirSync(".test-dist", { recursive: true });
  const tests = fs.readdirSync("tests").filter((file) => file.endsWith(".test.ts"));
  await Promise.all(tests.map((file) => esbuild.build({
    entryPoints: [`tests/${file}`],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    outfile: `.test-dist/${file.replace(/\.ts$/, ".cjs")}`,
  })));
  process.exit(0);
}

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", ...builtins],
  format: "cjs",
  target: "es2019",
  platform: "browser",
  sourcemap: mode === "production" ? false : "inline",
  outfile: "main.js",
  logLevel: "info",
});

if (mode === "production") {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
