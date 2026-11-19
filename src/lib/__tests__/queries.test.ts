import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "@/lib/db-test";
import { seedDatabase } from "@/lib/seed";
import { getGraph, getComponentById, listComponentNames } from "@/lib/queries";
import type { SqlClient } from "@/lib/db";

describe("queries", () => {
  let db: SqlClient;

  beforeEach(async () => {
    db = await createTestDb();
    await seedDatabase(db);
  });

  describe("seedDatabase", () => {
    it("is idempotent", async () => {
      const before = await getGraph(db);
      await seedDatabase(db);
      const after = await getGraph(db);
      expect(after.nodes.length).toBe(before.nodes.length);
      expect(after.links.length).toBe(before.links.length);
    });
  });

  describe("getGraph", () => {
    it("returns components as nodes and connections as links", async () => {
      const graph = await getGraph(db);
      expect(graph.nodes.length).toBeGreaterThan(5);
      expect(graph.links.length).toBeGreaterThan(5);

      const node = graph.nodes[0];
      expect(node.id).toBeGreaterThan(0);
      expect(typeof node.name).toBe("string");
      expect(typeof node.type).toBe("string");
    });

    it("only produces links whose endpoints are nodes", async () => {
      const graph = await getGraph(db);
      const ids = new Set(graph.nodes.map((n) => n.id));
      for (const link of graph.links) {
        expect(ids.has(link.source)).toBe(true);
        expect(ids.has(link.target)).toBe(true);
        expect(link.kind.length).toBeGreaterThan(0);
      }
    });
  });

  describe("getComponentById", () => {
    it("returns the component with owners and both connection directions", async () => {
      const graph = await getGraph(db);
      const ordersDb = graph.nodes.find((n) => n.name === "Orders DB");
      expect(ordersDb).toBeDefined();

      const detail = await getComponentById(db, ordersDb!.id);
      expect(detail).not.toBeNull();
      expect(detail!.type).toBe("Database");
      expect(detail!.tags).toBeInstanceOf(Array);
      expect(detail!.owners.length).toBeGreaterThan(0);
      expect(detail!.incoming.map((c) => c.componentName)).toContain(
        "Orders Service"
      );
      expect(detail!.outgoing).toEqual([]);
      expect(detail!.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("lists outgoing connections with the target's name and type", async () => {
      const graph = await getGraph(db);
      const orders = graph.nodes.find((n) => n.name === "Orders Service")!;
      const detail = await getComponentById(db, orders.id);
      const toDb = detail!.outgoing.find(
        (c) => c.componentName === "Orders DB"
      );
      expect(toDb).toBeDefined();
      expect(toDb!.componentType).toBe("Database");
      expect(toDb!.kind).toBe("reads/writes");
      expect(toDb!.protocol).toBe("SQL");
    });

    it("returns null for a non-existent component", async () => {
      expect(await getComponentById(db, 99999)).toBeNull();
    });
  });

  describe("listComponentNames", () => {
    it("returns name and type for every component", async () => {
      const names = await listComponentNames(db);
      const graph = await getGraph(db);
      expect(names.length).toBe(graph.nodes.length);
      expect(names).toContainEqual({ name: "Orders DB", type: "Database" });
    });
  });
});
