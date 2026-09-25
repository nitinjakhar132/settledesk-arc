export type Mode = "demo" | "testnet" | "mainnet";
export type TransferStatus = "processing" | "ready" | "settled" | "expired";
export type PaymentStatus =
  "requested" | TransferStatus | "refunding" | "refunded" | "partial";
export type PaymentMethod =
  "crypto" | "usdc" | "card" | "cashapp" | "paypal" | "venmo";
export interface FiatPayment {
  provider: "stripe" | "paypal";
  method: Exclude<PaymentMethod, "usdc">;
  status: "pending" | "paid" | "refunded";
  externalId: string;
  paidAt?: number;
  tax?: string;
  total?: string;
}
export interface Transfer {
  status: TransferStatus;
  startedAt: number;
  settledAt?: number;
  burnHash?: string;
  mintHash?: string;
  message?: string;
  attestation?: string;
  nonce?: string;
  fee?: string;
  manual?: boolean;
  rail?: "cctp" | "relay";
  requestId?: string;
  originChainId?: number;
  originCurrency?: string;
  originSymbol?: string;
  inTxHash?: string;
}
export interface PendingRelayQuote {
  requestId: string;
  originChainId: number;
  originCurrency: string;
  originSymbol: string;
  payer: string;
  quotedAt: number;
}
export interface Refund extends Transfer {
  id: string;
  amount: string;
  reason: string;
  reserved?: boolean;
}
export interface Payment {
  id: string;
  owner: string;
  mode: Mode;
  customer: string;
  description: string;
  reference: string;
  amount: string;
  subtotal?: string;
  tip?: string;
  tipsEnabled?: boolean;
  collectTax?: boolean;
  selectedMethod?: PaymentMethod;
  quickSale?: boolean;
  discreet?: boolean;
  expiresAt?: number;
  fiat?: FiatPayment;
  merchantName: string;
  merchantAddress: string;
  payerAddress?: string;
  createdAt: number;
  fulfilledAt?: number;
  transfer?: Transfer;
  pendingRelay?: PendingRelayQuote;
  refunds: Refund[];
}
export interface Profile {
  name: string;
  address?: string;
  mode: Mode;
  collectTax?: boolean;
}
export function units(value: string): bigint {
  if (!/^\d{1,7}(\.\d{1,6})?$/.test(value))
    throw new Error("Enter a valid USDC amount with up to 6 decimals.");
  const [whole, part = ""] = value.split(".");
  const amount = BigInt(whole) * 1_000_000n + BigInt(part.padEnd(6, "0"));
  if (amount <= 0n || amount > 1_000_000_000_000n)
    throw new Error("Amount must be between 0.000001 and 1,000,000 USDC.");
  return amount;
}
export function decimal(amount: bigint): string {
  const negative = amount < 0n;
  const n = negative ? -amount : amount;
  const fraction = (n % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${n / 1_000_000n}${fraction ? `.${fraction}` : ""}`;
}
export function refundedUnits(payment: Payment, includePending = true): bigint {
  return payment.refunds
    .filter((r) => includePending || r.status === "settled")
    .reduce((sum, r) => sum + units(r.amount), 0n);
}
export function refundable(payment: Payment): string {
  return decimal(units(payment.amount) - refundedUnits(payment));
}
export function statusOf(payment: Payment): PaymentStatus {
  if (payment.fiat?.status === "paid") return "processing";
  if (payment.expiresAt && payment.expiresAt <= Date.now() && !payment.transfer)
    return "expired";
  if (!payment.transfer) return "requested";
  if (payment.transfer.status !== "settled") return payment.transfer.status;
  if (payment.refunds.some((r) => r.status !== "settled")) return "refunding";
  const refunded = refundedUnits(payment);
  if (refunded >= units(payment.amount)) return "refunded";
  return refunded > 0n ? "partial" : "settled";
}

export function subtotalOf(payment: Payment): string {
  return payment.subtotal || payment.amount;
}

export function paidTotalOf(payment: Payment): string {
  return payment.fiat?.total || payment.amount;
}

export function tipUnits(value: string): bigint {
  if (!/^\d{1,7}(\.\d{1,6})?$/.test(value))
    throw new Error("Enter a valid tip amount with up to 6 decimals.");
  const [whole, part = ""] = value.split(".");
  const amount = BigInt(whole) * 1_000_000n + BigInt(part.padEnd(6, "0"));
  if (amount > 1_000_000_000_000n)
    throw new Error("The tip amount is too large.");
  return amount;
}

export function configureCheckout(
  payment: Payment,
  method: PaymentMethod,
  tip: string,
) {
  if (payment.transfer || payment.fiat?.status === "paid")
    throw new Error("This sale has already been paid.");
  if (payment.expiresAt && payment.expiresAt <= Date.now())
    throw new Error("This quick-sale QR has expired. Ask for a new one.");
  if (payment.collectTax && method !== "card" && method !== "cashapp")
    throw new Error(
      "Tax-enabled sales must use card, mobile wallet, or Cash App checkout.",
    );
  const subtotal = units(subtotalOf(payment));
  const tipAmount = tipUnits(tip);
  if (!payment.tipsEnabled && tipAmount > 0n)
    throw new Error("Tips are not enabled for this sale.");
  if (tipAmount > subtotal)
    throw new Error("The tip cannot be greater than the sale amount.");
  payment.tip = decimal(tipAmount);
  payment.amount = decimal(subtotal + tipAmount);
  payment.selectedMethod = method;
  return payment;
}
export function validateRefund(payment: Payment, amount: string) {
  if (payment.transfer?.status !== "settled")
    throw new Error("The payment must settle before it can be refunded.");
  if (!payment.payerAddress)
    throw new Error("A verified customer address is required.");
  if (units(amount) > units(payment.amount) - refundedUnits(payment))
    throw new Error("This exceeds the remaining refundable amount.");
  if (payment.refunds.some((r) => r.status !== "settled"))
    throw new Error("Finish the pending refund before starting another.");
}
export function money(value: string | number, precise = true): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: precise ? 6 : 2,
  }).format(Number(value));
}
export function feeFromBasisPoints(
  amount: bigint,
  basisPoints: number,
): bigint {
  if (!Number.isFinite(basisPoints) || basisPoints < 0 || basisPoints >= 10_000)
    throw new Error("Circle returned an invalid fee rate.");
  const rate = BigInt(Math.ceil(basisPoints * 1_000_000));
  return (amount * rate + 9_999_999_999n) / 10_000_000_000n;
}
export function shortAddress(address?: string) {
  return address
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : "Not connected";
}
export const statusLabels: Record<PaymentStatus, string> = {
  requested: "Awaiting payment",
  processing: "Settling",
  ready: "Ready to receive",
  settled: "Received",
  expired: "Needs attention",
  refunding: "Refund on its way",
  refunded: "Refunded",
  partial: "Partially refunded",
};
