import { z } from "zod";
import { markFiatPaid } from "@/lib/fiat";
import { paypalRequest } from "@/lib/paypal";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = z
      .object({
        paymentId: z.string().uuid(),
        orderId: z.string().min(1),
        method: z.enum(["paypal", "venmo"]),
      })
      .parse(await request.json());
    const order = await paypalRequest(
      `/v2/checkout/orders/${encodeURIComponent(input.orderId)}/capture`,
      { method: "POST", body: "{}" },
    );
    const units = order.purchase_units as
      | {
          custom_id?: string;
          payments?: { captures?: { status?: string }[] };
        }[]
      | undefined;
    if (
      units?.[0]?.custom_id !== input.paymentId ||
      !units[0].payments?.captures?.some(
        (capture) => capture.status === "COMPLETED",
      )
    )
      throw new Error("PayPal has not confirmed this payment.");
    const payment = markFiatPaid(
      input.paymentId,
      "paypal",
      input.orderId,
      input.method,
    );
    return Response.json({ payment });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "PayPal capture failed.";
    return Response.json({ error: message }, { status: 400 });
  }
}
