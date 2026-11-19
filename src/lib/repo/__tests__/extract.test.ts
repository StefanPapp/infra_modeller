import { describe, it, expect } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import {
  buildExtractionPrompt,
  extractInfraModel,
  importModelSchema,
} from "@/lib/repo/extract";
import { importRepository } from "@/lib/repo/import";
import { createTestDb } from "@/lib/db-test";
import { insertComponent } from "@/lib/mutations";
import { getGraph } from "@/lib/queries";
import type { RepoSnapshot } from "@/lib/repo/github";

const snapshot: RepoSnapshot = {
  owner: "acme",
  repo: "shop",
  ref: "main",
  description: "Shop platform",
  htmlUrl: "https://github.com/acme/shop",
  totalFiles: 42,
  treeTruncated: false,
  files: [
    {
      path: "docker-compose.yml",
      content: "services:\n  api:\n    depends_on: [db]\n  db:\n    image: postgres:18\n",
      truncated: false,
    },
  ],
};

const extracted = {
  components: [
    {
      name: "shop-api",
      type: "Service",
      description: "HTTP API",
      technology: "Node.js",
      criticality: "High",
      tags: ["compose"],
    },
    {
      name: "Postgres",
      type: "Database",
      description: null,
      technology: "PostgreSQL 18",
      criticality: null,
      tags: [],
    },
  ],
  connections: [
    {
      source: "shop-api",
      target: "Postgres",
      kind: "reads/writes",
      protocol: "SQL",
      description: null,
    },
  ],
};

function mockModel(json: unknown) {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify(json) }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: {
          total: 10,
          noCache: 10,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

describe("buildExtractionPrompt", () => {
  it("includes repo identity, file contents and existing components", () => {
    const prompt = buildExtractionPrompt(snapshot, [
      { name: "Postgres", type: "Database" },
    ]);
    expect(prompt).toContain("acme/shop");
    expect(prompt).toContain('<file path="docker-compose.yml">');
    expect(prompt).toContain("image: postgres:18");
    expect(prompt).toContain("- Postgres (Database)");
  });

  it("marks truncated files", () => {
    const prompt = buildExtractionPrompt(
      { ...snapshot, files: [{ ...snapshot.files[0], truncated: true }] },
      []
    );
    expect(prompt).toContain('<file path="docker-compose.yml" truncated="true">');
  });
});

describe("importModelSchema", () => {
  it("accepts a well-formed model", () => {
    expect(importModelSchema.safeParse(extracted).success).toBe(true);
  });

  it("rejects blank names and unknown criticalities", () => {
    expect(
      importModelSchema.safeParse({
        components: [{ ...extracted.components[0], name: " " }],
        connections: [],
      }).success
    ).toBe(false);
    expect(
      importModelSchema.safeParse({
        components: [{ ...extracted.components[0], criticality: "Extreme" }],
        connections: [],
      }).success
    ).toBe(false);
  });
});

describe("extractInfraModel", () => {
  it("returns the structured model produced by the LLM", async () => {
    const model = await extractInfraModel(snapshot, [], mockModel(extracted));
    expect(model.components.map((c) => c.name)).toEqual([
      "shop-api",
      "Postgres",
    ]);
    expect(model.connections).toHaveLength(1);
  });
});

describe("importRepository", () => {
  const deps = (overrides: Partial<Parameters<typeof importRepository>[2]> = {}) => ({
    fetchSnapshot: async () => snapshot,
    model: mockModel(extracted),
    ...overrides,
  });

  it("imports components and connections and reuses existing ones", async () => {
    const db = await createTestDb();
    await insertComponent(db, { name: "postgres", type: "Database" });

    const result = await importRepository(
      db,
      "https://github.com/acme/shop",
      deps()
    );
    expect(result).toMatchObject({
      repo: "acme/shop",
      ref: "main",
      filesAnalysed: ["docker-compose.yml"],
      createdComponents: ["shop-api"],
      reusedComponents: ["postgres"],
      createdConnections: 1,
    });

    const graph = await getGraph(db);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.links).toHaveLength(1);
  });

  it("rejects URLs that are not GitHub repositories without fetching", async () => {
    const db = await createTestDb();
    let fetched = false;
    const result = await importRepository(
      db,
      "https://gitlab.com/acme/shop",
      deps({
        fetchSnapshot: async () => {
          fetched = true;
          return snapshot;
        },
      })
    );
    expect(result).toEqual({
      error: "Not a GitHub repository URL (expected github.com/<owner>/<repo>)",
    });
    expect(fetched).toBe(false);
  });

  it("reports repositories without any infrastructure files", async () => {
    const db = await createTestDb();
    const result = await importRepository(
      db,
      "acme/shop",
      deps({ fetchSnapshot: async () => ({ ...snapshot, files: [] }) })
    );
    expect(result).toEqual({
      error:
        "No infrastructure-relevant files found in acme/shop@main (looked for compose, Terraform, Kubernetes, Dockerfiles, manifests, CI config)",
    });
  });
});
