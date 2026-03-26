/**
 * app/routes/app.returns.tsx
 *
 * Return & Exchange Requests dashboard.
 * Plan is read directly from AppSettings — if "free", shows upgrade prompt.
 * Starter / Pro merchants see the full request table with approve / reject.
 */
import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  HeadersFunction,
} from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { getSettings } from "../lib/settings.server";

// ── Loader ─────────────────────────────────────────────────────────────────
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Fetch plan directly from DB — single source of truth
  const settings = await getSettings(shop);
  const plan = settings.plan; // "free" | "starter" | "pro"

  // Only hit the DB for return requests if the plan allows it
  if (plan === "free") {
    return { plan, returns: [] };
  }

  const returns = await prisma.returnRequest
    .findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: 50,
    })
    .catch(() => []);

  return { plan, returns };
};

// ── Action ─────────────────────────────────────────────────────────────────
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const id = formData.get("id") as string;
  const shop = session.shop;

  // Re-check plan on every action — prevents manipulation via direct POST
  const settings = await getSettings(shop);
  if (settings.plan === "free") {
    return { success: false, error: "This feature requires a Starter plan." };
  }

  if (intent === "update-status") {
    const status = formData.get("status") as string;
    await prisma.returnRequest
      .update({
        where: { id, shop },
        data: { status },
      })
      .catch(() => null);
    return { success: true };
  }

  return { success: false };
};

// ── Types ──────────────────────────────────────────────────────────────────
type ReturnRequest = {
  id: string;
  orderName: string;
  customerEmail: string;
  items: string;
  type: string;
  reason: string;
  notes: string;
  status: string;
  createdAt: Date;
};

function getStatusTone(
  status: string,
): "success" | "warning" | "info" | "critical" | undefined {
  const map: Record<string, "success" | "warning" | "info" | "critical"> = {
    pending: "warning",
    approved: "success",
    rejected: "critical",
    processing: "info",
    completed: "success",
  };
  return map[status.toLowerCase()];
}

// ── Component ──────────────────────────────────────────────────────────────
export default function ReturnsPage() {
  const { plan, returns } = useLoaderData<typeof loader>() as {
    plan: string;
    returns: ReturnRequest[];
  };

  const fetcher = useFetcher<{ success: boolean }>();

  const handleStatusChange = (id: string, status: string) => {
    fetcher.submit({ intent: "update-status", id, status }, { method: "post" });
  };

  // ── Free plan gate ──────────────────────────────────────────────────────
  if (plan === "free") {
    return (
      <s-page heading="Return & Exchange Requests">
        <s-section>
          <s-stack direction="block" gap="base">
            <s-banner tone="warning">
              Return and exchange requests are available on the Starter plan
              ($9/mo) and above. Upgrade to start accepting returns from your
              tracking page.
            </s-banner>
            <s-paragraph>
              With the Starter plan, customers can select items to return or
              exchange directly from the order tracking page. You'll receive
              requests here to review and approve or reject.
            </s-paragraph>
            <s-button href="/app/billing" variant="primary">
              View Plans & Upgrade
            </s-button>
          </s-stack>
        </s-section>

        <s-section slot="aside" heading="What's included">
          <s-unordered-list>
            <s-list-item>Customer-facing return request form</s-list-item>
            <s-list-item>Item selection + reason for return</s-list-item>
            <s-list-item>Approve or reject from this dashboard</s-list-item>
            <s-list-item>Return vs exchange request types</s-list-item>
          </s-unordered-list>
        </s-section>
      </s-page>
    );
  }

  // ── Starter / Pro — no requests yet ────────────────────────────────────
  if (returns.length === 0) {
    return (
      <s-page heading="Return & Exchange Requests">
        <s-section>
          <s-stack direction="block" gap="base">
            <s-paragraph>
              No return or exchange requests yet. When customers submit requests
              from your order tracking page, they'll appear here.
            </s-paragraph>
          </s-stack>
        </s-section>

        <s-section slot="aside" heading="About Returns">
          <s-paragraph>
            Customers can submit return and exchange requests from your store's
            tracking page. Requests appear here for you to review.
          </s-paragraph>
          <s-divider />
          <s-stack direction="block" gap="small">
            <s-list-item>
              <s-badge tone="warning">Pending</s-badge> — Awaiting your review
            </s-list-item>
            <s-list-item>
              <s-badge tone="success">Approved</s-badge> — Return accepted
            </s-list-item>
            <s-list-item>
              <s-badge tone="critical">Rejected</s-badge> — Return declined
            </s-list-item>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  // ── Starter / Pro — full table ──────────────────────────────────────────
  return (
    <s-page heading="Return & Exchange Requests">
      <s-section heading="Requests">
        <s-table>
          <s-table-header-row>
            <s-table-header>Order</s-table-header>
            <s-table-header>Customer</s-table-header>
            <s-table-header>Type</s-table-header>
            <s-table-header>Items</s-table-header>
            <s-table-header>Reason</s-table-header>
            <s-table-header>Status</s-table-header>
            <s-table-header>Date</s-table-header>
            <s-table-header>Actions</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {returns.map((r) => (
              <s-table-row key={r.id}>
                <s-table-cell>
                  <s-text type="strong">{r.orderName}</s-text>
                </s-table-cell>
                <s-table-cell>{r.customerEmail}</s-table-cell>
                <s-table-cell>
                  <s-badge tone={r.type === "exchange" ? "info" : undefined}>
                    {r.type === "exchange" ? "Exchange" : "Return"}
                  </s-badge>
                </s-table-cell>
                <s-table-cell>
                  <s-text tone="info">
                    {(() => {
                      try {
                        const parsed = JSON.parse(r.items) as Array<{
                          title: string;
                        }>;
                        return parsed.map((i) => i.title).join(", ");
                      } catch {
                        return r.items;
                      }
                    })()}
                  </s-text>
                </s-table-cell>
                <s-table-cell>{r.reason}</s-table-cell>
                <s-table-cell>
                  <s-badge tone={getStatusTone(r.status)}>
                    {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                  </s-badge>
                </s-table-cell>
                <s-table-cell>
                  {new Date(r.createdAt).toLocaleDateString()}
                </s-table-cell>
                <s-table-cell>
                  {r.status === "pending" ? (
                    <s-stack direction="inline" gap="small">
                      <s-button
                        variant="secondary"
                        tone="success"
                        onClick={() => handleStatusChange(r.id, "approved")}
                        {...(fetcher.state !== "idle" ? { loading: true } : {})}
                      >
                        Approve
                      </s-button>
                      <s-button
                        variant="secondary"
                        tone="critical"
                        onClick={() => handleStatusChange(r.id, "rejected")}
                        {...(fetcher.state !== "idle" ? { loading: true } : {})}
                      >
                        Reject
                      </s-button>
                    </s-stack>
                  ) : (
                    <s-text tone="info">
                      {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                    </s-text>
                  )}
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      <s-section slot="aside" heading="About Returns">
        <s-paragraph>
          Customers submit return and exchange requests from your store's order
          tracking page. Review and action each request below.
        </s-paragraph>
        <s-divider />
        <s-stack direction="block" gap="small">
          <s-text type="strong">Statuses</s-text>
          <s-stack direction="block" gap="small">
            <s-list-item>
              <s-badge tone="warning">Pending</s-badge> — Awaiting your review
            </s-list-item>
            <s-list-item>
              <s-badge tone="success">Approved</s-badge> — Return accepted
            </s-list-item>
            <s-list-item>
              <s-badge tone="critical">Rejected</s-badge> — Return declined
            </s-list-item>
            <s-list-item>
              <s-badge tone="info">Processing</s-badge> — In progress
            </s-list-item>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
