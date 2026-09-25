"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { usePathname } from "next/navigation";
import { base, baseSepolia } from "viem/chains";
import { arc, arcTestnet } from "@/lib/chains";

export function AppProviders({
  appId,
  clientId,
  children,
}: {
  appId?: string;
  clientId?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  if (!appId || pathname === "/demo") return children;

  return (
    <PrivyProvider
      appId={appId}
      clientId={clientId}
      config={{
        loginMethods: ["email", "sms", "wallet"],
        appearance: {
          theme: "#101110",
          accentColor: "#d8ff63",
          landingHeader: "Welcome to SettleDesk",
          loginMessage: "Your calm business account on Arc.",
          showWalletLoginFirst: false,
          walletChainType: "ethereum-only",
          walletList: [
            "detected_wallets",
            "metamask",
            "coinbase_wallet",
            "wallet_connect",
          ],
        },
        embeddedWallets: {
          ethereum: {
            createOnLogin: "users-without-wallets",
          },
          showWalletUIs: true,
        },
        supportedChains: [arcTestnet, arc, baseSepolia, base],
        defaultChain: arcTestnet,
      }}
    >
      {children}
    </PrivyProvider>
  );
}

export function PrivySetup() {
  return (
    <main className="setup-page">
      <section className="setup-card">
        <div className="setup-mark">s.</div>
        <span className="eyebrow green">ONE LAST CONNECTION</span>
        <h1>Bring your business wallet to life.</h1>
        <p>
          Add your Privy app ID to enable secure sign-in with a wallet, email,
          or mobile number.
        </p>
        <div className="setup-methods" aria-label="Supported sign-in methods">
          <span>Wallet</span>
          <span>Email</span>
          <span>Mobile</span>
        </div>
        <div className="setup-code">
          <span>NEXT_PUBLIC_PRIVY_APP_ID</span>
          <strong>Required</strong>
        </div>
        <p className="setup-note">
          Set the value in <code>.env.local</code>, then restart SettleDesk.
        </p>
      </section>
    </main>
  );
}
