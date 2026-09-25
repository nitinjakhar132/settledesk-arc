"use client";

import { useMemo, useState } from "react";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { ArrowLeft, ArrowRight, Check, Coins, Search, X } from "lucide-react";
import { isAddress } from "viem";
import { api, errorText, sendCctpPayment, type Quote } from "@/lib/client";
import { cctpChains, isCctpUsdc } from "@/lib/cctp-chains";
import {
  executeRelayPayment,
  type RelayExecutableQuote,
} from "@/lib/relay-client";
import { money, type Payment } from "@/lib/model";
import { Spinner } from "./ui";

type Token = {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  metadata?: { logoURI?: string };
};
type Chain = {
  id: number;
  name: string;
  displayName: string;
  iconUrl?: string;
  tokenSupport?: string;
  tokens: Token[];
};
type Catalog = { chains: Chain[] };
type RouteQuote =
  | { kind: "cctp"; quote: Quote }
  | { kind: "relay"; quote: RelayExecutableQuote }
  | { kind: "demo"; rail: "cctp" | "relay" };

function demoCatalog(): Catalog {
  const token = (symbol: string, name = symbol, address?: string): Token => ({
    symbol,
    name,
    address:
      address ||
      (symbol === "ETH"
        ? "0x0000000000000000000000000000000000000000"
        : `0x${symbol.charCodeAt(0).toString(16).padStart(40, "0")}`),
    decimals: symbol === "USDC" || symbol === "USDT" ? 6 : 18,
  });
  return {
    chains: [
      {
        id: 8453,
        name: "base",
        displayName: "Base",
        tokens: [
          token(
            "USDC",
            "USD Coin",
            "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          ),
          token("ETH", "Ether"),
          token("DEGEN"),
        ],
      },
      {
        id: 1,
        name: "ethereum",
        displayName: "Ethereum",
        tokens: [
          token(
            "USDC",
            "USD Coin",
            "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          ),
          token("ETH", "Ether"),
          token("USDT"),
        ],
      },
      {
        id: 42161,
        name: "arbitrum",
        displayName: "Arbitrum",
        tokens: [
          token(
            "USDC",
            "USD Coin",
            "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
          ),
          token("ETH", "Ether"),
          token("ARB"),
        ],
      },
    ],
  };
}

export function AnyTokenPay({
  payment,
  tip,
  authenticated,
  login,
  activeWallet,
  disabled,
  onBusy,
  onPaid,
  onError,
}: {
  payment: Payment;
  tip: string;
  authenticated: boolean;
  login: () => void;
  activeWallet?: ConnectedWallet;
  disabled: boolean;
  onBusy: (message: string) => void;
  onPaid: (payment: Payment) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<Catalog>();
  const [chainId, setChainId] = useState(8453);
  const [currency, setCurrency] = useState("");
  const [customCurrency, setCustomCurrency] = useState("");
  const [search, setSearch] = useState("");
  const [route, setRoute] = useState<RouteQuote>();
  const chain = catalog?.chains.find((value) => value.id === chainId);
  const tokens = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (chain?.tokens || [])
      .filter(
        (token) =>
          !query ||
          token.symbol.toLowerCase().includes(query) ||
          token.name.toLowerCase().includes(query),
      )
      .slice(0, 80);
  }, [chain, search]);
  const selected =
    chain?.tokens.find(
      (token) => token.address.toLowerCase() === currency.toLowerCase(),
    ) ||
    (isAddress(customCurrency)
      ? {
          symbol: "TOKEN",
          name: "Custom token",
          address: customCurrency,
          decimals: 18,
        }
      : undefined);
  const cctp =
    !!selected &&
    isCctpUsdc(
      payment.mode === "demo" ? "mainnet" : payment.mode,
      chainId,
      selected.address,
    );
  const directArc = chainId === 5042;

  async function show() {
    setOpen(true);
    setRoute(undefined);
    onError("");
    if (catalog) return;
    onBusy("Loading supported tokens…");
    try {
      let next: Catalog;
      if (payment.mode === "demo") next = demoCatalog();
      else if (payment.mode === "testnet") {
        next = {
          chains: cctpChains("testnet").map((item) => ({
            id: item.id,
            name: item.name.toLowerCase().replaceAll(" ", "-"),
            displayName: item.name,
            tokens: [
              {
                symbol: "USDC",
                name: "USD Coin",
                address: item.usdc,
                decimals: 6,
              },
            ],
          })),
        };
      } else next = await api<Catalog>("relay/catalog");
      const preferred =
        next.chains.find((item) => item.id === 8453) || next.chains[0];
      if (!preferred) throw new Error("No payment networks are available.");
      setCatalog(next);
      setChainId(preferred.id);
      setCurrency(
        preferred.tokens.find((token) => token.symbol === "USDC")?.address ||
          preferred.tokens[0]?.address ||
          "",
      );
    } catch (error) {
      onError(errorText(error));
    } finally {
      onBusy("");
    }
  }

  async function getQuote() {
    if (!selected) {
      onError("Choose a token or paste a valid token contract address.");
      return;
    }
    if (payment.mode !== "demo" && !authenticated) {
      login();
      return;
    }
    if (payment.mode !== "demo" && !activeWallet) {
      onError("Your wallet is still getting ready.");
      return;
    }
    onBusy("Finding the cleanest route…");
    onError("");
    try {
      const configured = await api<{ payment: Payment }>(
        `payments/${payment.id}/configure`,
        { method: "crypto", tip },
      );
      onPaid(configured.payment);
      if (payment.mode === "demo") {
        setRoute({ kind: "demo", rail: cctp ? "cctp" : "relay" });
        return;
      }
      if (cctp) {
        const quote = await api<Quote>(`payments/${payment.id}/quote`, {
          originChainId: chainId,
        });
        setRoute({ kind: "cctp", quote });
        return;
      }
      const result = await api<{
        quote: RelayExecutableQuote;
        payment: Payment;
      }>(`payments/${payment.id}/relay-quote`, {
        originChainId: chainId,
        originCurrency: selected.address,
        originSymbol: selected.symbol,
        payer: activeWallet!.address,
      });
      onPaid(result.payment);
      setRoute({ kind: "relay", quote: result.quote });
    } catch (error) {
      onError(errorText(error));
    } finally {
      onBusy("");
    }
  }

  async function confirm() {
    if (!route || !selected) return;
    onError("");
    try {
      if (route.kind === "demo") {
        onBusy(
          route.rail === "cctp"
            ? "Simulating the CCTP payment…"
            : "Simulating the Relay payment…",
        );
        const result = await api<{ payment: Payment }>(
          `payments/${payment.id}/demo-pay`,
          { method: "crypto", tip },
        );
        onPaid(result.payment);
        setOpen(false);
        return;
      }
      if (!activeWallet) throw new Error("Your wallet is still getting ready.");
      if (route.kind === "cctp") {
        const result = await sendCctpPayment(
          payment,
          route.quote,
          chainId,
          onBusy,
          activeWallet,
        );
        onPaid(result.payment);
      } else {
        onBusy("Confirm the Relay payment in your wallet…");
        await executeRelayPayment(route.quote, activeWallet, onBusy);
        onBusy("Verifying USDC arrival on Arc…");
        const result = await api<{ payment: Payment }>(
          `payments/${payment.id}/relay-confirm`,
          { requestId: route.quote.requestId },
        );
        onPaid(result.payment);
      }
      setOpen(false);
    } catch (error) {
      onError(errorText(error));
    } finally {
      onBusy("");
    }
  }

  if (!open)
    return (
      <button
        className="button secondary wide method-button"
        disabled={disabled}
        onClick={show}
      >
        <Coins size={18} />
        Pay with any token
        <span className="method-note">Settles as USDC on Arc</span>
      </button>
    );

  const cctpRoute =
    route?.kind === "cctp" ||
    (route?.kind === "demo" && route.rail === "cctp");

  return (
    <div className="any-token-panel">
      <div className="any-token-heading">
        <button aria-label="Close token payment" onClick={() => setOpen(false)}>
          {route ? <ArrowLeft size={17} /> : <X size={17} />}
        </button>
        <span>
          <strong>{route ? "Review payment" : "Pay from your wallet"}</strong>
          <small>Choose a network and token</small>
        </span>
      </div>
      {!route ? (
        <>
          <label className="token-field">
            <span>Network</span>
            <select
              value={chainId}
              onChange={(event) => {
                const nextId = Number(event.target.value);
                const next = catalog?.chains.find((item) => item.id === nextId);
                setChainId(nextId);
                setCurrency(
                  next?.tokens.find((token) => token.symbol === "USDC")
                    ?.address ||
                    next?.tokens[0]?.address ||
                    "",
                );
                setCustomCurrency("");
              }}
            >
              {catalog?.chains.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="token-search">
            <Search size={15} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search token"
            />
          </label>
          <div className="token-grid">
            {tokens.slice(0, 12).map((token) => (
              <button
                key={token.address}
                className={
                  currency.toLowerCase() === token.address.toLowerCase() &&
                  !customCurrency
                    ? "selected"
                    : ""
                }
                onClick={() => {
                  setCurrency(token.address);
                  setCustomCurrency("");
                }}
              >
                <span>{token.symbol.slice(0, 1)}</span>
                <strong>{token.symbol}</strong>
                {currency.toLowerCase() === token.address.toLowerCase() &&
                  !customCurrency && <Check size={14} />}
              </button>
            ))}
          </div>
          <label className="token-field custom-token-field">
            <span>Token not listed?</span>
            <input
              value={customCurrency}
              onChange={(event) => setCustomCurrency(event.target.value.trim())}
              placeholder="Paste its contract address"
            />
          </label>
          <button
            className="button primary wide"
            disabled={disabled || !selected}
            onClick={getQuote}
          >
            Review payment <ArrowRight size={17} />
          </button>
        </>
      ) : (
        <>
          <div className="route-choice">
            <span
              className={cctpRoute ? "circle-route" : "relay-route"}
            >
              {cctpRoute ? "C" : "R"}
            </span>
            <div>
              <strong>
                {cctpRoute
                  ? "Circle CCTP"
                  : directArc
                    ? "Direct on Arc"
                    : "Relay best route"}
              </strong>
              <small>
                {cctpRoute
                  ? "USDC stays USDC — no liquidity bridge"
                  : "Token converted and delivered as USDC"}
              </small>
            </div>
          </div>
          <div className="receipt-facts token-receipt">
            <p>
              <span>You pay with</span>
              <strong>
                {selected?.symbol} on {chain?.displayName}
              </strong>
            </p>
            <p>
              <span>Merchant gets</span>
              <strong>{money(payment.amount)} USDC on Arc</strong>
            </p>
            <p>
              <span>Refund address</span>
              <strong>Your connected wallet</strong>
            </p>
          </div>
          <button
            className="button primary wide"
            disabled={disabled}
            onClick={confirm}
          >
            {disabled ? <Spinner /> : <Coins size={18} />}
            Confirm in wallet
          </button>
          <button
            className="text-button wide"
            onClick={() => setRoute(undefined)}
          >
            Choose another token
          </button>
        </>
      )}
    </div>
  );
}
