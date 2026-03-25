/**
 * App Proxy: GET /apps/postship/config
 *
 * Called by the theme extension JS on page load (before showing tabs).
 * Returns the merchant's active plan features so the storefront can
 * show/hide Cancel, Returns, and Get Help tabs accordingly.
 *
 * ── Plan → feature matrix ────────────────────────────────────────────────
 *   free     → cancel only
 *   starter  → cancel + returns + support
 *   pro      → cancel + returns + support (+ notifications, handled server-side)
 *
 * ── Why proxy, not block settings? ──────────────────────────────────────
 * Block settings are set once at theme customization time by the merchant.
 * The plan can change at any time (upgrade / downgrade / cancel).
 * Fetching from the proxy means the feature gate is always live and cannot
 * be bypassed by a merchant who was on Starter but downgraded to Free.
 */
import type { LoaderFunctionArgs } from "react-router";
import { unauthenticated } from "../shopify.server";
import prisma from "../db.server";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      // Cache for 5 minutes — plan changes are not instant anyway
      "Cache-Control": "public, max-age=300",
    },
  });
}

/** Map a plan string to the set of features enabled on the storefront */
function planFeatures(plan: string) {
  switch (plan) {
    case "pro":
      return {
        cancel: true,
        returns: true,
        support: true,
      };
    case "starter":
      return {
        cancel: true,
        returns: true,
        support: true,
      };
    case "free":
    default:
      return {
        cancel: true,
        returns: false,
        support: false,
      };
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

  // Verify the proxy HMAC signature
  let shop: string;
  try {
    await unauthenticated.admin(request);
    shop = new URL(request.url).searchParams.get("shop") ?? "";
    if (!shop) throw new Error("missing shop");
  } catch {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  // Load the merchant's plan from DB
  const settings = await prisma.appSettings
    .findUnique({ where: { shop } })
    .catch(() => null);

  const plan = settings?.plan ?? "free";
  const features = planFeatures(plan);

  return jsonResponse({
    plan,
    features,
    // Pass cancellation window so JS doesn't need to rely on block settings alone
    cancelWindowHours: settings?.cancellationWindowHours ?? 2,
    whatsappNumber: settings?.whatsappNumber ?? "",
    brandColor: settings?.brandColor ?? "#5c6ac4",
  });
};
