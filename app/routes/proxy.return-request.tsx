/**
 * App Proxy: POST /apps/Afyro/return-request
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
    return_type?: string;
    items?: Array<{ id: string; title: string }>;
    reason?: string;
    notes?: string;
  };

  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request." }, 400);
  }

  const { order_id, order_name, email, return_type, items, reason, notes } =
    body;
  if (!order_id || !email || !items?.length) {
    return jsonResponse({ error: "Missing required fields." }, 400);
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (!shop) return jsonResponse({ error: "Missing shop." }, 400);

  try {
    await unauthenticated.admin(shop);
  } catch {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  // Check existing open request
  const existing = await prisma.returnRequest
    .findFirst({
      where: { shop, orderId: order_id, status: "pending" },
    })
    .catch(() => null);

  if (existing) {
    return jsonResponse({
      message: "A return request for this order is already pending.",
    });
  }

  await prisma.returnRequest
    .create({
      data: {
        shop,
        orderId: order_id,
        orderName: order_name || order_id,
        customerEmail: email,
        type: return_type || "return",
        items: JSON.stringify(items),
        reason: reason || "other",
        notes: notes || "",
        status: "pending",
      },
    })
    .catch((err: Error) => {
      console.error("Failed to save return request:", err);
    });

  const label = return_type === "exchange" ? "exchange" : "return";
  return jsonResponse({
    message: `Your ${label} request has been submitted! We'll review it and get back to you within 1–2 business days.`,
  });
};
