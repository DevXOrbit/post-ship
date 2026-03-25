/**
 * App Proxy: POST /apps/postship/order-lookup
 *
 * Validates customer email against order, returns safe order data.
 *
 * ── GraphQL corrections (per https://shopify.dev/docs/api/admin-graphql/latest/queries/orders) ──
 *
 * 1. lineItems: use `name` not `title` — `name` includes variant (e.g. "Blue T-Shirt - Large")
 * 2. lineItems: use `originalUnitPriceSet` for price, NOT `variant.price`
 * 3. lineItems: image is `image { url }` directly on the lineItem node, NOT via variant
 * 4. fulfillments: plain ARRAY — no `(first: N)` argument (it's not a connection)
 * 5. shippingAddress: `province` doesn't exist — correct field is `provinceCode`
 * 6. displayFinancialStatus / displayFulfillmentStatus return UPPERCASE enums
 *    → normalize to lowercase in the response shape for the JS statusClass() map
 * 7. Auth: unauthenticated.admin(request) — full Request for HMAC verification
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { unauthenticated } from "../shopify.server";

// ── Types ──────────────────────────────────────────────────────────────────
interface GQLLineItem {
  id: string;
  name: string;
  quantity: number;
  sku: string | null;
  image: { url: string } | null;
  originalUnitPriceSet: {
    shopMoney: { amount: string; currencyCode: string };
  };
  variant: {
    id: string;
    title: string;
  } | null;
}

interface GQLFulfillment {
  status: string;
  trackingCompany: string | null;
  trackingInfo: Array<{
    number: string | null;
    url: string | null;
    company: string | null;
  }>;
}

interface GQLOrder {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  cancelledAt: string | null;
  displayFulfillmentStatus: string;
  displayFinancialStatus: string;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  subtotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  shippingAddress: {
    name: string;
    address1: string;
    address2: string | null;
    city: string;
    provinceCode: string;
    zip: string;
    country: string;
  } | null;
  lineItems: { edges: Array<{ node: GQLLineItem }> };
  fulfillments: GQLFulfillment[]; // plain array, NOT a paginated connection
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
  return raw.replace(/^[#\s]+/, "").trim();
}

// ── GET – health / CORS preflight ──────────────────────────────────────────
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }
  return jsonResponse({ status: "PostShip Order Lookup API" });
};

// ── POST – order lookup ────────────────────────────────────────────────────
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
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (!shop) {
    return jsonResponse({ error: "Missing shop parameter." }, 400);
  }
  // Auth: pass full request so Shopify can verify the proxy HMAC signature
  let admin: Awaited<ReturnType<typeof unauthenticated.admin>>["admin"];
  try {
    const result = await unauthenticated.admin(shop);
    admin = result.admin;
  } catch {
    return jsonResponse(
      { error: "Unauthorized — invalid proxy signature." },
      401,
    );
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

  const normalized = normalizeOrderNumber(order_number);

  // ── Corrected GraphQL query ────────────────────────────────────────────────
  const response = await admin.graphql(
    `#graphql
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
              shopMoney {
                amount
                currencyCode
              }
            }
            subtotalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            shippingAddress {
              name
              address1
              address2
              city
              provinceCode
              zip
              country
            }
            lineItems(first: 20) {
              edges {
                node {
                  id
                  name
                  quantity
                  sku
                  image {
                    url
                  }
                  originalUnitPriceSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                  }
                  variant {
                    id
                    title
                  }
                }
              }
            }
            fulfillments {
              status              
              trackingInfo (first:5) {
                number
                url
                company
              }
            }
          }
        }
      }
    }`,
    { variables: { query: `name:#${normalized}` } },
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

  // Match by email (case-insensitive)
  const normalizedEmail = email.trim().toLowerCase();
  const order = orders.find((o) => o.email?.toLowerCase() === normalizedEmail);

  if (!order) {
    return jsonResponse(
      { error: "The email address doesn't match our records for this order." },
      404,
    );
  }

  // ── Shape response for frontend ────────────────────────────────────────────
  // Shopify returns UPPERCASE enums ("PAID", "UNFULFILLED") — normalize to lowercase
  const currency = order.totalPriceSet.shopMoney.currencyCode;

  return jsonResponse({
    id: order.id,
    name: order.name,
    created_at: order.createdAt,
    cancelled_at: order.cancelledAt,
    fulfillment_status: order.displayFulfillmentStatus.toLowerCase(),
    financial_status: order.displayFinancialStatus.toLowerCase(),
    total_price: order.totalPriceSet.shopMoney.amount,
    subtotal_price: order.subtotalPriceSet.shopMoney.amount,
    currency,
    line_items: order.lineItems.edges.map(({ node }) => ({
      id: node.id,
      title: node.name, // name includes variant e.g. "Hoodie - L / Blue"
      quantity: node.quantity,
      sku: node.sku ?? null,
      variant_title: node.variant?.title ?? null,
      variant_id: node.variant?.id ?? null,
      price: node.originalUnitPriceSet.shopMoney.amount,
      image: node.image?.url ?? null,
    })),
    shipping_address: order.shippingAddress
      ? {
          name: order.shippingAddress.name,
          address1: order.shippingAddress.address1,
          address2: order.shippingAddress.address2 ?? null,
          city: order.shippingAddress.city,
          province: order.shippingAddress.provinceCode,
          zip: order.shippingAddress.zip,
          country: order.shippingAddress.country,
        }
      : null,
    fulfillments: order.fulfillments.map((f) => ({
      status: f.status.toLowerCase(),
      tracking_company: f.trackingCompany ?? null,
      tracking_info: f.trackingInfo.map((t) => ({
        number: t.number ?? null,
        url: t.url ?? null,
        company: t.company ?? null,
      })),
    })),
  });
};
