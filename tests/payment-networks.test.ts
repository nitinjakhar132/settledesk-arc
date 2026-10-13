import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkoutNetworks,
  CHECKOUT_NETWORK_IDS,
} from "../src/lib/payment-networks";

test("checkout lists at most ten supported networks in a stable familiar order", () => {
  const catalog = [
    { id: 9999 },
    ...CHECKOUT_NETWORK_IDS.toReversed().map((id) => ({ id })),
  ];
  assert.deepEqual(
    checkoutNetworks(catalog).map((chain) => chain.id),
    CHECKOUT_NETWORK_IDS,
  );
  assert.equal(checkoutNetworks(catalog).length, 10);
  assert.deepEqual(checkoutNetworks([{ id: 42161 }, { id: 8453 }]), [
    { id: 8453 },
    { id: 42161 },
  ]);
  assert.deepEqual(checkoutNetworks([{ id: 9999 }]), []);
});
