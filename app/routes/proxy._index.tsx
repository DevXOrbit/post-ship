/**
 * App Proxy entry point.
 *
 * React Router flat-file routing maps:
 *   /proxy                  → proxy._index.tsx   (this file)
 *   /proxy/order-lookup     → proxy.order-lookup.tsx
 *   /proxy/cancel-request   → proxy.cancel-request.tsx
 *   /proxy/return-request   → proxy.return-request.tsx
 *   /proxy/support-ticket   → proxy.support-ticket.tsx
 *
 * The Shopify App Proxy forwards {shop}/apps/postship/* → {appUrl}/proxy/*
 * and appends ?shop=... + HMAC params. The `unauthenticated.admin()` helper
 * verifies those automatically.
 *
 * This root file just serves a health-check and CORS preflight for the prefix.
 */
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // CORS preflight
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

  return new Response(
    JSON.stringify({ status: "PostShip Proxy OK", version: "1.0.0" }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
};
