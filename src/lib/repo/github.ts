const GITHUB_API = "https://api.github.com";
const NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_SELECTABLE_FILE_BYTES = 200_000;

export interface RepoRef {
  owner: string;
  repo: string;
  ref?: string;
}

export interface RepoFile {
  path: string;
  content: string;
  truncated: boolean;
}

export interface RepoSnapshot {
  owner: string;
  repo: string;
  ref: string;
  description: string | null;
  htmlUrl: string;
  /** Number of files in the repository tree (not the number fetched). */
  totalFiles: number;
  /** True when GitHub truncated the tree listing (very large repositories). */
  treeTruncated: boolean;
  files: RepoFile[];
}

export type RepoFetchErrorKind =
  | "not_found"
  | "unauthorized"
  | "rate_limited"
  | "upstream";

export class RepoFetchError extends Error {
  constructor(
    readonly kind: RepoFetchErrorKind,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "RepoFetchError";
  }
}

function validName(value: string | undefined): value is string {
  return (
    value !== undefined &&
    NAME_PATTERN.test(value) &&
    value !== "." &&
    value !== ".."
  );
}

/**
 * Parses a GitHub repository reference. Accepts https URLs, `github.com/o/r`,
 * `git@github.com:o/r.git` and the `owner/repo` shorthand. Returns null for
 * anything that is not unambiguously a github.com repository, so the result
 * is safe to use for building api.github.com requests.
 */
export function parseRepoUrl(input: string): RepoRef | null {
  const raw = input.trim();
  if (!raw) return null;

  const ssh = /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(raw);
  if (ssh) {
    return validName(ssh[1]) && validName(ssh[2])
      ? { owner: ssh[1], repo: ssh[2] }
      : null;
  }

  let segments: string[];
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(raw)) {
    segments = raw.split("/");
  } else {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      return null;
    }
    const host = url.hostname.toLowerCase();
    if (host !== "github.com" && host !== "www.github.com") return null;
    if (url.username || url.password) return null;
    segments = url.pathname.split("/").filter(Boolean);
  }

  const [owner, repoRaw, marker, ...rest] = segments;
  const repo = repoRaw?.replace(/\.git$/, "");
  if (!validName(owner) || !validName(repo)) return null;

  if (marker === "tree" && rest.length > 0) {
    const ref = decodeURIComponent(rest.join("/"));
    return { owner, repo, ref };
  }
  return { owner, repo };
}

const EXCLUDED_DIRS = new Set([
  "node_modules",
  "vendor",
  ".terraform",
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".git",
  "testdata",
  "__fixtures__",
  "fixtures",
  "third_party",
]);

/** Files that plausibly hold credentials. These are never downloaded. */
const SECRET_PATTERNS = [
  /\.tfvars(\.json)?$/i,
  /\.tfstate(\.backup)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore)$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)/i,
  /secret/i,
  /credential/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.netrc$/i,
];

const ENV_TEMPLATE = /^\.env\.(example|sample|template|dist)$/i;

const LOCKFILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "poetry.lock",
  "uv.lock",
  "Cargo.lock",
  "go.sum",
  "Gemfile.lock",
  "composer.lock",
  ".terraform.lock.hcl",
]);

const PLATFORM_CONFIG = new Set([
  "serverless.yml",
  "serverless.yaml",
  "vercel.json",
  "vercel.ts",
  "fly.toml",
  "render.yaml",
  "app.yaml",
  "netlify.toml",
  "wrangler.toml",
  "skaffold.yaml",
  "Pulumi.yaml",
  "cdk.json",
  "Procfile",
  "Tiltfile",
  "nginx.conf",
  "Caddyfile",
]);

const MANIFESTS = new Set([
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Gemfile",
  "composer.json",
]);

const K8S_DIRS = new Set([
  "k8s",
  "kubernetes",
  "manifests",
  "helm",
  "charts",
  "deploy",
  "deployment",
  "deployments",
  "kustomize",
  "argocd",
]);

function scorePath(path: string): number {
  const segments = path.split("/");
  const name = segments[segments.length - 1];
  const dirs = segments.slice(0, -1);

  if (dirs.some((d) => EXCLUDED_DIRS.has(d))) return 0;
  if (LOCKFILES.has(name)) return 0;
  if (/^\.env(\..+)?$/i.test(name)) return ENV_TEMPLATE.test(name) ? 80 : 0;
  if (SECRET_PATTERNS.some((p) => p.test(path))) return 0;

  const isYaml = /\.ya?ml$/i.test(name);

  if (/^(docker-)?compose(\.[\w-]+)*\.ya?ml$/i.test(name)) return 100;
  if (/\.tf$/i.test(name)) return 90;
  if (isYaml && dirs.some((d) => K8S_DIRS.has(d.toLowerCase()))) return 90;
  if (PLATFORM_CONFIG.has(name)) return 90;
  if (/^kustomization\.ya?ml$/i.test(name)) return 90;
  if (/^(Dockerfile|Containerfile)(\..+)?$/i.test(name)) return 80;
  if (/\.dockerfile$/i.test(name)) return 80;
  if (MANIFESTS.has(name)) return 70;
  if (isYaml && path.startsWith(".github/workflows/")) return 60;
  if (name === ".gitlab-ci.yml" || name === "Jenkinsfile") return 60;
  if (path === ".circleci/config.yml" || name === "azure-pipelines.yml") {
    return 60;
  }
  if (dirs.length === 0 && /^readme(\.md|\.rst|\.txt)?$/i.test(name)) return 50;
  return 0;
}

/**
 * Picks the files most likely to describe infrastructure, best first:
 * deployment descriptors, then Dockerfiles, package manifests, CI config and
 * the root README. Secrets, vendored code and lockfiles are never selected.
 */
export function selectInfraFiles(
  entries: { path: string; size?: number }[],
  limit = 25
): string[] {
  return entries
    .filter((e) => {
      const size = e.size ?? 0;
      return size > 0 && size <= MAX_SELECTABLE_FILE_BYTES;
    })
    .map((e) => ({
      path: e.path,
      score: scorePath(e.path),
      depth: e.path.split("/").length,
    }))
    .filter((e) => e.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.depth - b.depth ||
        a.path.localeCompare(b.path)
    )
    .slice(0, limit)
    .map((e) => e.path);
}

export interface FetchSnapshotOptions {
  fetchImpl?: typeof fetch;
  /** GitHub token for private repositories and higher rate limits. */
  token?: string;
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export async function fetchRepoSnapshot(
  ref: RepoRef,
  options: FetchSnapshotOptions = {}
): Promise<RepoSnapshot> {
  const {
    fetchImpl = fetch,
    token,
    maxFiles = 25,
    maxFileBytes = 12_000,
    maxTotalBytes = 120_000,
  } = options;

  const slug = `${ref.owner}/${ref.repo}`;
  const base = `${GITHUB_API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;

  const request = async (url: string, accept: string): Promise<Response> => {
    const headers: Record<string, string> = {
      Accept: accept,
      "User-Agent": "infra-modeller",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    let res: Response;
    try {
      res = await fetchImpl(url, {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new RepoFetchError("upstream", `Could not reach GitHub for ${slug}`, {
        cause: err,
      });
    }
    if (res.ok) return res;

    if (
      res.status === 429 ||
      (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")
    ) {
      throw new RepoFetchError(
        "rate_limited",
        "GitHub API rate limit exceeded. Set GITHUB_TOKEN to raise the limit."
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new RepoFetchError(
        "unauthorized",
        `GitHub rejected the request for ${slug}. Check GITHUB_TOKEN.`
      );
    }
    if (res.status === 404) {
      throw new RepoFetchError(
        "not_found",
        `Repository or ref not found: ${slug}${ref.ref ? `@${ref.ref}` : ""}. Private repositories need GITHUB_TOKEN.`
      );
    }
    throw new RepoFetchError(
      "upstream",
      `GitHub returned ${res.status} for ${slug}`
    );
  };

  const json = "application/vnd.github+json";

  const meta = (await (await request(base, json)).json()) as {
    default_branch: string;
    description: string | null;
    html_url: string;
  };
  const gitRef = ref.ref ?? meta.default_branch;

  const tree = (await (
    await request(
      `${base}/git/trees/${encodeURIComponent(gitRef)}?recursive=1`,
      json
    )
  ).json()) as {
    truncated?: boolean;
    tree: { path: string; type: string; size?: number }[];
  };

  const blobs = tree.tree.filter((e) => e.type === "blob");
  const selected = selectInfraFiles(blobs, maxFiles);

  const downloaded = await Promise.all(
    selected.map(async (path) => {
      try {
        const res = await request(
          `${base}/contents/${encodePath(path)}?ref=${encodeURIComponent(gitRef)}`,
          "application/vnd.github.raw+json"
        );
        return { path, text: await res.text() };
      } catch (err) {
        // Rate limiting affects every remaining file; surface it. Anything
        // else (e.g. a submodule path) only costs us that one file.
        if (err instanceof RepoFetchError && err.kind === "rate_limited") {
          throw err;
        }
        return null;
      }
    })
  );

  const files: RepoFile[] = [];
  let total = 0;
  for (const file of downloaded) {
    if (!file) continue;
    const truncated = file.text.length > maxFileBytes;
    const content = truncated ? file.text.slice(0, maxFileBytes) : file.text;
    if (total + content.length > maxTotalBytes) break;
    total += content.length;
    files.push({ path: file.path, content, truncated });
  }

  return {
    owner: ref.owner,
    repo: ref.repo,
    ref: gitRef,
    description: meta.description ?? null,
    htmlUrl: meta.html_url,
    totalFiles: blobs.length,
    treeTruncated: tree.truncated ?? false,
    files,
  };
}
