import { PGlite } from "@electric-sql/pglite";
import { initSchema, type SqlClient } from "./db";

export async function createTestDb(): Promise<SqlClient> {
  const pg = new PGlite();
  const client: SqlClient = {
    async query<T>(text: string, params: unknown[] = []) {
      const r = await pg.query<T>(text, params as unknown[]);
      return r.rows as T[];
    },
    async transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
      const result = await pg.transaction(async (txn) => {
        const tx: SqlClient = {
          async query<U>(text: string, params: unknown[] = []) {
            const r = await txn.query<U>(text, params as unknown[]);
            return r.rows as U[];
          },
          async transaction() {
            throw new Error("nested transactions not supported");
          },
        };
        return fn(tx);
      });
      return result as T;
    },
  };
  await initSchema(client);
  return client;
}
