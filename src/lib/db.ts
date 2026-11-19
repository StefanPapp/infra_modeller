import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

export interface SqlClient {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<T[]>;
  transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T>;
}

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS components (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    description TEXT,
    technology TEXT,
    criticality TEXT,
    status TEXT,
    environment TEXT,
    tags TEXT,
    url TEXT,
    repo_url TEXT,
    notes TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    last_verified TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS components_name_lower_idx
     ON components (LOWER(name))`,
  `CREATE TABLE IF NOT EXISTS connections (
    id SERIAL PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES components(id) ON DELETE CASCADE,
    target_id INTEGER NOT NULL REFERENCES components(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'depends on',
    protocol TEXT,
    description TEXT,
    CHECK (source_id <> target_id),
    UNIQUE (source_id, target_id, kind)
  )`,
  `CREATE INDEX IF NOT EXISTS connections_target_idx ON connections (target_id)`,
  `CREATE TABLE IF NOT EXISTS component_owners (
    id SERIAL PRIMARY KEY,
    component_id INTEGER NOT NULL REFERENCES components(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    role TEXT,
    team TEXT,
    UNIQUE (component_id, name)
  )`,
  `CREATE TABLE IF NOT EXISTS undo_log (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    action_type TEXT NOT NULL,
    payload TEXT NOT NULL
  )`,
];

export async function initSchema(client: SqlClient): Promise<void> {
  for (const stmt of SCHEMA_STATEMENTS) {
    await client.query(stmt);
  }
}

let _pool: Pool | null = null;
let _initPromise: Promise<void> | null = null;

function getPool(): Pool {
  if (!_pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL not configured");
    _pool = new Pool({ connectionString: url });
  }
  return _pool;
}

function poolClient(pool: Pool): SqlClient {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      const result = await pool.query(text, params as unknown[]);
      return result.rows as T[];
    },
    async transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
      const conn = await pool.connect();
      try {
        await conn.query("BEGIN");
        const tx: SqlClient = {
          async query<U>(text: string, params: unknown[] = []) {
            const r = await conn.query(text, params as unknown[]);
            return r.rows as U[];
          },
          async transaction() {
            throw new Error("nested transactions not supported");
          },
        };
        const out = await fn(tx);
        await conn.query("COMMIT");
        return out;
      } catch (err) {
        await conn.query("ROLLBACK");
        throw err;
      } finally {
        conn.release();
      }
    },
  };
}

type DevGlobal = typeof globalThis & { __infraDevDb?: Promise<SqlClient> };

/**
 * Local development without DATABASE_URL: an in-memory Postgres (PGlite).
 * Cached on globalThis so it survives hot reloads; data is lost on restart.
 */
function getDevDb(): Promise<SqlClient> {
  const g = globalThis as DevGlobal;
  if (!g.__infraDevDb) {
    console.warn(
      "DATABASE_URL is not set: using an in-memory database. Data is lost when the server restarts."
    );
    g.__infraDevDb = import("./db-test")
      .then((m) => m.createTestDb())
      .catch((err) => {
        g.__infraDevDb = undefined;
        throw err;
      });
  }
  return g.__infraDevDb;
}

export async function getDb(): Promise<SqlClient> {
  if (!process.env.DATABASE_URL && process.env.NODE_ENV !== "production") {
    return getDevDb();
  }

  const client = poolClient(getPool());
  if (!_initPromise) {
    _initPromise = initSchema(client).catch((err) => {
      _initPromise = null;
      throw err;
    });
  }
  await _initPromise;
  return client;
}
