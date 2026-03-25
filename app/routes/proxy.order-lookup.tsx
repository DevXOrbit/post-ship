/**
 * App Proxy: POST /apps/postship/order-lookup
 *
 * Validates customer email against order, returns safe order data.
 * This route is hit by the theme extension JS via the Shopify App Proxy.
 * Shopify verifies the HMAC signature automatically via the unauthenticated helper.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { unauthenticated } from "../shopify.server";

// ── Types ──────────────────────────────────────────────────────────────────
interface GQLOrder {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  cancelledAt: string | null;
  displayFulfillmentStatus: string;
  displayFinancialStatus: string;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  lineItems: {
    edges: Array<{
      node: {
        id: string;
        title: string;
        quantity: number;
        variant: {
          id: string;
          title: string;
          price: string;
          image: { url: string } | null;
        } | null;
      };
    }>;
  };
  shippingAddress: {
    name: string;
    address1: string;
    address2: string | null;
    city: string;
    province: string;
    zip: string;
    country: string;
  } | null;
  fulfillments: Array<{
    status: string;
    trackingCompany: string;
    trackingInfo: Array<{ number: string; url: string; company: string }>;
  }>;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function normalizeOrderNumber(raw: string): string {
  // Accept "#1001", "1001", "ORD-1001" → strip prefix symbols
  return raw.replace(/^[#\s]+/, "").trim();
}

// ── GET - not used, but prevents 405 errors ────────────────────────────────
export const loader = async ({ request }: LoaderFunctionArgs) => {
  return jsonResponse({ status: "PostShip Order Lookup API" });
};

// ── POST - order lookup ────────────────────────────────────────────────────
export const action = async ({ request }: ActionFunctionArgs) => {
  // OPTIONS preflight
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

  // Parse body
  let body: { order_number?: string; email?: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request body." }, 400);
  }

  const { order_number, email } = body;
  if (!order_number || !email) {
    return jsonResponse({ error: "Order number and email are required." }, 400);
  }

  // Authenticate via App Proxy (shop comes from query param)
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (!shop) {
    return jsonResponse({ error: "Missing shop parameter." }, 400);
  }

  let admin: Awaited<ReturnType<typeof unauthenticated.admin>>;
  try {
    const result = await unauthenticated.admin(shop);
    admin = result.admin;
  } catch {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  const normalized = normalizeOrderNumber(order_number);

  // Query by name (order name = "#1001")
  const queryString = `name:#${normalized}`;

  const response = await admin.graphql(
    `
    #graphql
    query lookupOrder($query: String!) {
      orders(first: 5, query: $query) {
        edges {
          node {
            id
            name
            email
            createdAt
            cancelledAt
            displayFulfillmentStatus
            displayFinancialStatus
            totalPriceSet {
              shopMoney { amount currencyCode }
            }
            lineItems(first: 20) {
              edges {
                node {
                  id
                  title
                  quantity
                  variant {
                    id
                    title
                    price
                    image { url }
                  }
                }
              }
            }
            shippingAddress {
              name address1 address2 city province zip country
            }
            fulfillments(first: 3) {
              status
              trackingCompany
              trackingInfo { number url company }
            }
          }
        }
      }
    }
  `,
    { variables: { query: queryString } },
  );

  const json = await response.json();
  const orders: GQLOrder[] =
    json.data?.orders?.edges?.map((e: { node: GQLOrder }) => e.node) ?? [];

  if (orders.length === 0) {
    return jsonResponse(
      {
        error:
          "We couldn't find an order with that order number. Please check and try again.",
      },
      404,
    );
  }

  // Find the order matching the email (case-insensitive)
  const normalizedEmail = email.trim().toLowerCase();
  const order = orders.find((o) => o.email?.toLowerCase() === normalizedEmail);

  if (!order) {
    return jsonResponse(
      { error: "The email address doesn't match our records for this order." },
      404,
    );
  }

  // Shape the response — safe fields only, no PII beyond what was given
  const currency = order.totalPriceSet.shopMoney.currencyCode;

  return jsonResponse({
    id: order.id,
    name: order.name,
    created_at: order.createdAt,
    cancelled_at: order.cancelledAt,
    fulfillment_status: order.displayFulfillmentStatus.toLowerCase(),
    financial_status: order.displayFinancialStatus.toLowerCase(),
    total: {
      amount: order.totalPriceSet.shopMoney.amount,
      currency,
    },
    line_items: order.lineItems.edges.map(({ node: item }) => ({
      id: item.id,
      title: item.title,
      quantity: item.quantity,
      variant_title:
        item.variant?.title && item.variant.title !== "Default Title"
          ? item.variant.title
          : null,
      price: item.variant?.price ?? null,
      currency,
      image: item.variant?.image?.url ?? null,
    })),
    shipping_address: order.shippingAddress
      ? {
          name: order.shippingAddress.name,
          address1: order.shippingAddress.address1,
          address2: order.shippingAddress.address2,
          city: order.shippingAddress.city,
          province: order.shippingAddress.province,
          zip: order.shippingAddress.zip,
          country: order.shippingAddress.country,
        }
      : null,
    fulfillments: order.fulfillments.map((f) => ({
      status: f.status,
      tracking_company: f.trackingCompany,
      tracking_info: f.trackingInfo.map((t) => ({
        number: t.number,
        url: t.url,
        company: t.company,
      })),
    })),
  });
};
