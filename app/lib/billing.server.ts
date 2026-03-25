/**
 * app/lib/billing.server.ts
 *
 * Shopify Billing API helpers for PostShip.
 *
 * Flow:
 *  1. Merchant clicks "Upgrade" on /app/billing
 *  2. createSubscription() creates a Shopify RecurringApplicationCharge
 *     and returns a confirmationUrl
 *  3. Merchant is redirected to Shopify to approve the charge
 *  4. Shopify redirects to /app/billing/callback?charge_id=xxx
 *  5. activateSubscription() activates the charge and writes plan to DB
 *  6. app_subscriptions/update webhook fires on any subscription change
 *     (cancel, downgrade, trial end) → syncPlanFromSubscription() updates DB
 *
 * Docs: https://shopify.dev/docs/apps/billing/subscriptions/create-recurring
 */
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { upsertSettings } from "./settings.server";

// ── Plan definitions ───────────────────────────────────────────────────────

export const PLANS = {
  free: {
    id: "free",
    name: "Free",
    price: "0.00",
    trialDays: 0,
  },
  starter: {
    id: "starter",
    name: "PostShip Starter",
    price: "9.00",
    trialDays: 7,
  },
  pro: {
    id: "pro",
    name: "PostShip Pro",
    price: "19.00",
    trialDays: 7,
  },
} as const;

export type PlanId = keyof typeof PLANS;

// ── GQL types ──────────────────────────────────────────────────────────────

interface AppSubscription {
  id: string;
  name: string;
  status: string; // ACTIVE | PENDING | DECLINED | EXPIRED | FROZEN | CANCELLED
  trialDays: number;
  currentPeriodEnd: string | null;
  lineItems: Array<{
    plan: {
      pricingDetails: {
        price?: { amount: string; currencyCode: string };
      };
    };
  }>;
}

// ── Create subscription ────────────────────────────────────────────────────

/**
 * Creates a Shopify recurring subscription and returns the confirmation URL.
 * The merchant must visit this URL to approve the charge.
 */
export async function createSubscription(
  admin: AdminApiContext["admin"],
  shop: string,
  planId: PlanId,
  appUrl: string,
): Promise<
  { confirmationUrl: string; subscriptionId: string } | { error: string }
> {
  const plan = PLANS[planId];
  if (!plan || planId === "free") {
    return { error: "Invalid plan." };
  }

  const returnUrl = `${appUrl}/app/billing/callback?plan=${planId}&shop=${shop}`;

  const response = await admin.graphql(
    `#graphql
    mutation createAppSubscription($name: String!, $lineItems: [AppSubscriptionLineItemInput!]!, $returnUrl: URL!, $trialDays: Int, $test: Boolean) {
      appSubscriptionCreate(
        name: $name
        lineItems: $lineItems
        returnUrl: $returnUrl
        trialDays: $trialDays
        test: $test
      ) {
        appSubscription {
          id
          status
        }
        confirmationUrl
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        name: plan.name,
        returnUrl,
        trialDays: plan.trialDays,
        // Use test: true in development to avoid real charges
        test: process.env.NODE_ENV !== "production",
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: { amount: plan.price, currencyCode: "USD" },
                interval: "EVERY_30_DAYS",
              },
            },
          },
        ],
      },
    },
  );

  const json = await response.json();
  const result = json.data?.appSubscriptionCreate;

  if (result?.userErrors?.length > 0) {
    return { error: result.userErrors[0].message };
  }

  if (!result?.confirmationUrl) {
    return {
      error: "Failed to create subscription — no confirmation URL returned.",
    };
  }

  return {
    confirmationUrl: result.confirmationUrl,
    subscriptionId: result.appSubscription.id,
  };
}

// ── Get active subscription ────────────────────────────────────────────────

/**
 * Returns the merchant's current active subscription, or null if on free plan.
 */
export async function getActiveSubscription(
  admin: AdminApiContext["admin"],
): Promise<AppSubscription | null> {
  const response = await admin.graphql(
    `#graphql
    query getActiveSubscription {
      currentAppInstallation {
        activeSubscriptions {
          id
          name
          status
          trialDays
          currentPeriodEnd
          lineItems {
            plan {
              pricingDetails {
                ... on AppRecurringPricing {
                  price { amount currencyCode }
                }
              }
            }
          }
        }
      }
    }`,
  );

  const json = await response.json();
  const subs: AppSubscription[] =
    json.data?.currentAppInstallation?.activeSubscriptions ?? [];

  return (
    subs.find((s) => s.status === "ACTIVE" || s.status === "PENDING") ?? null
  );
}

// ── Resolve plan from subscription name ───────────────────────────────────

export function planIdFromSubscriptionName(name: string): PlanId {
  const lower = name.toLowerCase();
  if (lower.includes("pro")) return "pro";
  if (lower.includes("starter")) return "starter";
  return "free";
}

// ── Activate subscription after merchant approval ─────────────────────────

/**
 * Called from /app/billing/callback after Shopify redirects back.
 * Activates the approved charge and writes the plan to DB.
 */
export async function activatePlan(
  shop: string,
  planId: PlanId,
): Promise<void> {
  await upsertSettings(shop, { plan: planId });
}

// ── Sync plan from subscription (used in webhook + loader) ────────────────

/**
 * Reads the active Shopify subscription and syncs the plan field in DB.
 * Call this from the billing loader to ensure DB is always in sync.
 */
export async function syncPlanFromSubscription(
  admin: AdminApiContext["admin"],
  shop: string,
): Promise<PlanId> {
  const sub = await getActiveSubscription(admin);

  if (!sub || sub.status !== "ACTIVE") {
    // No active subscription — downgrade to free
    await upsertSettings(shop, { plan: "free" });
    return "free";
  }

  const planId = planIdFromSubscriptionName(sub.name);
  await upsertSettings(shop, { plan: planId });
  return planId;
}
