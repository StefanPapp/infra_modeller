import { getModel } from "../ai";
import { fetchRepoSnapshot } from "./github";
import type { ImportRepositoryDeps } from "./import";

/** Production wiring: live GitHub API (optionally authenticated) and the configured Claude model. */
export function defaultImportDeps(): ImportRepositoryDeps {
  return {
    fetchSnapshot: (ref) =>
      fetchRepoSnapshot(ref, { token: process.env.GITHUB_TOKEN || undefined }),
    model: getModel(),
  };
}
