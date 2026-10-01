// Temp repos for tests. Every test gets its own directory, so tests can run
// in parallel and never see each other's files.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export type Files = Record<string, string | object>;

/** Creates a repo with `files` (objects are written as JSON). With `git`, initializes git and commits nothing. */
export function makeRepo(files: Files = {}, { git = false } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "cc-repo-"));
  if (git) execFileSync("git", ["init", "-q"], { cwd: root });
  writeFiles(root, files);
  return root;
}

export function writeFiles(root: string, files: Files): void {
  for (const [path, content] of Object.entries(files)) {
    const abs = join(root, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, typeof content === "string" ? content : JSON.stringify(content, null, 2));
  }
}

export function gitCommitAll(root: string, date?: string): void {
  const env = { ...process.env, ...(date ? { GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } : {}) };
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"], { cwd: root, env });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "commit"], { cwd: root, env });
}

export const adr = (title: string, body = `${title} body.`, frontmatter = ""): string =>
  `${frontmatter ? `---\n${frontmatter}\n---\n` : ""}# ${title}\n\n${body}\n`;
