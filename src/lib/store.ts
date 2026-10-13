import { randomUUID, randomBytes, createHash } from "node:crypto";
import type { Payment, Profile, Mode } from "./model";
import { query } from "./database";
export { atomic } from "./database";

export async function savePayment(payment: Payment) {
  await query(
    "INSERT INTO payments VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
    [payment.id, payment.owner, JSON.stringify(payment)],
  );
  return payment;
}
export async function getPayment(id: string): Promise<Payment | undefined> {
  const [row] = await query<{ payload: string }>(
    "SELECT payload FROM payments WHERE id=$1",
    [id],
  );
  return row ? JSON.parse(row.payload) : undefined;
}
export async function listPayments(owner: string): Promise<Payment[]> {
  const rows = await query<{ payload: string }>(
    "SELECT payload FROM payments WHERE owner=$1",
    [owner],
  );
  return rows
    .map((row) => JSON.parse(row.payload) as Payment)
    .sort((a, b) => b.createdAt - a.createdAt);
}
export async function profile(owner: string): Promise<Profile> {
  const [row] = await query<{ payload: string }>(
    "SELECT payload FROM profiles WHERE owner=$1",
    [owner],
  );
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
export async function saveProfile(owner: string, value: Profile) {
  await query(
    "INSERT INTO profiles VALUES($1,$2) ON CONFLICT(owner) DO UPDATE SET payload=excluded.payload",
    [owner, JSON.stringify(value)],
  );
  return value;
}
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function newSession(owner: string) {
  const token = randomBytes(32).toString("hex");
  await query("DELETE FROM sessions WHERE expires < $1", [Date.now()]);
  await query("INSERT INTO sessions VALUES($1,$2,$3)", [
    hash(token),
    owner,
    Date.now() + 7 * 86400_000,
  ]);
  return token;
}
export async function sessionOwner(token?: string) {
  if (!token) return undefined;
  const [row] = await query<{ owner: string }>(
    "SELECT owner FROM sessions WHERE token=$1 AND expires>$2",
    [hash(token), Date.now()],
  );
  return row?.owner;
}
export async function dropSession(token: string) {
  await query("DELETE FROM sessions WHERE token=$1", [hash(token)]);
}
export async function challenge(origin: string, address: string) {
  const nonce = randomBytes(20).toString("hex");
  const message = `${origin} wants you to sign in to SettleDesk.\n\nWallet: ${address.toLowerCase()}\nThis signature signs you in. It does not authorize a payment.\n\nNonce: ${nonce}\nIssued at: ${new Date().toISOString()}`;
  await query("DELETE FROM challenges WHERE expires < $1", [Date.now()]);
  await query("INSERT INTO challenges VALUES($1,$2,$3)", [
    nonce,
    message,
    Date.now() + 300_000,
  ]);
  return { nonce, message };
}
export async function consumeChallenge(nonce: string) {
  const [row] = await query<{ message: string }>(
    "DELETE FROM challenges WHERE nonce=$1 AND expires>$2 RETURNING message",
    [nonce, Date.now()],
  );
  return row?.message;
}
export async function bindBurn(
  mode: Mode,
  side: string,
  txHash: string,
  target: string,
) {
  const key = `${mode}:${side}:${txHash.toLowerCase()}`;
  await query("INSERT INTO burns VALUES($1,$2) ON CONFLICT(hash) DO NOTHING", [
    key,
    target,
  ]);
  const [row] = await query<{ payment: string }>(
    "SELECT payment FROM burns WHERE hash=$1",
    [key],
  );
  if (row?.payment !== target)
    throw new Error("This transfer is already linked to another payment.");
}
export async function seedDemo() {
  const owner = `demo:${randomUUID()}`;
  await saveProfile(owner, {
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
    await savePayment({
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
export async function advanceDemo(payment: Payment) {
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
