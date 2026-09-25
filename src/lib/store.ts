import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import type { Payment, Profile, Mode } from "./model";

const globalDb = globalThis as unknown as { settledeskDb?: DatabaseSync };
function db() {
  if (!globalDb.settledeskDb) {
    const path =
      process.env.SETTLEDESK_DB ||
      (process.env.VERCEL
        ? resolve("/tmp", "settledesk.db")
        : resolve("data/settledesk.db"));
    mkdirSync(dirname(path), { recursive: true });
    const database = new DatabaseSync(path);
    database.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY, owner TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS payments_owner ON payments(owner);
      CREATE TABLE IF NOT EXISTS profiles(owner TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS challenges(nonce TEXT PRIMARY KEY, message TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS burns(hash TEXT PRIMARY KEY, payment TEXT NOT NULL);
    `);
    globalDb.settledeskDb = database;
  }
  return globalDb.settledeskDb;
}
export function atomic<T>(operation: () => T): T {
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
export function savePayment(p: Payment) {
  db()
    .prepare(
      "INSERT INTO payments VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
    )
    .run(p.id, p.owner, JSON.stringify(p));
  return p;
}
export function getPayment(id: string): Payment | undefined {
  const row = db()
    .prepare("SELECT payload FROM payments WHERE id=?")
    .get(id) as { payload: string } | undefined;
  return row ? JSON.parse(row.payload) : undefined;
}
export function listPayments(owner: string): Payment[] {
  return (
    db().prepare("SELECT payload FROM payments WHERE owner=?").all(owner) as {
      payload: string;
    }[]
  )
    .map((r) => JSON.parse(r.payload))
    .sort((a, b) => b.createdAt - a.createdAt);
}
export function profile(owner: string): Profile {
  const row = db()
    .prepare("SELECT payload FROM profiles WHERE owner=?")
    .get(owner) as { payload: string } | undefined;
  return row
    ? JSON.parse(row.payload)
    : {
        name: "My store",
        mode:
          process.env.SETTLEDESK_DEFAULT_NETWORK === "mainnet"
            ? "mainnet"
            : "testnet",
        address: owner,
        collectTax: false,
      };
}
export function saveProfile(owner: string, p: Profile) {
  db()
    .prepare("INSERT OR REPLACE INTO profiles VALUES(?,?)")
    .run(owner, JSON.stringify(p));
  return p;
}
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function newSession(owner: string) {
  const token = randomBytes(32).toString("hex");
  db().prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
  db()
    .prepare("INSERT INTO sessions VALUES(?,?,?)")
    .run(hash(token), owner, Date.now() + 7 * 86400_000);
  return token;
}
export function sessionOwner(token?: string) {
  if (!token) return undefined;
  return (
    db()
      .prepare("SELECT owner FROM sessions WHERE token=? AND expires>?")
      .get(hash(token), Date.now()) as { owner: string } | undefined
  )?.owner;
}
export function dropSession(token: string) {
  db().prepare("DELETE FROM sessions WHERE token=?").run(hash(token));
}
export function challenge(origin: string, address: string) {
  const nonce = randomBytes(20).toString("hex");
  const message = `${origin} wants you to sign in to SettleDesk.\n\nWallet: ${address.toLowerCase()}\nThis signature signs you in. It does not authorize a payment.\n\nNonce: ${nonce}\nIssued at: ${new Date().toISOString()}`;
  db().prepare("DELETE FROM challenges WHERE expires < ?").run(Date.now());
  db()
    .prepare("INSERT INTO challenges VALUES(?,?,?)")
    .run(nonce, message, Date.now() + 300_000);
  return { nonce, message };
}
export function consumeChallenge(nonce: string) {
  return atomic(() => {
    const row = db()
      .prepare("SELECT message FROM challenges WHERE nonce=? AND expires>?")
      .get(nonce, Date.now()) as { message: string } | undefined;
    db().prepare("DELETE FROM challenges WHERE nonce=?").run(nonce);
    return row?.message;
  });
}
export function bindBurn(
  mode: Mode,
  side: string,
  txHash: string,
  target: string,
) {
  const key = `${mode}:${side}:${txHash.toLowerCase()}`;
  const existing = db()
    .prepare("SELECT payment FROM burns WHERE hash=?")
    .get(key) as { payment: string } | undefined;
  if (existing && existing.payment !== target)
    throw new Error("This transfer is already linked to another payment.");
  db().prepare("INSERT OR IGNORE INTO burns VALUES(?,?)").run(key, target);
}
export function seedDemo() {
  const owner = `demo:${randomUUID()}`;
  saveProfile(owner, {
    name: "Studio North",
    mode: "demo",
    collectTax: false,
  });
  const rows = [
    ["Emma Wilson", "Brand identity", "480", "settled", 6],
    ["Alex Chen", "Website deposit", "1250", "ready", 24],
    ["Olivia Park", "Art direction", "320", "settled", 49],
    ["Liam Davis", "Print collection", "95", "refunded", 120],
    ["Sofia Rivera", "Strategy session", "180", "requested", 240],
    ["Noah Williams", "Monthly retainer", "2400", "settled", 1500],
    ["Mia Thompson", "Product photography", "680", "settled", 2800],
    ["James Lee", "Design sprint", "960", "settled", 4000],
  ] as const;
  for (const [i, row] of rows.entries()) {
    const [customer, description, amount, status, minutes] = row;
    const createdAt = Date.now() - minutes * 60_000;
    savePayment({
      id: randomUUID(),
      owner,
      mode: "demo",
      customer,
      description,
      amount,
      reference: `SD-${1048 - i}`,
      merchantName: "Studio North",
      merchantAddress: "0x1111111111111111111111111111111111111111",
      payerAddress: "0x2222222222222222222222222222222222222222",
      createdAt,
      transfer:
        status === "requested"
          ? undefined
          : {
              status: status === "ready" ? "ready" : "settled",
              startedAt: createdAt,
              settledAt: status === "ready" ? undefined : createdAt + 30_000,
              manual: status === "ready",
            },
      refunds:
        status === "refunded"
          ? [
              {
                id: randomUUID(),
                amount,
                reason: "Customer request",
                status: "settled",
                startedAt: createdAt + 60_000,
                settledAt: createdAt + 90_000,
              },
            ]
          : [],
    });
  }
  return owner;
}
export function advanceDemo(payment: Payment) {
  if (payment.mode !== "demo") return payment;
  const advance = (transfer: NonNullable<Payment["transfer"]>) => {
    if (transfer.manual || transfer.status === "settled") return;
    const age = Date.now() - transfer.startedAt;
    if (age > 8500) {
      transfer.status = "settled";
      transfer.settledAt = transfer.startedAt + 8500;
    } else if (age > 4500) transfer.status = "ready";
  };
  if (payment.transfer) advance(payment.transfer);
  payment.refunds.forEach(advance);
  return savePayment(payment);
}
