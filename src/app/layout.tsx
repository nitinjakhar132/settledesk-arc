import type { Metadata, Viewport } from "next";
import "@fontsource-variable/dm-sans";
import "./globals.css";
import { AppProviders } from "@/components/app-providers";
export const metadata: Metadata = {
  title: "SettleDesk — Money in. Mind at ease.",
  description:
    "A calmer way to accept USDC, follow every payment, and send refunds home. Built on Arc and Circle CCTP.",
  applicationName: "SettleDesk",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SettleDesk",
  },
  icons: { icon: "/icon.svg", apple: "/apple-icon" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#101110",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AppProviders
          appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID}
          clientId={process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID}
        >
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
