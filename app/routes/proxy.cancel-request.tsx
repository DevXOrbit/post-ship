/**
 * App Proxy: POST /apps/postship/cancel-request
 * Receives a cancel request from the theme extension and logs it to DB.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { unauthenticated } from "../shopify.server";
import prisma from "../db.server";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export const loader = async (_: LoaderFunctionArgs) =>
  jsonResponse({ status: "ok" });

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  let body: {
    order_id?: string;
    order_name?: string;
    email?: string;
    reason?: string;
    notes?: string;
  };

  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request." }, 400);
  }

  const { order_id, order_name, email, reason, notes } = body;
  if (!order_id || !email) {
    return jsonResponse({ error: "Missing required fields." }, 400);
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (!shop) return jsonResponse({ error: "Missing shop." }, 400);

  // Verify shop access
  try {
    await unauthenticated.admin(shop);
  } catch {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  // Check for duplicate request
  const existing = await prisma.cancellationRequest
    .findFirst({
      where: { shop, orderId: order_id, status: "pending" },
    })
    .catch(() => null);

  if (existing) {
    return jsonResponse({
      message: "A cancellation request for this order is already pending.",
    });
  }

  // Save to DB
  await prisma.cancellationRequest
    .create({
      data: {
        shop,
        orderId: order_id,
        orderName: order_name || order_id,
        customerEmail: email,
        reason: reason || "customer",
        status: "pending",
      },
    })
    .catch((err: Error) => {
      console.error("Failed to save cancellation request:", err);
    });

  return jsonResponse({
    message:
      "Your cancellation request has been received. We'll process it as soon as possible and notify you by email.",
  });
};
