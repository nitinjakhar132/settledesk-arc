import {
  createPublicClient,
  decodeEventLog,
  erc20Abi,
  http,
  isAddress,
  type Address,
  type Hex,
} from "viem";
import { network } from "./chains";
import { isCctpUsdc } from "./cctp-chains";
import { units, type Payment } from "./model";

const RELAY_MAINNET = "https://api.relay.link";

type RelayToken = {
  id?: string;
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  supportsBridging?: boolean;
  metadata?: { logoURI?: string };
};
type RelayChainResponse = {
  id: number;
  name: string;
  displayName: string;
  httpRpcUrl: string;
  iconUrl?: string;
  disabled?: boolean;
  depositEnabled?: boolean;
  tokenSupport?: string;
  vmType?: string;
  currency?: RelayToken;
  featuredTokens?: RelayToken[];
  erc20Currencies?: RelayToken[];
};

async function relayFetch(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (init?.body) headers.set("Content-Type", "application/json");
  if (process.env.RELAY_API_KEY)
    headers.set("x-api-key", process.env.RELAY_API_KEY);
  const response = await fetch(`${RELAY_MAINNET}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = data as { message?: string; errorCode?: string };
    throw new Error(
      error.message || error.errorCode || "Relay could not build this route.",
    );
  }
  return data;
}

async function chains(): Promise<RelayChainResponse[]> {
  const data = (await relayFetch("/chains")) as {
    chains?: RelayChainResponse[];
  };
  return data.chains || [];
}

function uniqueTokens(chain: RelayChainResponse) {
  const values = [
    chain.currency,
    ...(chain.featuredTokens || []),
    ...(chain.erc20Currencies || []),
  ].filter(Boolean) as RelayToken[];
  const seen = new Set<string>();
  return values.filter((token) => {
    const key = token.address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return token.supportsBridging !== false;
  });
}

export async function relayCatalog() {
  const rows = await chains();
  return {
    chains: rows
      .filter(
        (chain) =>
          !chain.disabled &&
          chain.depositEnabled !== false &&
          chain.vmType === "evm",
      )
      .map((chain) => ({
        id: chain.id,
        name: chain.name,
        displayName: chain.displayName,
        iconUrl: chain.iconUrl,
        tokenSupport: chain.tokenSupport,
        tokens: uniqueTokens(chain),
      }))
      .filter((chain) => chain.tokens.length > 0),
  };
}

export async function createRelayQuote(
  payment: Payment,
  input: {
    originChainId: number;
    originCurrency: string;
    originSymbol: string;
    payer: string;
  },
) {
  if (payment.mode !== "mainnet")
    throw new Error("Any-token Relay payments are available on mainnet.");
  if (!isAddress(input.payer)) throw new Error("Connect a valid EVM wallet.");
  if (isCctpUsdc("mainnet", input.originChainId, input.originCurrency))
    throw new Error("USDC on this chain must use the protected CCTP route.");
  const arcUsdc = network("mainnet", "arc").usdc;
  const raw = (await relayFetch("/quote/v2", {
    method: "POST",
    body: JSON.stringify({
      user: input.payer,
      originChainId: input.originChainId,
      destinationChainId: 5042,
      originCurrency: input.originCurrency,
      destinationCurrency: arcUsdc,
      amount: units(payment.amount).toString(),
      tradeType: "EXACT_OUTPUT",
      recipient: payment.merchantAddress,
      refundTo: input.payer,
      explicitDeposit: true,
    }),
  })) as Record<string, unknown>;
  const requestId = raw.requestId;
  if (typeof requestId !== "string" || !requestId)
    throw new Error("Relay returned an invalid payment quote.");
  payment.pendingRelay = {
    requestId,
    originChainId: input.originChainId,
    originCurrency: input.originCurrency,
    originSymbol: input.originSymbol.slice(0, 16),
    payer: input.payer.toLowerCase(),
    quotedAt: Date.now(),
  };
  return raw;
}

export async function verifyRelayPayment(payment: Payment, requestId: string) {
  const pending = payment.pendingRelay;
  if (!pending || pending.requestId !== requestId)
    throw new Error("This Relay quote does not belong to the sale.");
  if (Date.now() - pending.quotedAt > 30 * 60_000)
    throw new Error("This Relay quote expired. Request a fresh route.");
  const status = (await relayFetch(
    `/intents/status/v3?requestId=${encodeURIComponent(requestId)}`,
  )) as {
    status?: string;
    inTxHashes?: string[];
    txHashes?: string[];
    originChainId?: number;
    destinationChainId?: number;
  };
  if (status.status !== "success")
    throw new Error("Relay is still settling this payment. Refresh shortly.");
  if (
    status.originChainId !== pending.originChainId ||
    status.destinationChainId !== 5042
  )
    throw new Error("Relay reported a different payment route.");
  const destinationHash = status.txHashes?.find((hash) =>
    /^0x[0-9a-fA-F]{64}$/.test(hash),
  ) as Hex | undefined;
  const inputHash = status.inTxHashes?.find((hash) =>
    /^0x[0-9a-fA-F]{64}$/.test(hash),
  ) as Hex | undefined;
  if (!destinationHash || !inputHash)
    throw new Error("Relay has not published both transaction proofs yet.");

  const arc = network("mainnet", "arc");
  const arcClient = createPublicClient({
    chain: arc.chain,
    transport: http(arc.chain.rpcUrls.default.http[0]),
  });
  const receipt = await arcClient.getTransactionReceipt({
    hash: destinationHash,
  });
  if (receipt.status !== "success")
    throw new Error("Relay’s Arc settlement transaction failed.");
  let received = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== arc.usdc.toLowerCase()) continue;
    try {
      const event = decodeEventLog({
        abi: erc20Abi,
        eventName: "Transfer",
        data: log.data,
        topics: log.topics,
      });
      if (event.args.to.toLowerCase() === payment.merchantAddress.toLowerCase())
        received += event.args.value;
    } catch {
      // Ignore unrelated logs from the settlement transaction.
    }
  }
  if (received < units(payment.amount))
    throw new Error("The verified Arc transfer does not cover this sale.");

  const rows = await chains();
  const origin = rows.find((chain) => chain.id === pending.originChainId);
  if (!origin?.httpRpcUrl)
    throw new Error("Relay’s source-chain proof is unavailable.");
  const originReceipt = await createPublicClient({
    transport: http(origin.httpRpcUrl),
  }).getTransactionReceipt({ hash: inputHash });
  if (originReceipt.status !== "success")
    throw new Error("Relay’s source transaction did not succeed.");
  if (originReceipt.from.toLowerCase() !== pending.payer)
    throw new Error("The connected payer does not match the Relay deposit.");
  return {
    payer: originReceipt.from as Address,
    inputHash,
    destinationHash,
    pending,
  };
}
