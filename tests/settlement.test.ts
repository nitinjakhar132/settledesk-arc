import { test } from "node:test";
import assert from "node:assert/strict";
import { concat, pad, toHex, type Hex } from "viem";
import { refreshTransfer, referenceHook, standardFee } from "../src/lib/cctp";
import { network } from "../src/lib/chains";
import type { Payment } from "../src/lib/model";

const p: Payment = {
  id: "settlement-test",
  owner: "merchant",
  mode: "testnet",
  customer: "Buyer",
  merchantName: "Shop",
  merchantAddress: "0x1111111111111111111111111111111111111111",
  payerAddress: "0x2222222222222222222222222222222222222222",
  description: "Test",
  reference: "TEST",
  amount: "100",
  createdAt: 0,
  refunds: [],
  transfer: { status: "processing", startedAt: 0, burnHash: pad("0x01") },
};
function signedMessage(recipient = p.merchantAddress, expires = 0n) {
  const config = network(p.mode, "base");
  return concat([
    toHex(1, { size: 4 }),
    toHex(6, { size: 4 }),
    toHex(26, { size: 4 }),
    pad("0x02"),
    pad(config.messenger),
    pad(config.messenger),
    pad("0x"),
    toHex(2000, { size: 4 }),
    toHex(2000, { size: 4 }),
    toHex(1, { size: 4 }),
    pad(config.usdc),
    pad(recipient as Hex),
    toHex(100_000_000n, { size: 32 }),
    pad(p.payerAddress as Hex),
    pad("0x"),
    pad("0x"),
    toHex(expires, { size: 32 }),
    referenceHook(p.id),
  ]);
}

test("Circle attestation alone is not settlement; finalized destination state is required", async (t) => {
  let used = false;
  const blockTags: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes("iris-api"))
        return Response.json({
          messages: [
            {
              status: "complete",
              message: signedMessage(),
              attestation: "0x1234",
            },
          ],
        });
      const body = JSON.parse(String(init?.body));
      if (body.method === "eth_call") {
        blockTags.push(body.params[1]);
        return Response.json({
          id: body.id,
          jsonrpc: "2.0",
          result: toHex(used ? 1 : 0, { size: 32 }),
        });
      }
      if (body.method === "eth_blockNumber")
        return Response.json({ id: body.id, jsonrpc: "2.0", result: "0x100" });
      throw new Error(`Unexpected RPC method: ${body.method}`);
    },
  );
  const attested = await refreshTransfer(p, p.transfer!);
  assert.equal(attested.status, "ready");
  assert.equal(attested.settledAt, undefined);
  used = true;
  const settled = await refreshTransfer(p, attested);
  assert.equal(settled.status, "settled");
  assert.ok(settled.settledAt);
  assert.deepEqual(blockTags, ["finalized", "finalized"]);
});

test("a mismatched attested recipient never reaches destination verification", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      messages: [
        {
          status: "complete",
          message: signedMessage(p.payerAddress),
          attestation: "0x1234",
        },
      ],
    }),
  );
  await assert.rejects(refreshTransfer(p, p.transfer!), /recipient/);
});

test("Base fee lookup fails closed on missing or invalid Standard Transfer quotes", async (t) => {
  let payload: unknown = [{ finalityThreshold: 1000, minimumFee: 1.3 }];
  t.mock.method(globalThis, "fetch", async () => Response.json(payload));
  await assert.rejects(
    standardFee("testnet", "base", 100_000_000n),
    /Standard Transfer/,
  );
  payload = [{ finalityThreshold: 2000, minimumFee: 0 }];
  assert.equal(await standardFee("testnet", "base", 100_000_000n), 0n);
  payload = [{ finalityThreshold: 2000, minimumFee: -1 }];
  await assert.rejects(
    standardFee("testnet", "base", 100_000_000n),
    /invalid fee/,
  );
});
