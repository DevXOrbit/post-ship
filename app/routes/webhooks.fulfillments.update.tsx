/**
 * app/routes/webhooks.fulfillments.update.tsx
 *
 * Webhook: fulfillments/update
 * Fires whenever a fulfillment's status changes.
 * We listen for shipment_status === "delivered" to trigger:
 *   1. "Your order has been delivered" email
 *   2. Schedule review request (stored in DB, cron sends it later)
 *
 * Note: Shopify's shipment_status field is populated when the carrier
 * updates the tracking status (requires Shopify Shipping or a carrier
 * that integrates with Shopify's tracking system).
 */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getSettings } from "../lib/settings.server";
import { sendDeliveredEmail } from "../lib/email.server";

interface FulfillmentUpdatePayload {
  id: number;
  order_id: number;
  status: string;
  shipment_status: string | null; // "delivered" | "in_transit" | "out_for_delivery" | null
  tracking_company: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
}

// Shopify sends the order context on fulfillment webhooks
interface FulfillmentWithOrder extends FulfillmentUpdatePayload {
  // These are available on the fulfillment webhook payload
  receipt: Record<string, unknown>;
  // Order data is NOT embedded — we pull it from the EmailLog / OrderId stored
  // during the shipped email. For the delivered email we need the customer email.
  // Solution: store order email in EmailLog, OR re-fetch from admin API.
  // For simplicity: we use the order_id to look up the shipped EmailLog entry
  // which was created during the fulfillment. Then we need the order email —
  // best fetched from admin API using the stored session.
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const fulfillment = payload as FulfillmentUpdatePayload;

  // Only act on "delivered"
  if (fulfillment.shipment_status !== "delivered") {
    return new Response("OK", { status: 200 });
  }

  if (!fulfillment.order_id) {
    return new Response("OK", { status: 200 });
  }

  const settings = await getSettings(shop);
  if (!settings.resendApiKey || !settings.fromEmail) {
    return new Response("OK", { status: 200 });
  }

  const orderId = `gid://shopify/Order/${fulfillment.order_id}`;

  // Dedup: only one "delivered" email per order
  try {
    await prisma.emailLog.create({
      data: { shop, orderId, type: "tracking_delivered" },
    });
  } catch {
    console.log(
      `[Afyro] Delivered email already sent for order ${fulfillment.order_id} — skipping.`,
    );
    return new Response("OK", { status: 200 });
  }

  // Fetch order details (email, name, shipping address) from admin API
  // We need a session to make the API call
  const session = await prisma.session.findFirst({
    where: { shop, isOnline: false },
  });

  if (!session?.accessToken) {
    console.error(`[Afyro] No offline session found for ${shop}`);
    return new Response("OK", { status: 200 });
  }

  let orderEmail = "";
  let orderName = "";
  let customerName = "";

  try {
    const res = await fetch(
      `https://${shop}/admin/api/2026-01/orders/${fulfillment.order_id}.json?fields=id,name,email,shipping_address`,
      {
        headers: {
          "X-Shopify-Access-Token": session.accessToken,
          "Content-Type": "application/json",
        },
      },
    );
    const data = (await res.json()) as {
      order?: {
        name: string;
        email: string;
        shipping_address?: { name: string };
      };
    };
    orderEmail = data.order?.email ?? "";
    orderName = data.order?.name ?? `#${fulfillment.order_id}`;
    customerName = data.order?.shipping_address?.name ?? "";
  } catch (err) {
    console.error(`[Afyro] Failed to fetch order for delivered email:`, err);
    return new Response("OK", { status: 200 });
  }

  if (!orderEmail) {
    console.warn(`[Afyro] No email found for order ${fulfillment.order_id}`);
    return new Response("OK", { status: 200 });
  }

  // ── Send delivered email ──────────────────────────────────────────────────
  const result = await sendDeliveredEmail({
    to: orderEmail,
    orderName,
    customerName,
    shopName: settings.senderName || shop,
    shopDomain: shop,
    brandColor: settings.brandColor,
    fromEmail: settings.fromEmail,
    senderName: settings.senderName || shop,
    resendApiKey: settings.resendApiKey,
  });

  if (result.success) {
    console.log(
      `[Afyro] Delivered email sent for ${orderName} → ${orderEmail}`,
    );
  } else {
    console.error(
      `[Afyro] Delivered email FAILED for ${orderName}: ${result.error}`,
    );
  }

  // ── Schedule review request ───────────────────────────────────────────────
  // Store a ReviewSchedule record. A daily cron route (/cron/review-emails)
  // queries for due records and sends the emails.
  if (settings.enableReviewEmails && settings.plan !== "free") {
    const sendAfter = new Date();
    sendAfter.setDate(sendAfter.getDate() + settings.reviewRequestDelayDays);

    await prisma.reviewSchedule
      .upsert({
        where: { shop_orderId: { shop, orderId } },
        create: {
          shop,
          orderId,
          orderName,
          customerEmail: orderEmail,
          customerName,
          sendAfter,
          sent: false,
        },
        update: {}, // don't overwrite if already exists
      })
      .catch((err: Error) => {
        console.error("[Afyro] Failed to schedule review email:", err);
      });

    console.log(
      `[Afyro] Review email scheduled for ${orderName} after ${sendAfter.toISOString()}`,
    );
  }

  return new Response("OK", { status: 200 });
};
