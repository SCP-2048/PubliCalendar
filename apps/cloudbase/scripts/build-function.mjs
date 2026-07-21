import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = resolve(appRoot, "functions/publicalendar/index.ts");
const httpDirectory = resolve(appRoot, "dist/publicalendar");
const eventDirectory = resolve(appRoot, "dist/publicalendar-event");

async function bundleHandler(outfile) {
  await build({
    bundle: true,
    entryPoints: [source],
    external: ["@cloudbase/node-sdk"],
    format: "cjs",
    outfile,
    platform: "node",
    target: "node18",
  });
}

await rm(httpDirectory, { force: true, recursive: true });
await rm(eventDirectory, { force: true, recursive: true });
await mkdir(httpDirectory, { recursive: true });
await mkdir(eventDirectory, { recursive: true });

await bundleHandler(resolve(httpDirectory, "handler.js"));
await cp(
  resolve(appRoot, "functions/publicalendar/server.js"),
  resolve(httpDirectory, "index.js"),
);
await cp(
  resolve(appRoot, "functions/publicalendar/package.json"),
  resolve(httpDirectory, "package.json"),
);
// CloudBase HTTP functions require LF-only scf_bootstrap (no Windows CRLF).
await writeFile(
  resolve(httpDirectory, "scf_bootstrap"),
  "#!/bin/bash\nnode index.js\n",
  { encoding: "utf8", mode: 0o755 },
);

await bundleHandler(resolve(eventDirectory, "handler.js"));
await writeFile(
  resolve(eventDirectory, "index.js"),
  `"use strict";\nconst { main } = require("./handler.js");\nexports.main = async (event) => main(event);\n`,
  { encoding: "utf8" },
);
await writeFile(
  resolve(eventDirectory, "package.json"),
  `${JSON.stringify(
    {
      name: "publicalendar-event",
      private: true,
      main: "index.js",
      dependencies: {
        "@cloudbase/node-sdk": "latest",
      },
    },
    null,
    2,
  )}\n`,
  { encoding: "utf8" },
);

console.log(`Built CloudBase HTTP function at ${httpDirectory}`);
console.log(`Built CloudBase event function at ${eventDirectory}`);
