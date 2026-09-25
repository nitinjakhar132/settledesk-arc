import { z } from "zod";
import { markFiatPaid, stripeTotals } from "@/lib/fiat";
import { requireStripe } from "@/lib/stripe";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = z
      .object({ paymentId: z.string().uuid(), sessionId: z.string().min(1) })
      .parse(await request.json());
    const session = await requireStripe().checkout.sessions.retrieve(
      input.sessionId,
    );
    if (
      session.client_reference_id !== input.paymentId ||
      session.metadata?.settledesk_payment_id !== input.paymentId
    )
      throw new Error("This checkout does not belong to this sale.");
    if (session.payment_status !== "paid")
      throw new Error("Stripe has not confirmed this payment yet.");
    if (
      session.metadata?.settledesk_tax === "automatic" &&
      session.automatic_tax?.status !== "complete"
    )
      throw new Error("Stripe has not completed the tax calculation yet.");
    const method =
      session.metadata?.settledesk_method === "cashapp" ? "cashapp" : "card";
    const payment = markFiatPaid(
      input.paymentId,
      "stripe",
      input.sessionId,
      method,
      stripeTotals(
        session.currency,
        session.amount_total,
        session.total_details?.amount_tax,
      ),
    );
    return Response.json({ payment });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Confirmation failed.";
    return Response.json({ error: message }, { status: 400 });
  }
}
