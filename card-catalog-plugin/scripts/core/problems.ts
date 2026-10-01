// Problems are what `validate` reports, and what hooks and the CLI log as
// warnings. Each has a stable code; validate.md lists them all.

export type Severity = "error" | "warning" | "note";

export interface Problem {
  severity: Severity;
  code: string;
  /** Repo-relative path the problem is about. */
  path: string;
  message: string;
  /** A command or edit that resolves it. */
  fix?: string;
}

export function problem(severity: Severity, code: string, path: string, message: string, fix?: string): Problem {
  return { severity, code, path, message, ...(fix !== undefined ? { fix } : {}) };
}
