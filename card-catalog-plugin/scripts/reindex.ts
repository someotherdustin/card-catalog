// Shortcut for `cli.ts reindex --root <root>`, kept because earlier READMEs
// and session-start messages gave it.
//   node scripts/reindex.ts [root]

import { runCli } from "./cli.ts";

process.exitCode = runCli(["reindex", ...(process.argv[2] !== undefined ? ["--root", process.argv[2]] : [])], {
  out: (t) => process.stdout.write(`${t}\n`),
  err: (t) => process.stderr.write(`${t}\n`),
  cwd: process.cwd(),
});
