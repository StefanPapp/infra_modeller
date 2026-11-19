import { describe, it, expect } from "vitest";
import {
  parseRepoUrl,
  selectInfraFiles,
  fetchRepoSnapshot,
  RepoFetchError,
} from "@/lib/repo/github";

describe("parseRepoUrl", () => {
  it.each([
    ["https://github.com/acme/shop", { owner: "acme", repo: "shop" }],
    ["https://github.com/acme/shop/", { owner: "acme", repo: "shop" }],
    ["https://github.com/acme/shop.git", { owner: "acme", repo: "shop" }],
    ["http://www.github.com/acme/shop", { owner: "acme", repo: "shop" }],
    ["github.com/acme/shop", { owner: "acme", repo: "shop" }],
    ["acme/shop", { owner: "acme", repo: "shop" }],
    ["  acme/shop.js  ", { owner: "acme", repo: "shop.js" }],
    ["git@github.com:acme/shop.git", { owner: "acme", repo: "shop" }],
    [
      "https://github.com/acme/shop/tree/release/v2",
      { owner: "acme", repo: "shop", ref: "release/v2" },
    ],
    [
      "https://github.com/acme/shop/blob/main/README.md",
      { owner: "acme", repo: "shop" },
    ],
    [
      "https://github.com/acme/shop/pull/12",
      { owner: "acme", repo: "shop" },
    ],
  ])("parses %s", (input, expected) => {
    expect(parseRepoUrl(input)).toEqual(expected);
  });

  it.each([
    "",
    "not a url",
    "https://gitlab.com/acme/shop",
    "https://github.com.evil.example/acme/shop",
    "https://evil.example/github.com/acme/shop",
    "https://github.com/acme",
    "http://169.254.169.254/latest/meta-data",
    "acme/shop/../../etc",
    "acme/..",
    "https://user:pass@github.com/acme/shop",
  ])("rejects %s", (input) => {
    expect(parseRepoUrl(input)).toBeNull();
  });
});

describe("selectInfraFiles", () => {
  const f = (path: string, size = 500) => ({ path, size });

  it("prioritises deployment descriptors over manifests and docs", () => {
    const selected = selectInfraFiles([
      f("README.md"),
      f("package.json"),
      f("src/index.ts"),
      f("docker-compose.yml"),
      f("infra/main.tf"),
      f("Dockerfile"),
      f(".github/workflows/ci.yml"),
    ]);
    expect(selected).toEqual([
      "docker-compose.yml",
      "infra/main.tf",
      "Dockerfile",
      "package.json",
      ".github/workflows/ci.yml",
      "README.md",
    ]);
  });

  it("never selects files that are likely to hold secrets", () => {
    const selected = selectInfraFiles([
      f(".env"),
      f(".env.production"),
      f("infra/prod.tfvars"),
      f("infra/terraform.tfstate"),
      f("certs/server.pem"),
      f("deploy/id_rsa"),
      f("k8s/secrets.yaml"),
      f("k8s/secret.yml"),
      f(".env.example"),
    ]);
    expect(selected).toEqual([".env.example"]);
  });

  it("skips vendored, generated, empty and oversized files", () => {
    const selected = selectInfraFiles([
      f("node_modules/foo/package.json"),
      f("vendor/github.com/x/go.mod"),
      f(".terraform/modules/x/main.tf"),
      f("dist/docker-compose.yml"),
      f("docker-compose.yml", 0),
      f("k8s/huge.yaml", 600_000),
      f("package-lock.json"),
      f("go.mod"),
    ]);
    expect(selected).toEqual(["go.mod"]);
  });

  it("recognises kubernetes, helm and platform config", () => {
    const selected = selectInfraFiles([
      f("k8s/deployment.yaml"),
      f("charts/api/values.yaml"),
      f("charts/api/Chart.yaml"),
      f("serverless.yml"),
      f("fly.toml"),
      f("vercel.json"),
      f("config/settings.yaml"),
    ]);
    expect(selected).toContain("k8s/deployment.yaml");
    expect(selected).toContain("charts/api/values.yaml");
    expect(selected).toContain("serverless.yml");
    expect(selected).toContain("fly.toml");
    expect(selected).toContain("vercel.json");
    expect(selected).not.toContain("config/settings.yaml");
  });

  it("prefers shallow files and honours the limit", () => {
    const selected = selectInfraFiles(
      [
        f("services/a/b/c/Dockerfile"),
        f("services/a/Dockerfile"),
        f("Dockerfile"),
      ],
      2
    );
    expect(selected).toEqual(["Dockerfile", "services/a/Dockerfile"]);
  });
});

type Route = { status?: number; body: unknown; headers?: Record<string, string> };

function fakeFetch(routes: Record<string, Route>) {
  const calls: { url: string; headers: Headers }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers) });
    const route = routes[url];
    if (!route) return new Response("not found", { status: 404 });
    const body =
      typeof route.body === "string" ? route.body : JSON.stringify(route.body);
    return new Response(body, {
      status: route.status ?? 200,
      headers: route.headers,
    });
  }) as typeof fetch;
  return { impl, calls };
}

const API = "https://api.github.com/repos/acme/shop";

describe("fetchRepoSnapshot", () => {
  const baseRoutes: Record<string, Route> = {
    [API]: {
      body: {
        default_branch: "main",
        description: "Shop platform",
        html_url: "https://github.com/acme/shop",
      },
    },
    [`${API}/git/trees/main?recursive=1`]: {
      body: {
        truncated: false,
        tree: [
          { path: "docker-compose.yml", type: "blob", size: 120 },
          { path: "src", type: "tree" },
          { path: "src/index.ts", type: "blob", size: 900 },
          { path: "apps/api/Dockerfile", type: "blob", size: 80 },
          { path: ".env", type: "blob", size: 50 },
        ],
      },
    },
    [`${API}/contents/docker-compose.yml?ref=main`]: {
      body: "services:\n  api:\n    image: api\n",
    },
    [`${API}/contents/apps/api/Dockerfile?ref=main`]: {
      body: "FROM node:24-alpine\n",
    },
  };

  it("fetches metadata, the tree and only the selected files", async () => {
    const { impl, calls } = fakeFetch(baseRoutes);
    const snapshot = await fetchRepoSnapshot(
      { owner: "acme", repo: "shop" },
      { fetchImpl: impl }
    );

    expect(snapshot).toMatchObject({
      owner: "acme",
      repo: "shop",
      ref: "main",
      description: "Shop platform",
      htmlUrl: "https://github.com/acme/shop",
      totalFiles: 4,
      treeTruncated: false,
    });
    expect(snapshot.files).toEqual([
      {
        path: "docker-compose.yml",
        content: "services:\n  api:\n    image: api\n",
        truncated: false,
      },
      {
        path: "apps/api/Dockerfile",
        content: "FROM node:24-alpine\n",
        truncated: false,
      },
    ]);
    expect(calls.some((c) => c.url.includes(".env"))).toBe(false);
    expect(calls[0].headers.get("authorization")).toBeNull();
    expect(calls[0].headers.get("user-agent")).toBeTruthy();
  });

  it("sends the token and uses an explicit ref", async () => {
    const { impl, calls } = fakeFetch({
      [API]: baseRoutes[API],
      [`${API}/git/trees/release%2Fv2?recursive=1`]: {
        body: { truncated: false, tree: [] },
      },
    });
    const snapshot = await fetchRepoSnapshot(
      { owner: "acme", repo: "shop", ref: "release/v2" },
      { fetchImpl: impl, token: "ghp_test" }
    );
    expect(snapshot.ref).toBe("release/v2");
    expect(snapshot.files).toEqual([]);
    for (const call of calls) {
      expect(call.headers.get("authorization")).toBe("Bearer ghp_test");
    }
  });

  it("truncates large files and stops at the total byte budget", async () => {
    const big = "x".repeat(5000);
    const { impl } = fakeFetch({
      ...baseRoutes,
      [`${API}/contents/docker-compose.yml?ref=main`]: { body: big },
      [`${API}/contents/apps/api/Dockerfile?ref=main`]: { body: big },
    });
    const snapshot = await fetchRepoSnapshot(
      { owner: "acme", repo: "shop" },
      { fetchImpl: impl, maxFileBytes: 1000, maxTotalBytes: 1500 }
    );
    expect(snapshot.files).toEqual([
      { path: "docker-compose.yml", content: "x".repeat(1000), truncated: true },
    ]);
  });

  it("skips individual files that fail to download", async () => {
    const routes = { ...baseRoutes };
    delete routes[`${API}/contents/apps/api/Dockerfile?ref=main`];
    const { impl } = fakeFetch(routes);
    const snapshot = await fetchRepoSnapshot(
      { owner: "acme", repo: "shop" },
      { fetchImpl: impl }
    );
    expect(snapshot.files.map((f) => f.path)).toEqual(["docker-compose.yml"]);
  });

  it("maps a missing repository to not_found", async () => {
    const { impl } = fakeFetch({});
    await expect(
      fetchRepoSnapshot({ owner: "acme", repo: "shop" }, { fetchImpl: impl })
    ).rejects.toMatchObject({ kind: "not_found" });
  });

  it("maps an exhausted rate limit to rate_limited", async () => {
    const { impl } = fakeFetch({
      [API]: {
        status: 403,
        body: { message: "API rate limit exceeded" },
        headers: { "x-ratelimit-remaining": "0" },
      },
    });
    const err = await fetchRepoSnapshot(
      { owner: "acme", repo: "shop" },
      { fetchImpl: impl }
    ).catch((e) => e);
    expect(err).toBeInstanceOf(RepoFetchError);
    expect(err.kind).toBe("rate_limited");
  });

  it("maps 401 to unauthorized and 5xx to upstream", async () => {
    const unauthorized = fakeFetch({ [API]: { status: 401, body: {} } });
    await expect(
      fetchRepoSnapshot(
        { owner: "acme", repo: "shop" },
        { fetchImpl: unauthorized.impl }
      )
    ).rejects.toMatchObject({ kind: "unauthorized" });

    const down = fakeFetch({ [API]: { status: 502, body: {} } });
    await expect(
      fetchRepoSnapshot({ owner: "acme", repo: "shop" }, { fetchImpl: down.impl })
    ).rejects.toMatchObject({ kind: "upstream" });
  });
});
