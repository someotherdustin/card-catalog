// SessionStart hook: tells the agent where each announced collection's index
// is and how to use it. It doesn't load the records themselves: that cost
// grows with every record, and most sessions touch few of them. The agent
// greps the indexes for the area it's changing and opens only the records
// whose lines match. See docs/specs/hooks.md.
//
// Read-only: it rebuilds indexes in memory only to check whether the ones on
// disk are current, and never writes. It always exits 0 and prints nothing
// when there's nothing to say.

import { type Collection } from "./core/collections.ts";
import { buildIndex } from "./core/index-build.ts";
import { findOrphans } from "./core/orphans.ts";
import { findRepoRoot } from "./core/paths.ts";
import { recordCount, recordNoun } from "./core/profile.ts";
import { openRepo } from "./core/repo.ts";
import { CLI_PATH, readHookInput, runHook } from "./hook-io.ts";

interface Listed {
  c: Collection;
  count: number;
  stale: boolean;
}

function sessionStartMessage(projectDir: string): string {
  const root = findRepoRoot(projectDir);
  const opened = openRepo(root);
  if (!opened.ok) return `card-catalog.json is invalid, so no index was checked. Run: node "${CLI_PATH}" validate`;
  const { repo } = opened;

  const listed: Listed[] = [];
  for (const c of repo.collections) {
    if (!c.settings.announce || c.indexFile === undefined) continue;
    const built = buildIndex(repo, c);
    if (built.records.length === 0) continue;
    listed.push({ c, count: built.records.length, stale: built.state !== "current" });
  }
  const orphans = findOrphans(repo, { allMarkdown: false });

  const lines: string[] = [];
  if (listed.length) {
    const types = [...new Map(listed.map((l) => [l.c.type, l.c])).values()];
    const withStatus = types.filter((c) => c.profile.status !== null).length;
    const shape = `label, ${withStatus ? "status, " : ""}date amended, title and a one-line summary.`;
    const only = types.length === 1 ? types[0] : undefined;
    if (only) {
      const { description, plural } = only.profile;
      lines.push(
        `This repo records ${description !== undefined ? `${description} as ${plural}` : plural}. Each collection below has an index with one line per ${recordNoun(only.profile)}:`,
        shape,
      );
    } else {
      lines.push(
        "This repo keeps an index for each collection of records below, with one line per record:",
        `${shape}${withStatus && withStatus < types.length ? " Types without a status leave it out." : ""}`,
      );
    }
    lines.push("");
    for (const { c, count, stale } of listed) {
      lines.push(`- ${c.indexFile ?? ""} (${recordCount(c.profile, count)}${stale ? ", out of date" : ""})`);
    }
    lines.push(
      "",
      `Before changing an area, grep the ${listed.length === 1 ? "index" : "indexes"} for its terms and open the ${only ? only.profile.plural : "records"} whose lines match.`,
    );
    for (const c of types) if (c.profile.guidance !== undefined) lines.push(c.profile.guidance);
    if (listed.some((l) => l.stale)) lines.push(`To bring an out-of-date index up to date, run: node "${CLI_PATH}" reindex`);
    lines.push(`The card-catalog CLI is node "${CLI_PATH}" (list, preview, profile, validate; add --help).`);
  }
  if (orphans.length) lines.push(`Orphaned indexes, which no collection maintains any more: ${orphans.join(", ")}`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  const input = await readHookInput();
  const text = sessionStartMessage(process.env["CLAUDE_PROJECT_DIR"] ?? input.cwd ?? process.cwd());
  if (!text) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } }));
}

runHook("session-start", main);
