"use client";
import { useId, useRef, useState } from "react";
import { Check, ChevronDown, Coins, Search } from "lucide-react";

type Option = {
  id: string;
  label: string;
  subtitle?: string;
  icon?: string;
  symbol?: string;
};

function AssetIcon({ icon, symbol = "" }: Pick<Option, "icon" | "symbol">) {
  const [failed, setFailed] = useState<string>();
  const safeIcon = icon?.startsWith("https://") ? icon : undefined;
  const kind = symbol.toUpperCase();
  return (
    <span
      className={`asset-icon asset-${kind.toLowerCase()}`}
      aria-hidden="true"
    >
      {safeIcon && failed !== safeIcon ? (
        <img
          src={safeIcon}
          alt=""
          width={32}
          height={32}
          referrerPolicy="no-referrer"
          onError={() => setFailed(safeIcon)}
        />
      ) : kind === "ETH" || kind === "WETH" ? (
        <svg viewBox="0 0 24 24">
          <path
            fill="currentColor"
            d="M12 1 5 12l7 4 7-4-7-11Zm0 17-7-4 7 9 7-9-7 4Z"
          />
        </svg>
      ) : kind === "USDC" ? (
        <span className="asset-dollar">$</span>
      ) : kind === "USDT" ? (
        "₮"
      ) : kind.includes("BTC") ? (
        "₿"
      ) : (
        <Coins size={20} />
      )}
    </span>
  );
}

export function PaymentAssetPicker({
  label,
  options,
  value,
  onChange,
  searchable = false,
  disabled = false,
}: {
  label: string;
  options: Option[];
  value: string;
  onChange: (id: string) => void;
  searchable?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = options.find((option) => option.id === value);
  const matching = options.filter((option) =>
    `${option.label} ${option.subtitle || ""}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <div
      className="asset-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <span className="asset-label" id={`${id}-label`}>
        {label}
      </span>
      <button
        ref={trigger}
        type="button"
        className="asset-trigger"
        aria-label={`${label}: ${selected?.label || "Choose"}`}
        aria-expanded={open}
        aria-controls={`${id}-options`}
        disabled={disabled || !options.length}
        onClick={() => {
          setOpen(!open);
          setQuery("");
        }}
      >
        <AssetIcon icon={selected?.icon} symbol={selected?.symbol} />
        <span className="asset-name">
          <strong>{selected?.label || "Choose a token"}</strong>
          {selected?.subtitle && <small>{selected.subtitle}</small>}
        </span>
        <ChevronDown size={18} />
      </button>
      {open && (
        <div
          className="asset-menu"
          id={`${id}-options`}
          role="region"
          aria-labelledby={`${id}-label`}
        >
          {searchable && (
            <label className="asset-search">
              <Search size={17} />
              <input
                autoFocus
                aria-label={`Search ${label.toLowerCase()}`}
                placeholder="Search by name or symbol"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          )}
          <div className="asset-options">
            {matching.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`asset-option ${option.id === value ? "selected" : ""}`}
                aria-label={`Select ${option.label}${option.subtitle ? `, ${option.subtitle}` : ""}`}
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                  trigger.current?.focus();
                }}
              >
                <AssetIcon icon={option.icon} symbol={option.symbol} />
                <span className="asset-name">
                  <strong>{option.label}</strong>
                  {option.subtitle && <small>{option.subtitle}</small>}
                </span>
                {option.id === value && <Check size={17} />}
              </button>
            ))}
            {!matching.length && (
              <p className="asset-empty">
                No tokens found. Try another name or use “Token not listed?”
                below.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
