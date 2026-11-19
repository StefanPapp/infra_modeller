import type { SqlClient } from "./db";
import type {
  ComponentDetail,
  ConnectionRef,
  GraphLink,
  GraphNode,
  InfraGraph,
  OwnerDetail,
} from "./types";

export async function getGraph(db: SqlClient): Promise<InfraGraph> {
  const nodes = await db.query<GraphNode>(
    `SELECT id, name, type, technology, criticality, status
     FROM components
     ORDER BY type, name`
  );
  const links = await db.query<GraphLink>(
    `SELECT id, source_id AS source, target_id AS target, kind, protocol
     FROM connections
     ORDER BY id`
  );
  return { nodes, links };
}

export async function listComponentNames(
  db: SqlClient
): Promise<{ name: string; type: string }[]> {
  return db.query<{ name: string; type: string }>(
    "SELECT name, type FROM components ORDER BY name"
  );
}

interface ComponentRowDb {
  id: number;
  name: string;
  type: string;
  description: string | null;
  technology: string | null;
  criticality: string | null;
  status: string | null;
  environment: string | null;
  tags: string | null;
  url: string | null;
  repo_url: string | null;
  notes: string | null;
  source: string;
  last_verified: string | Date | null;
}

interface ConnectionRowDb {
  id: number;
  component_id: number;
  component_name: string;
  component_type: string;
  kind: string;
  protocol: string | null;
  description: string | null;
}

function toIso(value: string | Date | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

export function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((t): t is string => typeof t === "string")
      : [];
  } catch {
    return [];
  }
}

function toConnectionRef(row: ConnectionRowDb): ConnectionRef {
  return {
    id: row.id,
    componentId: row.component_id,
    componentName: row.component_name,
    componentType: row.component_type,
    kind: row.kind,
    protocol: row.protocol,
    description: row.description,
  };
}

export async function getComponentById(
  db: SqlClient,
  id: number
): Promise<ComponentDetail | null> {
  const rows = await db.query<ComponentRowDb>(
    "SELECT * FROM components WHERE id = $1",
    [id]
  );
  const row = rows[0];
  if (!row) return null;

  const [owners, outgoing, incoming] = await Promise.all([
    db.query<OwnerDetail>(
      "SELECT id, name, role, team FROM component_owners WHERE component_id = $1 ORDER BY name",
      [id]
    ),
    db.query<ConnectionRowDb>(
      `SELECT cn.id, c.id AS component_id, c.name AS component_name,
              c.type AS component_type, cn.kind, cn.protocol, cn.description
       FROM connections cn
       JOIN components c ON c.id = cn.target_id
       WHERE cn.source_id = $1
       ORDER BY c.name, cn.kind`,
      [id]
    ),
    db.query<ConnectionRowDb>(
      `SELECT cn.id, c.id AS component_id, c.name AS component_name,
              c.type AS component_type, cn.kind, cn.protocol, cn.description
       FROM connections cn
       JOIN components c ON c.id = cn.source_id
       WHERE cn.target_id = $1
       ORDER BY c.name, cn.kind`,
      [id]
    ),
  ]);

  return {
    id: row.id,
    name: row.name,
    type: row.type,
    description: row.description,
    technology: row.technology,
    criticality: row.criticality,
    status: row.status,
    environment: row.environment,
    tags: parseTags(row.tags),
    url: row.url,
    repoUrl: row.repo_url,
    notes: row.notes,
    source: row.source,
    lastVerified: toIso(row.last_verified),
    owners,
    outgoing: outgoing.map(toConnectionRef),
    incoming: incoming.map(toConnectionRef),
  };
}
