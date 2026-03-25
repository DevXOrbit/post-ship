/**
 * Webhook: orders/fulfilled
 *
 * Fires when a Shopify order is fulfilled (tracking added).
 * In Phase 1: logs the event.
 * In Phase 2: triggers automated tracking update email via Resend/SendGrid.
 */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

interface FulfillmentPayload {
  id: number;
  order_id: number;
  email: string;
  name: string;         // order name e.g. "#1001"
  fulfillment_status: string;
  fulfillments: Array<{
    id: number;
    status: string;
    tracking_company: string;
    tracking_number: string;
    tracking_url: string;
    shipment_status: string | null;
  }>;
  shipping_address: {
    name: string;
    address1: string;
    city: string;
    country: string;
  } | null;
  line_items: Array<{
    id: number;
    title: string;
    quantity: number;
  }>;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`[PostShip] Webhook received: ${topic} for shop: ${shop}`);

  const order = payload as FulfillmentPayload;

  if (!order?.id) {
    return new Response("OK", { status: 200 });
  }

  const tracking = order.fulfillments?.[0];

  console.log(
    `[PostShip] Order ${order.name} fulfilled.`,
    `Tracking: ${tracking?.tracking_number ?? "none"}`,
    `Carrier: ${tracking?.tracking_company ?? "unknown"}`
  );

  // ── Phase 2: Send tracking email ─────────────────────────────────────────
  // TODO: Check AppSettings for shop to see if tracking emails are enabled.
  // TODO: Load email template with brand color from AppSettings.
  // TODO: Send via Resend/SendGrid with:
  //   - Order name, tracking number, carrier, tracking URL
  //   - Customer name from shipping address
  //   - Deep link back to the tracking widget: {shop}/apps/postship?order={name}&email={email}&auto=1
  //
  // Example (Phase 2):
  // const settings = await prisma.appSettings.findUnique({ where: { shop } });
  // if (settings?.enableTrackingEmails && tracking?.tracking_number) {
  //   await sendTrackingEmail({
  //     to: order.email,
  //     orderName: order.name,
  //     tracking: {
  //       number: tracking.tracking_number,
  //       carrier: tracking.tracking_company,
  //       url: tracking.tracking_url,
  //     },
  //     shopName: settings.senderName,
  //     brandColor: settings.brandColor,
  //   });
  // }
  // ─────────────────────────────────────────────────────────────────────────

  return new Response("OK", { status: 200 });
};
