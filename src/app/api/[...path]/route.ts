import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { verifyMessage, isAddress, type Hex } from "viem";
import { z } from "zod";
import * as store from "@/lib/store";
import {
  units,
  decimal,
  configureCheckout,
  validateRefund,
  type Payment,
  type PaymentMethod,
  type Refund,
  type Mode,
} from "@/lib/model";
import {
  quote,
  verifyBurn,
  verifyMint,
  refreshTransfer,
  reattest,
  referenceHook,
} from "@/lib/cctp";
import { createRelayQuote, verifyRelayPayment } from "@/lib/relay-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const address = z.string().refine(isAddress, "Enter a valid wallet address.");
const txHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const limited = new Map<string, { count: number; until: number }>();
function limit(key: string, maximum = 90) {
  const now = Date.now();
  if (limited.size > 5000)
    for (const [k, v] of limited) if (v.until < now) limited.delete(k);
  const item = limited.get(key);
  if (!item || item.until < now) {
    limited.set(key, { count: 1, until: now + 60_000 });
    return;
  }
  if (++item.count > maximum)
    throw new Error("Too many requests. Please wait a moment.");
}
function publicPayment(payment: Payment) {
  const { owner: _owner, ...result } = payment;
  return result;
}
async function session() {
  return store.sessionOwner((await cookies()).get("sd-session")?.value);
}
function requestOrigin(request: Request) {
  if (process.env.APP_ORIGIN) return new URL(process.env.APP_ORIGIN).origin;
  const protocol =
    request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ||
    new URL(request.url).protocol.replace(":", "");
  return `${protocol}://${request.headers.get("host") || new URL(request.url).host}`;
}
async function setSession(owner: string, request: Request) {
  (await cookies()).set("sd-session", store.newSession(owner), {
    httpOnly: true,
    secure: requestOrigin(request).startsWith("https:"),
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 86400,
  });
}
function requirePayment(id: string) {
  const p = store.getPayment(id);
  if (!p) throw new Error("Payment not found.");
  return p;
}
function own(p: Payment, owner?: string) {
  if (!owner || p.owner !== owner)
    throw new Error("Sign in as the merchant to manage this payment.");
}
function fundingPayment(
  owner: string,
  mode: "testnet" | "mainnet",
  amount: string,
): Payment {
  const profile = store.profile(owner);
  if (!profile.address) throw new Error("Connect your wallet first.");
  return {
    id: `fund-${profile.address.toLowerCase()}-${mode}`,
    owner,
    mode,
    amount: decimal(units(amount)),
    customer: profile.name,
    description: "Bring USDC to Arc",
    merchantAddress: profile.address,
    merchantName: profile.name,
    reference: "ARC-FUNDING",
    createdAt: Date.now(),
    refunds: [],
  };
}
async function dispatch(request: Request, parts: string[]) {
  const method = request.method;
  const path = parts.join("/");
  const owner = await session();
  if (method === "POST") {
    const origin = request.headers.get("origin");
    if (origin && origin !== requestOrigin(request))
      return Response.json(
        { error: "Request origin mismatch." },
        { status: 403 },
      );
    if (Number(request.headers.get("content-length") || 0) > 16_384)
      return Response.json({ error: "Request is too large." }, { status: 413 });
  }
  limit(owner || request.headers.get("x-forwarded-for") || "anonymous", 240);
  const body = method === "POST" ? await request.json().catch(() => ({})) : {};
  if (path === "session" && method === "GET")
    return { profile: owner ? store.profile(owner) : null };
  if (path === "demo" && method === "POST") {
    const id = store.seedDemo();
    await setSession(id, request);
    return { profile: store.profile(id) };
  }
  if (path === "auth/challenge" && method === "POST") {
    limit(`auth:${request.headers.get("x-forwarded-for") || "local"}`, 15);
    const input = z.object({ address }).parse(body);
    return store.challenge(requestOrigin(request), input.address);
  }
  if (path === "auth/verify" && method === "POST") {
    const input = z
      .object({
        address,
        nonce: z.string(),
        signature: z.string().regex(/^0x[0-9a-f]+$/i),
      })
      .parse(body);
    const message = store.consumeChallenge(input.nonce);
    if (
      !message ||
      !message.startsWith(`${requestOrigin(request)} wants`) ||
      !message.includes(`Wallet: ${input.address.toLowerCase()}\n`) ||
      !(await verifyMessage({
        address: input.address as Hex,
        message,
        signature: input.signature as Hex,
      }))
    )
      throw new Error("The sign-in signature is invalid or expired.");
    await setSession(input.address.toLowerCase(), request);
    return { profile: store.profile(input.address.toLowerCase()) };
  }
  if (path === "logout" && method === "POST") {
    store.dropSession((await cookies()).get("sd-session")?.value || "");
    (await cookies()).delete("sd-session");
    return { ok: true };
  }
  if (path === "profile" && method === "POST") {
    if (!owner) throw new Error("Please sign in first.");
    const input = z
      .object({
        name: z.string().trim().min(1).max(50),
        mode: z.enum(["demo", "testnet", "mainnet"]),
        collectTax: z.boolean().optional().default(false),
      })
      .parse(body);
    if ((input.mode === "demo") !== owner.startsWith("demo:"))
      throw new Error(
        "Connect a wallet to switch from demo to a live network.",
      );
    return {
      profile: store.saveProfile(owner, { ...store.profile(owner), ...input }),
    };
  }
  if (path === "payments") {
    if (!owner) throw new Error("Please sign in first.");
    if (method === "GET")
      return {
        payments: store
          .listPayments(owner)
          .filter((p) => p.mode === store.profile(owner).mode)
          .map(store.advanceDemo)
          .map(publicPayment),
        profile: store.profile(owner),
      };
    if (method === "POST") {
      const input = z
        .object({
          customer: z.string().trim().max(80).optional().default(""),
          description: z.string().trim().max(140).optional().default(""),
          amount: z.string(),
          tipsEnabled: z.boolean().optional().default(true),
          collectTax: z.boolean().optional(),
          discreet: z.boolean().optional().default(true),
          quickSale: z.boolean().optional().default(true),
        })
        .parse(body);
      const amount = decimal(units(input.amount));
      const profile = store.profile(owner);
      const payment: Payment = {
        ...input,
        collectTax: input.collectTax ?? !!profile.collectTax,
        customer: input.customer || "Walk-in customer",
        description: input.description || "Counter sale",
        amount,
        subtotal: amount,
        tip: "0",
        expiresAt: input.quickSale ? Date.now() + 10 * 60_000 : undefined,
        id: randomUUID(),
        owner,
        mode: profile.mode,
        merchantAddress:
          profile.address || "0x1111111111111111111111111111111111111111",
        merchantName: profile.name,
        reference: `SD-${randomUUID().slice(0, 6).toUpperCase()}`,
        createdAt: Date.now(),
        refunds: [],
      };
      return { payment: publicPayment(store.savePayment(payment)) };
    }
  }
  if (path.startsWith("funding/") && method === "POST") {
    if (!owner) throw new Error("Please sign in first.");
    const input = z
      .object({
        mode: z.enum(["testnet", "mainnet"]),
        amount: z.string(),
        burnHash: txHash.optional(),
        mintHash: txHash.optional(),
      })
      .parse(body);
    const payment = fundingPayment(owner, input.mode, input.amount);
    if (path === "funding/quote") {
      limit(`funding-quote:${owner}`, 12);
      return {
        ...(await quote(payment)),
        hook: referenceHook(payment.id),
      };
    }
    if (!input.burnHash) throw new Error("A Base transaction is required.");
    const verified = await verifyBurn(payment, input.burnHash as Hex);
    if (verified.payer.toLowerCase() !== payment.merchantAddress.toLowerCase())
      throw new Error("The sending wallet does not match your Arc account.");
    payment.payerAddress = verified.payer;
    const transfer = await refreshTransfer(payment, {
      status: "processing",
      burnHash: input.burnHash,
      startedAt: Date.now(),
    });
    if (path === "funding/status") return { transfer };
    if (path === "funding/mint") {
      if (!input.mintHash) throw new Error("An Arc transaction is required.");
      await verifyMint(payment, transfer, input.mintHash as Hex);
      return { ok: true };
    }
  }
  if (parts[0] !== "payments" || !parts[1])
    return Response.json({ error: "Not found" }, { status: 404 });
  const payment = store.advanceDemo(requirePayment(parts[1]));
  const action = parts[2];
  if (parts.length === 2 && method === "GET")
    return { payment: publicPayment(payment) };
  if (method !== "POST")
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  if (action === "fulfill") {
    own(payment, owner);
    if (
      (payment.transfer?.status !== "settled" &&
        payment.fiat?.status !== "paid") ||
      payment.refunds.length
    )
      throw new Error(
        "Only a confirmed payment without a refund can be fulfilled.",
      );
    payment.fulfilledAt ||= Date.now();
    return { payment: publicPayment(store.savePayment(payment)) };
  }
  if (action === "refund") {
    own(payment, owner);
    const input = z
      .object({
        amount: z.string(),
        reason: z.string().trim().min(1).max(140),
        idempotencyKey: z.string().uuid(),
      })
      .parse(body);
    return store.atomic(() => {
      const fresh = requirePayment(payment.id);
      const existing = fresh.refunds.find((r) => r.id === input.idempotencyKey);
      if (existing) return { payment: publicPayment(fresh), refund: existing };
      validateRefund(fresh, input.amount);
      const refund: Refund = {
        id: input.idempotencyKey,
        amount: decimal(units(input.amount)),
        reason: input.reason,
        status: "processing",
        startedAt: Date.now(),
        reserved: fresh.mode !== "demo",
      };
      fresh.refunds.push(refund);
      store.savePayment(fresh);
      return { payment: publicPayment(fresh), refund };
    });
  }
  if (action === "configure") {
    const input = z
      .object({
        method: z.enum([
          "crypto",
          "usdc",
          "card",
          "cashapp",
          "paypal",
          "venmo",
        ]),
        tip: z.string().default("0"),
      })
      .parse(body);
    return store.atomic(() => {
      const fresh = requirePayment(payment.id);
      configureCheckout(fresh, input.method as PaymentMethod, input.tip);
      return { payment: publicPayment(store.savePayment(fresh)) };
    });
  }
  const refundId =
    typeof body.refundId === "string" ? body.refundId : undefined;
  const refund = refundId
    ? payment.refunds.find((r) => r.id === refundId)
    : undefined;
  if (refundId && !refund) throw new Error("Refund not found.");
  if (refund && ["quote", "burn"].includes(action)) own(payment, owner);
  if (action === "demo-pay") {
    if (payment.mode !== "demo")
      throw new Error("Demo actions cannot change a real payment.");
    const input = z
      .object({
        method: z
          .enum(["crypto", "usdc", "card", "cashapp", "paypal", "venmo"])
          .default("usdc"),
        tip: z.string().default("0"),
      })
      .parse(body);
    return store.atomic(() => {
      const fresh = requirePayment(payment.id);
      if (fresh.transfer || fresh.fiat?.status === "paid")
        return { payment: publicPayment(fresh) };
      configureCheckout(fresh, input.method, input.tip);
      if (input.method === "usdc" || input.method === "crypto") {
        fresh.transfer = {
          status: "processing",
          startedAt: Date.now(),
          rail: input.method === "crypto" ? "relay" : "cctp",
          originSymbol: input.method === "crypto" ? "ETH" : "USDC",
        };
        fresh.payerAddress = "0x2222222222222222222222222222222222222222";
      } else {
        fresh.fiat = {
          provider:
            input.method === "paypal" || input.method === "venmo"
              ? "paypal"
              : "stripe",
          method: input.method,
          status: "paid",
          externalId: `demo_${randomUUID()}`,
          paidAt: Date.now(),
          tax: "0",
          total: fresh.amount,
        };
      }
      return { payment: publicPayment(store.savePayment(fresh)) };
    });
  }
  if (action === "demo-receive") {
    if (payment.mode !== "demo")
      throw new Error("Demo actions cannot change a real payment.");
    const transfer = refund || payment.transfer;
    if (transfer && transfer.status === "ready") {
      transfer.manual = false;
      transfer.startedAt = Date.now() - 4600;
      store.savePayment(payment);
    }
    return { payment: publicPayment(payment) };
  }
  if (payment.mode === "demo")
    throw new Error("This action needs a wallet-connected payment.");
  if (action === "relay-quote") {
    limit(`relay-quote:${payment.id}`, 12);
    const input = z
      .object({
        originChainId: z.number().int().positive(),
        originCurrency: z.string().min(1).max(100),
        originSymbol: z.string().min(1).max(16),
        payer: address,
      })
      .parse(body);
    const relayQuote = await createRelayQuote(payment, input);
    store.savePayment(payment);
    return { quote: relayQuote, payment: publicPayment(payment) };
  }
  if (action === "relay-confirm") {
    limit(`relay-confirm:${payment.id}`, 20);
    const input = z
      .object({ requestId: z.string().min(1).max(100) })
      .parse(body);
    const proof = await verifyRelayPayment(payment, input.requestId);
    return store.atomic(() => {
      const fresh = requirePayment(payment.id);
      if (fresh.transfer?.status === "settled")
        return { payment: publicPayment(fresh) };
      store.bindBurn(
        fresh.mode,
        `relay:${proof.pending.originChainId}`,
        proof.inputHash,
        fresh.id,
      );
      store.bindBurn(fresh.mode, "arc", proof.destinationHash, fresh.id);
      fresh.transfer = {
        status: "settled",
        startedAt: proof.pending.quotedAt,
        settledAt: Date.now(),
        rail: "relay",
        requestId: input.requestId,
        originChainId: proof.pending.originChainId,
        originCurrency: proof.pending.originCurrency,
        originSymbol: proof.pending.originSymbol,
        inTxHash: proof.inputHash,
        mintHash: proof.destinationHash,
      };
      fresh.payerAddress = proof.payer;
      fresh.pendingRelay = undefined;
      return { payment: publicPayment(store.savePayment(fresh)) };
    });
  }
  if (action === "quote") {
    limit(`quote:${payment.id}`, 12);
    const input = z
      .object({ originChainId: z.number().int().positive().optional() })
      .parse(body);
    return quote(payment, refund, input.originChainId);
  }
  if (action === "burn") {
    const input = z
      .object({
        hash: txHash,
        originChainId: z.number().int().positive().optional(),
      })
      .parse(body);
    const result = await verifyBurn(
      payment,
      input.hash as Hex,
      refund,
      input.originChainId,
    );
    return store.atomic(() => {
      const fresh = requirePayment(payment.id);
      const target = refundId
        ? fresh.refunds.find((r) => r.id === refundId)
        : fresh.transfer;
      if (
        target?.burnHash &&
        target.burnHash.toLowerCase() !== input.hash.toLowerCase()
      )
        throw new Error(
          "A transfer is already linked. Track it instead of paying again.",
        );
      if (target?.burnHash) return { payment: publicPayment(fresh) };
      store.bindBurn(
        payment.mode,
        refund ? "arc" : `cctp:${input.originChainId || "base"}`,
        input.hash,
        refundId || payment.id,
      );
      const update = {
        status: "processing" as const,
        burnHash: input.hash,
        startedAt: target?.startedAt || Date.now(),
        rail: "cctp" as const,
        originChainId: refund ? undefined : input.originChainId,
        originSymbol: refund ? undefined : "USDC",
      };
      if (refundId) {
        if (!target) throw new Error("Refund not found.");
        Object.assign(target, update, { reserved: false });
      } else {
        fresh.transfer = update;
        fresh.payerAddress = result.payer;
      }
      return { payment: publicPayment(store.savePayment(fresh)) };
    });
  }
  if (action === "refresh") {
    limit(`refresh:${payment.id}`, 20);
    const nextTransfer = payment.transfer
      ? await refreshTransfer(payment, payment.transfer)
      : undefined;
    const nextRefunds = await Promise.all(
      payment.refunds.map((r) => refreshTransfer(payment, r, r)),
    );
    return store.atomic(() => {
      const fresh = requirePayment(payment.id);
      if (nextTransfer && fresh.transfer?.status !== "settled")
        fresh.transfer = {
          ...nextTransfer,
          mintHash: fresh.transfer?.mintHash || nextTransfer.mintHash,
        };
      fresh.refunds = fresh.refunds.map((r) =>
        r.status === "settled"
          ? r
          : {
              ...r,
              ...nextRefunds.find(
                (n) => n.burnHash && n.burnHash === r.burnHash,
              ),
              mintHash: r.mintHash,
            },
      );
      return { payment: publicPayment(store.savePayment(fresh)) };
    });
  }
  if (action === "mint") {
    const input = z.object({ hash: txHash }).parse(body);
    const transfer = refund || payment.transfer;
    if (!transfer) throw new Error("No transfer to complete.");
    await verifyMint(payment, transfer, input.hash as Hex, refund);
    return store.atomic(() => {
      const fresh = requirePayment(payment.id);
      const target = refundId
        ? fresh.refunds.find((r) => r.id === refundId)
        : fresh.transfer;
      if (!target) throw new Error("Transfer not found.");
      target.mintHash = input.hash;
      return { payment: publicPayment(store.savePayment(fresh)) };
    });
  }
  if (action === "reattest") {
    limit(`reattest:${payment.id}`, 3);
    const transfer = refund || payment.transfer;
    if (!transfer) throw new Error("No transfer to refresh.");
    await reattest(payment, transfer, refund);
    return { ok: true };
  }
  return Response.json({ error: "Not found" }, { status: 404 });
}
async function handler(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const result = await dispatch(request, (await params).path);
    return result instanceof Response
      ? result
      : Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? error.issues[0]?.message
        : error instanceof Error
          ? error.message
          : "Something went wrong. Please try again.";
    const status = message?.includes("not found")
      ? 404
      : message?.includes("Sign in") || message?.includes("sign in")
        ? 401
        : message?.includes("Too many")
          ? 429
          : 400;
    return Response.json({ error: message?.slice(0, 250) }, { status });
  }
}
export { handler as GET, handler as POST };
