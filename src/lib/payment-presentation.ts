import { cctpChain } from "./cctp-chains";
import { network } from "./chains";
import type { Payment, Refund } from "./model";

export function paymentRoute(payment: Payment, refund?: Refund) {
  const transfer = refund || payment.transfer;
  const rail = transfer?.rail || (transfer?.message ? "cctp" : undefined);
  const sourceId = refund
    ? network(payment.mode, "arc").chain.id
    : (transfer?.originChainId ??
      (rail === "cctp" ? network(payment.mode, "base").chain.id : undefined));
  const source =
    sourceId === network(payment.mode, "arc").chain.id
      ? {
          name: "Arc",
          explorer: network(payment.mode, "arc").chain.blockExplorers!.default
            .url,
        }
      : sourceId !== undefined
        ? cctpChain(payment.mode, sourceId)
        : undefined;
  return {
    rail,
    origin: source?.name || (sourceId ? `Chain ${sourceId}` : "Buyer wallet"),
    destination: refund ? "Base" : "Arc",
    symbol:
      refund || rail === "cctp" ? "USDC" : transfer?.originSymbol || "Token",
    sourceExplorer: source?.explorer,
  };
}
