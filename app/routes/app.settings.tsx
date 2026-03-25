import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  HeadersFunction,
} from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

interface Settings {
  cancellationWindowHours: number;
  whatsappNumber: string;
  reviewRequestDelayDays: number;
  emailProvider: string;
  brandColor: string;
  senderName: string;
  enableTrackingEmails: boolean;
  enableReviewEmails: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  cancellationWindowHours: 2,
  whatsappNumber: "",
  reviewRequestDelayDays: 7,
  emailProvider: "resend",
  brandColor: "#5c6ac4",
  senderName: "",
  enableTrackingEmails: true,
  enableReviewEmails: false,
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  // Load shop info for defaults
  const shopResponse = await admin.graphql(`
    #graphql
    query getShop {
      shop {
        name
        email
        primaryDomain { url }
      }
    }
  `);
  const shopJson = await shopResponse.json();
  const shop = shopJson.data?.shop;

  // In production, load from DB. For now return defaults.
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    senderName: shop?.name ?? "",
  };

  return { settings, shop, shopDomain: session.shop };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();

  const settings: Settings = {
    cancellationWindowHours:
      parseInt(formData.get("cancellationWindowHours") as string) || 2,
    whatsappNumber: (formData.get("whatsappNumber") as string) || "",
    reviewRequestDelayDays:
      parseInt(formData.get("reviewRequestDelayDays") as string) || 7,
    emailProvider: (formData.get("emailProvider") as string) || "resend",
    brandColor: (formData.get("brandColor") as string) || "#5c6ac4",
    senderName: (formData.get("senderName") as string) || "",
    enableTrackingEmails: formData.get("enableTrackingEmails") === "on",
    enableReviewEmails: formData.get("enableReviewEmails") === "on",
  };

  // In production: save to DB
  console.log("Saving settings:", settings);

  return { success: true, settings };
};

export default function SettingsPage() {
  const { settings, shop } = useLoaderData<typeof loader>() as {
    settings: Settings;
    shop: { name: string; email: string; primaryDomain: { url: string } };
    shopDomain: string;
  };
  const fetcher = useFetcher<{ success: boolean; settings: Settings }>();

  const isSubmitting = fetcher.state !== "idle";
  const saved = fetcher.data?.success;
  const current = fetcher.data?.settings ?? settings;

  return (
    <s-page heading="PostShip Settings">
      {saved && (
        <s-banner tone="success">Settings saved successfully!</s-banner>
      )}

      <fetcher.Form method="post">
        {/* Order Management Settings */}
        <s-stack gap="base">
          <s-section heading="Order Management">
            <s-stack direction="block" gap="base">
              <s-number-field
                name="cancellationWindowHours"
                label="Cancellation window (hours)"
                details="How long after placing an order a customer can request cancellation"
                value={String(current.cancellationWindowHours)}
                min={0}
                max={72}
              />
            </s-stack>
          </s-section>

          {/* Email Settings */}
          <s-section heading="Email Notifications">
            <s-stack direction="block" gap="base">
              <s-text-field
                name="senderName"
                label="Sender name"
                details="Displayed as the 'From' name in emails to customers"
                value={current.senderName}
                placeholder={shop?.name ?? "Your Store"}
              />

              <s-select
                name="emailProvider"
                label="Email provider"
                value={current.emailProvider}
              >
                <s-option value="resend">
                  Resend (recommended — 3,000 free/month)
                </s-option>
                <s-option value="sendgrid">SendGrid</s-option>
                <s-option value="shopify">Shopify Email</s-option>
              </s-select>

              <s-switch
                name="enableTrackingEmails"
                label="Send tracking update emails"
                details="Notify customers when their order ships, is out for delivery, or delivered"
                checked={current.enableTrackingEmails}
              />

              <s-switch
                name="enableReviewEmails"
                label="Send post-delivery review requests"
                details="Available on Starter plan and above"
                checked={current.enableReviewEmails}
                disabled
              />
            </s-stack>
          </s-section>

          {/* Branding */}
          <s-section heading="Branding">
            <s-stack direction="block" gap="base">
              <s-color-field
                name="brandColor"
                label="Brand color"
                details="Used in customer-facing emails and the tracking page"
                value={current.brandColor}
              />
            </s-stack>
          </s-section>

          {/* WhatsApp (Phase 3 preview) */}
          <s-section heading="WhatsApp Contact Button">
            <s-banner tone="info">
              WhatsApp notifications are available on the Pro plan. The contact
              button below is free.
            </s-banner>
            <s-stack direction="block" gap="base">
              <s-text-field
                name="whatsappNumber"
                label="WhatsApp business number"
                details="Include country code, e.g. +1234567890. Used for the 'Contact via WhatsApp' button."
                value={current.whatsappNumber}
                placeholder="+1234567890"
              />
            </s-stack>
          </s-section>

          {/* Review requests (Phase 2 preview) */}
          <s-section heading="Review Requests">
            <s-banner tone="info">
              Automated review requests are available on the Starter plan.
            </s-banner>
            <s-stack direction="block" gap="base">
              <s-number-field
                name="reviewRequestDelayDays"
                label="Days after delivery to send review request"
                value={String(current.reviewRequestDelayDays)}
                min={1}
                max={30}
                disabled
              />
            </s-stack>
          </s-section>

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

      {/* Aside */}
      <s-section slot="aside" heading="Quick Help">
        <s-unordered-list>
          <s-list-item>
            <s-link href="https://docs.anthropic.com" target="_blank">
              Documentation
            </s-link>
          </s-list-item>
          <s-list-item>
            <s-link href="/app/billing">Upgrade plan</s-link>
          </s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section slot="aside" heading="Store Info">
        <s-stack direction="block" gap="small">
          <s-text type="strong">{shop?.name}</s-text>
          <s-text tone="info">{shop?.email}</s-text>
          <s-text tone="info">{shop?.primaryDomain?.url}</s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
