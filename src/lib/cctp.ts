import {
  createPublicClient,
  http,
  decodeEventLog,
  hexToBigInt,
  hexToString,
  slice,
  pad,
  stringToHex,
  type Hex,
} from "viem";
import { network, transmitterAbi, messengerAbi } from "./chains";
import { cctpChain, viemCctpChain, type CctpChain } from "./cctp-chains";
import {
  units,
  decimal,
  feeFromBasisPoints,
  type Mode,
  type Payment,
  type Refund,
  type Transfer,
} from "./model";

export function rpc(mode: Mode, side: "base" | "arc") {
  const config = network(mode, side);
  const url =
    process.env[`${side.toUpperCase()}_${mode.toUpperCase()}_RPC`] ||
    config.chain.rpcUrls.default.http[0];
  return createPublicClient({
    chain: config.chain,
    transport: http(url, { timeout: 15_000, retryCount: 1 }),
  });
}
function sourceConfig(
  payment: Payment,
  refund?: Refund,
  originChainId?: number,
): CctpChain | undefined {
  if (refund) return undefined;
  return cctpChain(
    payment.mode,
    originChainId ?? payment.transfer?.originChainId,
  );
}
function sourceClient(config: CctpChain) {
  return createPublicClient({
    chain: viemCctpChain(config),
    transport: http(config.rpc, { timeout: 15_000, retryCount: 1 }),
  });
}
export function referenceHook(paymentId: string, refundId?: string) {
  return stringToHex(
    `settledesk:${refundId ? `refund:${paymentId}:${refundId}` : `payment:${paymentId}`}`,
  );
}
export function decodeMessage(message: Hex) {
  if (!/^0x[0-9a-fA-F]+$/.test(message) || message.length < 754)
    throw new Error("Invalid CCTP message.");
  const number = (start: number, end: number) =>
    hexToBigInt(slice(message, start, end));
  return {
    version: number(0, 4),
    source: number(4, 8),
    destination: number(8, 12),
    nonce: slice(message, 12, 44),
    sender: slice(message, 44, 76),
    recipient: slice(message, 76, 108),
    caller: slice(message, 108, 140),
    finality: number(144, 148),
    token: slice(message, 152, 184),
    mintRecipient: slice(message, 184, 216),
    amount: number(216, 248),
    depositor: slice(message, 248, 280),
    maxFee: number(280, 312),
    fee: number(312, 344),
    expires: number(344, 376),
    hook: slice(message, 376),
  };
}
export function validateMessage(
  message: Hex,
  payment: Payment,
  refund?: Refund,
  expectedPayer?: string,
  origin?: CctpChain,
) {
  const d = decodeMessage(message);
  const source = origin || network(payment.mode, refund ? "arc" : "base");
  const sourceMessenger = origin
    ? network(payment.mode, "base").messenger
    : network(payment.mode, refund ? "arc" : "base").messenger;
  const destination = network(payment.mode, refund ? "base" : "arc");
  const target = refund ? payment.payerAddress : payment.merchantAddress;
  const equal = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (
    d.version !== 1n ||
    d.source !== BigInt(source.domain) ||
    d.destination !== BigInt(destination.domain)
  )
    throw new Error("The transfer uses a different route.");
  if (
    !equal(d.sender, pad(sourceMessenger)) ||
    !equal(d.recipient, pad(destination.messenger)) ||
    !equal(d.token, pad(source.usdc))
  )
    throw new Error("The transfer is not from the expected Circle contracts.");
  if (!target || !equal(d.mintRecipient, pad(target as Hex)))
    throw new Error("The recipient does not match this payment.");
  if (
    d.fee > d.maxFee ||
    d.maxFee > d.amount ||
    d.amount - d.maxFee < units(refund?.amount || payment.amount)
  )
    throw new Error(
      "The transfer does not cover the requested amount after fees.",
    );
  if (!equal(d.hook, referenceHook(payment.id, refund?.id)))
    throw new Error("The transfer reference does not match this order.");
  if (d.caller !== pad("0x"))
    throw new Error("This transfer requires a restricted destination caller.");
  const payer = refund ? payment.merchantAddress : expectedPayer;
  if (payer && !equal(d.depositor, pad(payer as Hex)))
    throw new Error("The sending wallet does not match.");
  return d;
}
export async function verifyBurn(
  payment: Payment,
  hash: Hex,
  refund?: Refund,
  originChainId?: number,
) {
  const side = refund ? "arc" : "base";
  const origin = sourceConfig(payment, refund, originChainId);
  const config = origin || network(payment.mode, side);
  const contracts = network(payment.mode, side);
  const receipt = await (
    origin ? sourceClient(origin) : rpc(payment.mode, side)
  ).getTransactionReceipt({ hash });
  if (receipt.status !== "success")
    throw new Error("The source transaction did not succeed.");
  // Direct wallet deposits only: routers need a separate, signed refund-destination flow.
  if (receipt.to?.toLowerCase() !== contracts.messenger.toLowerCase())
    throw new Error(
      "Use the direct SettleDesk payment flow for a verified refund address.",
    );
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contracts.transmitter.toLowerCase())
      continue;
    let message: Hex | undefined;
    try {
      const event = decodeEventLog({
        abi: transmitterAbi,
        data: log.data,
        topics: log.topics,
      });
      if (event.eventName === "MessageSent") message = event.args.message;
    } catch {
      continue;
    }
    if (!message) continue;
    validateMessage(message, payment, refund, receipt.from, origin);
    return { payer: receipt.from, message };
  }
  throw new Error("No matching CCTP burn was found in this transaction.");
}
export async function refreshTransfer(
  payment: Payment,
  transfer: Transfer,
  refund?: Refund,
): Promise<Transfer> {
  if (!transfer.burnHash || transfer.status === "settled") return transfer;
  const origin = sourceConfig(payment, refund);
  const source = origin || network(payment.mode, refund ? "arc" : "base");
  const iris =
    payment.mode === "mainnet"
      ? "https://iris-api.circle.com"
      : "https://iris-api-sandbox.circle.com";
  const response = await fetch(
    `${iris}/v2/messages/${source.domain}?transactionHash=${transfer.burnHash}`,
    { cache: "no-store", signal: AbortSignal.timeout(15_000) },
  );
  if (response.status === 404) return transfer;
  if (!response.ok)
    throw new Error(
      "Circle is temporarily unavailable. Your transfer is saved; try refreshing shortly.",
    );
  const data = (await response.json()) as {
    messages?: { message: Hex; attestation: Hex; status: string }[];
  };
  const item = data.messages?.find((item) => {
    try {
      return (
        hexToString(decodeMessage(item.message).hook) ===
        hexToString(referenceHook(payment.id, refund?.id))
      );
    } catch {
      return false;
    }
  });
  if (
    !item ||
    item.status !== "complete" ||
    !/^0x[0-9a-f]+$/i.test(item.attestation)
  )
    return transfer;
  const decoded = validateMessage(
    item.message,
    payment,
    refund,
    payment.payerAddress,
    origin,
  );
  const destination = network(payment.mode, refund ? "base" : "arc");
  const client = rpc(payment.mode, refund ? "base" : "arc");
  // Finalized state, not an attestation or a source-chain receipt, gates fulfillment.
  const used = await client.readContract({
    address: destination.transmitter,
    abi: transmitterAbi,
    functionName: "usedNonces",
    args: [decoded.nonce],
    blockTag: "finalized",
  });
  const block = await client.getBlockNumber();
  const status =
    used === 1n
      ? "settled"
      : decoded.expires > 0n && block >= decoded.expires
        ? "expired"
        : "ready";
  return {
    ...transfer,
    status,
    message: item.message,
    attestation: item.attestation,
    nonce: decoded.nonce,
    fee: decimal(decoded.fee),
    settledAt: status === "settled" ? Date.now() : undefined,
  };
}
export async function standardFee(
  mode: Mode,
  side: "base" | "arc",
  amount: bigint,
) {
  const source = network(mode, side);
  if (side === "arc")
    return rpc(mode, side).readContract({
      address: source.messenger,
      abi: messengerAbi,
      functionName: "getMinFeeAmount",
      args: [amount],
    });
  // Base's deployed V2 messenger predates the fee switch and has no getMinFeeAmount.
  // Query the documented route fee; never turn an RPC failure into an assumed zero fee.
  const response = await fetch(
    `${source.iris}/v2/burn/USDC/fees/${source.domain}/26`,
    { cache: "no-store", signal: AbortSignal.timeout(15_000) },
  );
  if (!response.ok)
    throw new Error(
      "Circle’s fee service is unavailable. Please try again shortly.",
    );
  const rows: unknown = await response.json();
  if (!Array.isArray(rows))
    throw new Error("Circle returned an invalid fee quote.");
  const row = rows.find(
    (value: { finalityThreshold?: number }) => value.finalityThreshold === 2000,
  );
  if (!row || typeof row.minimumFee !== "number")
    throw new Error(
      "Circle did not return a Standard Transfer quote for this route.",
    );
  return feeFromBasisPoints(amount, row.minimumFee);
}
async function sourceFee(mode: Mode, source: CctpChain, amount: bigint) {
  const iris =
    mode === "mainnet"
      ? "https://iris-api.circle.com"
      : "https://iris-api-sandbox.circle.com";
  const response = await fetch(
    `${iris}/v2/burn/USDC/fees/${source.domain}/26`,
    { cache: "no-store", signal: AbortSignal.timeout(15_000) },
  );
  if (!response.ok)
    throw new Error(
      "Circle’s fee service is unavailable. Please try again shortly.",
    );
  const rows: unknown = await response.json();
  if (!Array.isArray(rows))
    throw new Error("Circle returned an invalid fee quote.");
  const row = rows.find(
    (value: { finalityThreshold?: number }) => value.finalityThreshold === 2000,
  );
  if (!row || typeof row.minimumFee !== "number")
    throw new Error(
      "Circle did not return a Standard Transfer quote for this route.",
    );
  return feeFromBasisPoints(amount, row.minimumFee);
}
export async function quote(
  payment: Payment,
  refund?: Refund,
  originChainId?: number,
) {
  const side = refund ? "arc" : "base";
  const origin = sourceConfig(payment, refund, originChainId);
  if (!refund && originChainId !== undefined && !origin)
    throw new Error("CCTP is not available from that source chain.");
  const net = units(refund?.amount || payment.amount);
  let gross = net;
  // Gross up so the recipient gets the requested amount, even with standard fees.
  for (let i = 0; i < 12; i++) {
    const fee = origin
      ? await sourceFee(payment.mode, origin, gross)
      : await standardFee(payment.mode, side, gross);
    if (gross - fee >= net)
      return {
        amount: gross.toString(),
        maxFee: fee.toString(),
        total: decimal(gross),
        fee: decimal(fee),
        receive: decimal(net),
      };
    gross = net + fee;
  }
  throw new Error("Unable to calculate a stable fee quote. Please try again.");
}
export async function verifyMint(
  payment: Payment,
  transfer: Transfer,
  hash: Hex,
  refund?: Refund,
) {
  if (!transfer.message)
    throw new Error(
      "Refresh Circle verification before linking a destination transaction.",
    );
  const expected = validateMessage(
    transfer.message as Hex,
    payment,
    refund,
    payment.payerAddress,
    sourceConfig(payment, refund),
  );
  const side = refund ? "base" : "arc";
  const destination = network(payment.mode, side);
  const receipt = await rpc(payment.mode, side).getTransactionReceipt({ hash });
  if (receipt.status !== "success")
    throw new Error("The destination transaction did not succeed.");
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== destination.transmitter.toLowerCase())
      continue;
    try {
      const event = decodeEventLog({
        abi: transmitterAbi,
        data: log.data,
        topics: log.topics,
      });
      if (
        event.eventName === "MessageReceived" &&
        event.args.nonce.toLowerCase() === expected.nonce.toLowerCase() &&
        event.args.sourceDomain === Number(expected.source) &&
        event.args.sender.toLowerCase() === expected.sender.toLowerCase() &&
        event.args.messageBody.toLowerCase() ===
          slice(transfer.message as Hex, 148).toLowerCase()
      )
        return;
    } catch {
      continue;
    }
  }
  throw new Error(
    "This destination transaction does not belong to the payment.",
  );
}
export async function reattest(
  payment: Payment,
  transfer: Transfer,
  refund?: Refund,
) {
  if (!transfer.nonce || transfer.status !== "expired")
    throw new Error("Only expired transfers need a fresh attestation.");
  const source = network(payment.mode, refund ? "arc" : "base");
  const response = await fetch(`${source.iris}/v2/reattest/${transfer.nonce}`, {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(
      "Circle could not refresh the attestation yet. Please retry shortly.",
    );
}
