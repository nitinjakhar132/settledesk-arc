import { MerchantApp } from "@/components/merchant-app";
import { PrivySetup } from "@/components/app-providers";
export default function Page() {
  if (!process.env.NEXT_PUBLIC_PRIVY_APP_ID) return <PrivySetup />;
  return <MerchantApp />;
}
