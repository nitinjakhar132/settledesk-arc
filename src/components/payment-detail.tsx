"use client";
import { useRef, useState } from "react";
import type { ConnectedWallet } from "@privy-io/react-auth";
import {
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronRight,
  CornerUpLeft,
  CreditCard,
  Download,
  Link2,
  ShieldCheck,
  X,
  RefreshCw,
} from "lucide-react";
import { Sheet, Avatar, Badge, RouteLine, Journey, Proof, Spinner } from "./ui";
import {
  money,
  paidTotalOf,
  refundable,
  shortAddress,
  units,
  decimal,
  type Payment,
  type Refund,
} from "@/lib/model";
import {
  api,
  completeTransfer,
  download,
  errorText,
  sendPayment,
  shareLink,
  type Quote,
} from "@/lib/client";

export function PaymentDetail({
  payment,
  onClose,
  onChange,
  notify,
  wallet,
}: {
  payment: Payment;
  onClose: () => void;
  onChange: (p: Payment) => void;
  notify: (text: string) => void;
  wallet?: ConnectedWallet;
}) {
  const [refundView, setRefundView] = useState(false);
  const [amount, setAmount] = useState(refundable(payment));
  const [reason, setReason] = useState("Customer request");
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [quote, setQuote] = useState<Quote>();
  const key = useRef(crypto.randomUUID());
  const pending = payment.refunds.find((r) => r.status !== "settled");
  const remaining = refundable(payment);
  const confirmed =
    payment.transfer?.status === "settled" || payment.fiat?.status === "paid";
  const fiatLabel =
    payment.fiat?.method === "cashapp"
      ? "Cash App Pay"
      : payment.fiat?.method === "venmo"
        ? "Venmo"
        : payment.fiat?.method === "paypal"
          ? "PayPal"
          : "Card or mobile wallet";
  async function run(task: () => Promise<void>, label = "Working…") {
    if (busy) return;
    setBusy(label);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }
  async function refresh() {
    await run(async () => {
      const data =
        payment.mode === "demo" || payment.fiat
          ? await api<{ payment: Payment }>(`payments/${payment.id}`)
          : await api<{ payment: Payment }>(
              `payments/${payment.id}/refresh`,
              {},
            );
      onChange(data.payment);
      notify("Payment status refreshed");
    });
  }
  async function receive(refund?: Refund) {
    await run(async () => {
      const data =
        payment.mode === "demo"
          ? await api<{ payment: Payment }>(
              `payments/${payment.id}/demo-receive`,
              { refundId: refund?.id },
            )
          : await completeTransfer(payment, refund, wallet);
      onChange(data.payment);
      notify("Transfer submitted. Checking final settlement…");
    }, "Completing transfer…");
  }
  async function prepareRefund() {
    await run(async () => {
      if (units(amount) > units(remaining))
        throw new Error(
          "Enter an amount within the remaining refundable balance.",
        );
      if (payment.mode !== "demo") {
        // Reserve before quoting: retries reuse this exact refund instead of creating a second one.
        const data = await api<{ payment: Payment; refund: Refund }>(
          `payments/${payment.id}/refund`,
          { amount, reason, idempotencyKey: key.current },
        );
        onChange(data.payment);
        setQuote(
          await api<Quote>(`payments/${payment.id}/quote`, {
            refundId: data.refund.id,
          }),
        );
      }
      setReview(true);
    }, "Preparing refund…");
  }
  async function submitRefund(existing?: Refund) {
    await run(
      async () => {
        const data = existing
          ? { payment, refund: existing }
          : await api<{ payment: Payment; refund: Refund }>(
              `payments/${payment.id}/refund`,
              { amount, reason, idempotencyKey: key.current },
            );
        onChange(data.payment);
        if (payment.mode !== "demo") {
          const q =
            quote ||
            (await api<Quote>(`payments/${payment.id}/quote`, {
              refundId: data.refund.id,
            }));
          const result = await sendPayment(
            data.payment,
            q,
            setBusy,
            data.refund,
            wallet,
          );
          onChange(result.payment);
        }
        setRefundView(false);
        setReview(false);
        key.current = crypto.randomUUID();
        notify(
          payment.mode === "demo"
            ? "Demo refund started"
            : "Refund sent. We’ll track it from here.",
        );
      },
      payment.mode === "demo" ? "Sending demo refund…" : "Opening your wallet…",
    );
  }
  const title = refundView
    ? review
      ? "One last look."
      : "Make it right."
    : "Payment details";
  return (
    <Sheet
      title={title}
      subtitle={refundView ? "A little care goes a long way." : undefined}
      onClose={onClose}
    >
      {refundView ? (
        <div className="refund-flow">
          <div className="refund-person">
            <Avatar name={payment.customer} />
            <div>
              <strong>Refund to {payment.customer.split(" ")[0]}</strong>
              <p>
                {payment.reference} · {payment.description}
              </p>
            </div>
          </div>
          <div className="refund-amount">
            <label htmlFor="refund-amount">
              {review ? "Customer receives" : "Refund amount"}
            </label>
            <div>
              <span>$</span>
              <input
                id="refund-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                readOnly={review || !!pending}
                aria-label="Refund amount"
              />
            </div>
            <small>USDC · {money(remaining)} available to refund</small>
          </div>
          {!review && !pending && (
            <div className="amount-presets">
              {[25, 50, 100].map((percent) => (
                <button
                  key={percent}
                  onClick={() =>
                    setAmount(
                      decimal((units(remaining) * BigInt(percent)) / 100n),
                    )
                  }
                >
                  {percent === 100 ? "Full refund" : `${percent}%`}
                </button>
              ))}
            </div>
          )}
          <RouteLine reverse mode={payment.mode} />
          {!review ? (
            <label className="field">
              Reason
              <select
                value={reason}
                disabled={!!pending}
                onChange={(e) => setReason(e.target.value)}
              >
                <option>Customer request</option>
                <option>Order cancelled</option>
                <option>Duplicate payment</option>
                <option>Service not delivered</option>
                <option>Other</option>
              </select>
            </label>
          ) : (
            <div className="receipt-facts">
              <p>
                <span>Reason</span>
                <strong>{reason}</strong>
              </p>
              <p>
                <span>Returns to</span>
                <strong>{shortAddress(payment.payerAddress)} on Base</strong>
              </p>
              <p>
                <span>Transfer fee</span>
                <strong>
                  {payment.mode === "demo"
                    ? "Simulated · $0.00"
                    : `${money(quote?.fee || "0", true)} USDC`}
                </strong>
              </p>
              <p>
                <span>You pay</span>
                <strong>
                  {money(quote?.total || amount, true)} USDC
                  {payment.mode !== "demo" && " + wallet gas"}
                </strong>
              </p>
            </div>
          )}
          <div className="gentle-note">
            <ShieldCheck size={18} />
            <span>
              {payment.mode === "demo"
                ? "This is a demo. No money will move."
                : "Funds return to the wallet that made the original payment. Your wallet approves the transfer."}
            </span>
          </div>
          {error && (
            <p role="alert" className="error-box">
              {error}
            </p>
          )}
          <button
            className="button primary wide"
            disabled={!!busy}
            onClick={() => (review ? submitRefund(pending) : prepareRefund())}
          >
            {busy ? (
              <>
                <Spinner />
                {busy}
              </>
            ) : review ? (
              <>
                Confirm {money(amount)} USDC refund
                <CornerUpLeft size={18} />
              </>
            ) : (
              <>
                Review refund
                <ArrowUpRight size={18} />
              </>
            )}
          </button>
          <button
            className="text-button wide"
            disabled={!!busy}
            onClick={() => {
              setRefundView(false);
              setReview(false);
              setError("");
            }}
          >
            {pending ? "Back to payment" : "Keep payment"}
          </button>
        </div>
      ) : (
        <>
          <div className="detail-hero">
            <Avatar name={payment.customer} size="large" />
            <p>{payment.customer}</p>
            <h1>${money(paidTotalOf(payment))}</h1>
            <Badge payment={payment} />
            <span className="detail-description">{payment.description}</span>
          </div>
          {payment.fiat ? (
            <>
              <div className="fiat-settlement-card">
                <span>
                  <CreditCard size={19} />
                </span>
                <div>
                  <strong>{fiatLabel} confirmed</strong>
                  <p>
                    The customer is paid. Your processor payout is settling
                    separately from Arc USDC.
                  </p>
                </div>
              </div>
              {payment.collectTax && payment.fiat.tax !== undefined && (
                <div className="tax-detail-breakdown">
                  <p>
                    <span>Sale and tip</span>
                    <strong>${money(payment.amount)}</strong>
                  </p>
                  <p>
                    <span>Tax collected</span>
                    <strong>${money(payment.fiat.tax)}</strong>
                  </p>
                  <p>
                    <span>Customer paid</span>
                    <strong>${money(paidTotalOf(payment))}</strong>
                  </p>
                </div>
              )}
            </>
          ) : (
            <>
              <RouteLine mode={payment.mode} />
              <Journey payment={payment} />
            </>
          )}
          {payment.transfer?.status === "ready" && (
            <button
              className="button primary wide"
              disabled={!!busy}
              onClick={() => receive()}
            >
              {busy ? <Spinner /> : <ArrowUpRight size={18} />}Receive on Arc
            </button>
          )}
          {payment.transfer?.status === "expired" && (
            <button
              className="button primary wide"
              disabled={!!busy}
              onClick={() =>
                run(async () => {
                  await api(`payments/${payment.id}/reattest`, {});
                  notify("Fresh verification requested from Circle");
                })
              }
            >
              Refresh verification
            </button>
          )}
          {payment.transfer && payment.transfer.status !== "settled" && (
            <p className="center-note">
              {payment.mode === "demo"
                ? "Demo journey · no real funds"
                : "Your transfer is saved. You can safely come back later."}
            </p>
          )}
          {payment.refunds.map((r) => (
            <div className="refund-card" key={r.id}>
              <div className="section-heading">
                <span>
                  <CornerUpLeft size={17} />
                  {r.status === "settled"
                    ? "Refund delivered"
                    : r.reserved
                      ? "Refund awaiting approval"
                      : "Refund on its way"}
                </span>
                <strong>−${money(r.amount)}</strong>
              </div>
              <p>{r.reason} · Arc → Base</p>
              <Journey payment={payment} refund={r} />
              {r.reserved && (
                <button
                  className="button secondary wide"
                  disabled={!!busy}
                  onClick={() =>
                    run(async () => {
                      key.current = r.id;
                      setAmount(r.amount);
                      setReason(r.reason);
                      setQuote(
                        await api<Quote>(`payments/${payment.id}/quote`, {
                          refundId: r.id,
                        }),
                      );
                      setRefundView(true);
                      setReview(true);
                    })
                  }
                >
                  Review & approve refund
                  <ArrowUpRight size={17} />
                </button>
              )}
              {r.status === "ready" && (
                <button
                  className="button secondary wide"
                  disabled={!!busy}
                  onClick={() => receive(r)}
                >
                  Complete return to Base
                </button>
              )}
              {r.status === "expired" && (
                <button
                  className="button secondary wide"
                  disabled={!!busy}
                  onClick={() =>
                    run(async () => {
                      await api(`payments/${payment.id}/reattest`, {
                        refundId: r.id,
                      });
                      notify("Fresh verification requested");
                    })
                  }
                >
                  Refresh refund verification
                </button>
              )}
              <Proof payment={payment} refund={r} />
            </div>
          ))}
          <div className="receipt-facts">
            <p>
              <span>Reference</span>
              <strong>{payment.reference}</strong>
            </p>
            <p>
              <span>Created</span>
              <strong>
                {new Date(payment.createdAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </strong>
            </p>
            <p>
              <span>Fulfillment</span>
              <strong>
                {payment.fulfilledAt
                  ? "Complete"
                  : confirmed && !payment.refunds.length
                    ? "Ready to fulfill"
                    : "Not fulfilled"}
              </strong>
            </p>
          </div>
          {confirmed && !payment.refunds.length && (
            <button
              className={`button ${payment.fulfilledAt ? "subtle" : "primary"} wide`}
              disabled={!!payment.fulfilledAt || !!busy}
              onClick={() =>
                run(async () => {
                  const result = await api<{ payment: Payment }>(
                    `payments/${payment.id}/fulfill`,
                    {},
                  );
                  onChange(result.payment);
                  notify("Order marked as fulfilled");
                })
              }
            >
              {payment.fulfilledAt ? (
                <>
                  <CheckCheck size={18} />
                  Order fulfilled
                </>
              ) : (
                <>
                  <Check size={18} />
                  Mark as fulfilled
                </>
              )}
            </button>
          )}
          <div className="detail-actions">
            <button
              disabled={!!busy}
              onClick={() =>
                run(async () =>
                  notify(
                    await shareLink(
                      `${location.origin}/pay/${payment.id}`,
                      `${payment.merchantName} · ${payment.reference}`,
                    ),
                  ),
                )
              }
            >
              <Link2 size={19} />
              Share receipt
            </button>
            <button
              onClick={() => {
                download(
                  `${payment.reference}.json`,
                  JSON.stringify(
                    {
                      ...payment,
                      receiptType:
                        payment.mode === "demo"
                          ? "DEMO — NOT PROOF OF PAYMENT"
                          : payment.fiat
                            ? `${payment.fiat.provider} payment receipt`
                            : "SettleDesk CCTP receipt",
                    },
                    null,
                    2,
                  ),
                );
                notify("Receipt downloaded");
              }}
            >
              <Download size={19} />
              Download
            </button>
            {payment.transfer?.status === "settled" &&
              Number(remaining) > 0 &&
              !pending && (
                <button
                  onClick={() => {
                    setAmount(remaining);
                    setRefundView(true);
                    setError("");
                  }}
                >
                  <CornerUpLeft size={19} />
                  Refund
                </button>
              )}
          </div>
          {!payment.fiat && <Proof payment={payment} />}
          {error && (
            <p className="error-box" role="alert">
              {error}
            </p>
          )}
          <button
            className="text-button wide"
            disabled={!!busy}
            onClick={refresh}
          >
            {busy ? <Spinner /> : <RefreshCw size={14} />}Refresh status
          </button>
        </>
      )}
    </Sheet>
  );
}
