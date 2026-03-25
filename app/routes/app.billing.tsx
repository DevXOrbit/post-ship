import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  HeadersFunction,
} from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  // In Phase 3, check Shopify Billing API for active subscription
  return { currentPlan: "free" };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const plan = formData.get("plan") as string;

  // Phase 3: Shopify Billing API integration
  // For now just return a message
  const priceMap: Record<string, string> = {
    starter: "9.00",
    pro: "19.00",
  };
  const price = priceMap[plan] ?? "0.00";

  // TODO: Phase 3 - create Shopify recurring charge
  // const response = await admin.graphql(`mutation { ... }`);

  return {
    success: false,
    message: `Billing integration coming in Phase 3. ${plan} plan ($${price}/mo) will be available soon.`,
    redirectUrl: null,
  };
};

const PLANS = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "/ month",
    description: "Get started with the essentials",
    features: [
      "Order tracking lookup",
      "Order details page",
      "Cancel order request",
      "Basic support",
    ],
    cta: "Current Plan",
    disabled: true,
    tone: undefined,
  },
  {
    id: "starter",
    name: "Starter",
    price: "$9",
    period: "/ month",
    description: "Grow customer loyalty post-purchase",
    features: [
      "Everything in Free",
      "Return / exchange request form",
      "Automated review requests",
      "Delivery feedback form",
      "Post-delivery coupon codes",
      "Basic ticket system",
      "WhatsApp contact button",
    ],
    cta: "Upgrade to Starter",
    disabled: false,
    tone: "success" as const,
  },
  {
    id: "pro",
    name: "Pro",
    price: "$19",
    period: "/ month",
    description: "Full post-purchase automation suite",
    features: [
      "Everything in Starter",
      "SMS / WhatsApp tracking notifications",
      "Web push notifications",
      "Advanced dashboard analytics",
      "Priority support",
    ],
    cta: "Upgrade to Pro",
    disabled: false,
    tone: undefined,
  },
];

export default function BillingPage() {
  const { currentPlan } = useLoaderData<typeof loader>() as {
    currentPlan: string;
  };
  const fetcher = useFetcher<{ success: boolean; message: string }>();

  return (
    <s-page heading="Plans & Billing">
      {fetcher.data?.message && (
        <s-banner tone={fetcher.data.success ? "success" : "info"}>
          {fetcher.data.message}
        </s-banner>
      )}
      <s-stack gap="base">
        <s-section heading="Choose your plan">
          <s-grid gridTemplateColumns="repeat(12, 1fr)" gap="base">
            {PLANS.map((plan) => (
              <s-grid-item key={plan.id} gridColumn="span 4" gridRow="span 1">
                <s-box
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background={plan.id === currentPlan ? "subdued" : "base"}
                >
                  <s-stack direction="block" gap="base">
                    <s-stack direction="inline" gap="small">
                      <s-heading>{plan.name}</s-heading>
                      {plan.id === currentPlan && (
                        <s-badge tone="success" icon="check-circle">
                          Current
                        </s-badge>
                      )}
                    </s-stack>

                    <s-stack direction="inline" gap="none">
                      <s-heading>{plan.price}</s-heading>
                      <s-text tone="info">{plan.period}</s-text>
                    </s-stack>

                    <s-text tone="info">{plan.description}</s-text>

                    <s-divider />

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

                    {!plan.disabled && plan.id !== currentPlan && (
                      <fetcher.Form method="post">
                        <input type="hidden" name="plan" value={plan.id} />
                        <s-button
                          type="submit"
                          tone={plan.tone}
                          {...(fetcher.state !== "idle"
                            ? { loading: true }
                            : {})}
                        >
                          {plan.cta}
                        </s-button>
                      </fetcher.Form>
                    )}

                    {plan.id === currentPlan && (
                      <s-button disabled>{plan.cta}</s-button>
                    )}
                  </s-stack>
                </s-box>
              </s-grid-item>
            ))}
          </s-grid>
        </s-section>

        <s-section heading="Billing FAQ">
          <s-stack direction="block" gap="base">
            <s-stack direction="block" gap="small">
              <s-text fontWeight="semibold">When am I charged?</s-text>
              <s-paragraph>
                Charges are billed through Shopify monthly. You can cancel
                anytime.
              </s-paragraph>
            </s-stack>
            <s-stack direction="block" gap="small">
              <s-text fontWeight="semibold">Can I downgrade?</s-text>
              <s-paragraph>
                Yes — you can downgrade at any time. Features above your plan
                tier will be disabled.
              </s-paragraph>
            </s-stack>
            <s-stack direction="block" gap="small">
              <s-text fontWeight="semibold">Free trial?</s-text>
              <s-paragraph>
                Paid plans include a 7-day free trial. No credit card required
                to start on the Free plan.
              </s-paragraph>
            </s-stack>
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
