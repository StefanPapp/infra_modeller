import type { SqlClient } from "./db";
import type {
  ImportModel,
  ImportResult,
  NewComponentInput,
  NewConnectionInput,
  NewOwnerInput,
} from "./types";

type Failure = { error: string };
type Success = { success: true };

const DEFAULT_KIND = "depends on";

/** Updatable component fields mapped to their column names. */
const UPDATABLE_COLUMNS = {
  type: "type",
  description: "description",
  technology: "technology",
  criticality: "criticality",
  status: "status",
  environment: "environment",
  tags: "tags",
  url: "url",
  repoUrl: "repo_url",
  notes: "notes",
} as const;

export type ComponentUpdates = {
  type?: string;
  description?: string;
  technology?: string;
  criticality?: string;
  status?: string;
  environment?: string;
  tags?: string[];
  url?: string;
  repoUrl?: string;
  notes?: string;
};

const RESTORABLE_COLUMNS = new Set<string>([
  ...Object.values(UPDATABLE_COLUMNS),
  "last_verified",
]);

interface ComponentRef {
  id: number;
  name: string;
}

interface ConnectionSnapshot {
  source_id: number;
  target_id: number;
  kind: string;
  protocol: string | null;
  description: string | null;
}

interface UndoAction {
  type: string;
  payload: Record<string, unknown>;
  description: string;
}

async function saveUndo(db: SqlClient, action: UndoAction): Promise<void> {
  await db.query(
    `INSERT INTO undo_log (id, action_type, payload) VALUES (1, $1, $2)
     ON CONFLICT (id) DO UPDATE SET action_type = EXCLUDED.action_type, payload = EXCLUDED.payload`,
    [
      action.type,
      JSON.stringify({ ...action.payload, _desc: action.description }),
    ]
  );
}

async function findComponent(
  db: SqlClient,
  name: string
): Promise<ComponentRef | null> {
  const rows = await db.query<ComponentRef>(
    "SELECT id, name FROM components WHERE LOWER(name) = LOWER($1)",
    [name.trim()]
  );
  return rows[0] ?? null;
}

function notFound(name: string): Failure {
  return { error: `Component "${name}" not found` };
}

async function insertComponentRow(
  tx: SqlClient,
  data: NewComponentInput
): Promise<number> {
  const inserted = await tx.query<{ id: number }>(
    `INSERT INTO components
       (name, type, description, technology, criticality, status, environment,
        tags, url, repo_url, notes, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      data.name.trim(),
      data.type,
      data.description ?? null,
      data.technology ?? null,
      data.criticality ?? "Medium",
      data.status ?? "Active",
      data.environment ?? null,
      JSON.stringify(data.tags ?? []),
      data.url ?? null,
      data.repoUrl ?? null,
      data.notes ?? null,
      data.source ?? "manual",
    ]
  );
  const id = inserted[0].id;
  for (const owner of data.owners ?? []) {
    await tx.query(
      `INSERT INTO component_owners (component_id, name, role, team)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (component_id, name) DO NOTHING`,
      [id, owner.name.trim(), owner.role ?? null, owner.team ?? null]
    );
  }
  return id;
}

/** Re-inserts connections, skipping any whose endpoints no longer exist. */
async function restoreConnections(
  tx: SqlClient,
  connections: ConnectionSnapshot[]
): Promise<void> {
  for (const c of connections) {
    await tx.query(
      `INSERT INTO connections (source_id, target_id, kind, protocol, description)
       SELECT $1, $2, $3, $4, $5
       WHERE EXISTS (SELECT 1 FROM components WHERE id = $1)
         AND EXISTS (SELECT 1 FROM components WHERE id = $2)
       ON CONFLICT (source_id, target_id, kind) DO NOTHING`,
      [c.source_id, c.target_id, c.kind, c.protocol, c.description]
    );
  }
}

export async function insertComponent(
  db: SqlClient,
  data: NewComponentInput
): Promise<{ componentId: number } | Failure> {
  const existing = await findComponent(db, data.name);
  if (existing) {
    return { error: `Component "${existing.name}" already exists` };
  }

  const componentId = await db.transaction(async (tx) => {
    const id = await insertComponentRow(tx, data);
    await saveUndo(tx, {
      type: "undo_add_component",
      payload: { componentId: id },
      description: `Added ${data.name.trim()}`,
    });
    return id;
  });

  return { componentId };
}

export async function deleteComponent(
  db: SqlClient,
  name: string
): Promise<Success | Failure> {
  const component = await findComponent(db, name);
  if (!component) return notFound(name);

  await db.transaction(async (tx) => {
    const rows = await tx.query<Record<string, unknown>>(
      "SELECT * FROM components WHERE id = $1",
      [component.id]
    );
    const owners = await tx.query<Record<string, unknown>>(
      "SELECT name, role, team FROM component_owners WHERE component_id = $1",
      [component.id]
    );
    const connections = await tx.query<ConnectionSnapshot>(
      `SELECT source_id, target_id, kind, protocol, description
       FROM connections WHERE source_id = $1 OR target_id = $1`,
      [component.id]
    );

    // ON DELETE CASCADE removes owners and connections.
    await tx.query("DELETE FROM components WHERE id = $1", [component.id]);

    await saveUndo(tx, {
      type: "undo_delete_component",
      payload: { component: rows[0], owners, connections },
      description: `Deleted ${component.name}`,
    });
  });

  return { success: true };
}

export async function updateComponent(
  db: SqlClient,
  name: string,
  updates: ComponentUpdates
): Promise<Success | Failure> {
  const component = await findComponent(db, name);
  if (!component) return notFound(name);

  const setClauses: string[] = [];
  const values: unknown[] = [];
  const touched: string[] = [];

  for (const [field, column] of Object.entries(UPDATABLE_COLUMNS)) {
    const value = updates[field as keyof ComponentUpdates];
    if (value === undefined) continue;
    values.push(Array.isArray(value) ? JSON.stringify(value) : value);
    setClauses.push(`${column} = $${values.length}`);
    touched.push(column);
  }

  if (setClauses.length === 0) {
    return { error: "No fields to update" };
  }

  await db.transaction(async (tx) => {
    const oldRows = await tx.query<Record<string, unknown>>(
      "SELECT * FROM components WHERE id = $1",
      [component.id]
    );
    const old: Record<string, unknown> = {
      last_verified: oldRows[0].last_verified,
    };
    for (const column of touched) old[column] = oldRows[0][column];

    values.push(component.id);
    await tx.query(
      `UPDATE components SET ${setClauses.join(", ")}, last_verified = now()
       WHERE id = $${values.length}`,
      values
    );

    await saveUndo(tx, {
      type: "undo_update_component",
      payload: { componentId: component.id, old },
      description: `Updated ${component.name}`,
    });
  });

  return { success: true };
}

export async function renameComponent(
  db: SqlClient,
  oldName: string,
  newName: string
): Promise<Success | Failure> {
  const component = await findComponent(db, oldName);
  if (!component) return notFound(oldName);

  const trimmed = newName.trim();
  if (!trimmed) return { error: "New name must not be empty" };

  const conflict = await findComponent(db, trimmed);
  if (conflict && conflict.id !== component.id) {
    return { error: `Component "${conflict.name}" already exists` };
  }

  await db.transaction(async (tx) => {
    await tx.query("UPDATE components SET name = $1 WHERE id = $2", [
      trimmed,
      component.id,
    ]);
    await saveUndo(tx, {
      type: "undo_rename_component",
      payload: { componentId: component.id, oldName: component.name },
      description: `Renamed "${component.name}" to "${trimmed}"`,
    });
  });

  return { success: true };
}

export async function addOwner(
  db: SqlClient,
  componentName: string,
  owner: NewOwnerInput
): Promise<{ ownerId: number } | Failure> {
  const component = await findComponent(db, componentName);
  if (!component) return notFound(componentName);

  const ownerName = owner.name.trim();
  const existing = await db.query<{ id: number }>(
    "SELECT id FROM component_owners WHERE component_id = $1 AND LOWER(name) = LOWER($2)",
    [component.id, ownerName]
  );
  if (existing.length > 0) {
    return { error: `"${ownerName}" already owns "${component.name}"` };
  }

  const ownerId = await db.transaction(async (tx) => {
    const inserted = await tx.query<{ id: number }>(
      `INSERT INTO component_owners (component_id, name, role, team)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [component.id, ownerName, owner.role ?? null, owner.team ?? null]
    );
    const id = inserted[0].id;
    await saveUndo(tx, {
      type: "undo_add_owner",
      payload: { ownerId: id },
      description: `Added ${ownerName} as owner of ${component.name}`,
    });
    return id;
  });

  return { ownerId };
}

export async function removeOwner(
  db: SqlClient,
  componentName: string,
  ownerName: string
): Promise<Success | Failure> {
  const component = await findComponent(db, componentName);
  if (!component) return notFound(componentName);

  const owners = await db.query<{
    id: number;
    name: string;
    role: string | null;
    team: string | null;
  }>(
    "SELECT id, name, role, team FROM component_owners WHERE component_id = $1 AND LOWER(name) = LOWER($2)",
    [component.id, ownerName.trim()]
  );
  const owner = owners[0];
  if (!owner) {
    return { error: `"${ownerName}" does not own "${component.name}"` };
  }

  await db.transaction(async (tx) => {
    await tx.query("DELETE FROM component_owners WHERE id = $1", [owner.id]);
    await saveUndo(tx, {
      type: "undo_remove_owner",
      payload: {
        componentId: component.id,
        name: owner.name,
        role: owner.role,
        team: owner.team,
      },
      description: `Removed ${owner.name} from ${component.name}`,
    });
  });

  return { success: true };
}

export async function connectComponents(
  db: SqlClient,
  sourceName: string,
  targetName: string,
  input: NewConnectionInput = {}
): Promise<{ connectionId: number } | Failure> {
  const source = await findComponent(db, sourceName);
  if (!source) return notFound(sourceName);
  const target = await findComponent(db, targetName);
  if (!target) return notFound(targetName);

  if (source.id === target.id) {
    return { error: "A component cannot be connected to itself" };
  }

  const kind = input.kind?.trim() || DEFAULT_KIND;

  const connectionId = await db.transaction(async (tx) => {
    const inserted = await tx.query<{ id: number }>(
      `INSERT INTO connections (source_id, target_id, kind, protocol, description)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (source_id, target_id, kind) DO NOTHING
       RETURNING id`,
      [
        source.id,
        target.id,
        kind,
        input.protocol ?? null,
        input.description ?? null,
      ]
    );
    const id = inserted[0]?.id;
    if (id === undefined) return null;
    await saveUndo(tx, {
      type: "undo_connect",
      payload: { connectionIds: [id] },
      description: `Connected ${source.name} -> ${target.name} (${kind})`,
    });
    return id;
  });

  if (connectionId === null) {
    return {
      error: `Connection "${source.name}" -> "${target.name}" (${kind}) already exists`,
    };
  }
  return { connectionId };
}

async function removeConnections(
  db: SqlClient,
  where: string,
  params: unknown[],
  description: (removed: number) => string
): Promise<number> {
  return db.transaction(async (tx) => {
    const removed = await tx.query<ConnectionSnapshot>(
      `DELETE FROM connections WHERE ${where}
       RETURNING source_id, target_id, kind, protocol, description`,
      params
    );
    if (removed.length > 0) {
      await saveUndo(tx, {
        type: "undo_disconnect",
        payload: { connections: removed },
        description: description(removed.length),
      });
    }
    return removed.length;
  });
}

export async function disconnectComponents(
  db: SqlClient,
  sourceName: string,
  targetName: string,
  kind?: string
): Promise<(Success & { removed: number }) | Failure> {
  const source = await findComponent(db, sourceName);
  if (!source) return notFound(sourceName);
  const target = await findComponent(db, targetName);
  if (!target) return notFound(targetName);

  const params: unknown[] = [source.id, target.id];
  let where = "source_id = $1 AND target_id = $2";
  if (kind?.trim()) {
    params.push(kind.trim());
    where += " AND kind = $3";
  }

  const removed = await removeConnections(
    db,
    where,
    params,
    () => `Disconnected ${source.name} -> ${target.name}`
  );
  if (removed === 0) {
    return {
      error: `No connection from "${source.name}" to "${target.name}"`,
    };
  }
  return { success: true, removed };
}

export async function deleteConnectionById(
  db: SqlClient,
  connectionId: number
): Promise<(Success & { removed: number }) | Failure> {
  const removed = await removeConnections(
    db,
    "id = $1",
    [connectionId],
    () => "Removed a connection"
  );
  if (removed === 0) return { error: "Connection not found" };
  return { success: true, removed };
}

/**
 * Merges an extracted model into the map. Components are matched by name
 * (case-insensitively): existing ones are reused untouched, new ones are
 * created. Connections are resolved by component name and deduplicated.
 */
export async function importModel(
  db: SqlClient,
  model: ImportModel,
  origin: { source: string; repoUrl?: string }
): Promise<ImportResult> {
  return db.transaction(async (tx) => {
    const existing = await tx.query<ComponentRef>(
      "SELECT id, name FROM components"
    );
    const byName = new Map<string, ComponentRef>(
      existing.map((c) => [c.name.toLowerCase(), c])
    );

    const result: ImportResult = {
      createdComponents: [],
      reusedComponents: [],
      createdConnections: 0,
      skippedConnections: [],
    };
    const createdComponentIds: number[] = [];
    const createdConnectionIds: number[] = [];
    const seen = new Set<string>();

    for (const component of model.components) {
      const name = component.name.trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);

      const match = byName.get(key);
      if (match) {
        result.reusedComponents.push(match.name);
        continue;
      }

      const id = await insertComponentRow(tx, {
        name,
        type: component.type,
        description: component.description ?? undefined,
        technology: component.technology ?? undefined,
        criticality: component.criticality ?? undefined,
        tags: component.tags,
        repoUrl: origin.repoUrl,
        source: origin.source,
      });
      byName.set(key, { id, name });
      createdComponentIds.push(id);
      result.createdComponents.push(name);
    }

    for (const connection of model.connections) {
      const skip = (reason: string) =>
        result.skippedConnections.push({
          source: connection.source,
          target: connection.target,
          reason,
        });

      const source = byName.get(connection.source.trim().toLowerCase());
      const target = byName.get(connection.target.trim().toLowerCase());
      if (!source || !target) {
        skip("unknown component");
        continue;
      }
      if (source.id === target.id) {
        skip("self-connection");
        continue;
      }

      const inserted = await tx.query<{ id: number }>(
        `INSERT INTO connections (source_id, target_id, kind, protocol, description)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (source_id, target_id, kind) DO NOTHING
         RETURNING id`,
        [
          source.id,
          target.id,
          connection.kind.trim() || DEFAULT_KIND,
          connection.protocol ?? null,
          connection.description ?? null,
        ]
      );
      if (inserted.length === 0) {
        skip("already exists");
        continue;
      }
      createdConnectionIds.push(inserted[0].id);
      result.createdConnections++;
    }

    if (createdComponentIds.length > 0 || createdConnectionIds.length > 0) {
      await saveUndo(tx, {
        type: "undo_import",
        payload: {
          componentIds: createdComponentIds,
          connectionIds: createdConnectionIds,
        },
        description: `Imported ${origin.source}`,
      });
    }

    return result;
  });
}

async function applyUndo(
  tx: SqlClient,
  actionType: string,
  data: Record<string, unknown>
): Promise<boolean> {
  switch (actionType) {
    case "undo_add_component": {
      await tx.query("DELETE FROM components WHERE id = $1", [
        data.componentId,
      ]);
      return true;
    }
    case "undo_delete_component": {
      const c = data.component as Record<string, unknown>;
      // Restore under the original id so snapshotted connections still resolve.
      await tx.query(
        `INSERT INTO components
           (id, name, type, description, technology, criticality, status,
            environment, tags, url, repo_url, notes, source, last_verified)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          c.id,
          c.name,
          c.type,
          c.description ?? null,
          c.technology ?? null,
          c.criticality ?? null,
          c.status ?? null,
          c.environment ?? null,
          c.tags ?? null,
          c.url ?? null,
          c.repo_url ?? null,
          c.notes ?? null,
          c.source ?? "manual",
          c.last_verified ?? new Date().toISOString(),
        ]
      );
      for (const o of (data.owners ?? []) as NewOwnerInput[]) {
        await tx.query(
          "INSERT INTO component_owners (component_id, name, role, team) VALUES ($1, $2, $3, $4)",
          [c.id, o.name, o.role ?? null, o.team ?? null]
        );
      }
      await restoreConnections(
        tx,
        (data.connections ?? []) as ConnectionSnapshot[]
      );
      return true;
    }
    case "undo_update_component": {
      const old = data.old as Record<string, unknown>;
      const columns = Object.keys(old).filter((k) => RESTORABLE_COLUMNS.has(k));
      if (columns.length === 0) return true;
      const setClauses = columns.map((k, i) => `${k} = $${i + 1}`).join(", ");
      const values: unknown[] = columns.map((k) => old[k] ?? null);
      values.push(data.componentId);
      await tx.query(
        `UPDATE components SET ${setClauses} WHERE id = $${values.length}`,
        values
      );
      return true;
    }
    case "undo_rename_component": {
      await tx.query("UPDATE components SET name = $1 WHERE id = $2", [
        data.oldName,
        data.componentId,
      ]);
      return true;
    }
    case "undo_add_owner": {
      await tx.query("DELETE FROM component_owners WHERE id = $1", [
        data.ownerId,
      ]);
      return true;
    }
    case "undo_remove_owner": {
      await tx.query(
        `INSERT INTO component_owners (component_id, name, role, team)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (component_id, name) DO NOTHING`,
        [data.componentId, data.name, data.role ?? null, data.team ?? null]
      );
      return true;
    }
    case "undo_connect": {
      await tx.query("DELETE FROM connections WHERE id = ANY($1::int[])", [
        data.connectionIds,
      ]);
      return true;
    }
    case "undo_disconnect": {
      await restoreConnections(tx, data.connections as ConnectionSnapshot[]);
      return true;
    }
    case "undo_import": {
      await tx.query("DELETE FROM connections WHERE id = ANY($1::int[])", [
        data.connectionIds,
      ]);
      await tx.query("DELETE FROM components WHERE id = ANY($1::int[])", [
        data.componentIds,
      ]);
      return true;
    }
    default:
      return false;
  }
}

export async function undoLastAction(
  db: SqlClient
): Promise<{ success: true; message: string } | Failure> {
  return db.transaction(async (tx) => {
    const rows = await tx.query<{ action_type: string; payload: string }>(
      "SELECT action_type, payload FROM undo_log WHERE id = 1"
    );
    const row = rows[0];
    if (!row) return { error: "Nothing to undo" };

    const data = JSON.parse(row.payload) as Record<string, unknown>;
    const applied = await applyUndo(tx, row.action_type, data);
    if (!applied) {
      return { error: `Unknown undo action: ${row.action_type}` };
    }

    await tx.query("DELETE FROM undo_log WHERE id = 1");
    return { success: true as const, message: `Undone: ${String(data._desc)}` };
  });
}
