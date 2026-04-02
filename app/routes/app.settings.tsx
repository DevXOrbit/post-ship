/**
 * app/routes/app.settings.tsx
 *
 * Afyro Settings — fully wired to the DB via getSettings / upsertSettings.
 * All Phase 2 fields are live: Resend API key, from email, coupon config,
 * review delay, brand color, WhatsApp number.
 */
import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  HeadersFunction,
} from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  getSettings,
  upsertSettings,
  type AppSettingsData,
} from "../lib/settings.server";

// ── Loader ─────────────────────────────────────────────────────────────────
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const [shopResponse, settings] = await Promise.all([
    admin.graphql(`#graphql
      query getShop {
        shop { name email primaryDomain { url } }
      }
    `),
    getSettings(session.shop),
  ]);

  const shopJson = await shopResponse.json();
  const shopInfo = shopJson.data?.shop ?? null;

  // Use shop name as senderName default if not yet set
  if (!settings.senderName && shopInfo?.name) {
    settings.senderName = shopInfo.name;
  }
  if (!settings.fromEmail && shopInfo?.email) {
    settings.fromEmail = shopInfo.email;
  }

  return { settings, shopInfo, shopDomain: session.shop };
};

// ── Action ─────────────────────────────────────────────────────────────────
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const data: Partial<AppSettingsData> = {
    senderName: (formData.get("senderName") as string) || "",
    fromEmail: (formData.get("fromEmail") as string) || "",
    resendApiKey: (formData.get("resendApiKey") as string) || "",
    brandColor: (formData.get("brandColor") as string) || "#5c6ac4",
    cancellationWindowHours:
      parseInt(formData.get("cancellationWindowHours") as string) || 2,
    whatsappNumber: (formData.get("whatsappNumber") as string) || "",
    enableTrackingEmails: formData.get("enableTrackingEmails") === "true",
    enableReviewEmails: formData.get("enableReviewEmails") === "true",
    reviewRequestDelayDays:
      parseInt(formData.get("reviewRequestDelayDays") as string) || 7,
    enableCoupon: formData.get("enableCoupon") === "true",
    couponCode: (formData.get("couponCode") as string) || "",
    couponDiscountPercent:
      parseInt(formData.get("couponDiscountPercent") as string) || 10,
    couponExpiryDays:
      parseInt(formData.get("couponExpiryDays") as string) || 30,
  };

  await upsertSettings(session.shop, data);

  return { success: true, settings: await getSettings(session.shop) };
};

// ── Component ──────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { settings, shopInfo, shopDomain } = useLoaderData<typeof loader>() as {
    settings: AppSettingsData;
    shopInfo: {
      name: string;
      email: string;
      primaryDomain: { url: string };
    } | null;
    shopDomain: string;
  };

  const fetcher = useFetcher<{ success: boolean; settings: AppSettingsData }>();
  const isSubmitting = fetcher.state !== "idle";
  const saved = fetcher.data?.success;
  const current: AppSettingsData = fetcher.data?.settings ?? settings;

  return (
    <s-page heading="Afyro Settings">
      {saved && (
        <s-banner tone="success">Settings saved successfully!</s-banner>
      )}

      <fetcher.Form method="post">
        <s-stack gap="base">
          {/* ── Order Management ─────────────────────────────────────────── */}
          <s-section heading="Order Management">
            <s-stack direction="block" gap="base">
              <s-number-field
                name="cancellationWindowHours"
                label="Cancellation window (hours)"
                details="How long after placing an order a customer can request cancellation. Set 0 to disable."
                value={String(current.cancellationWindowHours)}
                min={0}
                max={72}
              />
            </s-stack>
          </s-section>

          {/* ── Branding ─────────────────────────────────────────────────── */}
          <s-section heading="Branding">
            <s-stack direction="block" gap="base">
              <s-color-field
                name="brandColor"
                label="Brand color"
                details="Used as the accent color in customer-facing emails and the tracking widget."
                value={current.brandColor}
              />
            </s-stack>
          </s-section>

          {/* ── Email ────────────────────────────────────────────────────── */}
          <s-section heading="Email Notifications">
            <s-stack direction="block" gap="base">
              <s-text-field
                name="senderName"
                label="Sender name"
                details="Displayed as the 'From' name in emails sent to customers."
                value={current.senderName}
                placeholder={shopInfo?.name ?? "Your Store"}
              />

              <s-text-field
                name="fromEmail"
                label="From email address"
                details="The reply-to address for customer emails. Must be verified in Resend."
                value={current.fromEmail}
                placeholder={shopInfo?.email ?? "orders@yourstore.com"}
              />

              <s-text-field
                name="resendApiKey"
                label="Resend API key"
                details="Get your API key at resend.com. Starts with re_. Required to send emails."
                value={current.resendApiKey}
                placeholder="re_xxxxxxxxxxxxxxxxxxxx"
              />

              <s-divider />

              <s-switch
                name="enableTrackingEmails"
                label="Send tracking update emails"
                details="Notify customers automatically when their order ships or is delivered."
                checked={current.enableTrackingEmails}
                value="true"
              />

              <s-switch
                name="enableReviewEmails"
                label="Send post-delivery review requests"
                details="Automatically email customers asking for a review after delivery. Starter plan required."
                checked={current.enableReviewEmails}
                value="true"
              />
            </s-stack>
          </s-section>

          {/* ── Review Request + Coupon ───────────────────────────────────── */}
          <s-section heading="Review Requests & Coupons">
            <s-banner tone="info">
              Review requests and coupons require the Starter plan or above.
            </s-banner>
            <s-stack direction="block" gap="base">
              <s-number-field
                name="reviewRequestDelayDays"
                label="Days after delivery to send review email"
                details="How many days to wait after an order is marked delivered before sending the review request."
                value={String(current.reviewRequestDelayDays)}
                min={1}
                max={60}
              />

              <s-switch
                name="enableCoupon"
                label="Include a discount coupon in review emails"
                details="Reward customers with a coupon code to encourage repeat purchases."
                checked={current.enableCoupon}
                value="true"
              />

              <s-text-field
                name="couponCode"
                label="Coupon code"
                details="The discount code to include in the email. Create it first in Shopify Admin → Discounts."
                value={current.couponCode}
                placeholder="THANKYOU10"
              />

              <s-number-field
                name="couponDiscountPercent"
                label="Discount percentage"
                details="Shown in the email to the customer (informational — create the actual discount in Shopify)."
                value={String(current.couponDiscountPercent)}
                min={1}
                max={100}
              />

              <s-number-field
                name="couponExpiryDays"
                label="Coupon valid for (days)"
                details="Shown in the email. Set the same expiry on the Shopify discount code."
                value={String(current.couponExpiryDays)}
                min={1}
                max={365}
              />
            </s-stack>
          </s-section>

          {/* ── WhatsApp ─────────────────────────────────────────────────── */}
          <s-section heading="WhatsApp Contact Button">
            <s-stack direction="block" gap="base">
              <s-paragraph>
                Show a WhatsApp button on the order tracking widget so customers
                can contact you instantly with their order number pre-filled.
              </s-paragraph>
              <s-text-field
                name="whatsappNumber"
                label="WhatsApp business number"
                details="Include country code, e.g. +1234567890. Leave blank to hide the button."
                value={current.whatsappNumber}
                placeholder="+1234567890"
              />
            </s-stack>
          </s-section>

          {/* ── Save ─────────────────────────────────────────────────────── */}
          <s-section>
            <s-button
              type="submit"
              {...(isSubmitting ? { loading: true } : {})}
            >
              Save Settings
            </s-button>
          </s-section>
        </s-stack>
      </fetcher.Form>

      {/* ── Aside ──────────────────────────────────────────────────────────── */}
      <s-section slot="aside" heading="Store Info">
        <s-stack direction="block" gap="small">
          <s-text type="strong">{shopInfo?.name}</s-text>
          <s-text tone="info">{shopInfo?.email}</s-text>
          <s-text tone="info">{shopInfo?.primaryDomain?.url}</s-text>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Current Plan">
        <s-stack direction="block" gap="small">
          <s-badge tone={current.plan === "free" ? undefined : "success"}>
            {current.plan.charAt(0).toUpperCase() + current.plan.slice(1)} Plan
          </s-badge>
          {current.plan === "free" && (
            <>
              <s-paragraph>
                Upgrade to <s-text type="strong">Starter ($9/mo)</s-text> to
                unlock review emails, coupons, and delivery feedback.
              </s-paragraph>
              <s-button href="/app/billing" variant="secondary">
                Upgrade Plan
              </s-button>
            </>
          )}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Quick Links">
        <s-unordered-list>
          <s-list-item>
            <s-link href="https://resend.com/api-keys" target="_blank">
              Get Resend API key ↗
            </s-link>
          </s-list-item>
          <s-list-item>
            <s-link
              href={`https://${shopDomain}/admin/discounts`}
              target="_blank"
            >
              Manage discount codes ↗
            </s-link>
          </s-list-item>
          <s-list-item>
            <s-link href="/app/billing">Plans & Billing</s-link>
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
