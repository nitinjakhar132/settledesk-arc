import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as store from "../src/lib/store";

process.env.SETTLEDESK_DB = join(
  mkdtempSync(join(tmpdir(), "settledesk-storage-")),
  "test.db",
);
delete process.env.DATABASE_URL;
delete process.env.VERCEL;
const owner = "0x1111111111111111111111111111111111111111";

test("sessions survive a fresh server process using shared storage", async () => {
  const token = await store.newSession(owner);
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      "import {sessionOwner} from './src/lib/store.ts'; console.log(await sessionOwner(process.env.TEST_SESSION));",
    ],
    { cwd: process.cwd(), env: { ...process.env, TEST_SESSION: token } },
  );
  assert.equal(stdout.trim(), owner);
  await store.dropSession(token);
  assert.equal(await store.sessionOwner(token), undefined);
});

test("simultaneous login verification consumes a challenge only once", async () => {
  const challenge = await store.challenge("https://example.com", owner);
  const results = await Promise.all([
    store.consumeChallenge(challenge.nonce),
    store.consumeChallenge(challenge.nonce),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
});

test("failed store transactions roll back profile changes", async () => {
  await store.saveProfile(owner, {
    name: "Original",
    mode: "testnet",
    address: owner,
  });
  await assert.rejects(
    store.atomic(async () => {
      await store.saveProfile(owner, {
        name: "Unsaved",
        mode: "testnet",
        address: owner,
      });
      throw new Error("rollback-test");
    }),
    /rollback-test/,
  );
  assert.equal((await store.profile(owner)).name, "Original");
});

test("Vercel never silently falls back to temporary SQLite", async () => {
  process.env.VERCEL = "1";
  try {
    await assert.rejects(
      store.newSession(owner),
      /Shared database is not configured/,
    );
  } finally {
    delete process.env.VERCEL;
  }
});
