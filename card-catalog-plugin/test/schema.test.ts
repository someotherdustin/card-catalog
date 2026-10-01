import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseConfig } from "../scripts/core/config.ts";
import { ENTRY_PROFILE_FIELDS } from "../scripts/core/profile.ts";

const pluginDir = join(dirname(fileURLToPath(import.meta.url)), "..");

interface Schema {
  properties: Record<string, unknown>;
  $defs: { entry: { properties: Record<string, unknown> }; source: { pattern: string }; linkSource: { pattern: string } };
}

const schema = JSON.parse(readFileSync(join(pluginDir, "card-catalog.schema.json"), "utf8")) as Schema;

test("the JSON Schema describes the same keys the config reader accepts", () => {
  assert.deepEqual(Object.keys(schema.properties).sort(), ["$schema", "collections", "defaults", "ignoreFiles"]);
  assert.deepEqual(
    Object.keys(schema.$defs.entry.properties).sort(),
    ["announce", "dir", "exclude", "indexPath", "type", ...ENTRY_PROFILE_FIELDS].sort(),
  );
});

test("the schema's source patterns agree with the config reader", () => {
  const source = new RegExp(schema.$defs.source.pattern);
  const linkSource = new RegExp(schema.$defs.linkSource.pattern);
  for (const s of ["frontmatter:summary", "inline:Summary", "section:Decision", "heading", "lead", "quote", "status:superseded", "nonsense", "frontmatter:", "section: x"]) {
    const ok = (field: string, value: string) => !("errors" in parseConfig({ collections: [{ dir: "x", type: "x", [field]: field === "links" ? { a: value } : value }] }));
    assert.equal(source.test(s), ok("summary", s), `summary: ${s}`);
    assert.equal(linkSource.test(s), ok("links", s), `links: ${s}`);
  }
});

test("the npm package, the plugin and the CLI carry the same version", async () => {
  const plugin = JSON.parse(readFileSync(join(pluginDir, ".claude-plugin", "plugin.json"), "utf8")) as { version: string };
  const npm = JSON.parse(readFileSync(join(pluginDir, "..", "npm", "package.json"), "utf8")) as { version: string };
  const { VERSION } = await import("../scripts/core/version.ts");
  assert.equal(npm.version, plugin.version);
  assert.equal(VERSION, plugin.version);
});
