/**
 * App Proxy: POST /apps/afyro/cancel-request
 *
 * FIX: Use unauthenticated.admin(request) — not unauthenticated.admin(shop).
 * The `request` form is required so the helper can verify the proxy HMAC.
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

  // ── Auth via full request (HMAC verified) ─────────────────────────────────
  let shop: string;
  try {
    await unauthenticated.admin(request);
    // Extract shop from URL after auth passes
    shop = new URL(request.url).searchParams.get("shop") ?? "";
    if (!shop) throw new Error("missing shop");
  } catch {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  // Parse body — must clone request since body was already read by auth
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

  // Check for duplicate
  const existing = await prisma.cancellationRequest
    .findFirst({ where: { shop, orderId: order_id, status: "pending" } })
    .catch(() => null);

  if (existing) {
    return jsonResponse({
      message: "A cancellation request for this order is already pending.",
    });
  }

  await prisma.cancellationRequest
    .create({
      data: {
        shop,
        orderId: order_id,
        orderName: order_name || order_id,
        customerEmail: email,
        reason: reason || "customer",
        notes: notes || null,
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
