// Tracks when each ADR was last amended.
//
// File mtimes are useless for this: git sets them to checkout time, so every
// fresh clone would report every ADR as amended "just now". Instead the index
// stores a content hash per ADR, and `amendedAt` only moves when the hash
// does. Because index.json is committed alongside the ADRs, the timestamps
// survive clones and don't churn between machines.
//
// For an ADR the index has never hashed (new file, or an index written
// before hashes existed), the best evidence is its last commit date; an ADR
// git doesn't know about yet was just written, so it gets "now".

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { basename } from "node:path";

/** Hash of the ADR's content, ignoring line endings and trailing whitespace. */
export function contentHash(content: string): string {
  const normalized = content.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trimEnd();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export interface PreviousStamp {
  contentHash?: string | undefined;
  amendedAt?: string | undefined;
}

export function resolveAmendedAt(
  hash: string,
  previous: PreviousStamp | undefined,
  lastCommitDate: () => string | undefined,
  now: Date,
): string {
  if (previous?.contentHash !== undefined) {
    return previous.contentHash === hash && previous.amendedAt ? previous.amendedAt : now.toISOString();
  }
  return lastCommitDate() ?? now.toISOString();
}

/**
 * Last commit date (UTC ISO) for each ADR file in `adrDir`, keyed by
 * filename. One `git log` call per directory; empty outside a git repo.
 */
export function lastCommitDates(adrDir: string): Map<string, string> {
  const dates = new Map<string, string>();
  let out: string;
  try {
    out = execFileSync("git", ["log", "--relative", "--format=%x00%cI", "--name-only", "--", "."], {
      cwd: adrDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return dates;
  }
  // Newest commit first, so the first date seen for a file is its latest.
  for (const commit of out.split("\0")) {
    const [date = "", ...files] = commit.split("\n").filter(Boolean);
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) continue;
    for (const file of files) {
      const name = basename(file);
      if (!dates.has(name)) dates.set(name, parsed.toISOString());
    }
  }
  return dates;
}
