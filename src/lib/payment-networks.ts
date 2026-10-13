// A curated checkout shortlist, not a live ranking. Only supported catalog
// entries are shown, and their current names/tokens still come from Relay.
export const CHECKOUT_NETWORK_IDS = [
  8453, 1, 42161, 10, 137, 43114, 56, 5042, 59144, 324,
] as const;
export function checkoutNetworks<T extends { id: number }>(chains: T[]): T[] {
  return CHECKOUT_NETWORK_IDS.flatMap((id) => {
    const chain = chains.find((value) => value.id === id);
    return chain ? [chain] : [];
  });
}
