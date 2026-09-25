# SettleDesk

Money in. Mind at ease.

A mobile-first counter and merchant app built around Arc, Circle CCTP, and Relay. Arc Counter creates a temporary sale QR that buyers can open in any browser, choose a private tip, and pay from an EVM wallet without installing the app. Circle-issued USDC is routed to Arc through CCTP; other Relay-supported tokens are swapped and bridged into USDC on Arc. Rewind sends USDC refunds back to the original paying wallet, while ArcTrace connects payment, verification, settlement, and return to one order.

**Live app:** [settledesk-arc.vercel.app](https://settledesk-arc.vercel.app)  
**Instant demo:** [settledesk-arc.vercel.app/demo](https://settledesk-arc.vercel.app/demo)

## What SettleDesk uses Arc for

Arc is the single settlement and accounting layer. Every crypto checkout targets an exact USDC amount on Arc, giving the merchant one predictable balance and one payment history even when buyers start with different tokens or chains. Native Circle USDC uses CCTP rather than a liquidity bridge; non-USDC assets use Relay for route discovery and conversion before final Arc settlement.

## Run locally

Requires Node.js 22.13+; developed and tested with Node.js 24.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Create a Privy app, enable **Wallet**, **Email**, and **SMS** login methods, add the local/deployed origin to its allowed origins, and set `NEXT_PUBLIC_PRIVY_APP_ID` in `.env.local`. Open http://localhost:3000 and choose **Continue to SettleDesk**. Email and mobile users receive a Privy embedded wallet; users signing in with Rabby, MetaMask, or another supported external wallet keep that wallet.

For an optimized build:

```sh
npm run build
npm start
```

## Try the complete experience

1. Sign in with a wallet, email, or mobile number.
2. Open **Bring money to Arc**. The app shows only supported balances and detects Base USDC/ETH without moving either automatically.
3. Move an exact amount of Base USDC to Arc with CCTP, then return when Circle verification is ready to receive it on Arc.
4. Open **Arc Counter**, tap a quick amount, and show the 10-minute QR. The merchant can hide the amount while the buyer privately chooses a tip.
5. The buyer pays with Circle USDC through CCTP, another Relay-supported EVM token through Relay, or—when configured—Stripe card/mobile wallet/Cash App Pay or PayPal/Venmo.
6. After USDC settlement, open the payment and use **Refund** to send a full or partial return to the original paying wallet.

## Included

- Responsive merchant dashboard, payment search and filters, activity, store settings.
- Temporary quick-sale QR codes, quick amounts, discreet counter mode, private buyer-selected tips, native sharing, and automatic merchant-side payment confirmation.
- One browser checkout with no SettleDesk buyer account: Circle USDC through CCTP, other EVM tokens through Relay, optional Stripe-hosted card/Apple Pay/Google Pay/Cash App Pay, and optional PayPal/Venmo.
- Exact-output crypto quotes: the merchant receives the requested USDC amount on Arc while the buyer sees the required origin token amount and keeps their connected wallet as the refund address.
- Optional per-store and per-sale Stripe Tax collection. Tax-enabled sales collect the buyer billing location in hosted Checkout, show the final tax before payment, save the tax breakdown to the receipt, and add tax columns to the merchant CSV export.
- Live demo progression, persistent orders, full/partial refunds, linked receipts, CSV and JSON exports.
- Mobile bottom navigation, focused bottom sheets, large touch targets, reduced-motion support, keyboard focus trapping, offline messaging, and home-screen manifest.
- Privy wallet, email, and SMS sign-in with automatic embedded-wallet creation only for users who need one.
- A short-lived wallet challenge behind Privy, signature verification, and HttpOnly application sessions.
- Live Arc USDC/EURC and Base USDC/ETH balance views; the interface intentionally hides unsupported token clutter.
- Recoverable Base → Arc account funding plus Base ↔ Arc payment/refund settlement through CCTP V2.
- Exact six-decimal monetary arithmetic; refund reservations and idempotency; cross-merchant authorization.
- Source receipt verification and invoice binding through CCTP hook metadata.
- Circle attestation polling, destination receive, expired-message re-attestation, and finalized destination-state checks.
- Verification and linking of destination transaction hashes after receive.
- Fee quotes that gross up standard-transfer amounts so the recipient gets at least the requested USDC.

Fee discovery accounts for deployment differences: Base’s older messenger does not expose `getMinFeeAmount`, so its current route fee comes from Circle’s fee API; Arc’s supported fee-switch contract is queried directly. Quotes fail closed if the required source is unavailable.

## Wallet and funding flow

Privy is the only login surface. The app accepts a supported external EVM wallet—including detected Rabby and MetaMask wallets—or creates an embedded wallet after email/SMS login. SettleDesk never receives a private key or delegated signing authority.

New wallet workspaces default to **testnet**. Set the store name and network under **Your store**. Switching to mainnet affects new links; existing links retain their original network. Dashboard totals never combine testnet and mainnet.

- Payment: customer approves USDC on Base, then burns through Circle’s TokenMessengerV2 with the order reference in hook data. The server verifies the emitted message before linking it.
- Funding: the merchant chooses an exact net amount of Base USDC. The quote grosses up Circle’s fee, approval is exact, the burn is bound to the signed-in wallet and Arc recipient, and its source hash is saved locally so the transfer can resume after closing the app.
- Refund: merchant reserves an amount, reviews the fee, and approves the return burn on Arc. The destination is the original source transaction’s wallet. This version accepts direct deposits through SettleDesk, not arbitrary routers.
- Settlement: the app obtains Circle’s attestation. A wallet submits the destination `receiveMessage`. The server only marks the payment settled after the attested nonce is used in the destination contract’s **finalized** state.
- Recovery: a broadcast source hash is saved locally before waiting for confirmation. Retrying resumes that transfer rather than sending another. A reserved refund stays available for review and approval.

The app uses Standard Transfers. They may take several minutes, particularly with source-chain finality requirements. No automatic forwarding, sponsored destination gas, or private-key relayer is configured. The destination receive step therefore requires a wallet transaction. Circle hooks carry a signed order reference; they do not automatically execute application logic.

The merchant needs USDC for a refund and native gas for signing. Base gas is ETH; Arc gas is native USDC. The app uses the ERC-20 USDC interface with six decimals for transfers and never double-counts native and ERC-20 Arc balances.

## What was verified

- Production compilation and strict TypeScript checking.
- Unit tests covering exact USDC arithmetic, refund limits, pending-refund reservations, and CCTP message matching.
- Browser tests covering the Privy setup state at 320/390/768/1440px plus merchant isolation, challenge replay protection, and the simulated settlement state machine used in API tests.
- API tests covering authorization, over-refunds, replayed refund requests, wallet challenge replay, origin checks, and separation of testnet/mainnet records.
- Read-only RPC checks for Base, Base Sepolia, Arc, and Arc Testnet, including deployed contract bytecode and token decimals.

**No funded onchain payment/refund has been executed during development.** The live integration needs a funded testnet round trip before handling customer money. Demo receipts explicitly identify themselves as simulated.

```sh
npm test
npm run typecheck
npm run test:e2e     # Start the app first. Defaults to local Microsoft Edge.
npm run check:networks
```

To run browser tests on another machine, adjust the `channel` in `playwright.config.ts`, or install Playwright Chromium and omit that option.

## Storage and hosting

SQLite stores profiles, payments, refund reservations, consumed challenges, and hashed session tokens in `data/settledesk.db`. The store uses WAL and immediate transactions for refund reservations. Data is excluded from source control.

Deploy this version as **one Node.js service with a persistent disk**, using the included Dockerfile or an equivalent host. It is not suitable for stateless serverless hosting without replacing the storage adapter. Back up the database and its WAL together, or use SQLite’s backup tooling.

Environment variables are documented in `.env.example`. Set the public Privy app ID, set `APP_ORIGIN` to the exact HTTPS public origin behind a proxy, and set `SETTLEDESK_DB` to the persistent volume path. Dedicated RPC URLs can replace public defaults. No Circle API secret or server wallet private key is required for CCTP. Stripe and PayPal credentials are optional and only enable their corresponding buyer buttons.

Stripe and PayPal in this prototype are configured as the platform merchant accounts. A production multi-merchant release needs Stripe Connect and PayPal Commerce Platform onboarding so every merchant receives their own fiat proceeds. A processor-confirmed fiat payment is deliberately shown as **settling**: card, Cash App, PayPal, and Venmo proceeds are not magically onchain USDC and are not counted in the merchant’s Arc balance. Fiat disputes and refunds remain in the processor; Rewind is currently for verified USDC payments only.

Stripe Tax is opt-in under **Your store** and can be overridden for each new counter sale. Before enabling it for real payments, finish the business address, default product tax code, and registrations in the Stripe Tax Dashboard. Stripe calculates and reports tax only where the Stripe account has an active registration. Tax-enabled sales intentionally use Stripe card/mobile-wallet/Cash App checkout; the app does not guess a tax rate for USDC, PayPal, or Venmo payments.

The installable mobile experience requires HTTPS, except on localhost. Local commands bind only to 127.0.0.1. Publish to an HTTPS host to use the wallet-connected app on a phone. The Docker entrypoint binds inside its container for use behind a deployment proxy. This is a PWA, not an App Store or Play Store binary.

## Deliberate boundaries

- CCTP status refresh is driven by open app/checkout sessions, not a background indexer. Closed apps do not generate push notifications.
- No outbound webhooks, automated shipping integration, email delivery, accounting integrations, or background relayer are enabled. The fulfillment action records the merchant’s completion of the order.
- Refund limits are application-enforced. The merchant still controls their wallet and can send transfers outside the app. This is not escrow or a chargeback guarantee.
- A failed or cancelled wallet approval leaves the same refund reservation available to resume. Reservations do not expire automatically, to avoid releasing funds while a submitted transfer is uncertain.
- Multiple simultaneous checkout wallets can still independently broadcast onchain payments. A production payment contract would be needed to enforce one payment per invoice onchain.
- Fiat rails require approved processor accounts, eligible devices/regions, HTTPS domains, and production webhooks. Apple Pay and Google Pay appear through Stripe only when the buyer and device are eligible. Venmo availability is determined by PayPal.
- Zelle is intentionally not presented as an integrated checkout method because it does not provide a general-purpose merchant checkout API. Bank transfer is omitted from the fast counter flow.
- Public links are unguessable capability URLs. Anyone with the link can see its receipt; do not put sensitive personal information in the customer or description fields.
- Rate limiting is in-process and assumes a trusted reverse proxy. Scale-out hosting needs a shared limiter and durable background processing.

## Source map

`src/components/merchant-app.tsx` — merchant screens and creation flow

`src/components/payment-detail.tsx` — payment management and Rewind

`src/components/checkout.tsx` — customer checkout and receipt

`src/lib/cctp.ts` — verification, quoting, polling, and recovery

`src/lib/client.ts` — wallet transactions and browser helpers

`src/lib/assets.ts` — curated Arc/Base asset reads

`src/lib/model.ts` — exact amounts and refund rules

`src/lib/store.ts` — persistent SQLite storage and sessions

`src/app/api/[...path]/route.ts` — authenticated merchant and public checkout API

## Protocol references

- [Circle CCTP contract addresses](https://developers.circle.com/cctp/references/contract-addresses)
- [Circle CCTP contract interfaces](https://developers.circle.com/cctp/references/contract-interfaces)
- [Circle CCTP message format and attestations](https://developers.circle.com/cctp/references/technical-guide)
- [Arc network configuration](https://docs.arc.io/arc/references/connect-to-arc)

Visual direction: a calm dark interface with warm lime accents, clear amounts, restrained motion, and one primary action at a time. Inspired by the simplicity of modern mobile finance apps; no Fomo brand assets are used.
