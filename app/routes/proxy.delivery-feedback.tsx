/**
 * app/routes/proxy.delivery-feedback.tsx
 *
 * App Proxy: POST /apps/postship/delivery-feedback
 *
 * Receives 1–5 star rating + optional comment from the theme extension.
 * Requires Starter plan. One entry per order (duplicate guard).
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import { getSettings } from "../lib/settings.server";

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

  let shop: string;
  try {
    await unauthenticated.admin(request);
    shop = new URL(request.url).searchParams.get("shop") ?? "";
    if (!shop) throw new Error("missing shop");
  } catch {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  const settings = await getSettings(shop);
  if (settings.plan === "free") {
    return jsonResponse(
      { error: "Delivery feedback requires a Starter plan or above." },
      403,
    );
  }

  let body: {
    order_id?: string;
    order_name?: string;
    email?: string;
    rating?: number;
    comment?: string;
  };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request." }, 400);
  }

  const { order_id, order_name, email, rating, comment } = body;

  if (!order_id || !email || !rating) {
    return jsonResponse({ error: "Missing required fields." }, 400);
  }

  if (typeof rating !== "number" || rating < 1 || rating > 5) {
    return jsonResponse({ error: "Rating must be between 1 and 5." }, 400);
  }

  // One feedback per order
  const existing = await prisma.deliveryFeedback
    .findFirst({ where: { shop, orderId: order_id } })
    .catch(() => null);

  if (existing) {
    return jsonResponse({
      message: "Thank you! We already have your feedback for this order.",
    });
  }

  await prisma.deliveryFeedback
    .create({
      data: {
        shop,
        orderId: order_id,
        orderName: order_name || order_id,
        customerEmail: email,
        rating,
        comment: comment || "",
      },
    })
    .catch((err: Error) => {
      console.error("[PostShip] Failed to save delivery feedback:", err);
    });

  return jsonResponse({
    message: "Thank you for your feedback! We really appreciate it.",
  });
};
