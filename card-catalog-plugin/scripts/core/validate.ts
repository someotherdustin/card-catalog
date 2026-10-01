// Every check in docs/specs/validate.md, over the whole repo: the
// non-conversational route to everything the records-doctor skill does.

import { buildIndex } from "./index-build.ts";
import { findOrphans } from "./orphans.ts";
import { type Problem, problem, type Severity } from "./problems.ts";
import { openRepo } from "./repo.ts";

export interface ValidateResult {
  problems: Problem[];
  counts: Record<Severity, number>;
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, note: 2 };

export function validate(root: string, { now = new Date() }: { now?: Date } = {}): ValidateResult {
  const opened = openRepo(root);
  const problems: Problem[] = [];
  if (!opened.ok) {
    problems.push(...opened.problems);
  } else {
    const { repo } = opened;
    problems.push(...repo.problems);
    for (const c of repo.collections) problems.push(...buildIndex(repo, c, { now }).problems);
    for (const path of findOrphans(repo, { allMarkdown: true })) {
      problems.push(problem("error", "orphaned-index", path, "is a card-catalog index that no collection writes", "Delete the file, or make its directory a collection again"));
    }
  }
  const unique = dedupe(problems).sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
  );
  const counts: Record<Severity, number> = { error: 0, warning: 0, note: 0 };
  for (const p of unique) counts[p.severity]++;
  return { problems: unique, counts };
}

/** Link lookups can report the same problem from more than one build. */
function dedupe(problems: Problem[]): Problem[] {
  const seen = new Set<string>();
  return problems.filter((p) => {
    const key = `${p.code}\0${p.path}\0${p.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
