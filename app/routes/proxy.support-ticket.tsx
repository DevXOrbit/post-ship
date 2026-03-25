/**
 * App Proxy: POST /apps/postship/support-ticket
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
    issue_type?: string;
    description?: string;
  };

  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request." }, 400);
  }

  const { order_id, order_name, email, issue_type, description } = body;
  if (!order_id || !email || !description) {
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

  await prisma.supportTicket
    .create({
      data: {
        shop,
        orderId: order_id,
        orderName: order_name || order_id,
        customerEmail: email,
        issueType: issue_type || "other",
        description,
        status: "open",
      },
    })
    .catch((err: Error) => {
      console.error("Failed to save support ticket:", err);
    });

  return jsonResponse({
    message:
      "Your support ticket has been created. Our team will get back to you within 24 hours.",
  });
};
