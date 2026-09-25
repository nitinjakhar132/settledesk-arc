import { DemoMerchantApp } from "@/components/merchant-app";
import { redirect } from "next/navigation";

export default function DemoPage() {
  // Keep the simulated workspace available for local development and browser
  // tests, but never present it as the production Arc application.
  if (process.env.VERCEL) redirect("/");
  return <DemoMerchantApp />;
}
