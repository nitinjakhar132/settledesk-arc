import { z } from "zod";
import { cents, paymentForCheckout, saveFiatAttempt } from "@/lib/fiat";
import { paypalRequest } from "@/lib/paypal";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = z
      .object({
        paymentId: z.string().uuid(),
        method: z.enum(["paypal", "venmo"]),
        tip: z.string().default("0"),
      })
      .parse(await request.json());
    const payment = paymentForCheckout(
      input.paymentId,
      input.method,
      input.tip,
    );
    const order = await paypalRequest("/v2/checkout/orders", {
      method: "POST",
      headers: { "PayPal-Request-Id": payment.id },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: payment.id,
            custom_id: payment.id,
            invoice_id: payment.reference,
            description: payment.description,
            amount: {
              currency_code: "USD",
              value: (cents(payment) / 100).toFixed(2),
            },
          },
        ],
      }),
    });
    const id = String(order.id || "");
    if (!id) throw new Error("PayPal did not create an order.");
    saveFiatAttempt(payment, {
      provider: "paypal",
      method: input.method,
      status: "pending",
      externalId: id,
    });
    return Response.json({ id });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "PayPal checkout failed.";
    return Response.json({ error: message }, { status: 400 });
  }
}
