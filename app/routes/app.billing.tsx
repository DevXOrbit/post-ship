/**
 * app/routes/app.billing.tsx
 *
 * Plans & Billing page — Phase 3: fully wired to Shopify Billing API.
 *
 * Loader:  reads current active subscription from Shopify + syncs plan in DB
 * Action:  creates a Shopify subscription and redirects merchant to approve it
 */
import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  HeadersFunction,
} from "react-router";
import { useLoaderData, useFetcher, redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  createSubscription,
  syncPlanFromSubscription,
  getActiveSubscription,
  type PlanId,
} from "../lib/billing.server";

// ── Plan display config ────────────────────────────────────────────────────
const PLAN_DISPLAY = [
  {
    id: "free" as PlanId,
    name: "Free",
    price: "$0",
    period: "/ month",
    description: "Get started with the essentials",
    features: [
      "Order tracking lookup",
      "Order details page",
      "Cancel order request",
      "Up to 50 orders / month",
    ],
    cta: "Current Plan",
    tone: undefined,
    highlight: false,
  },
  {
    id: "starter" as PlanId,
    name: "Starter",
    price: "$9",
    period: "/ month",
    description: "Grow customer loyalty post-purchase",
    trialNote: "7-day free trial",
    features: [
      "Everything in Free",
      "Return / exchange request form",
      "Automated tracking & delivery emails",
      "Post-delivery review requests",
      "Discount coupons after delivery",
      "Delivery feedback form",
      "Basic support ticket system",
      "WhatsApp contact button",
    ],
    cta: "Start Free Trial",
    tone: "success" as const,
    highlight: true,
  },
  {
    id: "pro" as PlanId,
    name: "Pro",
    price: "$19",
    period: "/ month",
    description: "Full post-purchase automation suite",
    trialNote: "7-day free trial",
    features: [
      "Everything in Starter",
      "Advanced analytics dashboard",
      "SMS / WhatsApp tracking notifications",
      "Web push notifications",
      "Priority support",
      "Unlimited orders",
    ],
    cta: "Start Free Trial",
    tone: undefined,
    highlight: false,
  },
];

// ── Loader ─────────────────────────────────────────────────────────────────
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  // Sync plan from Shopify (source of truth)
  const currentPlan = await syncPlanFromSubscription(admin, session.shop);
  const activeSub = await getActiveSubscription(admin);
  console.log(currentPlan);

  return {
    currentPlan,
    activeSub: activeSub
      ? {
          name: activeSub.name,
          status: activeSub.status,
          trialDays: activeSub.trialDays,
          currentPeriodEnd: activeSub.currentPeriodEnd,
        }
      : null,
  };
};

// ── Action ─────────────────────────────────────────────────────────────────
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const planId = formData.get("plan") as PlanId;

  if (!planId || planId === "free") {
    return { success: false, error: "Invalid plan selected." };
  }

  const appUrl = process.env.SHOPIFY_APP_URL ?? "";
  const result = await createSubscription(admin, session.shop, planId, appUrl);

  if ("error" in result) {
    return { success: false, error: result.error };
  }

  // Redirect to Shopify's payment confirmation page
  throw redirect(result.confirmationUrl);
};

// ── Component ──────────────────────────────────────────────────────────────
export default function BillingPage() {
  const { currentPlan, activeSub } = useLoaderData<typeof loader>() as {
    currentPlan: PlanId;
    activeSub: {
      name: string;
      status: string;
      trialDays: number;
      currentPeriodEnd: string | null;
    } | null;
  };

  const fetcher = useFetcher<{ success: boolean; error?: string }>();
  const isLoading = fetcher.state !== "idle";

  return (
    <s-page heading="Plans & Billing">
      {/* ── Error banner ───────────────────────────────────────────────── */}
      {fetcher.data?.error && (
        <s-banner tone="critical">{fetcher.data.error}</s-banner>
      )}

      {/* ── Active subscription info ───────────────────────────────────── */}
      {activeSub && (
        <s-section>
          <s-stack direction="inline" gap="base">
            <s-badge
              tone={activeSub.status === "ACTIVE" ? "success" : "warning"}
            >
              {activeSub.status === "ACTIVE" ? "Active" : activeSub.status}
            </s-badge>
            <s-text>{activeSub.name}</s-text>
            {activeSub.currentPeriodEnd && (
              <s-text tone="info">
                Next billing:{" "}
                {new Date(activeSub.currentPeriodEnd).toLocaleDateString()}
              </s-text>
            )}
            {activeSub.trialDays > 0 && activeSub.status === "ACTIVE" && (
              <s-badge tone="info">Trial active</s-badge>
            )}
          </s-stack>
        </s-section>
      )}

      {/* ── Plan cards ─────────────────────────────────────────────────── */}
      <s-section heading="Choose your plan">
        <s-grid gridTemplateColumns="repeat(12, 1fr)" gap="base">
          {PLAN_DISPLAY.map((plan) => {
            const isCurrent = plan.id === currentPlan;
            return (
              <s-grid-item key={plan.id} gridColumn="span 4">
                <s-box
                  padding="base"
                  borderWidth={plan.highlight ? "thick" : "base"}
                  borderRadius="base"
                  background={isCurrent ? "subdued" : "base"}
                >
                  <s-stack direction="block" gap="base">
                    {/* Plan header */}
                    <s-stack direction="inline" gap="small">
                      <s-heading>{plan.name}</s-heading>
                      {isCurrent && <s-badge tone="success">Current</s-badge>}
                      {plan.highlight && !isCurrent && (
                        <s-badge tone="info">Most Popular</s-badge>
                      )}
                    </s-stack>

                    {/* Price */}
                    <s-stack
                      direction="inline"
                      gap="extraSmall"
                      blockAlignment="center"
                    >
                      <s-heading>{plan.price}</s-heading>
                      <s-text tone="info">{plan.period}</s-text>
                    </s-stack>

                    {plan.trialNote && (
                      <s-badge tone="success">{plan.trialNote}</s-badge>
                    )}

                    <s-text tone="info">{plan.description}</s-text>
                    <s-divider />

                    {/* Features */}
                    <s-unordered-list>
                      {plan.features.map((f) => (
                        <s-list-item key={f}>
                          <s-stack direction="inline" gap="small">
                            <s-icon type="check-circle" />
                            <s-text>{f}</s-text>
                          </s-stack>
                        </s-list-item>
                      ))}
                    </s-unordered-list>

                    {/* CTA */}
                    {isCurrent ? (
                      <s-button disabled>Current Plan</s-button>
                    ) : plan.id === "free" ? (
                      <s-text tone="info">Your default plan</s-text>
                    ) : (
                      <fetcher.Form method="post">
                        <input type="hidden" name="plan" value={plan.id} />
                        <s-button
                          type="submit"
                          tone={plan.tone}
                          {...(isLoading ? { loading: true } : {})}
                        >
                          {plan.cta}
                        </s-button>
                      </fetcher.Form>
                    )}
                  </s-stack>
                </s-box>
              </s-grid-item>
            );
          })}
        </s-grid>
      </s-section>

      {/* ── FAQ ────────────────────────────────────────────────────────────── */}
      <s-section heading="Billing FAQ">
        <s-stack direction="block" gap="base">
          <s-stack direction="block" gap="small">
            <s-text type="strong">How does the free trial work?</s-text>
            <s-paragraph>
              Paid plans include a 7-day free trial. You won't be charged until
              the trial ends. Cancel anytime before the trial ends to avoid
              charges.
            </s-paragraph>
          </s-stack>
          <s-stack direction="block" gap="small">
            <s-text type="strong">When am I charged?</s-text>
            <s-paragraph>
              Charges are billed through Shopify on a 30-day cycle and appear on
              your Shopify invoice. You can review charges in your Shopify Admin
              under Settings → Billing.
            </s-paragraph>
          </s-stack>
          <s-stack direction="block" gap="small">
            <s-text type="strong">Can I downgrade or cancel?</s-text>
            <s-paragraph>
              Yes — you can downgrade or cancel your subscription at any time
              from your Shopify Admin. Features above your plan tier will be
              disabled immediately on downgrade.
            </s-paragraph>
          </s-stack>
          <s-stack direction="block" gap="small">
            <s-text type="strong">Are charges in USD?</s-text>
            <s-paragraph>
              Yes. Shopify converts to your local currency at checkout. The
              prices shown are in USD.
            </s-paragraph>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
