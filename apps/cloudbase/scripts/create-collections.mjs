import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(root, "node_modules/@cloudbase/cli/dist/standalone/cli.js");
const envId = "publicalendar-d6g6uxmuz4b418883";
const collections = [
  "schedules",
  "schedule_date_ranges",
  "participants",
  "availability_ranges",
];

function run(commandObject) {
  const command = JSON.stringify(commandObject);
  console.log(">>", command);
  const result = spawnSync(process.execPath, [cli, "db", "nosql", "execute", "-e", envId, "--command", command], {
    cwd: root,
    encoding: "utf8",
  });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  return result.status === 0;
}

for (const name of collections) {
  console.log(`\nCreating ${name}...`);
  const created = run([
    {
      TableName: name,
      CommandType: "COMMAND",
      Command: JSON.stringify({ create: name }),
    },
  ]);
  if (!created) {
    console.log(`Insert bootstrap for ${name}...`);
    run([
      {
        TableName: name,
        CommandType: "INSERT",
        Command: JSON.stringify({
          insert: name,
          documents: [{ _bootstrap: true, createdAt: Date.now() }],
        }),
      },
    ]);
  }
}
