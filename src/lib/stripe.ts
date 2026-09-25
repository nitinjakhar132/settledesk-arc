import "server-only";
import Stripe from "stripe";

let client: Stripe | undefined;

export function stripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) return undefined;
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2026-08-26.dahlia",
    typescript: true,
  });
  return client;
}

export function requireStripe() {
  const stripe = stripeClient();
  if (!stripe)
    throw new Error(
      "Card payments are not connected for this merchant yet. Choose USDC instead.",
    );
  return stripe;
}
