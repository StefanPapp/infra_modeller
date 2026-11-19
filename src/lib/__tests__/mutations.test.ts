import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "@/lib/db-test";
import {
  insertComponent,
  deleteComponent,
  updateComponent,
  renameComponent,
  addOwner,
  removeOwner,
  connectComponents,
  disconnectComponents,
  deleteConnectionById,
  importModel,
  undoLastAction,
} from "@/lib/mutations";
import { getComponentById, getGraph } from "@/lib/queries";
import type { SqlClient } from "@/lib/db";

async function add(db: SqlClient, name: string, type = "Service") {
  const result = await insertComponent(db, { name, type });
  if ("error" in result) throw new Error(result.error);
  return result.componentId;
}

describe("mutations", () => {
  let db: SqlClient;

  beforeEach(async () => {
    db = await createTestDb();
  });

  describe("insertComponent", () => {
    it("inserts a component with owners and defaults", async () => {
      const result = await insertComponent(db, {
        name: "Billing API",
        type: "Service",
        description: "Invoices and subscriptions",
        technology: "Go 1.26",
        criticality: "High",
        tags: ["payments", "pci"],
        repoUrl: "https://github.com/acme/billing",
        owners: [{ name: "Dana Reyes", role: "Tech lead", team: "Payments" }],
      });
      expect(result).toHaveProperty("componentId");
      const { componentId } = result as { componentId: number };

      const detail = await getComponentById(db, componentId);
      expect(detail).toMatchObject({
        name: "Billing API",
        type: "Service",
        technology: "Go 1.26",
        criticality: "High",
        status: "Active",
        source: "manual",
        tags: ["payments", "pci"],
        repoUrl: "https://github.com/acme/billing",
      });
      expect(detail!.owners).toEqual([
        expect.objectContaining({
          name: "Dana Reyes",
          role: "Tech lead",
          team: "Payments",
        }),
      ]);
    });

    it("rejects duplicate names case-insensitively", async () => {
      await add(db, "Billing API");
      const result = await insertComponent(db, {
        name: "billing api",
        type: "Service",
      });
      expect(result).toEqual({
        error: 'Component "Billing API" already exists',
      });
    });
  });

  describe("connectComponents", () => {
    it("creates a directed connection resolved by name, case-insensitively", async () => {
      const apiId = await add(db, "API");
      await add(db, "Postgres", "Database");

      const result = await connectComponents(db, "api", "postgres", {
        kind: "reads/writes",
        protocol: "SQL",
      });
      expect(result).toHaveProperty("connectionId");

      const detail = await getComponentById(db, apiId);
      expect(detail!.outgoing).toEqual([
        expect.objectContaining({
          componentName: "Postgres",
          kind: "reads/writes",
          protocol: "SQL",
        }),
      ]);
    });

    it("defaults the kind to 'depends on'", async () => {
      const apiId = await add(db, "API");
      await add(db, "Cache", "Cache");
      await connectComponents(db, "API", "Cache");
      const detail = await getComponentById(db, apiId);
      expect(detail!.outgoing[0].kind).toBe("depends on");
    });

    it("rejects self-connections, unknown components and duplicates", async () => {
      await add(db, "API");
      await add(db, "Cache", "Cache");

      expect(await connectComponents(db, "API", "API")).toEqual({
        error: "A component cannot be connected to itself",
      });
      expect(await connectComponents(db, "API", "Nope")).toEqual({
        error: 'Component "Nope" not found',
      });
      await connectComponents(db, "API", "Cache", { kind: "calls" });
      expect(
        await connectComponents(db, "API", "Cache", { kind: "calls" })
      ).toEqual({
        error: 'Connection "API" -> "Cache" (calls) already exists',
      });
    });

    it("allows the reverse direction and a different kind", async () => {
      await add(db, "A");
      await add(db, "B");
      await connectComponents(db, "A", "B", { kind: "calls" });
      expect(
        await connectComponents(db, "B", "A", { kind: "calls" })
      ).toHaveProperty("connectionId");
      expect(
        await connectComponents(db, "A", "B", { kind: "publishes to" })
      ).toHaveProperty("connectionId");
      expect((await getGraph(db)).links.length).toBe(3);
    });
  });

  describe("disconnectComponents / deleteConnectionById", () => {
    it("removes a connection by endpoints and restores it on undo", async () => {
      await add(db, "A");
      await add(db, "B");
      await connectComponents(db, "A", "B", {
        kind: "calls",
        protocol: "gRPC",
      });

      expect(await disconnectComponents(db, "A", "B")).toEqual({
        success: true,
        removed: 1,
      });
      expect((await getGraph(db)).links).toEqual([]);

      await undoLastAction(db);
      const links = (await getGraph(db)).links;
      expect(links).toEqual([
        expect.objectContaining({ kind: "calls", protocol: "gRPC" }),
      ]);
    });

    it("only removes the given kind when one is specified", async () => {
      await add(db, "A");
      await add(db, "B");
      await connectComponents(db, "A", "B", { kind: "calls" });
      await connectComponents(db, "A", "B", { kind: "publishes to" });
      await disconnectComponents(db, "A", "B", "calls");
      expect((await getGraph(db)).links.map((l) => l.kind)).toEqual([
        "publishes to",
      ]);
    });

    it("reports when no connection exists", async () => {
      await add(db, "A");
      await add(db, "B");
      expect(await disconnectComponents(db, "A", "B")).toEqual({
        error: 'No connection from "A" to "B"',
      });
    });

    it("deletes by id", async () => {
      await add(db, "A");
      await add(db, "B");
      const created = (await connectComponents(db, "A", "B")) as {
        connectionId: number;
      };
      expect(await deleteConnectionById(db, created.connectionId)).toEqual({
        success: true,
        removed: 1,
      });
      expect(await deleteConnectionById(db, created.connectionId)).toEqual({
        error: "Connection not found",
      });
    });
  });

  describe("deleteComponent", () => {
    it("cascades connections and undo restores component, owners and connections", async () => {
      await insertComponent(db, {
        name: "API",
        type: "Service",
        owners: [{ name: "Dana Reyes", team: "Platform" }],
      });
      await add(db, "Postgres", "Database");
      await add(db, "Web", "Frontend");
      await connectComponents(db, "API", "Postgres", { kind: "reads/writes" });
      await connectComponents(db, "Web", "API", { kind: "calls" });

      expect(await deleteComponent(db, "API")).toEqual({ success: true });
      let graph = await getGraph(db);
      expect(graph.nodes.map((n) => n.name).sort()).toEqual([
        "Postgres",
        "Web",
      ]);
      expect(graph.links).toEqual([]);

      const undone = await undoLastAction(db);
      expect(undone).toEqual({ success: true, message: "Undone: Deleted API" });

      graph = await getGraph(db);
      const api = graph.nodes.find((n) => n.name === "API")!;
      const detail = await getComponentById(db, api.id);
      expect(detail!.owners.map((o) => o.name)).toEqual(["Dana Reyes"]);
      expect(detail!.outgoing.map((c) => c.componentName)).toEqual([
        "Postgres",
      ]);
      expect(detail!.incoming.map((c) => c.componentName)).toEqual(["Web"]);
    });

    it("returns an error for unknown components", async () => {
      expect(await deleteComponent(db, "Ghost")).toEqual({
        error: 'Component "Ghost" not found',
      });
    });
  });

  describe("updateComponent", () => {
    it("updates fields and undo restores the previous values", async () => {
      const id = await add(db, "API");
      const result = await updateComponent(db, "API", {
        type: "Gateway / Networking",
        criticality: "High",
        tags: ["edge"],
        status: "Deprecated",
      });
      expect(result).toEqual({ success: true });

      let detail = await getComponentById(db, id);
      expect(detail).toMatchObject({
        type: "Gateway / Networking",
        criticality: "High",
        tags: ["edge"],
        status: "Deprecated",
      });

      await undoLastAction(db);
      detail = await getComponentById(db, id);
      expect(detail).toMatchObject({
        type: "Service",
        criticality: "Medium",
        tags: [],
        status: "Active",
      });
    });

    it("rejects an empty update", async () => {
      await add(db, "API");
      expect(await updateComponent(db, "API", {})).toEqual({
        error: "No fields to update",
      });
    });
  });

  describe("renameComponent", () => {
    it("renames and keeps connections; undo restores the name", async () => {
      const id = await add(db, "Api");
      await add(db, "DB", "Database");
      await connectComponents(db, "Api", "DB");

      expect(await renameComponent(db, "Api", "API Gateway")).toEqual({
        success: true,
      });
      const detail = await getComponentById(db, id);
      expect(detail!.name).toBe("API Gateway");
      expect(detail!.outgoing.length).toBe(1);

      await undoLastAction(db);
      expect((await getComponentById(db, id))!.name).toBe("Api");
    });

    it("rejects a name that is already taken", async () => {
      await add(db, "A");
      await add(db, "B");
      expect(await renameComponent(db, "A", "b")).toEqual({
        error: 'Component "B" already exists',
      });
    });

    it("allows changing only the casing", async () => {
      const id = await add(db, "api");
      expect(await renameComponent(db, "api", "API")).toEqual({
        success: true,
      });
      expect((await getComponentById(db, id))!.name).toBe("API");
    });
  });

  describe("owners", () => {
    it("adds and removes owners with undo", async () => {
      const id = await add(db, "API");
      expect(
        await addOwner(db, "API", { name: "Sam Okafor", team: "Platform" })
      ).toHaveProperty("ownerId");
      expect(await addOwner(db, "API", { name: "Sam Okafor" })).toEqual({
        error: '"Sam Okafor" already owns "API"',
      });

      expect(await removeOwner(db, "API", "Sam Okafor")).toEqual({
        success: true,
      });
      expect((await getComponentById(db, id))!.owners).toEqual([]);

      await undoLastAction(db);
      expect((await getComponentById(db, id))!.owners).toEqual([
        expect.objectContaining({ name: "Sam Okafor", team: "Platform" }),
      ]);
    });
  });

  describe("importModel", () => {
    const model = {
      components: [
        { name: "web", type: "Frontend", technology: "Next.js" },
        { name: "api", type: "Service" },
        { name: "Postgres", type: "Database" },
      ],
      connections: [
        { source: "web", target: "api", kind: "calls", protocol: "HTTP" },
        { source: "api", target: "postgres", kind: "reads/writes" },
        { source: "api", target: "ghost", kind: "calls" },
        { source: "api", target: "api", kind: "calls" },
      ],
    };

    it("creates new components, reuses existing ones and links by name", async () => {
      const existingId = await add(db, "Postgres", "Database");

      const result = await importModel(db, model, {
        source: "repo:acme/shop",
        repoUrl: "https://github.com/acme/shop",
      });

      expect(result.createdComponents).toEqual(["web", "api"]);
      expect(result.reusedComponents).toEqual(["Postgres"]);
      expect(result.createdConnections).toBe(2);
      expect(result.skippedConnections).toEqual([
        { source: "api", target: "ghost", reason: "unknown component" },
        { source: "api", target: "api", reason: "self-connection" },
      ]);

      const graph = await getGraph(db);
      expect(graph.nodes.length).toBe(3);
      const api = graph.nodes.find((n) => n.name === "api")!;
      const detail = await getComponentById(db, api.id);
      expect(detail!.source).toBe("repo:acme/shop");
      expect(detail!.repoUrl).toBe("https://github.com/acme/shop");
      expect(detail!.outgoing[0].componentId).toBe(existingId);

      // Pre-existing components are not re-attributed to the repository.
      expect((await getComponentById(db, existingId))!.source).toBe("manual");
    });

    it("is idempotent when the same model is imported twice", async () => {
      await importModel(db, model, { source: "repo:acme/shop" });
      const second = await importModel(db, model, { source: "repo:acme/shop" });
      expect(second.createdComponents).toEqual([]);
      expect(second.createdConnections).toBe(0);
      const graph = await getGraph(db);
      expect(graph.nodes.length).toBe(3);
      expect(graph.links.length).toBe(2);
    });

    it("undo removes everything the import created and nothing else", async () => {
      await add(db, "Postgres", "Database");
      await importModel(db, model, { source: "repo:acme/shop" });

      await undoLastAction(db);
      const graph = await getGraph(db);
      expect(graph.nodes.map((n) => n.name)).toEqual(["Postgres"]);
      expect(graph.links).toEqual([]);
    });
  });

  describe("undoLastAction", () => {
    it("undoes an add and then has nothing left to undo", async () => {
      await add(db, "API");
      expect(await undoLastAction(db)).toEqual({
        success: true,
        message: "Undone: Added API",
      });
      expect((await getGraph(db)).nodes).toEqual([]);
      expect(await undoLastAction(db)).toEqual({ error: "Nothing to undo" });
    });

    it("undoes a new connection", async () => {
      await add(db, "A");
      await add(db, "B");
      await connectComponents(db, "A", "B");
      await undoLastAction(db);
      expect((await getGraph(db)).links).toEqual([]);
      expect((await getGraph(db)).nodes.length).toBe(2);
    });
  });
});
