import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Pool, type PoolClient } from "pg";

const schema = `
  CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY, owner TEXT NOT NULL, payload TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS payments_owner ON payments(owner);
  CREATE TABLE IF NOT EXISTS profiles(owner TEXT PRIMARY KEY, payload TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, owner TEXT NOT NULL, expires BIGINT NOT NULL);
  CREATE TABLE IF NOT EXISTS challenges(nonce TEXT PRIMARY KEY, message TEXT NOT NULL, expires BIGINT NOT NULL);
  CREATE TABLE IF NOT EXISTS burns(hash TEXT PRIMARY KEY, payment TEXT NOT NULL);
`;
const transaction = new AsyncLocalStorage<PoolClient | DatabaseSync>();
let pool: Pool | undefined;
let initialized: Promise<void> | undefined;
let sqlite: DatabaseSync | undefined;
let localQueue: Promise<unknown> = Promise.resolve();

async function localExclusive<T>(operation: () => Promise<T>): Promise<T> {
  const result = localQueue.then(operation, operation);
  localQueue = result.catch(() => {});
  return result;
}

function localDatabase() {
  if (process.env.VERCEL)
    throw new Error(
      "Shared database is not configured. Connect DATABASE_URL before accepting payments.",
    );
  if (!sqlite) {
    const path = process.env.SETTLEDESK_DB || resolve("data/settledesk.db");
    mkdirSync(dirname(path), { recursive: true });
    sqlite = new DatabaseSync(path);
    sqlite.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
    sqlite.exec(schema);
  }
  return sqlite;
}

async function postgresPool() {
  if (!pool)
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 10000,
    });
  if (!initialized)
    initialized = (async () => {
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(5042002)");
        await client.query(schema);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        initialized = undefined;
        throw error;
      } finally {
        client.release();
      }
    })();
  await initialized;
  return pool;
}

export async function query<
  T extends Record<string, unknown> = Record<string, unknown>,
>(sql: string, parameters: SQLInputValue[] = []): Promise<T[]> {
  const current = transaction.getStore();
  if (current && !(current instanceof DatabaseSync))
    return (await current.query(sql, parameters)).rows as T[];
  if (process.env.DATABASE_URL)
    return (await (await postgresPool()).query(sql, parameters)).rows as T[];
  const execute = async () => {
    const values: SQLInputValue[] = [];
    const statement = (
      (current as DatabaseSync | undefined) || localDatabase()
    ).prepare(
      sql.replace(/\$(\d+)/g, (_, position) => {
        values.push(parameters[Number(position) - 1]);
        return "?";
      }),
    );
    return statement.all(...values) as T[];
  };
  return current ? execute() : localExclusive(execute);
}

export async function atomic<T>(operation: () => Promise<T>): Promise<T> {
  if (transaction.getStore()) return operation();
  if (!process.env.DATABASE_URL)
    return localExclusive(async () => {
      const database = localDatabase();
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = await transaction.run(database, operation);
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    });
  const database = await postgresPool();
  for (let attempt = 0; ; attempt++) {
    const client = await database.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const result = await transaction.run(client, operation);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      if (
        attempt < 2 &&
        ["40001", "40P01"].includes((error as { code?: string }).code || "")
      )
        continue;
      throw error;
    } finally {
      client.release();
    }
  }
}
