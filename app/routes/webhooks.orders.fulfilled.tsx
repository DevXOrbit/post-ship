/**
 * app/routes/webhooks.orders.fulfilled.tsx
 *
 * Webhook: orders/fulfilled
 * Fires when a Shopify order gains at least one fulfillment with a tracking number.
 *
 * Flow:
 *  1. Authenticate webhook (HMAC)
 *  2. Load merchant AppSettings
 *  3. Guard: tracking emails enabled + Resend key configured + Starter plan
 *  4. Dedup via EmailLog (one "tracking_shipped" email per order)
 *  5. Send branded tracking email via Resend
 */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getSettings } from "../lib/settings.server";
import { sendTrackingEmail } from "../lib/email.server";

interface FulfillmentPayload {
  id: number;
  name: string;
  email: string;
  fulfillment_status: string;
  fulfillments: Array<{
    id: number;
    status: string;
    tracking_company: string | null;
    tracking_number: string | null;
    tracking_url: string | null;
    shipment_status: string | null;
  }>;
  shipping_address: {
    name: string;
    address1: string;
    city: string;
    country: string;
  } | null;
  line_items: Array<{ id: number; title: string; quantity: number }>;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const order = payload as FulfillmentPayload;

  if (!order?.id || !order.email) {
    return new Response("OK", { status: 200 });
  }

  const settings = await getSettings(shop);

  // Guard: feature enabled
  if (!settings.enableTrackingEmails) {
    console.log(`[Afyro] Tracking emails disabled for ${shop} — skipping.`);
    return new Response("OK", { status: 200 });
  }

  // Guard: Resend configured
  if (!settings.resendApiKey || !settings.fromEmail) {
    console.warn(`[Afyro] Resend not configured for ${shop} — skipping email.`);
    return new Response("OK", { status: 200 });
  }

  const tracking = order.fulfillments?.find(
    (f) => f.tracking_number && f.tracking_number.trim() !== "",
  );

  if (!tracking?.tracking_number) {
    console.log(
      `[Afyro] Order ${order.name} fulfilled with no tracking number — skipping.`,
    );
    return new Response("OK", { status: 200 });
  }

  const orderId = `gid://shopify/Order/${order.id}`;

  // Dedup: only send once per order
  try {
    await prisma.emailLog.create({
      data: {
        shop,
        orderId,
        type: "tracking_shipped",
      },
    });
  } catch {
    // Unique constraint violation = already sent
    console.log(
      `[Afyro] Tracking shipped email already sent for ${order.name} — skipping.`,
    );
    return new Response("OK", { status: 200 });
  }

  const result = await sendTrackingEmail({
    to: order.email,
    orderName: order.name,
    customerName: order.shipping_address?.name ?? "",
    trackingNumber: tracking.tracking_number,
    trackingUrl: tracking.tracking_url ?? "",
    carrier: tracking.tracking_company ?? "Carrier",
    shopName: settings.senderName || shop,
    shopDomain: shop,
    brandColor: settings.brandColor,
    fromEmail: settings.fromEmail,
    senderName: settings.senderName || shop,
    resendApiKey: settings.resendApiKey,
  });

  if (result.success) {
    console.log(
      `[Afyro] Tracking email sent for ${order.name} → ${order.email} (id: ${result.id})`,
    );
  } else {
    console.error(
      `[Afyro] Tracking email FAILED for ${order.name}: ${result.error}`,
    );
    // Don't remove the EmailLog entry — retry logic can be added later
  }

  return new Response("OK", { status: 200 });
};
