import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { findCli } from "../scripts/find-cli.ts";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(pluginRoot, "scripts", "find-cli.ts");
const { version } = JSON.parse(readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8")) as { version: string };
const npxCommand = `npx -y @someotherdustin/card-catalog@${version}`;

interface Fakes {
  /** A CLI script for the session path, printing this version. */
  cli?: string;
  /** Fake npx and card-catalog on PATH, printing these versions; null leaves them off PATH. */
  npx?: string | null;
  path?: string | null;
}

/** A temp dir holding the fakes, each logging its arguments to calls.log. */
function setUp({ cli, npx = null, path = null }: Fakes) {
  const dir = mkdtempSync(join(tmpdir(), "cc-find-cli-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const log = join(dir, "calls.log");
  const fake = (name: string, v: string) => {
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\necho "${v}"\n`);
    chmodSync(join(bin, name), 0o755);
  };
  if (npx !== null) fake("npx", npx);
  if (path !== null) fake("card-catalog", path);
  let cliPath: string | undefined;
  if (cli !== undefined) {
    cliPath = join(dir, "plugin dir", "cli.mjs");
    mkdirSync(dirname(cliPath));
    writeFileSync(cliPath, `console.log(${JSON.stringify(cli)});\n`);
  }
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);
  return { dir, bin, cliPath, calls };
}

function run(bin: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { ...process.env, PATH: bin } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test("uses the session's CLI when it reports the plugin's version, without trying npx", () => {
  const { bin, cliPath = "", calls } = setUp({ cli: version, npx: version });
  const r = run(bin, cliPath);
  assert.equal(r.code, 0);
  assert.equal(r.out, `node "${cliPath}"\n`);
  assert.equal(r.err, "");
  assert.deepEqual(calls(), []);
});

test("falls back to the pinned npx package when no session path is given", () => {
  const { bin, calls } = setUp({ npx: version, path: version });
  const r = run(bin);
  assert.equal(r.code, 0);
  assert.equal(r.out, `${npxCommand}\n`);
  assert.deepEqual(calls(), [`npx -y @someotherdustin/card-catalog@${version} --version`]);
});

test("falls back to card-catalog on PATH when the session's CLI and npx have the wrong version", () => {
  const { bin, cliPath = "" } = setUp({ cli: "0.0.1", npx: "0.0.2", path: version });
  const r = run(bin, cliPath);
  assert.equal(r.code, 0);
  assert.equal(r.out, "card-catalog\n");
});

test("with no usable source, prints nothing on stdout, says why for each, and how to install", () => {
  const { dir, bin } = setUp({ npx: "0.0.2" });
  const missing = join(dir, "gone", "cli.ts");
  const r = run(bin, missing);
  assert.equal(r.code, 1);
  assert.equal(r.out, "");
  assert.equal(
    r.err,
    [
      `card-catalog-helpers: found no card-catalog CLI at version ${version}.`,
      `  node "${missing}": not found`,
      `  ${npxCommand}: version 0.0.2, need ${version}`,
      "  card-catalog on PATH: not found",
      `Install it with: npm install -g @someotherdustin/card-catalog@${version}`,
      "",
    ].join("\n"),
  );
  assert.match(run(bin).err, /^ {2}node "<cli>": not given$/m);
});

test("a source that exits with an error, or takes too long, is rejected", () => {
  const { bin, cliPath = "" } = setUp({ cli: version });
  writeFileSync(join(bin, "npx"), "#!/bin/sh\necho 'npm error 404' >&2\nexit 1\n");
  chmodSync(join(bin, "npx"), 0o755);
  // A grandchild still holding stdout, as npm's own children would.
  writeFileSync(join(bin, "card-catalog"), `#!/bin/sh\n"${process.execPath}" -e "setTimeout(() => {}, 5000)"\n`);
  chmodSync(join(bin, "card-catalog"), 0o755);
  writeFileSync(cliPath, "setTimeout(() => {}, 5000);\n");
  const found = findCli({ version, cli: cliPath, env: { ...process.env, PATH: bin }, timeouts: { npx: 1000, other: 300 } });
  assert.equal(found.command, undefined);
  assert.deepEqual(found.tried.map((t) => t.reason), ["timed out", "exited with code 1", "timed out"]);
});
