/**
 * app/routes/app.billing.callback.tsx
 *
 * Shopify redirects here after the merchant approves (or declines) a subscription.
 *
 * URL: /app/billing/callback?plan=starter&shop=mystore.myshopify.com&charge_id=xxx
 *
 * Flow:
 *  1. Authenticate the request
 *  2. Verify the subscription is now ACTIVE via getActiveSubscription()
 *  3. Write the plan to AppSettings
 *  4. Redirect to /app/billing with a success message
 *
 * If the merchant declined, charge_id may be absent or the subscription
 * won't be ACTIVE — we redirect back to billing with an info message.
 */
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getActiveSubscription,
  planIdFromSubscriptionName,
  type PlanId,
} from "../lib/billing.server";
import { upsertSettings } from "../lib/settings.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const planParam = url.searchParams.get("plan") as PlanId | null;

  // Re-authenticate with admin to check subscription status
  const { admin } = await authenticate.admin(request);
  const activeSub = await getActiveSubscription(admin);

  if (
    !activeSub ||
    (activeSub.status !== "ACTIVE" && activeSub.status !== "PENDING")
  ) {
    // Merchant declined or something went wrong
    throw redirect("/app/billing?status=declined");
  }

  // Derive the plan from the subscription name (more reliable than the URL param)
  const planId: PlanId =
    planIdFromSubscriptionName(activeSub.name) ?? planParam ?? "free";

  // Activate the plan in DB
  await upsertSettings(session.shop, { plan: planId });

  throw redirect(`/app/billing?status=activated&plan=${planId}`);
};
