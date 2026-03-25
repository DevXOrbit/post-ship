/**
 * app/routes/app.onboarding.tsx
 *
 * PostShip — Onboarding Page
 *
 * Three setup steps the merchant must complete before using the app:
 *   Step 1 — Enable the PostShip app embed in the Shopify Theme Editor
 *   Step 2 — Create a "Track Your Order" page in the Shopify admin
 *   Step 3 — Add the PostShip tracking widget block to that page
 *
 * Step completion is stored in AppSettings (onboardingStep1/2/3).
 * Steps 2 and 3 are manually confirmed by the merchant (button click).
 * Step 1 is also manually confirmed — there's no API to detect theme embeds.
 *
 * Once all 3 steps are done → onboardingDone = true → redirect to /app.
 *
 * The page is also accessible at any time from the nav ("Setup Guide").
 */
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { redirect, useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { getSettings, upsertSettings } from "../lib/settings.server";

// ── Loader ─────────────────────────────────────────────────────────────────
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // Check onboarding state from DB
  const row = await import("../db.server").then((m) =>
    m.default.appSettings.findUnique({ where: { shop } }),
  );

  const steps = {
    step1: row?.onboardingStep1 ?? false,
    step2: row?.onboardingStep2 ?? false,
    step3: row?.onboardingStep3 ?? false,
    done: row?.onboardingDone ?? false,
  };

  // Already completed — send to main app
  if (steps.done) throw redirect("/app");

  // Build the theme editor deep-link for the app embed
  const apiKey = process.env.SHOPIFY_API_KEY ?? "";
  const themeEditorUrl = `https://${shop}/admin/themes/current/editor?context=apps&appEmbed=${apiKey}`;

  // Shopify admin new page link
  const newPageUrl = `https://${shop}/admin/pages/new`;

  // Fetch shop name for greeting
  const shopRes = await admin.graphql(`#graphql
  query ShopShow {
    shop {
      name   
    }
  }`);
  const shopJson = await shopRes.json();
  const shopName = shopJson.data?.shop?.name ?? "your store";

  return { steps, themeEditorUrl, newPageUrl, shopName, shop };
};

// ── Action ─────────────────────────────────────────────────────────────────
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "complete-step") {
    const step = formData.get("step") as string;
    const update: Record<string, boolean> = {};

    if (step === "1") update.onboardingStep1 = true;
    if (step === "2") update.onboardingStep2 = true;
    if (step === "3") update.onboardingStep3 = true;

    await upsertSettings(shop, update as Parameters<typeof upsertSettings>[1]);

    // Check if all 3 are now done
    const row = await import("../db.server").then((m) =>
      m.default.appSettings.findUnique({ where: { shop } }),
    );

    const allDone =
      (row?.onboardingStep1 || update.onboardingStep1) &&
      (row?.onboardingStep2 || update.onboardingStep2) &&
      (row?.onboardingStep3 || update.onboardingStep3);

    if (allDone) {
      await upsertSettings(shop, { onboardingDone: true } as Parameters<
        typeof upsertSettings
      >[1]);
      throw redirect("/app");
    }

    return { success: true };
  }

  // "skip" — mark as done and go to app
  if (intent === "skip") {
    await upsertSettings(shop, { onboardingDone: true } as Parameters<
      typeof upsertSettings
    >[1]);
    throw redirect("/app");
  }

  return { success: false };
};

// ── Component ──────────────────────────────────────────────────────────────
export default function Index() {
  const { steps, themeEditorUrl, newPageUrl, shopName } = useLoaderData<
    typeof loader
  >() as {
    steps: { step1: boolean; step2: boolean; step3: boolean; done: boolean };
    themeEditorUrl: string;
    newPageUrl: string;
    shopName: string;
  };

  const fetcher = useFetcher<{ success: boolean }>();

  const completeStep = (step: string) => {
    fetcher.submit({ intent: "complete-step", step }, { method: "post" });
  };

  const completedCount = [steps.step1, steps.step2, steps.step3].filter(
    Boolean,
  ).length;
  const allDone = completedCount === 3;

  return (
    <s-page heading={`Welcome to PostShip${shopName ? `, ${shopName}` : ""}!`}>
      {/* ── Subtitle ──────────────────────────────────────────────────────── */}
      <s-banner tone="info">
        <s-paragraph slot="subtitle">
          Complete these 3 quick steps to get your order tracking page live on
          your store. It takes less than 5 minutes.
        </s-paragraph>
      </s-banner>
      {/* ── Progress banner ───────────────────────────────────────────────── */}
      {allDone ? (
        <s-banner tone="success">
          🎉 All done! PostShip is live on your store. Redirecting you to the
          dashboard…
        </s-banner>
      ) : (
        <s-banner tone="info">
          {completedCount} of 3 steps completed
          {completedCount === 0
            ? " — let's get started!"
            : completedCount === 1
              ? " — great start, keep going!"
              : " — almost there!"}
        </s-banner>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          STEP 1 — Enable App Embed
      ════════════════════════════════════════════════════════════════════ */}
      <s-section heading="Step 1 — Enable PostShip in Your Theme">
        <s-stack direction="block" gap="base">
          {steps.step1 ? (
            <s-banner tone="success">
              ✓ App embed is enabled. PostShip is active on your storefront.
            </s-banner>
          ) : (
            <s-banner tone="warning">
              The app embed must be turned on before the tracking widget will
              appear on your store.
            </s-banner>
          )}

          <s-paragraph>
            PostShip uses a Shopify Theme App Extension. You need to enable it
            once in the Theme Editor so it can render the tracking widget and
            the floating &quot;Track My Order&quot; button on your storefront.
          </s-paragraph>

          <s-stack direction="block" gap="small">
            <s-text type="strong">How to do it:</s-text>
            <s-ordered-list>
              <s-list-item>
                Click &quot;Open Theme Editor&quot; below — it opens in a new
                tab.
              </s-list-item>
              <s-list-item>
                In the left sidebar, find the{" "}
                <s-text type="strong">App embeds</s-text> section (toggle icon
                at the bottom).
              </s-list-item>
              <s-list-item>
                Find <s-text type="strong">PostShip</s-text> and toggle it{" "}
                <s-text type="strong">ON</s-text>.
              </s-list-item>
              <s-list-item>
                Click <s-text type="strong">Save</s-text> in the Theme Editor.
              </s-list-item>
              <s-list-item>
                Come back here and click &quot;I&apos;ve enabled it&quot; below.
              </s-list-item>
            </s-ordered-list>
          </s-stack>

          {!steps.step1 && (
            <s-stack direction="inline" gap="base">
              <s-button href={themeEditorUrl} target="_blank" variant="primary">
                Open Theme Editor ↗
              </s-button>
              <s-button
                variant="secondary"
                onClick={() => completeStep("1")}
                {...(fetcher.state !== "idle" ? { loading: true } : {})}
              >
                ✓ I&apos;ve enabled it
              </s-button>
            </s-stack>
          )}

          {steps.step1 && (
            <s-stack direction="inline" gap="base">
              <s-button
                href={themeEditorUrl}
                target="_blank"
                variant="secondary"
              >
                Open Theme Editor ↗
              </s-button>
            </s-stack>
          )}
        </s-stack>
      </s-section>

      {/* ════════════════════════════════════════════════════════════════════
          STEP 2 — Create a Tracking Page
      ════════════════════════════════════════════════════════════════════ */}
      <s-section heading="Step 2 — Create a 'Track Your Order' Page">
        <s-stack direction="block" gap="base">
          {steps.step2 ? (
            <s-banner tone="success">
              ✓ Tracking page created. Your customers now have a dedicated place
              to track their orders.
            </s-banner>
          ) : (
            <s-banner tone="info">
              Your customers need a page to visit when they want to track their
              order. You&apos;ll add the PostShip widget to this page in Step 3.
            </s-banner>
          )}

          <s-paragraph>
            Create a new page in your Shopify admin with a title like
            <s-text type="strong"> &quot;Track Your Order&quot;</s-text>. The
            URL will automatically become{" "}
            <s-text type="strong">/pages/track-your-order</s-text>, which you
            can link to from your store&apos;s navigation, order confirmation
            emails, and footer.
          </s-paragraph>

          <s-stack direction="block" gap="small">
            <s-text type="strong">How to do it:</s-text>
            <s-ordered-list>
              <s-list-item>
                Click &quot;Create New Page&quot; below — it opens
                Shopify&apos;s page editor.
              </s-list-item>
              <s-list-item>
                Set the title to <s-text type="strong">Track Your Order</s-text>
                .
              </s-list-item>
              <s-list-item>
                Leave the content blank for now (the widget will fill it).
              </s-list-item>
              <s-list-item>
                Set visibility to <s-text type="strong">Visible</s-text> and
                click Save.
              </s-list-item>
              <s-list-item>
                Come back here and click &quot;I&apos;ve created it&quot; below.
              </s-list-item>
            </s-ordered-list>
          </s-stack>

          {!steps.step2 && (
            <s-stack direction="inline" gap="base">
              <s-button href={newPageUrl} target="_blank" variant="primary">
                Create New Page ↗
              </s-button>
              <s-button
                variant="secondary"
                onClick={() => completeStep("2")}
                {...(fetcher.state !== "idle" ? { loading: true } : {})}
              >
                ✓ I&apos;ve created the page
              </s-button>
            </s-stack>
          )}

          {steps.step2 && (
            <s-button href={newPageUrl} target="_blank" variant="secondary">
              Manage Pages ↗
            </s-button>
          )}
        </s-stack>
      </s-section>

      {/* ════════════════════════════════════════════════════════════════════
          STEP 3 — Add the Widget Block
      ════════════════════════════════════════════════════════════════════ */}
      <s-section heading="Step 3 — Add the PostShip Widget to Your Page">
        <s-stack direction="block" gap="base">
          {steps.step3 ? (
            <s-banner tone="success">
              ✓ Widget added! The PostShip tracking widget is live on your
              tracking page. Your customers can now look up their orders.
            </s-banner>
          ) : (
            <s-banner tone="info">
              This is the final step — add the tracking widget block to the page
              you created in Step 2.
            </s-banner>
          )}

          <s-paragraph>
            In the Shopify Theme Editor, navigate to the tracking page you just
            created and add the{" "}
            <s-text type="strong">PostShip — Order Tracking</s-text> block. This
            is the customer-facing widget where shoppers enter their order
            number and email to see their order status, tracking info, and take
            actions like cancelling or requesting a return.
          </s-paragraph>

          <s-stack direction="block" gap="small">
            <s-text type="strong">How to do it:</s-text>
            <s-ordered-list>
              <s-list-item>
                Open the Theme Editor and navigate to your{" "}
                <s-text type="strong">Track Your Order</s-text> page.
              </s-list-item>
              <s-list-item>
                Click <s-text type="strong">Add section</s-text> or{" "}
                <s-text type="strong">Add block</s-text> in the left sidebar.
              </s-list-item>
              <s-list-item>
                Find and select{" "}
                <s-text type="strong">PostShip — Order Tracking</s-text>.
              </s-list-item>
              <s-list-item>
                Customise the heading, colours, and feature toggles as needed.
              </s-list-item>
              <s-list-item>
                Click <s-text type="strong">Save</s-text> and come back here.
              </s-list-item>
            </s-ordered-list>
          </s-stack>

          {!steps.step3 && (
            <s-stack direction="inline" gap="base">
              <s-button
                href={`https://admin.shopify.com/store/${
                  /* strip .myshopify.com */ ""
                }/themes/current/editor`}
                target="_blank"
                variant="primary"
              >
                Open Theme Editor ↗
              </s-button>
              <s-button
                variant="secondary"
                onClick={() => completeStep("3")}
                {...(fetcher.state !== "idle" ? { loading: true } : {})}
              >
                ✓ I&apos;ve added the widget
              </s-button>
            </s-stack>
          )}
        </s-stack>
      </s-section>

      {/* ════════════════════════════════════════════════════════════════════
          VIDEO GUIDE
      ════════════════════════════════════════════════════════════════════ */}
      <s-section heading="Video Guide">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Watch this short walkthrough to see the full setup process from
            install to a live tracking page in under 5 minutes.
          </s-paragraph>

          {/* YouTube embed — replace VIDEO_ID with your real video ID */}
          <div
            style={{
              position: "relative",
              paddingBottom: "56.25%",
              height: 0,
              overflow: "hidden",
              borderRadius: "8px",
              border: "1px solid var(--p-color-border)",
              background: "#000",
            }}
          >
            <iframe
              src="https://www.youtube.com/embed/dQw4w9WgXcQ"
              title="PostShip Setup Guide"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                border: "none",
              }}
            />
          </div>
        </s-stack>
      </s-section>

      {/* ── Skip link (aside) ──────────────────────────────────────────────── */}
      <s-section slot="aside" heading="Already set up?">
        <s-paragraph>
          If you&apos;ve already configured your store manually or want to
          explore the dashboard first, you can skip this guide.
        </s-paragraph>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="skip" />
          <s-button
            type="submit"
            variant="secondary"
            {...(fetcher.state !== "idle" ? { loading: true } : {})}
          >
            Skip Setup
          </s-button>
        </fetcher.Form>
      </s-section>

      <s-section slot="aside" heading="Need help?">
        <s-unordered-list>
          <s-list-item>
            <s-link href="https://help.postship.app" target="_blank">
              Documentation ↗
            </s-link>
          </s-list-item>
          <s-list-item>
            <s-link href="mailto:support@postship.app">Email support</s-link>
          </s-list-item>
          <s-list-item>
            <s-link href="/app/settings">Configure settings</s-link>
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}
