"use client";
import { useEffect, useRef, type ReactNode } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock3,
  CircleDashed,
  CornerUpLeft,
  LoaderCircle,
  X,
  ShieldCheck,
  ExternalLink,
} from "lucide-react";
import {
  money,
  paidTotalOf,
  statusLabels,
  statusOf,
  shortAddress,
  type Payment,
  type Refund,
} from "@/lib/model";
import { explorer } from "@/lib/chains";
import { paymentRoute } from "@/lib/payment-presentation";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="logo">
      <span className="logo-symbol">
        s<span>·</span>
      </span>
      {!compact && (
        <span>
          settle<span className="logo-period">.</span>
        </span>
      )}
    </span>
  );
}
export function Spinner() {
  return <LoaderCircle size={18} className="spin" aria-label="Loading" />;
}
export function Badge({ payment }: { payment: Payment }) {
  const status = statusOf(payment);
  return (
    <span className={`badge ${status}`}>
      <span />
      {statusLabels[status]}
    </span>
  );
}
export function Avatar({ name, size = "" }: { name: string; size?: string }) {
  const initials = name
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("");
  const color = name.charCodeAt(0) % 5;
  return <span className={`avatar avatar-${color} ${size}`}>{initials}</span>;
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <CircleDashed size={32} strokeWidth={1.2} />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Sheet({
  title,
  subtitle,
  children,
  onClose,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
      dialog?.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`sheet ${className}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const box = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < box.left ||
            e.clientX > box.right ||
            e.clientY < box.top ||
            e.clientY > box.bottom
          )
            onClose();
        }
      }}
    >
      <div className="sheet-handle" />
      <header className="sheet-header">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={21} />
        </button>
      </header>
      <div className="sheet-body">{children}</div>
    </dialog>
  );
}
export function PaymentRow({
  payment,
  onClick,
}: {
  payment: Payment;
  onClick: () => void;
}) {
  const status = statusOf(payment);
  const statusText =
    payment.fiat?.status === "paid" && payment.transfer?.status !== "settled"
      ? "Customer paid · payout settling"
      : status === "settled" && !payment.fiat
        ? "USDC received"
        : statusLabels[status];
  const total = paidTotalOf(payment);
  return (
    <button
      className="payment-row"
      onClick={onClick}
      aria-label={`${payment.customer}, ${money(total)} ${payment.fiat ? "USD" : "USDC"}, ${statusText}`}
    >
      <Avatar name={payment.customer} />
      <span className="row-person">
        <strong>{payment.customer}</strong>
        <span>{payment.description}</span>
      </span>
      <span className="row-money">
        <strong className={status === "refunded" ? "muted" : ""}>
          {status === "refunded" ? "−" : "+"}${money(total)}
        </strong>
        <span className={`status-text ${status}`}>
          {status === "settled" ? (
            <Check size={12} />
          ) : status === "refunded" ? (
            <CornerUpLeft size={12} />
          ) : (
            <Clock3 size={12} />
          )}
          {statusText}
        </span>
      </span>
      <ChevronRight size={17} className="row-chevron" />
    </button>
  );
}
export function RouteLine({
  reverse = false,
  mode,
}: {
  reverse?: boolean;
  mode: Payment["mode"];
}) {
  return (
    <div className="route-line">
      <span className={`chain-icon ${reverse ? "arc" : "base"}`}>
        {reverse ? "∩" : "—"}
      </span>
      <div>
        <strong>{reverse ? "Arc" : "Base"}</strong>
        <small>
          {mode === "testnet" ? "Testnet" : reverse ? "Your store" : "Customer"}
        </small>
      </div>
      <div className="route-dashes">
        <span />
        <ArrowUpRight size={16} />
        <span />
      </div>
      <span className={`chain-icon ${reverse ? "base" : "arc"}`}>
        {reverse ? "—" : "∩"}
      </span>
      <div>
        <strong>{reverse ? "Base" : "Arc"}</strong>
        <small>
          {mode === "testnet" ? "Testnet" : reverse ? "Customer" : "Your store"}
        </small>
      </div>
    </div>
  );
}
export function Journey({
  payment,
  refund,
}: {
  payment: Payment;
  refund?: Refund;
}) {
  const transfer = refund || payment.transfer;
  const route = paymentRoute(payment, refund);
  const stage =
    !transfer || refund?.reserved
      ? -1
      : transfer.status === "settled"
        ? 3
        : transfer.status === "processing"
          ? 0
          : 1;
  const items = [
    {
      title: refund
        ? "Refund sent from Arc"
        : `Payment sent from ${route.origin}`,
      description: `${route.symbol} payment submitted`,
      Icon: ArrowUpRight,
    },
    {
      title:
        route.rail === "cctp"
          ? "Verified by Circle"
          : route.rail === "relay"
            ? "Delivered by Relay"
            : "Payment verified",
      description:
        route.rail === "cctp"
          ? "USDC transfer checked and attested"
          : "USDC settlement verified on Arc",
      Icon: ShieldCheck,
    },
    {
      title: refund ? "Received on Base" : "Received on Arc",
      description: refund
        ? "Back in your customer’s wallet"
        : "Funds are in your wallet",
      Icon: ArrowDownLeft,
    },
  ];
  return (
    <div className="journey">
      {items.map(({ title, description, Icon }, i) => (
        <div
          key={title}
          className={`journey-step ${stage >= i ? "complete" : ""} ${stage === i - 1 ? "current" : ""}`}
        >
          <span className="journey-icon">
            {stage >= i ? (
              <Check size={16} />
            ) : stage === i - 1 ? (
              <span className="pulse-dot" />
            ) : (
              <Icon size={16} />
            )}
          </span>
          <div>
            <strong>{title}</strong>
            <p>{description}</p>
          </div>
          {stage >= i && <Check size={14} className="green" />}
        </div>
      ))}
    </div>
  );
}
export function Proof({
  payment,
  refund,
}: {
  payment: Payment;
  refund?: Refund;
}) {
  const transfer = refund || payment.transfer;
  const route = paymentRoute(payment, refund);
  const sourceHash = transfer?.inTxHash || transfer?.burnHash;
  return (
    <details className="proof">
      <summary>
        <ShieldCheck size={15} />
        {payment.mode === "demo"
          ? "Demo transfer details"
          : "Transaction details"}
        <ChevronRight size={15} />
      </summary>
      <div>
        <p>
          <span>Route</span>
          <strong>
            {route.origin} → {route.destination}
          </strong>
        </p>
        <p>
          <span>Payment method</span>
          <strong>
            {route.rail === "cctp"
              ? "USDC · Circle CCTP"
              : route.rail === "relay"
                ? `${route.symbol} · Relay`
                : "Crypto payment"}
          </strong>
        </p>
        <Journey payment={payment} refund={refund} />
        <p>
          <span>Reference</span>
          <strong>{payment.reference}</strong>
        </p>
        <p>
          <span>Network</span>
          <strong>
            {payment.mode === "demo"
              ? "Simulated · no real funds"
              : payment.mode}
          </strong>
        </p>
        <p>
          <span>Recipient</span>
          <strong>
            {shortAddress(
              refund ? payment.payerAddress : payment.merchantAddress,
            )}
          </strong>
        </p>
        {sourceHash && route.sourceExplorer && (
          <a
            href={`${route.sourceExplorer}/tx/${sourceHash}`}
            target="_blank"
            rel="noreferrer"
          >
            Source transaction <ExternalLink size={13} />
          </a>
        )}
        {transfer?.mintHash && (
          <a
            href={explorer(
              payment.mode,
              refund ? "base" : "arc",
              transfer.mintHash,
            )}
            target="_blank"
            rel="noreferrer"
          >
            Destination transaction <ExternalLink size={13} />
          </a>
        )}
        {route.rail === "cctp" && transfer?.nonce && (
          <p>
            <span>Circle message</span>
            <code title={transfer.nonce}>{shortAddress(transfer.nonce)}</code>
          </p>
        )}
        {route.rail === "cctp" && transfer?.fee !== undefined && (
          <p>
            <span>CCTP fee</span>
            <strong>{money(transfer.fee, true)} USDC</strong>
          </p>
        )}
        {payment.mode !== "demo" && transfer?.status === "settled" && (
          <small>
            {route.rail === "cctp"
              ? "Verified against Circle’s destination contract at finalized block state."
              : "Source payment and USDC delivery verified against on-chain transaction receipts."}
          </small>
        )}
      </div>
    </details>
  );
}
