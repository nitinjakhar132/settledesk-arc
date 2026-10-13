import "server-only";
import * as store from "./store";
import {
  configureCheckout,
  decimal,
  type FiatPayment,
  type Payment,
  type PaymentMethod,
} from "./model";

export async function paymentForCheckout(
  id: string,
  method: PaymentMethod,
  tip: string,
) {
  return store.atomic(async () => {
    const payment = await store.getPayment(id);
    if (!payment) throw new Error("Payment not found.");
    configureCheckout(payment, method, tip);
    return await store.savePayment(payment);
  });
}

export async function saveFiatAttempt(payment: Payment, fiat: FiatPayment) {
  return store.atomic(async () => {
    const fresh = await store.getPayment(payment.id);
    if (!fresh) throw new Error("Payment not found.");
    if (fresh.transfer || fresh.fiat?.status === "paid")
      throw new Error("This sale has already been paid.");
    fresh.fiat = fiat;
    fresh.selectedMethod = fiat.method;
    return await store.savePayment(fresh);
  });
}

export async function markFiatPaid(
  id: string,
  provider: FiatPayment["provider"],
  externalId: string,
  method?: FiatPayment["method"],
  totals?: { tax: string; total: string },
) {
  return store.atomic(async () => {
    const payment = await store.getPayment(id);
    if (!payment) throw new Error("Payment not found.");
    if (
      payment.fiat?.externalId &&
      payment.fiat.externalId !== externalId &&
      payment.fiat.status === "paid"
    )
      throw new Error("This sale is already linked to another payment.");
    payment.fiat = {
      provider,
      method: method || payment.fiat?.method || "card",
      status: "paid",
      externalId,
      paidAt: payment.fiat?.paidAt || Date.now(),
      tax: totals?.tax ?? payment.fiat?.tax,
      total: totals?.total ?? payment.fiat?.total,
    };
    return await store.savePayment(payment);
  });
}

export function stripeTotals(
  currency: string | null,
  total: number | null,
  tax?: number | null,
) {
  if (currency !== "usd" || total === null)
    throw new Error("Stripe returned an unsupported payment total.");
  const fromCents = (value: number) => decimal(BigInt(value) * 10_000n);
  return { tax: fromCents(tax || 0), total: fromCents(total) };
}

export function cents(payment: Payment) {
  const value = Number(payment.amount);
  const amount = Math.round(value * 100);
  if (!Number.isFinite(value) || amount < 50 || amount > 99_999_999)
    throw new Error("Card sales must be between $0.50 and $999,999.99.");
  return amount;
}
