import "server-only";
import { createHash } from "node:crypto";
import { getAuthHeaders } from "@coinbase/cdp-sdk/auth";

const COINBASE_HOST = "api.developer.coinbase.com";
const COINBASE_PATH = "/onramp/v1/sell/quote";

export interface CoinbaseCashoutQuote {
  offrampUrl: string;
  cashoutTotal?: { amount: string; currency: string };
  cashoutSubtotal?: { amount: string; currency: string };
  coinbaseFee?: { amount: string; currency: string };
  quoteId?: string;
}

export function coinbaseCashoutConfigured() {
  return Boolean(
    process.env.CDP_API_KEY_ID?.trim() &&
    process.env.CDP_API_KEY_SECRET?.trim(),
  );
}

export async function createCoinbaseCashoutQuote(input: {
  amount: string;
  sourceAddress: string;
  subdivision: string;
  redirectOrigin: string;
}) {
  const apiKeyId = process.env.CDP_API_KEY_ID?.trim();
  const apiKeySecret = process.env.CDP_API_KEY_SECRET?.replace(
    /\\n/g,
    "\n",
  ).trim();
  if (!apiKeyId || !apiKeySecret)
    throw new Error(
      "Bank cash-out is not connected yet. Add the Coinbase CDP keys first.",
    );

  const requestBody = {
    sell_currency: "USDC",
    sell_network: "base",
    sell_amount: input.amount,
    cashout_currency: "USD",
    payment_method: "ACH_BANK_ACCOUNT",
    country: "US",
    subdivision: input.subdivision,
    source_address: input.sourceAddress,
    redirect_url: `${input.redirectOrigin}/?cashout=complete`,
    partner_user_ref: `sd_${createHash("sha256")
      .update(input.sourceAddress.toLowerCase())
      .digest("hex")
      .slice(0, 24)}`,
  };
  const headers = await getAuthHeaders({
    apiKeyId,
    apiKeySecret,
    requestMethod: "POST",
    requestHost: COINBASE_HOST,
    requestPath: COINBASE_PATH,
    requestBody,
  });
  const response = await fetch(`https://${COINBASE_HOST}${COINBASE_PATH}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    data?: {
      offramp_url?: string;
      cashout_total?: { amount: string; currency: string };
      cashout_subtotal?: { amount: string; currency: string };
      coinbase_fee?: { amount: string; currency: string };
      quote_id?: string;
    };
    errorMessage?: string;
    message?: string;
  };
  if (!response.ok)
    throw new Error(
      response.status === 401 || response.status === 403
        ? "Coinbase did not accept the cash-out connection. Check the CDP keys and allowed domain."
        : payload.errorMessage ||
            payload.message ||
            "Coinbase could not prepare this bank cash-out. Please try again.",
    );
  if (!payload.data?.offramp_url)
    throw new Error("Coinbase did not return a bank cash-out link.");
  const url = new URL(payload.data.offramp_url);
  if (url.protocol !== "https:" || url.hostname !== "pay.coinbase.com")
    throw new Error("Coinbase returned an unexpected cash-out destination.");
  return {
    offrampUrl: url.toString(),
    cashoutTotal: payload.data.cashout_total,
    cashoutSubtotal: payload.data.cashout_subtotal,
    coinbaseFee: payload.data.coinbase_fee,
    quoteId: payload.data.quote_id,
  } satisfies CoinbaseCashoutQuote;
}
