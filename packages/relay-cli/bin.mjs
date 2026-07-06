#!/usr/bin/env node
// Thin launcher: run the CHAOS relay server (a Deno app published to JSR) via
// `npx chaos-relay-server`. Requires Deno on PATH; all args and env are passed
// through. The JSR version is pinned to this package's version so the two stay
// in lockstep.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);
const jsrSpec = `jsr:@paulkinlan/chaos-relay@${pkg.version}`;

const res = spawnSync(
  "deno",
  ["run", "-A", "--unstable-kv", jsrSpec, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (res.error) {
  const enoent = /** @type {NodeJS.ErrnoException} */ (res.error).code ===
    "ENOENT";
  console.error(
    enoent
      ? "chaos-relay-server needs Deno on your PATH. Install it: https://deno.com/\n" +
        "  curl -fsSL https://deno.land/install.sh | sh"
      : `Failed to launch the relay: ${res.error.message}`,
  );
  process.exit(1);
}

process.exit(res.status ?? 0);
