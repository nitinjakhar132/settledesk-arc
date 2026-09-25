"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  usePrivy,
  useWallets,
  type ConnectedWallet,
} from "@privy-io/react-auth";
import type { Hex } from "viem";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { QRCodeSVG } from "qrcode.react";
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Copy,
  CornerUpLeft,
  Download,
  Eye,
  EyeOff,
  Home,
  Link2,
  LogOut,
  Plus,
  ReceiptText,
  Search,
  Settings2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Store,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { Logo, Spinner, Sheet, Empty, PaymentRow, Avatar } from "./ui";
import { PaymentDetail } from "./payment-detail";
import {
  api,
  continueArcFunding,
  download,
  errorText,
  shareLink,
  signIn,
  startArcFunding,
  type FundingTransfer,
} from "@/lib/client";
import { readAssetSnapshot, type AssetSnapshot } from "@/lib/assets";
import { network } from "@/lib/chains";
import {
  money,
  paidTotalOf,
  refundedUnits,
  shortAddress,
  statusOf,
  units,
  decimal,
  type Payment,
  type Profile,
  type Mode,
} from "@/lib/model";

type Tab = "home" | "payments" | "links" | "store";
type InstallEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
const tabs = [
  { id: "home", label: "Counter", Icon: Home },
  { id: "payments", label: "Payments", Icon: ArrowDownLeft },
  { id: "links", label: "Pay links", Icon: Link2 },
  { id: "store", label: "Your store", Icon: Store },
] as const;

export function MerchantApp() {
  const {
    ready: privyReady,
    authenticated,
    login,
    logout: privyLogout,
  } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  return (
    <MerchantExperience
      auth={{
        privyReady,
        authenticated,
        login,
        privyLogout,
        walletsReady,
        activeWallet: wallets[0],
      }}
    />
  );
}

export function DemoMerchantApp() {
  return (
    <MerchantExperience
      demoOnly
      auth={{
        privyReady: false,
        authenticated: false,
        login: () => {},
        privyLogout: async () => {},
        walletsReady: true,
      }}
    />
  );
}

function MerchantExperience({
  auth,
  demoOnly = false,
}: {
  auth: {
    privyReady: boolean;
    authenticated: boolean;
    login: () => void;
    privyLogout: () => Promise<void>;
    walletsReady: boolean;
    activeWallet?: ConnectedWallet;
  };
  demoOnly?: boolean;
}) {
  const {
    privyReady,
    authenticated,
    login,
    privyLogout,
    walletsReady,
    activeWallet,
  } = auth;
  const authAttempt = useRef("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("home");
  const [selected, setSelected] = useState<string>();
  const [createOpen, setCreateOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [activity, setActivity] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [hidden, setHidden] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [period, setPeriod] = useState("7D");
  const [offline, setOffline] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallEvent>();
  const [assets, setAssets] = useState<AssetSnapshot>();
  const [fundOpen, setFundOpen] = useState(false);
  const reduced = useReducedMotion();
  const notify = useCallback((message: string) => setToast(message), []);
  const load = useCallback(async () => {
    const data = await api<{ payments: Payment[]; profile: Profile }>(
      "payments",
    );
    setPayments(data.payments);
    setProfile(data.profile);
  }, []);
  useEffect(() => {
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    const offlineHandler = () => setOffline(!navigator.onLine);
    const installHandler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as InstallEvent);
    };
    window.addEventListener("offline", offlineHandler);
    window.addEventListener("online", offlineHandler);
    window.addEventListener("beforeinstallprompt", installHandler);
    return () => {
      window.removeEventListener("offline", offlineHandler);
      window.removeEventListener("online", offlineHandler);
      window.removeEventListener("beforeinstallprompt", installHandler);
    };
  }, []);
  useEffect(() => {
    if (demoOnly) {
      if (authAttempt.current === "demo") return;
      authAttempt.current = "demo";
      let active = true;
      setLoading(true);
      api<{ profile: Profile }>("demo", {})
        .then(() => (active ? load() : undefined))
        .catch((e) => {
          authAttempt.current = "";
          if (active) setError(errorText(e));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
        if (authAttempt.current === "demo") authAttempt.current = "";
      };
    }
    if (!privyReady) return;
    if (!authenticated) {
      authAttempt.current = "";
      setProfile(null);
      setLoading(false);
      return;
    }
    if (!walletsReady) return;
    if (!activeWallet) {
      setError("Your wallet is still being created. Please try again.");
      setLoading(false);
      return;
    }
    const key = activeWallet.address.toLowerCase();
    if (authAttempt.current === key) return;
    authAttempt.current = key;
    let active = true;
    setLoading(true);
    setError("");
    api<{ profile: Profile | null }>("session")
      .then(async ({ profile: sessionProfile }) => {
        if (
          !sessionProfile ||
          sessionProfile.address?.toLowerCase() !== key ||
          sessionProfile.mode === "demo"
        ) {
          await signIn(activeWallet);
        }
        if (active) await load();
      })
      .catch((e) => {
        authAttempt.current = "";
        if (active) setError(errorText(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      if (authAttempt.current === key) authAttempt.current = "";
    };
  }, [
    demoOnly,
    privyReady,
    authenticated,
    walletsReady,
    activeWallet?.address,
    load,
  ]);
  useEffect(() => {
    if (privyReady) return;
    const timer = setTimeout(() => setLoading(false), 3500);
    return () => clearTimeout(timer);
  }, [privyReady]);
  const refreshAssets = useCallback(async () => {
    if (!profile || profile.mode === "demo" || !activeWallet) return;
    const next = await readAssetSnapshot(
      activeWallet.address as `0x${string}`,
      profile.mode,
    );
    setAssets(next);
    if (
      Number(next.arcUsdc) === 0 &&
      Number(next.baseUsdc) > 0 &&
      !sessionStorage.getItem(
        `settledesk:funding-intro:${activeWallet.address}`,
      )
    ) {
      sessionStorage.setItem(
        `settledesk:funding-intro:${activeWallet.address}`,
        "shown",
      );
      setFundOpen(true);
    }
  }, [profile?.mode, activeWallet?.address]);
  useEffect(() => {
    if (!profile || profile.mode === "demo" || !activeWallet) return;
    refreshAssets().catch(() => {});
    const timer = setInterval(() => refreshAssets().catch(() => {}), 30_000);
    return () => clearInterval(timer);
  }, [profile?.mode, activeWallet?.address, refreshAssets]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!profile) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        if (document.visibilityState === "visible") {
          const data = await api<{ payments: Payment[] }>("payments");
          if (active) setPayments(data.payments);
          const pending = data.payments
            .filter(
              (p) =>
                p.mode !== "demo" &&
                ((p.transfer && p.transfer.status !== "settled") ||
                  p.refunds.some((r) => r.burnHash && r.status !== "settled")),
            )
            .slice(0, 3);
          for (const p of pending) {
            try {
              const result = await api<{ payment: Payment }>(
                `payments/${p.id}/refresh`,
                {},
              );
              if (active)
                setPayments((old) =>
                  old.map((item) => (item.id === p.id ? result.payment : item)),
                );
            } catch {
              /* Keep the last verified state; the detail view exposes manual retry. */
            }
          }
        }
      } catch {
        /* The offline banner and manual refresh retain the current screen. */
      }
      if (active)
        timer = setTimeout(poll, profile.mode === "demo" ? 1800 : 10_000);
    };
    timer = setTimeout(poll, 1800);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [profile?.mode]);
  const updatePayment = useCallback((payment: Payment) => {
    setPayments((old) =>
      old.some((p) => p.id === payment.id)
        ? old.map((p) => (p.id === payment.id ? payment : p))
        : [payment, ...old],
    );
  }, []);
  async function leave() {
    await api("logout", {}).catch(() => {});
    await privyLogout();
    authAttempt.current = "";
    setProfile(null);
    setPayments([]);
    setTab("home");
  }
  const settled = payments.filter((p) => p.transfer?.status === "settled");
  const net = settled.reduce(
    (sum, p) => sum + units(p.amount) - refundedUnits(p, false),
    0n,
  );
  const pending = payments.filter((p) =>
    ["processing", "ready", "expired"].includes(statusOf(p)),
  );
  const attention = payments.filter(
    (p) =>
      ["ready", "expired"].includes(statusOf(p)) ||
      p.refunds.some(
        (r) => ["ready", "expired"].includes(r.status) || r.reserved,
      ),
  );
  const filtered = payments
    .filter((p) =>
      `${p.customer} ${p.description} ${p.reference}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .filter(
      (p) =>
        filter === "All" ||
        (filter === "Received" &&
          ["settled", "partial"].includes(statusOf(p))) ||
        (filter === "Pending" &&
          ["requested", "processing", "ready", "expired"].includes(
            statusOf(p),
          )) ||
        (filter === "Refunds" && p.refunds.length > 0),
    );
  const events = useMemo(
    () =>
      payments
        .flatMap((p) => [
          {
            id: p.id,
            text:
              p.transfer?.status === "settled"
                ? `${p.customer.split(" ")[0]} paid you`
                : p.transfer
                  ? `Payment from ${p.customer.split(" ")[0]} is on its way`
                  : `Payment link created for ${p.customer.split(" ")[0]}`,
            amount: paidTotalOf(p),
            at: p.transfer?.settledAt || p.createdAt,
            refund: false,
          },
          ...p.refunds.map((r) => ({
            id: p.id,
            text:
              r.status === "settled"
                ? `Refund delivered to ${p.customer.split(" ")[0]}`
                : `Refund to ${p.customer.split(" ")[0]} in progress`,
            amount: r.amount,
            at: r.settledAt || r.startedAt,
            refund: true,
          })),
        ])
        .sort((a, b) => b.at - a.at),
    [payments],
  );
  function exportCSV() {
    const escape = (s: string) =>
      `"${(/^[=+\-@\t\r]/.test(s) ? "'" : "") + s.replaceAll('"', '""')}"`;
    const rows = [
      [
        "Reference",
        "Customer",
        "Description",
        "Sale amount",
        "Tip",
        "Tax",
        "Customer paid",
        "Currency",
        "Refunded USDC",
        "Status",
        "Network",
        "Created",
      ],
      ...payments.map((p) => [
        p.reference,
        p.customer,
        p.description,
        p.amount,
        p.tip || "0",
        p.fiat?.tax || "0",
        paidTotalOf(p),
        p.fiat ? "USD" : "USDC",
        decimal(refundedUnits(p, false)),
        statusOf(p),
        p.mode,
        new Date(p.createdAt).toISOString(),
      ]),
    ];
    download(
      "settledesk-payments.csv",
      rows.map((row) => row.map(escape).join(",")).join("\r\n"),
      "text/csv",
    );
    notify("Payments exported");
  }
  if (loading)
    return (
      <main className="boot">
        <Logo />
        <Spinner />
        <p>Making room for a calmer day.</p>
      </main>
    );
  if (!profile)
    return (
      <main className="welcome">
        <div className="welcome-top">
          <Logo />
          <span className="eyebrow">BUILT FOR YOUR EVERYDAY</span>
        </div>
        <div className="welcome-content">
          <div className="welcome-art" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="orbit orbit-three" />
            <div className="floating-payment">
              <span className="success-icon">
                <Check size={22} />
              </span>
              <span>
                Payment received<strong>+$480.00</strong>
              </span>
              <span className="tiny-label">just now</span>
            </div>
            <div className="arc-coin">s.</div>
            <span className="orbit-star">✳</span>
          </div>
          <span className="eyebrow green">YOUR BUSINESS, IN FLOW</span>
          <h1>
            Money in.
            <br />
            <span>Mind at ease.</span>
          </h1>
          <p>
            One simple Arc account for payments, payouts,
            <br />
            and refunds that find their way home.
          </p>
          <div className="welcome-buttons">
            <button
              className="button primary"
              disabled={!privyReady}
              onClick={login}
            >
              {!privyReady ? (
                <Spinner />
              ) : (
                <>
                  Continue to SettleDesk
                  <ArrowRight size={19} />
                </>
              )}
            </button>
            <a className="button secondary" href="/demo">
              Explore the demo
            </a>
          </div>
          <div className="signin-methods">
            <span>Wallet</span>
            <span>Email</span>
            <span>Mobile</span>
          </div>
          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
          <div className="welcome-assurance">
            <ShieldCheck size={15} />
            <span>Your wallet. Your funds. Always.</span>
          </div>
        </div>
        <footer className="welcome-footer">
          <span>
            Powered by <strong>Arc</strong> + Circle CCTP
          </span>
          <span>Crosschain. Without the chaos.</span>
        </footer>
      </main>
    );
  const selectedPayment = payments.find((p) => p.id === selected);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a href="/" className="brand-link" aria-label="SettleDesk home">
          <Logo />
        </a>
        <span className="sidebar-label">WORKSPACE</span>
        <nav aria-label="Main navigation">
          {tabs.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              <Icon size={20} />
              {label}
              {id === "payments" && attention.length > 0 && (
                <span className="nav-count">{attention.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="arc-word">∩ arc</span>
            <p>
              A little less admin.
              <br />A lot more headspace.
            </p>
            <span>
              <span className="live-dot" />
              Settles on Arc
            </span>
          </div>
          <button className="sidebar-help" onClick={() => setHelp(true)}>
            <CircleHelp size={18} />A little help
            <ArrowUpRight size={15} />
          </button>
          <button className="store-switch" onClick={() => setTab("store")}>
            <span className="store-monogram">{profile.name.slice(0, 1)}</span>
            <span>
              <strong>{profile.name}</strong>
              <small>
                {profile.mode === "demo"
                  ? "Demo workspace"
                  : shortAddress(profile.address)}
              </small>
            </span>
            <ChevronDown size={16} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="mobile-brand">
            <Logo compact />
          </div>
          <div className="breadcrumb">
            <span>{profile.name}</span>
            <span>/</span>
            <strong>{tabs.find((t) => t.id === tab)?.label}</strong>
          </div>
          <div className="topbar-actions">
            <button
              className={`mode-pill ${profile.mode}`}
              onClick={() => setTab("store")}
            >
              <span />
              {profile.mode === "demo"
                ? "Demo mode"
                : profile.mode === "testnet"
                  ? "Testnet"
                  : "Mainnet"}
              <ChevronDown size={12} />
            </button>
            <button
              className="icon-button notification-button"
              aria-label="View activity"
              onClick={() => setActivity(true)}
            >
              <Bell size={19} />
              {attention.length > 0 && <span className="notification-dot" />}
            </button>
            <button
              className="store-monogram small"
              aria-label="Your store settings"
              onClick={() => setTab("store")}
            >
              {profile.name.slice(0, 1)}
            </button>
          </div>
        </header>
        {offline && (
          <div className="offline-banner" role="status">
            You’re offline. Showing your last loaded payments.
          </div>
        )}
        <main className="main-content" id="main">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: reduced ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
            >
              {tab === "home" && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">A LITTLE MORE PEACE OF MIND</div>
                      <h1>
                        Your money, in flow<span className="green">.</span>
                      </h1>
                      <p>Good things are coming your way.</p>
                    </div>
                    <button
                      className="button primary desktop-create"
                      onClick={() => setCreateOpen(true)}
                    >
                      <Plus size={18} />
                      New sale
                    </button>
                  </div>
                  <section className="arc-account-card">
                    <div className="arc-account-main">
                      <span className="arc-account-icon">∩</span>
                      <div>
                        <span>Available on Arc</span>
                        <strong>
                          {hidden
                            ? "••••••"
                            : assets
                              ? `$${money(assets.arcUsdc, true)}`
                              : "—"}
                          <small>USDC</small>
                        </strong>
                      </div>
                    </div>
                    <div className="arc-account-assets">
                      <span>
                        {assets?.arcEurc
                          ? `${money(assets.arcEurc, true)} EURC`
                          : "Arc assets only"}
                      </span>
                      <small>
                        {activeWallet?.walletClientType === "privy" ||
                        activeWallet?.walletClientType === "privy-v2"
                          ? "Protected by Privy"
                          : activeWallet?.walletClientType ||
                            "Connected wallet"}
                      </small>
                    </div>
                    <button
                      className="button secondary arc-fund-button"
                      onClick={() => setFundOpen(true)}
                    >
                      <Wallet size={17} />
                      Bring money to Arc
                    </button>
                  </section>
                  <div className="home-grid">
                    <div className="home-main">
                      <section className="balance-card">
                        <div className="balance-top">
                          <span>
                            Net received
                            <button
                              className="icon-button tiny"
                              aria-label={
                                hidden ? "Show amounts" : "Hide amounts"
                              }
                              onClick={() => setHidden(!hidden)}
                            >
                              {hidden ? (
                                <EyeOff size={15} />
                              ) : (
                                <Eye size={15} />
                              )}
                            </button>
                          </span>
                          <span className="currency-chip">
                            <span className="usdc-icon">$</span>USDC
                          </span>
                        </div>
                        <div className="balance-value">
                          {hidden ? (
                            "••••••"
                          ) : (
                            <>
                              <span>$</span>
                              {money(decimal(net)).split(".")[0]}
                              <span className="balance-cents">
                                .{money(decimal(net)).split(".")[1]}
                              </span>
                            </>
                          )}
                        </div>
                        <div className="balance-caption">
                          <span className="green">
                            <ArrowDownLeft size={14} />
                            {settled.length} payments received
                          </span>
                          <span className="caption-dot">·</span>
                          <span>After delivered refunds</span>
                        </div>
                        <RevenueChart payments={payments} period={period} />
                        <div className="chart-footer">
                          <span>Received over time</span>
                          <div className="period-switch">
                            {["1D", "7D", "1M", "ALL"].map((p) => (
                              <button
                                key={p}
                                className={period === p ? "active" : ""}
                                onClick={() => setPeriod(p)}
                              >
                                {p}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="balance-divider" />
                        <div className="balance-bottom">
                          <div>
                            <span className="mini-icon amber">
                              <Activity size={16} />
                            </span>
                            <div>
                              <span>On the way</span>
                              <strong>
                                {hidden
                                  ? "••••"
                                  : `$${money(decimal(pending.reduce((sum, p) => sum + (p.transfer?.status !== "settled" ? units(paidTotalOf(p)) : 0n), 0n)))}`}
                                <small>{pending.length} in progress</small>
                              </strong>
                            </div>
                          </div>
                          <span className="settlement-mark">
                            <ShieldCheck size={14} />
                            Arc settlement
                          </span>
                        </div>
                      </section>
                      <button
                        className="button primary mobile-create wide"
                        onClick={() => setCreateOpen(true)}
                      >
                        <Plus size={19} />
                        New sale
                        <ArrowUpRight size={18} />
                      </button>
                      {attention.length > 0 && (
                        <button
                          className="attention-card"
                          onClick={() => setSelected(attention[0].id)}
                        >
                          <span className="attention-icon">
                            <Zap size={19} />
                          </span>
                          <span>
                            <strong>A little nudge, and it’s yours.</strong>
                            <small>
                              {attention.length}{" "}
                              {attention.length === 1
                                ? "payment needs"
                                : "payments need"}{" "}
                              your attention
                            </small>
                          </span>
                          <ChevronRight size={19} />
                        </button>
                      )}
                      <section className="payments-panel">
                        <div className="section-heading">
                          <h2>
                            Recent payments<span>{payments.length}</span>
                          </h2>
                          <button
                            className="text-button"
                            onClick={() => setTab("payments")}
                          >
                            View all
                            <ArrowUpRight size={14} />
                          </button>
                        </div>
                        {payments.length ? (
                          <div className="payment-list">
                            {payments.slice(0, 5).map((p) => (
                              <PaymentRow
                                key={p.id}
                                payment={p}
                                onClick={() => setSelected(p.id)}
                              />
                            ))}
                          </div>
                        ) : (
                          <Empty
                            title="Your first payment starts here."
                            description="Send a link. Get paid in USDC. We’ll handle the details."
                            action={
                              <button
                                className="button secondary"
                                onClick={() => setCreateOpen(true)}
                              >
                                Create a pay link
                                <Plus size={16} />
                              </button>
                            }
                          />
                        )}
                      </section>
                    </div>
                    <aside className="home-aside">
                      <section className="rewind-feature">
                        <div className="feature-top">
                          <span className="eyebrow">MEET REWIND</span>
                          <span className="feature-tag">Built in</span>
                        </div>
                        <div className="rewind-art" aria-hidden="true">
                          <span className="rewind-ring ring-outer" />
                          <span className="rewind-ring ring-inner" />
                          <CornerUpLeft size={66} strokeWidth={1.2} />
                          <span className="rewind-spark">✳</span>
                        </div>
                        <h2>
                          A good experience.
                          <br />
                          Even in reverse.
                        </h2>
                        <p>
                          Send a refund straight back to where it came from. One
                          order. One clear story.
                        </p>
                        <button
                          className="text-button"
                          onClick={() => {
                            const p = payments.find(
                              (p) =>
                                p.transfer?.status === "settled" &&
                                !p.refunds.length,
                            );
                            if (p) setSelected(p.id);
                            else setHelp(true);
                          }}
                        >
                          Explore refunds
                          <ArrowUpRight size={16} />
                        </button>
                      </section>
                      <section className="flow-note">
                        <div className="section-heading">
                          <h3>Made to move simply</h3>
                          <ShieldCheck size={17} />
                        </div>
                        <div>
                          <span className="chain-icon base">—</span>
                          <span className="flow-line" />
                          <span className="flow-circle">C</span>
                          <span className="flow-line" />
                          <span className="chain-icon arc">∩</span>
                        </div>
                        <p>
                          They pay on Base.
                          <br />
                          You receive on Arc.
                        </p>
                        <small>Every step accounted for with ArcTrace.</small>
                      </section>
                      <div className="quiet-note">
                        <span className="live-dot" />
                        Your funds stay in your wallet.
                      </div>
                    </aside>
                  </div>
                </>
              )}
              {tab === "payments" && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">EVERY PAYMENT. ONE PLACE.</div>
                      <h1>
                        The full picture<span className="green">.</span>
                      </h1>
                      <p>From the first hello to the final receipt.</p>
                    </div>
                    <button className="button secondary" onClick={exportCSV}>
                      <Download size={17} />
                      Export
                    </button>
                  </div>
                  <div className="payments-toolbar">
                    <label className="search-field">
                      <Search size={18} />
                      <input
                        aria-label="Search payments"
                        placeholder="Search a name, order, or reference"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                      {query && (
                        <button
                          className="icon-button tiny"
                          aria-label="Clear search"
                          onClick={() => setQuery("")}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </label>
                    <button
                      className="button primary icon-only"
                      aria-label="New counter sale"
                      onClick={() => setCreateOpen(true)}
                    >
                      <Plus size={19} />
                    </button>
                  </div>
                  <div className="filter-tabs">
                    {["All", "Received", "Pending", "Refunds"].map((f) => (
                      <button
                        key={f}
                        className={filter === f ? "active" : ""}
                        onClick={() => setFilter(f)}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                  <section className="payments-panel full">
                    <div className="list-caption">
                      <span>
                        {filtered.length}{" "}
                        {filtered.length === 1 ? "payment" : "payments"}
                      </span>
                      <span>AMOUNT · STATUS</span>
                    </div>
                    {filtered.length ? (
                      filtered.map((p) => (
                        <PaymentRow
                          key={p.id}
                          payment={p}
                          onClick={() => setSelected(p.id)}
                        />
                      ))
                    ) : (
                      <Empty
                        title="Nothing here just yet."
                        description={
                          query
                            ? "Try a different name or reference."
                            : "Payments matching this filter will appear here."
                        }
                      />
                    )}
                  </section>
                </>
              )}
              {tab === "links" && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">
                        ASK NICELY. GET PAID EASILY.
                      </div>
                      <h1>
                        A link is all it takes<span className="green">.</span>
                      </h1>
                      <p>Share it in a message. Or let them scan.</p>
                    </div>
                    <button
                      className="button primary"
                      onClick={() => setCreateOpen(true)}
                    >
                      <Plus size={18} />
                      New pay link
                    </button>
                  </div>
                  <div className="links-grid">
                    {payments
                      .filter((p) => !p.transfer)
                      .map((p) => (
                        <article className="pay-link-card" key={p.id}>
                          <div className="section-heading">
                            <span className="link-card-icon">
                              <Link2 size={21} />
                            </span>
                            <span className="badge requested">
                              <span />
                              Awaiting payment
                            </span>
                          </div>
                          <h2>${money(p.amount)}</h2>
                          <p>{p.description}</p>
                          <div className="link-customer">
                            <Avatar name={p.customer} />
                            <span>
                              {p.customer}
                              <small>{p.reference}</small>
                            </span>
                          </div>
                          <div className="link-card-actions">
                            <button
                              className="button secondary"
                              onClick={() =>
                                shareLink(
                                  `${location.origin}/pay/${p.id}`,
                                  `Payment for ${p.description}`,
                                ).then(notify)
                              }
                            >
                              <Copy size={15} />
                              Share link
                            </button>
                            <a
                              className="icon-button"
                              href={`/pay/${p.id}`}
                              aria-label={`Open payment link for ${p.customer}`}
                            >
                              <ArrowUpRight size={19} />
                            </a>
                          </div>
                        </article>
                      ))}
                    <button
                      className="new-link-card"
                      onClick={() => setCreateOpen(true)}
                    >
                      <span>
                        <Plus size={26} />
                      </span>
                      <strong>Something new in the works?</strong>
                      <p>Create a payment link</p>
                    </button>
                  </div>
                </>
              )}
              {tab === "store" && (
                <StoreSettings
                  profile={profile}
                  onProfile={(next) => {
                    if (next.mode !== profile.mode) setPayments([]);
                    setProfile(next);
                  }}
                  notify={notify}
                  onConnect={leave}
                  onExport={exportCSV}
                  onHelp={() => setHelp(true)}
                  onInstall={async () => {
                    if (installPrompt) {
                      await installPrompt.prompt();
                      await installPrompt.userChoice;
                      setInstallPrompt(undefined);
                    } else setHelp(true);
                  }}
                  onLogout={leave}
                />
              )}
            </motion.div>
          </AnimatePresence>
          <footer className="app-footer">
            <span>
              <Logo compact />A calmer kind of commerce.
            </span>
            <span>Powered by Arc + Circle CCTP</span>
          </footer>
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Mobile navigation">
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            <Icon size={21} strokeWidth={tab === id ? 2 : 1.6} />
            <span>{label}</span>
            {tab === id && <span className="nav-indicator" />}
          </button>
        ))}
      </nav>
      <AnimatePresence>
        {toast && (
          <motion.div
            className="toast"
            role="status"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
          >
            <span>
              <Check size={14} />
            </span>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
      {createOpen && (
        <CreatePayment
          profile={profile}
          onClose={() => setCreateOpen(false)}
          onCreated={updatePayment}
          notify={notify}
        />
      )}
      {fundOpen && activeWallet && profile.mode !== "demo" && (
        <FundingSheet
          profile={profile}
          wallet={activeWallet}
          assets={assets}
          onClose={() => setFundOpen(false)}
          onRefresh={refreshAssets}
          notify={notify}
        />
      )}
      {selectedPayment && (
        <PaymentDetail
          key={selectedPayment.id}
          payment={selectedPayment}
          onClose={() => setSelected(undefined)}
          onChange={updatePayment}
          notify={notify}
          wallet={activeWallet}
        />
      )}
      {activity && (
        <Sheet
          title="Your day, at a glance."
          subtitle="Every arrival. Every return."
          onClose={() => setActivity(false)}
        >
          {events.length ? (
            events.slice(0, 15).map((event, i) => (
              <button
                className="activity-row"
                key={`${event.id}-${i}`}
                onClick={() => {
                  setActivity(false);
                  setSelected(event.id);
                }}
              >
                <span
                  className={`activity-icon ${event.refund ? "refund" : ""}`}
                >
                  {event.refund ? (
                    <CornerUpLeft size={18} />
                  ) : (
                    <ArrowDownLeft size={18} />
                  )}
                </span>
                <span>
                  <strong>{event.text}</strong>
                  <small>
                    {new Date(event.at).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </small>
                </span>
                <strong>${money(event.amount)}</strong>
              </button>
            ))
          ) : (
            <Empty
              title="A fresh start."
              description="Your store activity will appear here."
            />
          )}
        </Sheet>
      )}
      {help && (
        <Sheet
          title="A little help."
          subtitle="Simple on the surface. Accounted for underneath."
          onClose={() => setHelp(false)}
        >
          <div className="help-content">
            <h3>How do payments work?</h3>
            <p>
              Create a link and send it to your customer. They pay USDC on Base;
              Circle CCTP moves it to your Arc wallet. SettleDesk follows the
              journey and confirms when it is received.
            </p>
            <h3>When can I fulfill an order?</h3>
            <p>
              When the payment says “Received.” For wallet payments, that means
              we verified the destination contract at finalized block state.
            </p>
            <h3>How does Rewind work?</h3>
            <p>
              Open a received payment and tap Refund. Choose an amount, review
              it, and approve in your wallet. The refund goes back to the
              original paying wallet on Base. Funds and network gas come from
              your wallet.
            </p>
            <h3>What does demo mode do?</h3>
            <p>
              It gives you a private example store. Payments and refunds are
              simulated. You can create links, try checkout, and watch funds
              make the round trip without spending anything.
            </p>
            <h3>Add to your home screen</h3>
            <p>
              On iPhone, open this page in Safari, tap Share, then Add to Home
              Screen. On Android, use your browser’s Install app option. Wallet
              payments work in an injected wallet browser.
            </p>
            <a
              className="button secondary wide"
              href="https://developers.circle.com/cctp"
              target="_blank"
              rel="noreferrer"
            >
              Explore Circle CCTP
              <ArrowUpRight size={16} />
            </a>
          </div>
        </Sheet>
      )}
      {error && profile && (
        <div className="global-error" role="alert">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function RevenueChart({
  payments,
  period,
}: {
  payments: Payment[];
  period: string;
}) {
  const now = Date.now();
  const days =
    period === "1D" ? 1 : period === "7D" ? 7 : period === "1M" ? 30 : 90;
  const start = now - days * 86400_000;
  const values = Array.from({ length: 31 }, (_, i) =>
    payments
      .filter(
        (p) =>
          p.transfer?.status === "settled" &&
          (p.transfer.settledAt || p.createdAt) >= start &&
          (p.transfer.settledAt || p.createdAt) <=
            start + ((now - start) * i) / 30,
      )
      .reduce((n, p) => n + Number(p.amount), 0),
  );
  const max = Math.max(...values, 1);
  const points = values.map((n, i) => `${i * 20},${108 - (n / max) * 90}`);
  const line = `M${points.join(" L")}`;
  return (
    <div
      className="chart"
      role="img"
      aria-label={`Cumulative received USDC over ${days} days: ${money(values[30])}`}
    >
      <svg viewBox="0 0 600 124" preserveAspectRatio="none">
        <defs>
          <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c4f582" stopOpacity=".15" />
            <stop offset="100%" stopColor="#c4f582" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} L600,124 L0,124 Z`} fill="url(#chart-fill)" />
        <path
          d={line}
          fill="none"
          stroke="#c4f582"
          strokeWidth="2.5"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx="600"
          cy={108 - (values[30] / max) * 90}
          r="4"
          fill="#c4f582"
        />
      </svg>
    </div>
  );
}

function CreatePayment({
  profile,
  onClose,
  onCreated,
  notify,
}: {
  profile: Profile;
  onClose: () => void;
  onCreated: (p: Payment) => void;
  notify: (s: string) => void;
}) {
  const [customer, setCustomer] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [tipsEnabled, setTipsEnabled] = useState(true);
  const [collectTax, setCollectTax] = useState(!!profile.collectTax);
  const [discreet, setDiscreet] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [created, setCreated] = useState<Payment>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const url = created ? `${location.origin}/pay/${created.id}` : "";
  const salePaid =
    created?.transfer?.status === "settled" || created?.fiat?.status === "paid";
  const secondsLeft = created?.expiresAt
    ? Math.max(0, Math.ceil((created.expiresAt - now) / 1000))
    : 0;

  useEffect(() => {
    if (!created || salePaid) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [created?.id, salePaid]);

  useEffect(() => {
    if (
      !created ||
      salePaid ||
      (created.expiresAt !== undefined && created.expiresAt <= Date.now())
    )
      return;
    const timer = setInterval(
      async () => {
        if (created.expiresAt !== undefined && created.expiresAt <= Date.now())
          return;
        try {
          const data = await api<{ payment: Payment }>(
            `payments/${created.id}`,
          );
          setCreated(data.payment);
          onCreated(data.payment);
        } catch {
          /* The QR remains usable while the next status check retries. */
        }
      },
      created.mode === "demo" ? 1400 : 2500,
    );
    return () => clearInterval(timer);
  }, [created?.id, created?.mode, created?.expiresAt, salePaid, onCreated]);

  function newSale() {
    setCreated(undefined);
    setAmount("");
    setCustomer("");
    setDescription("");
    setRevealed(false);
    setNow(Date.now());
  }

  return (
    <Sheet
      title={
        created
          ? salePaid
            ? "Payment received."
            : "Ready to scan."
          : "Arc Counter"
      }
      subtitle={
        created
          ? salePaid
            ? "The customer is all set."
            : "One temporary QR. Every way to pay."
          : "Type an amount and start the sale."
      }
      onClose={onClose}
    >
      {created ? (
        <div
          className={`created-link counter-qr ${created.discreet ? "discreet" : ""}`}
        >
          {salePaid ? (
            <div className="counter-paid">
              <span>
                <Check size={34} />
              </span>
              <strong>
                {created.fiat ? "Payment confirmed" : "Received on Arc"}
              </strong>
              <p>
                {created.fiat
                  ? `${created.fiat.method === "cashapp" ? "Cash App Pay" : created.fiat.method === "card" ? "Card or wallet" : created.fiat.method === "venmo" ? "Venmo" : "PayPal"} confirmed · payout settling`
                  : "USDC is in your Arc wallet."}
              </p>
            </div>
          ) : (
            <>
              <div className="counter-qr-topline">
                <span
                  className={`sale-timer ${secondsLeft < 60 ? "urgent" : ""}`}
                >
                  {Math.floor(secondsLeft / 60)}:
                  {String(secondsLeft % 60).padStart(2, "0")}
                </span>
                <span>Quick-sale QR</span>
              </div>
              <div className="qr-wrap">
                <QRCodeSVG value={url} size={210} level="M" marginSize={1} />
              </div>
              <p className="scan-instruction">
                Customer scans with their camera. No app needed.
              </p>
            </>
          )}
          <div className="counter-total">
            <span>Sale total</span>
            <strong>
              {created.discreet && !revealed
                ? "••••••"
                : `$${money(created.amount)}`}
            </strong>
            {created.discreet && (
              <button
                className="icon-button tiny"
                aria-label={
                  revealed ? "Hide sale amount" : "Reveal sale amount"
                }
                onClick={() => setRevealed(!revealed)}
              >
                {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            )}
          </div>
          <p>
            {created.description} · {created.customer}
          </p>
          {!salePaid && (
            <>
              <div className="counter-link-actions">
                <button
                  className="button secondary"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(url)
                      .then(() => notify("Checkout link copied"))
                      .catch(() => notify("Could not copy the link"))
                  }
                >
                  <Copy size={16} /> Copy link
                </button>
                <button
                  className="button secondary"
                  onClick={() =>
                    shareLink(
                      url,
                      `${profile.name} · ${created.description}`,
                    ).then(notify)
                  }
                >
                  <ArrowUpRight size={16} /> Share
                </button>
              </div>
              <a
                className="text-button wide"
                href={`/pay/${created.id}`}
                target="_blank"
                rel="noreferrer"
              >
                Preview customer checkout <ArrowRight size={15} />
              </a>
            </>
          )}
          <button className="button primary wide" onClick={newSale}>
            <Plus size={18} /> New sale
          </button>
          <p className="center-note">
            {salePaid
              ? created.fiat
                ? "Processor-confirmed now. Arc payout follows separately."
                : "Finalized on Arc."
              : created.collectTax
                ? "Tax is calculated privately in secure checkout."
                : created.tipsEnabled
                  ? "Tips are offered privately on the customer’s phone."
                  : "This QR expires automatically and cannot be reused."}
          </p>
        </div>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            setError("");
            try {
              units(amount);
              const data = await api<{ payment: Payment }>("payments", {
                customer: customer || "Walk-in customer",
                description: description || "Counter sale",
                amount,
                tipsEnabled,
                collectTax,
                discreet,
                quickSale: true,
              });
              setCreated(data.payment);
              onCreated(data.payment);
            } catch (err) {
              setError(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="request-amount">
            <label htmlFor="request-amount">How much?</label>
            <div>
              <span>$</span>
              <input
                id="request-amount"
                inputMode="decimal"
                autoFocus
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                aria-label="Payment amount"
              />
            </div>
            <div
              className="quick-amounts"
              role="group"
              aria-label="Quick amounts"
            >
              {[5, 10, 20, 50, 100].map((value) => (
                <button
                  type="button"
                  key={value}
                  className={amount === String(value) ? "active" : ""}
                  onClick={() => setAmount(String(value))}
                >
                  ${value}
                </button>
              ))}
            </div>
          </div>
          <div className="counter-options">
            <label className="counter-toggle">
              <span>
                <strong>Offer a tip</strong>
                <small>Customer chooses privately</small>
              </span>
              <input
                type="checkbox"
                checked={tipsEnabled}
                onChange={(e) => setTipsEnabled(e.target.checked)}
              />
              <i />
            </label>
            <label className="counter-toggle">
              <span>
                <strong>Discreet screen</strong>
                <small>Hide the amount beside the QR</small>
              </span>
              <input
                type="checkbox"
                checked={discreet}
                onChange={(e) => setDiscreet(e.target.checked)}
              />
              <i />
            </label>
            <label className="counter-toggle tax-counter-toggle">
              <span>
                <strong>Collect tax</strong>
                <small>Stripe calculates it from the buyer’s location</small>
              </span>
              <input
                type="checkbox"
                checked={collectTax}
                onChange={(e) => setCollectTax(e.target.checked)}
              />
              <i />
            </label>
          </div>
          <button
            type="button"
            className="counter-details-toggle"
            onClick={() => setDetailsOpen(!detailsOpen)}
          >
            {detailsOpen ? "Hide sale details" : "Add customer or note"}
            <ChevronDown size={15} className={detailsOpen ? "open" : ""} />
          </button>
          {detailsOpen && (
            <div className="counter-details">
              <label className="field">
                Customer
                <input
                  value={customer}
                  onChange={(e) => setCustomer(e.target.value)}
                  placeholder="Optional name"
                  maxLength={80}
                  autoComplete="off"
                />
              </label>
              <label className="field">
                Note
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional sale note"
                  maxLength={140}
                />
              </label>
            </div>
          )}
          <div className="gentle-note">
            <ShieldCheck size={18} />
            <span>
              {profile.mode === "demo"
                ? "You’re in demo mode. No real funds will move."
                : `Settles directly to your Arc wallet · ${profile.mode}.`}
            </span>
          </div>
          {error && (
            <p role="alert" className="error-box">
              {error}
            </p>
          )}
          <button type="submit" className="button primary wide" disabled={busy}>
            {busy ? (
              <Spinner />
            ) : (
              <>
                Show payment QR
                <ArrowUpRight size={18} />
              </>
            )}
          </button>
        </form>
      )}
    </Sheet>
  );
}

type PendingFunding = FundingTransfer & { amount: string };

function FundingSheet({
  profile,
  wallet,
  assets,
  onClose,
  onRefresh,
  notify,
}: {
  profile: Profile;
  wallet: ConnectedWallet;
  assets?: AssetSnapshot;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  notify: (text: string) => void;
}) {
  const mode = profile.mode === "mainnet" ? "mainnet" : "testnet";
  const storageKey = `settledesk:funding:${wallet.address.toLowerCase()}:${mode}`;
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState<PendingFunding>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setPending(JSON.parse(saved) as PendingFunding);
    } catch {
      localStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  function save(next?: PendingFunding) {
    setPending(next);
    if (next) localStorage.setItem(storageKey, JSON.stringify(next));
    else localStorage.removeItem(storageKey);
  }

  async function start() {
    if (!amount || units(amount) <= 0n)
      return setError("Enter how much USDC you want available on Arc.");
    setBusy("Preparing a Circle quote…");
    setError("");
    try {
      const result = await startArcFunding(mode, amount, wallet, setBusy);
      const next = { ...result.transfer, burnHash: result.burnHash, amount };
      save(next);
      notify("USDC left Base. Circle is verifying it now.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }

  async function continueTransfer() {
    if (!pending) return;
    setBusy("Checking with Circle…");
    setError("");
    try {
      const next = await continueArcFunding(
        mode,
        pending.amount,
        pending.burnHash as Hex,
        wallet,
        setBusy,
      );
      if (next.status === "settled") {
        save(undefined);
        await onRefresh();
        notify("Your USDC is ready on Arc.");
        onClose();
      } else {
        save({ ...next, amount: pending.amount });
        notify(
          next.status === "ready"
            ? "Ready to receive on Arc."
            : "Circle is still verifying the transfer.",
        );
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }

  async function fundAnotherWay() {
    setBusy("Opening funding options…");
    setError("");
    try {
      await wallet.fund({
        chain: network(mode, "arc").chain,
        amount: amount || "25",
        asset: "USDC",
        defaultFundingMethod: "wallet",
        uiConfig: {
          receiveFundsTitle: "Bring USDC to Arc",
          receiveFundsSubtitle: "Choose a wallet or supported funding route.",
        },
      });
      await onRefresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }

  return (
    <Sheet
      title={pending ? "Your USDC is on its way." : "Bring money to Arc."}
      subtitle="One balance for your business."
      onClose={onClose}
    >
      <div className="funding-flow">
        <div className="funding-route">
          <div>
            <span className="chain-icon base">—</span>
            <span>
              <small>{mode === "testnet" ? "Base Sepolia" : "Base"}</small>
              <strong>{money(assets?.baseUsdc || "0", true)} USDC</strong>
            </span>
          </div>
          <ArrowRight size={19} />
          <div>
            <span className="chain-icon arc">∩</span>
            <span>
              <small>Arc</small>
              <strong>{money(assets?.arcUsdc || "0", true)} USDC</strong>
            </span>
          </div>
        </div>

        {pending ? (
          <div className="funding-pending">
            <span className={`status-orb ${pending.status}`}>
              {pending.status === "settled" ? <Check size={22} /> : "C"}
            </span>
            <div>
              <strong>{money(pending.amount, true)} USDC</strong>
              <p>
                {pending.status === "ready"
                  ? "Circle verified it. One confirmation receives it on Arc."
                  : pending.status === "expired"
                    ? "This verification expired. Your funds are still recoverable."
                    : "Circle is verifying the Base transaction."}
              </p>
            </div>
          </div>
        ) : (
          <label className="funding-amount">
            Amount to arrive on Arc
            <div>
              <span>$</span>
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                aria-label="USDC to bring to Arc"
              />
              <strong>USDC</strong>
            </div>
            <small>
              Available on Base: {money(assets?.baseUsdc || "0", true)} USDC
            </small>
          </label>
        )}

        <div className="gentle-note">
          <ShieldCheck size={18} />
          <span>
            {pending
              ? "You can close this screen. The transfer is saved on this device."
              : "SettleDesk asks for the exact amount only. It never sweeps your wallet or holds your funds."}
          </span>
        </div>

        {Number(assets?.baseNative || 0) > 0 && !pending && (
          <div className="detected-asset">
            <span>ETH detected</span>
            <strong>{Number(assets?.baseNative).toFixed(4)} ETH</strong>
            <small>
              Kept untouched for Base gas unless you choose another route.
            </small>
          </div>
        )}

        {error && (
          <p role="alert" className="error-box">
            {error}
          </p>
        )}

        <button
          className="button primary wide"
          disabled={!!busy || pending?.status === "expired"}
          onClick={pending ? continueTransfer : start}
        >
          {busy ? (
            <>
              <Spinner />
              {busy}
            </>
          ) : pending ? (
            <>
              {pending.status === "ready" ? "Receive on Arc" : "Check transfer"}
              <ArrowRight size={18} />
            </>
          ) : (
            <>
              Move USDC with CCTP
              <ArrowRight size={18} />
            </>
          )}
        </button>
        {!pending && (
          <button
            className="button subtle wide"
            disabled={!!busy}
            onClick={fundAnotherWay}
          >
            Use another wallet or route
          </button>
        )}
        <p className="center-note">
          Standard CCTP transfers can take several minutes. Network fees are
          shown before approval.
        </p>
      </div>
    </Sheet>
  );
}

function StoreSettings({
  profile,
  onProfile,
  notify,
  onConnect,
  onExport,
  onHelp,
  onInstall,
  onLogout,
}: {
  profile: Profile;
  onProfile: (p: Profile) => void;
  notify: (s: string) => void;
  onConnect: () => void;
  onExport: () => void;
  onHelp: () => void;
  onInstall: () => void;
  onLogout: () => void;
}) {
  const [name, setName] = useState(profile.name);
  const [mode, setMode] = useState<Mode>(profile.mode);
  const [collectTax, setCollectTax] = useState(!!profile.collectTax);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">MAKE YOURSELF AT HOME</div>
          <h1>
            Your corner of the world<span className="green">.</span>
          </h1>
          <p>The small details that make it yours.</p>
        </div>
      </div>
      <div className="settings-layout">
        <section className="settings-card">
          <span className="store-monogram large">
            {profile.name.slice(0, 1)}
          </span>
          <h2>{profile.name}</h2>
          <p>
            {profile.mode === "demo"
              ? "Your private demo workspace"
              : shortAddress(profile.address)}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const data = await api<{ profile: Profile }>("profile", {
                  name,
                  mode,
                  collectTax,
                });
                onProfile(data.profile);
                notify("Store details saved");
              } catch (err) {
                setError(errorText(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field">
              Store name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={50}
                required
              />
            </label>
            <label className="field">
              Payment network
              <select
                value={mode}
                disabled={profile.mode === "demo"}
                onChange={(e) => setMode(e.target.value as Mode)}
              >
                {profile.mode === "demo" ? (
                  <option value="demo">Demo · simulated funds</option>
                ) : (
                  <>
                    <option value="testnet">Testnet · test USDC</option>
                    <option value="mainnet">Mainnet · real USDC</option>
                  </>
                )}
              </select>
            </label>
            {mode === "mainnet" && (
              <p className="center-note">
                New payment links will accept real USDC. Existing links keep
                their original network.
              </p>
            )}
            <label className={`tax-feature-card ${collectTax ? "active" : ""}`}>
              <span className="tax-feature-check" aria-hidden="true">
                {collectTax ? <Check size={16} /> : <ReceiptText size={16} />}
              </span>
              <span>
                <strong>Collect tax</strong>
                <small>
                  Calculate, collect, and report tax on eligible global card
                  payments with Stripe Tax.
                </small>
              </span>
              <input
                type="checkbox"
                checked={collectTax}
                onChange={(e) => setCollectTax(e.target.checked)}
                aria-label="Collect tax by default"
              />
            </label>
            {collectTax && (
              <p className="tax-setup-note">
                Applies to new sales. Stripe uses your registered tax regions
                and the buyer’s billing address—Arc Counter never guesses a
                rate.
                <a
                  href="https://dashboard.stripe.com/test/settings/tax"
                  target="_blank"
                  rel="noreferrer"
                >
                  Review Stripe Tax setup <ArrowUpRight size={13} />
                </a>
              </p>
            )}
            {error && (
              <p className="error-box" role="alert">
                {error}
              </p>
            )}
            <button className="button primary wide" disabled={busy}>
              {busy ? <Spinner /> : "Save changes"}
            </button>
          </form>
        </section>
        <section className="settings-menu">
          {[
            {
              Icon: Wallet,
              title: "Change sign-in",
              subtitle: "Wallet, email, or mobile",
              action: onConnect,
            },
            {
              Icon: Smartphone,
              title: "Add to home screen",
              subtitle: "A little closer to your everyday",
              action: onInstall,
            },
            {
              Icon: Download,
              title: "Export payments",
              subtitle: "A clean CSV for your books",
              action: onExport,
            },
            {
              Icon: CircleHelp,
              title: "Help & how it works",
              subtitle: "A few useful answers",
              action: onHelp,
            },
            {
              Icon: LogOut,
              title: "Sign out",
              subtitle: "Your payments will still be here",
              action: onLogout,
            },
          ].map(({ Icon, title, subtitle, action }) => (
            <button key={title} onClick={action}>
              <Icon size={20} />
              <span>
                <strong>{title}</strong>
                <small>{subtitle}</small>
              </span>
              <ChevronRight size={17} />
            </button>
          ))}
          <div className="settings-footnote">
            <ShieldCheck size={25} />
            <p>
              SettleDesk never holds your funds
              <br />
              or asks for your private key.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
