"use client";
import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  erc20Abi,
  pad,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { network, messengerAbi, transmitterAbi } from "./chains";
import { cctpChain, viemCctpChain } from "./cctp-chains";
import type { Payment, Refund } from "./model";
import type { ConnectedWallet } from "@privy-io/react-auth";
export async function api<T = Record<string, unknown>>(
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}
export async function connect(connectedWallet?: ConnectedWallet) {
  const provider = connectedWallet
    ? await connectedWallet.getEthereumProvider()
    : window.ethereum;
  if (!provider)
    throw new Error("Sign in with Privy to continue with your wallet.");
  const wallet = createWalletClient({ transport: custom(provider) });
  const account = connectedWallet?.address as Address | undefined;
  const [requestedAccount] = account
    ? [account]
    : await wallet.requestAddresses();
  const selectedAccount = account || requestedAccount;
  if (!selectedAccount) throw new Error("No wallet selected.");
  return { wallet, account: selectedAccount, provider };
}
export async function signIn(connectedWallet: ConnectedWallet) {
  const { wallet, account } = await connect(connectedWallet);
  const { nonce, message } = await api<{ nonce: string; message: string }>(
    "auth/challenge",
    { address: account },
  );
  const signature = await wallet.signMessage({ account, message });
  return api<{ profile: import("./model").Profile }>("auth/verify", {
    address: account,
    nonce,
    signature,
  });
}
async function chainContext(
  mode: Payment["mode"],
  side: "base" | "arc",
  connectedWallet: ConnectedWallet,
) {
  const { wallet, account } = await connect(connectedWallet);
  const config = network(mode, side);
  try {
    await connectedWallet.switchChain(config.chain.id);
  } catch (error) {
    const e = error as { code?: number; cause?: { code?: number } };
    if (e.code !== 4902 && e.cause?.code !== 4902) throw error;
    await wallet.addChain({ chain: config.chain });
    await connectedWallet.switchChain(config.chain.id);
  }
  const provider = await connectedWallet.getEthereumProvider();
  return {
    wallet: createWalletClient({
      chain: config.chain,
      transport: custom(provider),
      account,
    }),
    account,
    config,
    client: createPublicClient({ chain: config.chain, transport: http() }),
  };
}
async function onChain(
  payment: Payment,
  side: "base" | "arc",
  connectedWallet: ConnectedWallet,
) {
  return chainContext(payment.mode, side, connectedWallet);
}
async function cctpSourceContext(
  mode: Payment["mode"],
  chainId: number,
  connectedWallet: ConnectedWallet,
) {
  const source = cctpChain(mode, chainId);
  if (!source) throw new Error("CCTP is not available from that chain.");
  const { wallet, account } = await connect(connectedWallet);
  const chain = viemCctpChain(source);
  try {
    await connectedWallet.switchChain(chain.id);
  } catch (error) {
    const e = error as { code?: number; cause?: { code?: number } };
    if (e.code !== 4902 && e.cause?.code !== 4902) throw error;
    await wallet.addChain({ chain });
    await connectedWallet.switchChain(chain.id);
  }
  const provider = await connectedWallet.getEthereumProvider();
  return {
    wallet: createWalletClient({
      chain,
      transport: custom(provider),
      account,
    }),
    account,
    source,
    contracts: network(mode, "base"),
    client: createPublicClient({ chain, transport: http(source.rpc) }),
  };
}
export interface Quote {
  amount: string;
  maxFee: string;
  total: string;
  fee: string;
  receive: string;
}
export interface FundingTransfer {
  status: "processing" | "ready" | "settled" | "expired";
  burnHash: Hex;
  message?: Hex;
  attestation?: Hex;
  mintHash?: Hex;
  fee?: string;
}
export async function startArcFunding(
  mode: "testnet" | "mainnet",
  value: string,
  connectedWallet: ConnectedWallet,
  onStep: (step: string) => void,
) {
  const quote = await api<Quote & { hook: Hex }>("funding/quote", {
    mode,
    amount: value,
  });
  const { wallet, account, config, client } = await chainContext(
    mode,
    "base",
    connectedWallet,
  );
  const amount = BigInt(quote.amount);
  const balance = await client.readContract({
    address: config.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account],
  });
  if (balance < amount)
    throw new Error(`You need ${quote.total} USDC on ${config.chain.name}.`);
  const allowance = await client.readContract({
    address: config.usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account, config.messenger],
  });
  if (allowance < amount) {
    onStep("Approve this exact USDC amount…");
    const approval = await wallet.writeContract({
      address: config.usdc,
      abi: erc20Abi,
      functionName: "approve",
      args: [config.messenger, amount],
    });
    const receipt = await client.waitForTransactionReceipt({ hash: approval });
    if (receipt.status !== "success")
      throw new Error("USDC approval failed. Nothing was moved.");
  }
  onStep("Confirm the move to Arc…");
  const { request } = await client.simulateContract({
    account,
    address: config.messenger,
    abi: messengerAbi,
    functionName: "depositForBurnWithHook",
    args: [
      amount,
      26,
      pad(account),
      config.usdc,
      pad("0x"),
      BigInt(quote.maxFee),
      2000,
      quote.hook,
    ],
  });
  const burnHash = await wallet.writeContract(request);
  onStep("Saving your CCTP transfer…");
  const receipt = await client.waitForTransactionReceipt({ hash: burnHash });
  if (receipt.status !== "success")
    throw new Error("The Base transaction reverted. Nothing was moved.");
  const result = await api<{ transfer: FundingTransfer }>("funding/status", {
    mode,
    amount: value,
    burnHash,
  });
  return { ...result, burnHash, quote };
}
export async function continueArcFunding(
  mode: "testnet" | "mainnet",
  value: string,
  burnHash: Hex,
  connectedWallet: ConnectedWallet,
  onStep: (step: string) => void,
) {
  const result = await api<{ transfer: FundingTransfer }>("funding/status", {
    mode,
    amount: value,
    burnHash,
  });
  if (result.transfer.status !== "ready") return result.transfer;
  if (!result.transfer.message || !result.transfer.attestation)
    throw new Error("Circle verification is not complete yet.");
  onStep("Confirm receipt on Arc…");
  const { wallet, account, config, client } = await chainContext(
    mode,
    "arc",
    connectedWallet,
  );
  const { request } = await client.simulateContract({
    account,
    address: config.transmitter,
    abi: transmitterAbi,
    functionName: "receiveMessage",
    args: [result.transfer.message, result.transfer.attestation],
  });
  const mintHash = await wallet.writeContract(request);
  const receipt = await client.waitForTransactionReceipt({ hash: mintHash });
  if (receipt.status !== "success")
    throw new Error("Arc did not receive the transfer. You can safely retry.");
  await api("funding/mint", { mode, amount: value, burnHash, mintHash });
  return { ...result.transfer, status: "settled" as const, mintHash };
}
export async function sendPayment(
  payment: Payment,
  quote: Quote,
  onStep: (step: string) => void,
  refund?: Refund,
  connectedWallet?: ConnectedWallet,
) {
  if (!connectedWallet) throw new Error("Sign in to approve this transfer.");
  const side = refund ? "arc" : "base";
  const { wallet, account, config, client } = await onChain(
    payment,
    side,
    connectedWallet,
  );
  if (refund && account.toLowerCase() !== payment.merchantAddress.toLowerCase())
    throw new Error("Switch to the merchant wallet to approve this refund.");
  const key = `settledesk:pending:${payment.id}:${refund?.id || "payment"}`;
  const savedHash = localStorage.getItem(key) as Hex | null;
  if (savedHash) {
    onStep("Recovering your submitted transfer…");
    const receipt = await client.waitForTransactionReceipt({ hash: savedHash });
    if (receipt.status !== "success") {
      localStorage.removeItem(key);
      throw new Error(
        "The previous transaction reverted. It is safe to retry.",
      );
    }
    const result = await api<{ payment: Payment }>(
      `payments/${payment.id}/burn`,
      { hash: savedHash, refundId: refund?.id },
    );
    localStorage.removeItem(key);
    return result;
  }
  if ((refund || payment.transfer)?.burnHash)
    throw new Error(
      "A transfer has already been submitted. Refresh its progress instead of sending again.",
    );
  const amount = BigInt(quote.amount);
  const balance = await client.readContract({
    address: config.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account],
  });
  if (balance < amount)
    throw new Error(
      `You need ${quote.total} USDC on ${config.chain.name}, plus gas, to continue.`,
    );
  const allowance = await client.readContract({
    address: config.usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account, config.messenger],
  });
  if (allowance < amount) {
    onStep("Approve USDC in your wallet…");
    const approval = await wallet.writeContract({
      address: config.usdc,
      abi: erc20Abi,
      functionName: "approve",
      args: [config.messenger, amount],
    });
    const receipt = await client.waitForTransactionReceipt({ hash: approval });
    if (receipt.status !== "success")
      throw new Error("USDC approval failed. No payment was sent.");
  }
  onStep(
    refund
      ? "Confirm the refund in your wallet…"
      : "Confirm payment in your wallet…",
  );
  const recipient = (
    refund ? payment.payerAddress : payment.merchantAddress
  ) as Address;
  const hook = stringToHex(
    `settledesk:${refund ? `refund:${payment.id}:${refund.id}` : `payment:${payment.id}`}`,
  );
  const { request } = await client.simulateContract({
    account,
    address: config.messenger,
    abi: messengerAbi,
    functionName: "depositForBurnWithHook",
    args: [
      amount,
      refund ? 6 : 26,
      pad(recipient),
      config.usdc,
      pad("0x"),
      BigInt(quote.maxFee),
      2000,
      hook,
    ],
  });
  const hash = await wallet.writeContract(request);
  localStorage.setItem(key, hash);
  onStep("Payment submitted. Saving its journey…");
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    localStorage.removeItem(key);
    throw new Error("The transaction reverted. No funds were transferred.");
  }
  const result = await api<{ payment: Payment }>(
    `payments/${payment.id}/burn`,
    { hash, refundId: refund?.id },
  );
  localStorage.removeItem(key);
  return result;
}
export async function sendCctpPayment(
  payment: Payment,
  quote: Quote,
  originChainId: number,
  onStep: (step: string) => void,
  connectedWallet?: ConnectedWallet,
) {
  if (!connectedWallet) throw new Error("Sign in to approve this transfer.");
  const { wallet, account, source, contracts, client } =
    await cctpSourceContext(payment.mode, originChainId, connectedWallet);
  const key = `settledesk:pending:${payment.id}:cctp:${originChainId}`;
  const savedHash = localStorage.getItem(key) as Hex | null;
  if (savedHash) {
    onStep("Recovering your submitted transfer…");
    const receipt = await client.waitForTransactionReceipt({ hash: savedHash });
    if (receipt.status !== "success") {
      localStorage.removeItem(key);
      throw new Error(
        "The previous transaction reverted. It is safe to retry.",
      );
    }
    const result = await api<{ payment: Payment }>(
      `payments/${payment.id}/burn`,
      { hash: savedHash, originChainId },
    );
    localStorage.removeItem(key);
    return result;
  }
  if (payment.transfer?.burnHash)
    throw new Error("A transfer is already being tracked for this sale.");
  const amount = BigInt(quote.amount);
  const balance = await client.readContract({
    address: source.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account],
  });
  if (balance < amount)
    throw new Error(
      `You need ${quote.total} USDC on ${source.name}, plus gas.`,
    );
  const allowance = await client.readContract({
    address: source.usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account, contracts.messenger],
  });
  if (allowance < amount) {
    onStep("Approve this exact USDC amount…");
    const approval = await wallet.writeContract({
      address: source.usdc,
      abi: erc20Abi,
      functionName: "approve",
      args: [contracts.messenger, amount],
    });
    const receipt = await client.waitForTransactionReceipt({ hash: approval });
    if (receipt.status !== "success")
      throw new Error("USDC approval failed. No payment was sent.");
  }
  onStep("Confirm the CCTP payment…");
  const { request } = await client.simulateContract({
    account,
    address: contracts.messenger,
    abi: messengerAbi,
    functionName: "depositForBurnWithHook",
    args: [
      amount,
      26,
      pad(payment.merchantAddress as Hex),
      source.usdc,
      pad("0x"),
      BigInt(quote.maxFee),
      2000,
      stringToHex(`settledesk:payment:${payment.id}`),
    ],
  });
  const hash = await wallet.writeContract(request);
  localStorage.setItem(key, hash);
  onStep("Payment submitted. Saving its journey…");
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    localStorage.removeItem(key);
    throw new Error("The transaction reverted. No funds were transferred.");
  }
  const result = await api<{ payment: Payment }>(
    `payments/${payment.id}/burn`,
    { hash, originChainId },
  );
  localStorage.removeItem(key);
  return result;
}
export async function completeTransfer(
  payment: Payment,
  refund: Refund | undefined,
  connectedWallet?: ConnectedWallet,
) {
  if (!connectedWallet) throw new Error("Sign in to complete this transfer.");
  const transfer = refund || payment.transfer;
  if (
    !transfer?.message ||
    !transfer.attestation ||
    transfer.status !== "ready"
  )
    throw new Error("This transfer is not ready to receive yet.");
  const { wallet, config, client, account } = await onChain(
    payment,
    refund ? "base" : "arc",
    connectedWallet,
  );
  const { request } = await client.simulateContract({
    account,
    address: config.transmitter,
    abi: transmitterAbi,
    functionName: "receiveMessage",
    args: [transfer.message as Hex, transfer.attestation as Hex],
  });
  const hash = await wallet.writeContract(request);
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success")
    throw new Error(
      "The receive transaction failed. Your transfer can be retried.",
    );
  await api(`payments/${payment.id}/mint`, { hash, refundId: refund?.id });
  return api<{ payment: Payment }>(`payments/${payment.id}/refresh`, {});
}
export function errorText(error: unknown) {
  const value = error as { shortMessage?: string; message?: string };
  if (
    value?.message?.includes("rejected") ||
    value?.message?.includes("denied")
  )
    return "You cancelled in your wallet. Nothing new was sent.";
  return (
    value?.shortMessage ||
    value?.message ||
    "Something went wrong. Please try again."
  );
}
export async function shareLink(url: string, title: string) {
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return "Shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "Share cancelled";
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return "Link copied";
  } catch {
    return "Use the link below to copy manually";
  }
}
export function download(
  name: string,
  data: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
