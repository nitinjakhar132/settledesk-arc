import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import * as store from "../src/lib/store";
import { query } from "../src/lib/database";

async function main() {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required");
  const owner = `0x${randomBytes(20).toString("hex")}`;
  const paymentId = randomUUID();
  let token: string | undefined;
  try {
    await store.saveProfile(owner, {
      name: "Storage verification",
      mode: "testnet",
      address: owner,
    });
    token = await store.newSession(owner);
    await store.savePayment({
      id: paymentId,
      owner,
      mode: "testnet",
      customer: "Storage check",
      description: "Unpaid storage verification; no funds move",
      amount: "1",
      reference: "STORAGE-CHECK",
      merchantAddress: owner,
      merchantName: "Storage verification",
      createdAt: Date.now(),
      refunds: [],
    });
    const child = await promisify(execFile)(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        "import {sessionOwner,getPayment} from './src/lib/store.ts'; console.log(JSON.stringify({owner:await sessionOwner(process.env.CHECK_SESSION),payment:(await getPayment(process.env.CHECK_PAYMENT))?.id}));",
      ],
      {
        env: { ...process.env, CHECK_SESSION: token, CHECK_PAYMENT: paymentId },
        timeout: 30000,
      },
    );
    assert.deepEqual(JSON.parse(child.stdout.trim()), {
      owner,
      payment: paymentId,
    });
    console.log(
      "PASS: session and payment survive an independent server process",
    );
    const challenge = await store.challenge(
      "https://settledesk-arc.vercel.app",
      owner,
    );
    const answers = await Promise.all([
      store.consumeChallenge(challenge.nonce),
      store.consumeChallenge(challenge.nonce),
    ]);
    assert.equal(answers.filter(Boolean).length, 1);
    console.log("PASS: PostgreSQL challenge consumption rejects replay");
    await assert.rejects(
      store.atomic(async () => {
        await store.saveProfile(owner, {
          name: "Must roll back",
          mode: "testnet",
          address: owner,
        });
        throw new Error("rollback-check");
      }),
      /rollback-check/,
    );
    assert.equal((await store.profile(owner)).name, "Storage verification");
    console.log("PASS: PostgreSQL transaction rollback");
  } finally {
    if (token) await store.dropSession(token);
    await query("DELETE FROM payments WHERE id=$1 AND owner=$2", [
      paymentId,
      owner,
    ]);
    await query("DELETE FROM profiles WHERE owner=$1", [owner]);
  }
}
main().catch((error) => {
  console.error(
    "Shared storage verification failed:",
    (error as { code?: string }).code ||
      (error instanceof assert.AssertionError
        ? error.message
        : "database operation failed"),
  );
  process.exitCode = 1;
});
