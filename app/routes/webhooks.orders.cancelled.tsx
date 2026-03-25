/**
 * Webhook: orders/cancelled
 *
 * Fires when a Shopify order is cancelled.
 * Updates any pending cancellation requests in the DB to "approved".
 */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

interface CancelledOrderPayload {
  id: number;
  name: string;
  email: string;
  cancel_reason: string;
  cancelled_at: string;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`[PostShip] Webhook received: ${topic} for shop: ${shop}`);

  const order = payload as CancelledOrderPayload;

  if (!order?.id) {
    return new Response("OK", { status: 200 });
  }

  const orderId = `gid://shopify/Order/${order.id}`;

  // Mark any pending cancellation request as approved
  await prisma.cancellationRequest
    .updateMany({
      where: {
        shop,
        orderId,
        status: "pending",
      },
      data: {
        status: "approved",
        processedAt: new Date(),
      },
    })
    .catch((err: Error) => {
      console.error(`[PostShip] Failed to update cancellation request:`, err);
    });

  console.log(`[PostShip] Order ${order.name} cancelled. DB updated.`);

  return new Response("OK", { status: 200 });
};
