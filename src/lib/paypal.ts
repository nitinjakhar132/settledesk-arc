import "server-only";

function baseUrl() {
  return process.env.PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function accessToken() {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret)
    throw new Error(
      "PayPal and Venmo are not connected for this merchant yet.",
    );
  const response = await fetch(`${baseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("PayPal could not start checkout.");
  return ((await response.json()) as { access_token: string }).access_token;
}

export async function paypalRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });
  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const details = data.details as { description?: string }[] | undefined;
    throw new Error(details?.[0]?.description || "PayPal checkout failed.");
  }
  return data;
}
