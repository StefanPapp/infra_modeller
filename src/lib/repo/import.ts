import type { LanguageModel } from "ai";
import type { SqlClient } from "../db";
import { importModel } from "../mutations";
import { listComponentNames } from "../queries";
import type { ImportResult } from "../types";
import { extractInfraModel } from "./extract";
import { parseRepoUrl, type RepoRef, type RepoSnapshot } from "./github";

export interface ImportRepositoryDeps {
  fetchSnapshot: (ref: RepoRef) => Promise<RepoSnapshot>;
  model: LanguageModel;
}

export interface RepositoryImport extends ImportResult {
  repo: string;
  ref: string;
  filesAnalysed: string[];
}

/**
 * Reads a GitHub repository and merges the infrastructure it describes into
 * the map. Infrastructure failures (GitHub, model) propagate as exceptions;
 * user-correctable problems are returned as `{ error }`.
 */
export async function importRepository(
  db: SqlClient,
  url: string,
  deps: ImportRepositoryDeps
): Promise<RepositoryImport | { error: string }> {
  const ref = parseRepoUrl(url);
  if (!ref) {
    return {
      error: "Not a GitHub repository URL (expected github.com/<owner>/<repo>)",
    };
  }

  const snapshot = await deps.fetchSnapshot(ref);
  const slug = `${snapshot.owner}/${snapshot.repo}`;

  if (snapshot.files.length === 0) {
    return {
      error: `No infrastructure-relevant files found in ${slug}@${snapshot.ref} (looked for compose, Terraform, Kubernetes, Dockerfiles, manifests, CI config)`,
    };
  }

  const existing = await listComponentNames(db);
  const model = await extractInfraModel(snapshot, existing, deps.model);
  const result = await importModel(db, model, {
    source: `repo:${slug}`,
    repoUrl: snapshot.htmlUrl,
  });

  return {
    repo: slug,
    ref: snapshot.ref,
    filesAnalysed: snapshot.files.map((f) => f.path),
    ...result,
  };
}
