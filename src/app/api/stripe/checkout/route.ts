import { z } from "zod";
import { cents, paymentForCheckout, saveFiatAttempt } from "@/lib/fiat";
import { requireStripe } from "@/lib/stripe";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = z
      .object({
        paymentId: z.string().uuid(),
        method: z.enum(["card", "cashapp"]),
        tip: z.string().default("0"),
      })
      .parse(await request.json());
    const payment = paymentForCheckout(
      input.paymentId,
      input.method,
      input.tip,
    );
    const stripe = requireStripe();
    const origin = process.env.APP_ORIGIN || new URL(request.url).origin;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: payment.id,
      payment_method_types: [input.method],
      automatic_tax: payment.collectTax ? { enabled: true } : undefined,
      billing_address_collection: payment.collectTax ? "required" : "auto",
      tax_id_collection: payment.collectTax ? { enabled: true } : undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: cents(payment),
            tax_behavior: payment.collectTax ? "exclusive" : undefined,
            product_data: {
              name: payment.description,
              description: `${payment.merchantName} · ${payment.reference}`,
            },
          },
        },
      ],
      metadata: {
        settledesk_payment_id: payment.id,
        settledesk_method: input.method,
        settledesk_tax: payment.collectTax ? "automatic" : "none",
      },
      success_url: `${origin}/pay/${payment.id}?stripe=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/pay/${payment.id}?stripe=cancelled`,
    });
    saveFiatAttempt(payment, {
      provider: "stripe",
      method: input.method,
      status: "pending",
      externalId: session.id,
    });
    return Response.json({ url: session.url });
  } catch (error) {
    const raw = error instanceof Error ? error.message : "Checkout failed.";
    const message = /head office address|automatic tax calculation/i.test(raw)
      ? "Tax checkout is not ready yet. The merchant needs to finish their Stripe Tax business address."
      : raw;
    return Response.json({ error: message }, { status: 400 });
  }
}
