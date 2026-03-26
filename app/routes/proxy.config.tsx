/**
 * app/routes/proxy.config.tsx
 *
 * App Proxy: GET /apps/postship/config
 * Returns live plan feature flags to the storefront JS.
 *
 * Updated in Phase 2b: added `feedback` feature flag.
 */
import type { LoaderFunctionArgs } from "react-router";
import { unauthenticated } from "../shopify.server";
import { getSettings } from "../lib/settings.server";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
    },
  });
}

function planFeatures(plan: string) {
  switch (plan) {
    case "pro":
    case "starter":
      return { cancel: true, returns: true, support: true, feedback: true };
    case "free":
    default:
      return { cancel: true, returns: false, support: false, feedback: false };
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  let shop: string;
  try {
    shop = new URL(request.url).searchParams.get("shop") ?? "";
    await unauthenticated.admin(shop);
    if (!shop) throw new Error("missing shop");
  } catch {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  const settings = await getSettings(shop);

  return jsonResponse({
    plan: settings.plan,
    features: planFeatures(settings.plan),
    cancelWindowHours: settings.cancellationWindowHours,
    whatsappNumber: settings.whatsappNumber,
    brandColor: settings.brandColor,
  });
};
