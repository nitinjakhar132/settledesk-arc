import type Stripe from "stripe";
import { markFiatPaid, stripeTotals } from "@/lib/fiat";
import { requireStripe } from "@/lib/stripe";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");
  if (!secret || !signature)
    return Response.json(
      { error: "Webhook is not configured." },
      { status: 400 },
    );
  let event: Stripe.Event;
  try {
    event = requireStripe().webhooks.constructEvent(
      await request.text(),
      signature,
      secret,
    );
  } catch {
    return Response.json({ error: "Invalid signature." }, { status: 400 });
  }
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    const session = event.data.object as Stripe.Checkout.Session;
    const id = session.metadata?.settledesk_payment_id;
    const taxComplete =
      session.metadata?.settledesk_tax !== "automatic" ||
      session.automatic_tax?.status === "complete";
    if (id && session.payment_status === "paid" && taxComplete) {
      markFiatPaid(
        id,
        "stripe",
        session.id,
        session.metadata?.settledesk_method === "cashapp" ? "cashapp" : "card",
        stripeTotals(
          session.currency,
          session.amount_total,
          session.total_details?.amount_tax,
        ),
      );
    }
  }
  return Response.json({ received: true });
}
