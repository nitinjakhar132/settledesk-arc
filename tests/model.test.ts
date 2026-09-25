import { test } from "node:test";
import assert from "node:assert/strict";
import { concat, pad, toHex, type Hex } from "viem";
import {
  units,
  decimal,
  refundable,
  validateRefund,
  statusOf,
  feeFromBasisPoints,
  configureCheckout,
  paidTotalOf,
  subtotalOf,
  type Payment,
} from "../src/lib/model";
import { referenceHook, validateMessage } from "../src/lib/cctp";
import { network } from "../src/lib/chains";
import { cctpChain, isCctpUsdc } from "../src/lib/cctp-chains";

function payment(): Payment {
  return {
    id: "order-1",
    owner: "merchant",
    mode: "testnet",
    customer: "Test Customer",
    description: "Order",
    reference: "TEST",
    amount: "100",
    merchantName: "Test Shop",
    merchantAddress: "0x1111111111111111111111111111111111111111",
    payerAddress: "0x2222222222222222222222222222222222222222",
    createdAt: Date.now(),
    transfer: { status: "settled", startedAt: Date.now() },
    refunds: [],
  };
}
test("fee rates retain fractional basis points and round up subunits", () => {
  assert.equal(feeFromBasisPoints(100_000_000n, 1.3), 13_000n);
  assert.equal(feeFromBasisPoints(1n, 1), 1n);
  assert.equal(feeFromBasisPoints(100_000_000n, 0), 0n);
  for (const rate of [-1, Infinity, NaN, 10_000])
    assert.throws(() => feeFromBasisPoints(1n, rate));
});
test("USDC arithmetic stays exact through six decimals", () => {
  assert.equal(units("0.000001"), 1n);
  assert.equal(decimal(units("123.123456")), "123.123456");
  assert.equal(decimal(units("0.1") + units("0.2")), "0.3");
  for (const invalid of [
    "-1",
    "0",
    "1e3",
    "NaN",
    "0.0000001",
    "1000001",
    " 1",
    "1.2.3",
  ])
    assert.throws(() => units(invalid));
});
test("a pending refund reserves its balance and prevents a second refund", () => {
  const p = payment();
  p.refunds.push({
    id: "refund-1",
    amount: "40",
    reason: "Customer request",
    status: "processing",
    startedAt: 0,
  });
  assert.equal(refundable(p), "60");
  assert.equal(statusOf(p), "refunding");
  assert.throws(() => validateRefund(p, "40"), /pending refund/);
  assert.throws(() => validateRefund(p, "61"), /remaining/);
});
test("partial then full refunds cannot exceed the original payment", () => {
  const p = payment();
  p.refunds.push({
    id: "r1",
    amount: "40",
    reason: "Return",
    status: "settled",
    startedAt: 0,
  });
  assert.equal(statusOf(p), "partial");
  validateRefund(p, "60");
  p.refunds.push({
    id: "r2",
    amount: "60",
    reason: "Return",
    status: "settled",
    startedAt: 0,
  });
  assert.equal(statusOf(p), "refunded");
  assert.equal(refundable(p), "0");
  assert.throws(() => validateRefund(p, "0.000001"));
});
test("unsettled payments and unverified recipients cannot be refunded", () => {
  const p = payment();
  p.transfer!.status = "ready";
  assert.throws(() => validateRefund(p, "10"), /settle/);
  p.transfer!.status = "settled";
  p.payerAddress = undefined;
  assert.throws(() => validateRefund(p, "10"), /verified/);
});
test("quick-sale checkout adds an exact tip once and rejects expired sales", () => {
  const p = payment();
  p.transfer = undefined;
  p.subtotal = "100";
  p.amount = "100";
  p.tipsEnabled = true;
  p.expiresAt = Date.now() + 60_000;
  configureCheckout(p, "card", "20");
  assert.equal(subtotalOf(p), "100");
  assert.equal(p.tip, "20");
  assert.equal(p.amount, "120");
  configureCheckout(p, "usdc", "15");
  assert.equal(p.amount, "115");

  p.tipsEnabled = false;
  assert.throws(() => configureCheckout(p, "card", "1"), /not enabled/);
  p.expiresAt = Date.now() - 1;
  assert.throws(() => configureCheckout(p, "card", "0"), /expired/);
});
test("tax-enabled sales stay on a calculated checkout rail", () => {
  const p = payment();
  p.transfer = undefined;
  p.collectTax = true;
  p.subtotal = "100";
  p.tipsEnabled = true;
  assert.throws(() => configureCheckout(p, "usdc", "0"), /Tax-enabled/);
  assert.throws(() => configureCheckout(p, "paypal", "0"), /Tax-enabled/);
  assert.throws(() => configureCheckout(p, "crypto", "0"), /Tax-enabled/);
  configureCheckout(p, "card", "10");
  assert.equal(p.amount, "110");
  p.fiat = {
    provider: "stripe",
    method: "card",
    status: "paid",
    externalId: "cs_test",
    tax: "9.08",
    total: "119.08",
  };
  assert.equal(paidTotalOf(p), "119.08");
});
test("Circle-issued USDC is recognized without trusting token symbols", () => {
  const base = cctpChain("mainnet", 8453)!;
  assert.equal(isCctpUsdc("mainnet", 8453, base.usdc), true);
  assert.equal(
    isCctpUsdc("mainnet", 8453, "0x1111111111111111111111111111111111111111"),
    false,
  );
  assert.equal(
    isCctpUsdc("mainnet", 5042, network("mainnet", "arc").usdc),
    false,
  );
});
function message(
  p: Payment,
  changes: {
    recipient?: Hex;
    hook?: Hex;
    amount?: bigint;
    fee?: bigint;
    caller?: Hex;
  } = {},
) {
  const source = network(p.mode, "base");
  const destination = network(p.mode, "arc");
  return concat([
    toHex(1, { size: 4 }),
    toHex(6, { size: 4 }),
    toHex(26, { size: 4 }),
    pad("0x01"),
    pad(source.messenger),
    pad(destination.messenger),
    changes.caller || pad("0x"),
    toHex(2000, { size: 4 }),
    toHex(2000, { size: 4 }),
    toHex(1, { size: 4 }),
    pad(source.usdc),
    changes.recipient || pad(p.merchantAddress as Hex),
    toHex(changes.amount || units(p.amount), { size: 32 }),
    pad(p.payerAddress as Hex),
    toHex(changes.fee || 0n, { size: 32 }),
    toHex(changes.fee || 0n, { size: 32 }),
    pad("0x"),
    changes.hook || referenceHook(p.id),
  ]);
}
test("CCTP message validation binds route, amount, recipient, payer, and invoice", () => {
  const p = payment();
  assert.equal(
    validateMessage(message(p), p, undefined, p.payerAddress).amount,
    100_000_000n,
  );
  assert.throws(
    () =>
      validateMessage(message(p, { recipient: pad(p.payerAddress as Hex) }), p),
    /recipient/,
  );
  assert.throws(
    () =>
      validateMessage(message(p, { hook: referenceHook("wrong-order") }), p),
    /reference/,
  );
  assert.throws(
    () => validateMessage(message(p, { amount: 99_000_000n }), p),
    /amount/,
  );
  assert.throws(() => validateMessage(message(p, { fee: 1n }), p), /amount/);
  assert.throws(
    () =>
      validateMessage(message(p, { caller: pad(p.payerAddress as Hex) }), p),
    /restricted/,
  );
  assert.throws(
    () => validateMessage(message(p), p, undefined, p.merchantAddress),
    /wallet/,
  );
});
