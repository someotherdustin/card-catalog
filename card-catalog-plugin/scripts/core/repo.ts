// A repo as card-catalog sees it: its root, config, ignore sources and
// resolved collections. Every front-end (hooks, CLI) starts here.

import { type Config, loadConfig } from "./config.ts";
import { type Collection, type NotIndexed, resolveCollections } from "./collections.ts";
import { type IgnoreSources, loadIgnoreSources } from "./ignore.ts";
import type { Problem } from "./problems.ts";

export interface Repo {
  root: string;
  config: Config;
  /** Whether a card-catalog.json exists. */
  configPresent: boolean;
  ignore: IgnoreSources;
  collections: Collection[];
  notIndexed: NotIndexed[];
  /** Config, ignore-source and resolution problems. */
  problems: Problem[];
}

export type RepoOpen = { ok: true; repo: Repo } | { ok: false; root: string; problems: Problem[] };

export function openRepo(root: string): RepoOpen {
  const loaded = loadConfig(root);
  if (!loaded.ok) return { ok: false, root, problems: loaded.problems };
  const ignore = loadIgnoreSources(root, loaded.config.ignoreFiles);
  const resolution = resolveCollections(root, loaded.config, ignore);
  return {
    ok: true,
    repo: {
      root,
      config: loaded.config,
      configPresent: loaded.present,
      ignore,
      collections: resolution.collections,
      notIndexed: resolution.notIndexed,
      problems: [...ignore.problems, ...resolution.problems],
    },
  };
}
