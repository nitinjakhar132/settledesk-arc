"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  usePrivy,
  useWallets,
  type ConnectedWallet,
} from "@privy-io/react-auth";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock3,
  CreditCard,
  Download,
  Landmark,
  MoreHorizontal,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import { Logo, Spinner, Journey, Proof, RouteLine } from "./ui";
import { AnyTokenPay } from "./any-token-pay";
import {
  api,
  completeTransfer,
  download,
  errorText,
  sendPayment,
  type Quote,
} from "@/lib/client";
import {
  money,
  paidTotalOf,
  statusOf,
  subtotalOf,
  type Payment,
  type PaymentMethod,
  type Refund,
} from "@/lib/model";

type PaymentConfig = {
  stripe: boolean;
  paypalClientId?: string;
  walletEnabled: boolean;
};
type WalletSession = {
  privyReady: boolean;
  authenticated: boolean;
  walletsReady: boolean;
  activeWallet?: ConnectedWallet;
  login: () => void;
};
type PayPalNamespace = {
  FUNDING: { PAYPAL: string; VENMO: string };
  Buttons(options: Record<string, unknown>): {
    isEligible(): boolean;
    render(element: HTMLElement): Promise<void>;
    close(): void;
  };
};
declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

export function Checkout({
  id,
  paymentConfig,
}: {
  id: string;
  paymentConfig: PaymentConfig;
}) {
  if (!paymentConfig.walletEnabled)
    return (
      <CheckoutExperience
        id={id}
        paymentConfig={paymentConfig}
        walletSession={{
          privyReady: true,
          authenticated: false,
          walletsReady: true,
          login: () => {},
        }}
      />
    );
  return <WalletCheckout id={id} paymentConfig={paymentConfig} />;
}

function WalletCheckout({
  id,
  paymentConfig,
}: {
  id: string;
  paymentConfig: PaymentConfig;
}) {
  const { ready: privyReady, authenticated, login } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  return (
    <CheckoutExperience
      id={id}
      paymentConfig={paymentConfig}
      walletSession={{
        privyReady,
        authenticated,
        login,
        walletsReady,
        activeWallet: wallets[0],
      }}
    />
  );
}

function CheckoutExperience({
  id,
  paymentConfig,
  walletSession,
}: {
  id: string;
  paymentConfig: PaymentConfig;
  walletSession: WalletSession;
}) {
  const { privyReady, authenticated, login, walletsReady, activeWallet } =
    walletSession;
  const [payment, setPayment] = useState<Payment>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [quote, setQuote] = useState<Quote>();
  const [review, setReview] = useState(false);
  const [more, setMore] = useState(false);
  const [paypalMethod, setPaypalMethod] = useState<"paypal" | "venmo">();
  const [tipPercent, setTipPercent] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const confirmedStripe = useRef(false);
  const load = useCallback(async () => {
    const data = await api<{ payment: Payment }>(`payments/${id}`);
    setPayment(data.payment);
    return data.payment;
  }, [id]);

  useEffect(() => {
    load()
      .catch((e) => setError(errorText(e)))
      .finally(() => setLoading(false));
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!payment || (!payment.transfer && payment.fiat?.status !== "pending"))
      return;
    let active = true;
    const timer = setInterval(
      async () => {
        try {
          const data =
            payment.transfer && payment.mode !== "demo"
              ? await api<{ payment: Payment }>(`payments/${id}/refresh`, {})
              : await api<{ payment: Payment }>(`payments/${id}`);
          if (active) setPayment(data.payment);
        } catch {
          /* Manual refresh remains available. */
        }
      },
      payment.mode === "demo" ? 1600 : 8000,
    );
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [id, payment?.mode, !!payment?.transfer, payment?.fiat?.status]);
  useEffect(() => {
    if (!payment || confirmedStripe.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("stripe") === "cancelled") {
      window.history.replaceState({}, "", `/pay/${payment.id}`);
      return;
    }
    const sessionId = params.get("session_id");
    if (params.get("stripe") !== "success" || !sessionId) return;
    confirmedStripe.current = true;
    setBusy("Confirming payment…");
    api<{ payment: Payment }>("stripe/confirm", {
      paymentId: payment.id,
      sessionId,
    })
      .then(({ payment: next }) => {
        setPayment(next);
        window.history.replaceState({}, "", `/pay/${payment.id}`);
      })
      .catch((e) => setError(errorText(e)))
      .finally(() => setBusy(""));
  }, [payment?.id]);

  const subtotal = Number(subtotalOf(payment || ({ amount: "0" } as Payment)));
  const tip = useMemo(
    () => ((subtotal * tipPercent) / 100).toFixed(2),
    [subtotal, tipPercent],
  );
  const total = (subtotal + Number(tip)).toFixed(2);

  async function run(task: () => Promise<void>, text = "Just a moment…") {
    if (busy) return;
    setBusy(text);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }

  async function demoPay(method: PaymentMethod) {
    await run(async () => {
      const data = await api<{ payment: Payment }>(`payments/${id}/demo-pay`, {
        method,
        tip,
      });
      setPayment(data.payment);
    }, "Confirming demo payment…");
  }

  async function stripePay(method: "card" | "cashapp") {
    if (payment?.mode === "demo") return demoPay(method);
    await run(async () => {
      const data = await api<{ url?: string }>("stripe/checkout", {
        paymentId: id,
        method,
        tip,
      });
      if (!data.url) throw new Error("Stripe did not return a checkout page.");
      window.location.assign(data.url);
    }, "Opening secure checkout…");
  }

  async function payUsdc() {
    if (!payment) return;
    if (payment.mode === "demo") return demoPay("usdc");
    await run(
      async () => {
        let current = payment;
        if (!review || !quote) {
          const configured = await api<{ payment: Payment }>(
            `payments/${id}/configure`,
            { method: "usdc", tip },
          );
          current = configured.payment;
          setPayment(current);
          setQuote(await api<Quote>(`payments/${id}/quote`, {}));
          setReview(true);
          return;
        }
        if (!authenticated) {
          login();
          return;
        }
        if (!activeWallet)
          throw new Error("Your wallet is still getting ready.");
        const result = await sendPayment(
          current,
          quote,
          setBusy,
          undefined,
          activeWallet,
        );
        setPayment(result.payment);
      },
      review ? "Preparing your wallet…" : "Checking the Arc route…",
    );
  }

  async function receive(refund?: Refund) {
    if (!payment) return;
    await run(async () => {
      if (payment.mode !== "demo" && !authenticated) {
        login();
        return;
      }
      if (payment.mode !== "demo" && !activeWallet)
        throw new Error("Your wallet is still getting ready.");
      const data =
        payment.mode === "demo"
          ? await api<{ payment: Payment }>(`payments/${id}/demo-receive`, {
              refundId: refund?.id,
            })
          : await completeTransfer(payment, refund, activeWallet);
      setPayment(data.payment);
    }, "Confirm in your wallet…");
  }

  if (loading)
    return (
      <main className="boot">
        <Logo />
        <Spinner />
        <p>Getting your payment ready.</p>
      </main>
    );
  if (!payment)
    return (
      <main className="checkout-page">
        <Logo />
        <section className="checkout-card checkout-empty">
          <h1>That sale is no longer here.</h1>
          <p>{error || "Ask the merchant for a fresh quick-sale QR."}</p>
        </section>
      </main>
    );

  const p = payment;
  const settled = p.transfer?.status === "settled";
  const fiatPaid = p.fiat?.status === "paid";
  const paid = settled || fiatPaid;
  const expired = statusOf(p) === "expired" && !p.transfer;
  const secondsLeft = p.expiresAt
    ? Math.max(0, Math.ceil((p.expiresAt - now) / 1000))
    : undefined;
  const displayTotal = p.selectedMethod ? p.amount : total;
  const paidTotal = paidTotalOf(p);

  return (
    <main className="checkout-page buyer-checkout">
      <header className="checkout-header buyer-header">
        <Logo />
        {secondsLeft !== undefined && !paid && (
          <span className={`sale-timer ${secondsLeft < 60 ? "urgent" : ""}`}>
            <Clock3 size={13} />
            {Math.floor(secondsLeft / 60)}:
            {String(secondsLeft % 60).padStart(2, "0")}
          </span>
        )}
      </header>
      <section className="checkout-card universal-checkout">
        <div className="checkout-store">
          <span className="store-monogram">{p.merchantName.slice(0, 1)}</span>
          <strong>{p.merchantName}</strong>
          <ShieldCheck size={16} />
        </div>

        {paid ? (
          <div className="checkout-success counter-success">
            <div className="success-orbit">
              <span>
                <Check size={32} />
              </span>
            </div>
            <span className="eyebrow green">PAYMENT CONFIRMED</span>
            <h1>You’re all set.</h1>
            <p>
              {fiatPaid
                ? `${p.merchantName} has your payment. Their payout is settling.`
                : `${p.merchantName} received USDC on Arc.`}
            </p>
            <div className="success-total">${money(paidTotal)}</div>
            {Number(p.tip || 0) > 0 && (
              <span className="tip-thanks">
                Tip included · ${money(p.tip || "0")}
              </span>
            )}
            {p.collectTax && p.fiat?.tax !== undefined && (
              <span className="tax-confirmed">
                Tax collected · ${money(p.fiat.tax)}
              </span>
            )}
          </div>
        ) : expired ? (
          <div className="checkout-success expired-sale">
            <span className="expired-icon">
              <Clock3 size={29} />
            </span>
            <h1>This QR has expired.</h1>
            <p>Ask the merchant to make a fresh quick sale.</p>
          </div>
        ) : (
          <>
            <p className="checkout-for">{p.description}</p>
            <div className="checkout-amount buyer-amount">
              ${money(subtotalOf(p), false)}
              <span>Sale amount</span>
            </div>
            {p.tipsEnabled &&
              !p.transfer &&
              p.fiat?.status !== "paid" &&
              !review && (
                <div className="tip-picker">
                  <div>
                    <span>Add a tip</span>
                    <small>Only you can see this screen</small>
                  </div>
                  <div
                    className="tip-options"
                    role="group"
                    aria-label="Tip amount"
                  >
                    {[0, 15, 20, 25].map((percent) => (
                      <button
                        key={percent}
                        className={tipPercent === percent ? "active" : ""}
                        onClick={() => setTipPercent(percent)}
                      >
                        {percent === 0 ? "No tip" : `${percent}%`}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            {!p.transfer && p.fiat?.status !== "paid" && !review && (
              <>
                <div className="pay-total-row">
                  <span>{p.collectTax ? "Subtotal before tax" : "Total"}</span>
                  <strong>${money(displayTotal, false)}</strong>
                </div>
                {p.collectTax && (
                  <div className="tax-checkout-note">
                    <ReceiptText size={17} />
                    <span>
                      <strong>Tax calculated at checkout</strong>
                      <small>
                        Stripe uses your billing location and shows the final
                        total before you pay.
                      </small>
                    </span>
                  </div>
                )}
              </>
            )}

            {review && !p.transfer ? (
              <div className="usdc-review">
                <button
                  className="back-method"
                  onClick={() => setReview(false)}
                >
                  <ArrowLeft size={15} /> Change payment method
                </button>
                <RouteLine mode={p.mode} />
                <div className="receipt-facts">
                  <p>
                    <span>You pay</span>
                    <strong>
                      {money(quote?.total || p.amount, true)} USDC
                    </strong>
                  </p>
                  <p>
                    <span>Merchant receives</span>
                    <strong>{money(p.amount)} USDC on Arc</strong>
                  </p>
                  <p>
                    <span>CCTP fee</span>
                    <strong>{money(quote?.fee || "0", true)} USDC</strong>
                  </p>
                </div>
                <button
                  className="button primary wide"
                  disabled={
                    !!busy || !privyReady || (authenticated && !walletsReady)
                  }
                  onClick={payUsdc}
                >
                  {busy ? <Spinner /> : <Wallet size={18} />}
                  {authenticated ? "Confirm in wallet" : "Connect wallet & pay"}
                </button>
              </div>
            ) : !p.transfer && p.fiat?.status !== "paid" ? (
              <div className="universal-actions">
                {(paymentConfig.stripe || p.mode === "demo") && (
                  <button
                    className="button primary wide express-pay"
                    disabled={!!busy}
                    onClick={() => stripePay("card")}
                  >
                    {busy ? <Spinner /> : <CreditCard size={19} />}
                    <span>
                      <strong>
                        {p.collectTax
                          ? "Continue to secure checkout"
                          : `Pay $${money(displayTotal, false)}`}
                      </strong>
                      <small>
                        {p.collectTax
                          ? "Card · wallets · final tax shown next"
                          : "Card · Apple Pay · Google Pay"}
                      </small>
                    </span>
                    <ArrowRight size={18} />
                  </button>
                )}
                {!p.collectTax &&
                  (paymentConfig.walletEnabled || p.mode === "demo") && (
                    <AnyTokenPay
                      payment={p}
                      tip={tip}
                      authenticated={authenticated}
                      login={login}
                      activeWallet={activeWallet}
                      disabled={!!busy}
                      onBusy={setBusy}
                      onPaid={setPayment}
                      onError={setError}
                    />
                  )}
                {(paymentConfig.stripe ||
                  p.mode === "demo" ||
                  (!p.collectTax && paymentConfig.paypalClientId)) && (
                  <button
                    className="more-methods"
                    onClick={() => setMore(!more)}
                  >
                    <MoreHorizontal size={17} />
                    More ways to pay
                  </button>
                )}
                {p.collectTax && !paymentConfig.stripe && p.mode !== "demo" && (
                  <p className="tax-unavailable" role="alert">
                    Tax checkout is not available yet. Ask the merchant for a
                    fresh sale after Stripe Tax setup is complete.
                  </p>
                )}
                {more && (
                  <div className="method-drawer">
                    {(paymentConfig.stripe || p.mode === "demo") && (
                      <button onClick={() => stripePay("cashapp")}>
                        <span className="method-logo cash">$</span>
                        <span>
                          <strong>Cash App Pay</strong>
                          <small>Continue in Cash App</small>
                        </span>
                        <ArrowRight size={16} />
                      </button>
                    )}
                    {!p.collectTax &&
                      (paymentConfig.paypalClientId || p.mode === "demo") && (
                        <>
                          <button
                            onClick={() =>
                              p.mode === "demo"
                                ? demoPay("paypal")
                                : setPaypalMethod("paypal")
                            }
                          >
                            <span className="method-logo paypal">P</span>
                            <span>
                              <strong>PayPal</strong>
                              <small>Use your PayPal balance or card</small>
                            </span>
                            <ArrowRight size={16} />
                          </button>
                          <button
                            onClick={() =>
                              p.mode === "demo"
                                ? demoPay("venmo")
                                : setPaypalMethod("venmo")
                            }
                          >
                            <span className="method-logo venmo">V</span>
                            <span>
                              <strong>Venmo</strong>
                              <small>Continue in Venmo</small>
                            </span>
                            <ArrowRight size={16} />
                          </button>
                        </>
                      )}
                    {!p.collectTax && (
                      <button className="method-disabled" disabled>
                        <Landmark size={18} />
                        <span>
                          <strong>Bank account</strong>
                          <small>Best for invoices, not counter sales</small>
                        </span>
                      </button>
                    )}
                  </div>
                )}
                {paypalMethod && paymentConfig.paypalClientId && (
                  <div className="paypal-panel">
                    <div>
                      <strong>
                        Pay with {paypalMethod === "venmo" ? "Venmo" : "PayPal"}
                      </strong>
                      <button
                        aria-label="Close PayPal options"
                        onClick={() => setPaypalMethod(undefined)}
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <PayPalButtons
                      clientId={paymentConfig.paypalClientId}
                      method={paypalMethod}
                      paymentId={p.id}
                      tip={tip}
                      onPaid={setPayment}
                      onError={setError}
                    />
                  </div>
                )}
              </div>
            ) : null}
          </>
        )}

        {p.transfer && !settled && <Journey payment={p} />}
        {p.transfer?.status === "ready" && (
          <button
            className="button primary wide"
            disabled={!!busy}
            onClick={() => receive()}
          >
            {busy ? <Spinner /> : <ArrowUpRight size={18} />}Complete on Arc
          </button>
        )}
        {p.transfer?.status === "expired" && (
          <button
            className="button primary wide"
            disabled={!!busy}
            onClick={() =>
              run(async () => {
                await api(`payments/${id}/reattest`, {});
                await load();
              })
            }
          >
            Refresh verification
          </button>
        )}
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        {paid && (
          <button
            className="button secondary wide"
            onClick={() =>
              download(
                `${p.reference}-receipt.json`,
                JSON.stringify(
                  {
                    ...p,
                    receiptType:
                      p.mode === "demo"
                        ? "DEMO — NOT PROOF OF PAYMENT"
                        : p.fiat
                          ? `${p.fiat.provider} payment receipt`
                          : "SettleDesk CCTP receipt",
                  },
                  null,
                  2,
                ),
              )
            }
          >
            <Download size={17} /> Download receipt
          </button>
        )}
        {p.transfer && (
          <button
            className="text-button wide"
            disabled={!!busy}
            onClick={() => run(async () => void (await load()))}
          >
            {busy ? <Spinner /> : <RefreshCw size={14} />}Refresh status
          </button>
        )}
        {p.transfer && <Proof payment={p} />}
        <div className="checkout-assurance">
          <ShieldCheck size={15} />
          <span>No Arc Counter account needed to pay.</span>
        </div>
      </section>
      <footer className="checkout-footer">
        One checkout · <strong>Arc settlement</strong>
      </footer>
    </main>
  );
}

function PayPalButtons({
  clientId,
  method,
  paymentId,
  tip,
  onPaid,
  onError,
}: {
  clientId: string;
  method: "paypal" | "venmo";
  paymentId: string;
  tip: string;
  onPaid: (payment: Payment) => void;
  onError: (error: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    let buttons: ReturnType<PayPalNamespace["Buttons"]> | undefined;
    async function render() {
      if (!window.paypal) {
        await new Promise<void>((resolve, reject) => {
          const existing = document.getElementById(
            "settledesk-paypal-sdk",
          ) as HTMLScriptElement | null;
          if (existing) {
            existing.addEventListener("load", () => resolve(), { once: true });
            existing.addEventListener(
              "error",
              () => reject(new Error("PayPal could not load.")),
              { once: true },
            );
            return;
          }
          const script = document.createElement("script");
          script.id = "settledesk-paypal-sdk";
          script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&components=buttons&enable-funding=venmo`;
          script.async = true;
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("PayPal could not load."));
          document.head.appendChild(script);
        });
      }
      if (cancelled || !window.paypal || !ref.current) return;
      const paypal = window.paypal;
      buttons = paypal.Buttons({
        fundingSource:
          method === "venmo" ? paypal.FUNDING.VENMO : paypal.FUNDING.PAYPAL,
        style: { shape: "rect", height: 48, layout: "vertical" },
        createOrder: async () => {
          const order = await api<{ id: string }>("paypal/orders", {
            paymentId,
            method,
            tip,
          });
          return order.id;
        },
        onApprove: async (data: { orderID: string }) => {
          const result = await api<{ payment: Payment }>("paypal/capture", {
            paymentId,
            orderId: data.orderID,
            method,
          });
          onPaid(result.payment);
        },
        onError: (value: unknown) => onError(errorText(value)),
      });
      if (!buttons.isEligible()) {
        onError(
          `${method === "venmo" ? "Venmo" : "PayPal"} is not available on this device.`,
        );
        return;
      }
      await buttons.render(ref.current);
    }
    render().catch((value) => onError(errorText(value)));
    return () => {
      cancelled = true;
      buttons?.close();
    };
  }, [clientId, method, paymentId, tip, onPaid, onError]);
  return <div ref={ref} className="paypal-buttons" />;
}
