import { Checkout } from "@/components/checkout";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Checkout
      id={(await params).id}
      paymentConfig={{
        stripe: Boolean(process.env.STRIPE_SECRET_KEY),
        paypalClientId: process.env.PAYPAL_CLIENT_ID,
        walletEnabled: Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID),
      }}
    />
  );
}
