// Renders ADR index entries as a compact plain-text digest for agent context.
//
// Budget: context is shared with everything else in the session, so the
// digest is capped. When over budget, summaries of inactive ADRs
// (superseded / deprecated / rejected) are dropped first, then summaries of
// the oldest active ones; every ADR keeps at least its title line.

import type { IndexedAdr } from "./index-store.ts";

export const DEFAULT_BUDGET = 6000;

export interface AdrDirEntries {
  /** ADR directory relative to the project root, e.g. "docs/adr". */
  dir: string;
  adrs: IndexedAdr[];
}

const INACTIVE = new Set(["superseded", "deprecated", "rejected"]);

export function formatDigest(dirs: AdrDirEntries[], budget = DEFAULT_BUDGET): string {
  const nonEmpty = dirs.filter((d) => d.adrs.length > 0);
  if (nonEmpty.length === 0) return "";

  // Drop order: inactive first, then oldest active. Each step removes one summary.
  const all = nonEmpty.flatMap((d) => d.adrs);
  const dropOrder = [
    ...all.filter((a) => INACTIVE.has(a.status)),
    ...all.filter((a) => !INACTIVE.has(a.status)),
  ];
  const withoutSummary = new Set<IndexedAdr>();

  let text = render(nonEmpty, withoutSummary);
  for (const adr of dropOrder) {
    if (text.length <= budget) break;
    withoutSummary.add(adr);
    text = render(nonEmpty, withoutSummary);
  }
  return text;
}

function render(dirs: AdrDirEntries[], withoutSummary: Set<IndexedAdr>): string {
  const lines = [
    "Architecture decisions recorded in this repo (from the adr-index plugin).",
    "Check these before proposing changes in the same area. Open the full ADR only when a summary looks relevant.",
    "If your work would contradict an accepted ADR, say so explicitly rather than silently overriding it.",
  ];
  for (const { dir, adrs } of dirs) {
    lines.push("", `${dir}/`);
    for (const adr of adrs) {
      lines.push(`- ${label(adr)} ${adr.title} (${adr.file}, amended ${adr.amendedAt.slice(0, 10)})`);
      if (!withoutSummary.has(adr) && adr.summary) lines.push(`  ${adr.summary}`);
    }
  }
  const trimmed = dirs.flatMap((d) => d.adrs).filter((a) => withoutSummary.has(a) && a.summary).length;
  if (trimmed > 0) lines.push("", `(${String(trimmed)} summaries omitted for length; each ADR directory's index.json has all of them.)`);
  return lines.join("\n");
}

function label(adr: IndexedAdr): string {
  const id = ref(adr.id, adr.prefix);
  if (adr.status === "superseded" && adr.supersededBy !== undefined) {
    return `${id} [superseded by ${ref(adr.supersededBy, adr.supersededByPrefix)}]`;
  }
  return adr.status === "unspecified" ? id : `${id} [${adr.status}]`;
}

/** ADR-0007 for the main sequence, hub-0007 for a prefixed series. */
function ref(id: number, prefix: string | undefined): string {
  return `${prefix ?? "ADR"}-${String(id).padStart(4, "0")}`;
}
