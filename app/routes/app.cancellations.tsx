/**
 * app/routes/app.cancellations.tsx
 *
 * Cancellation Requests Dashboard — fully wired to DB.
 * Merchant can approve (trigger Shopify cancel) or reject requests.
 */
import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  HeadersFunction,
} from "react-router";
import { useLoaderData, useFetcher, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

type CancelRequest = {
  id: string;
  orderName: string;
  orderId: string;
  customerEmail: string;
  reason: string;
  notes: string;
  status: string;
  createdAt: string;
  processedAt: string | null;
};

const REASON_LABELS: Record<string, string> = {
  customer: "Changed mind",
  duplicate: "Duplicate / mistake",
  shipping: "Shipping too slow",
  price: "Found better price",
  other: "Other",
};

const STATUS_TONES: Record<
  string,
  "warning" | "success" | "critical" | undefined
> = {
  pending: "warning",
  approved: "success",
  rejected: "critical",
  "auto-rejected": "critical",
};

// ── Loader ─────────────────────────────────────────────────────────────────
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status") ?? "all";

  const where: { shop: string; status?: string } = { shop: session.shop };
  if (statusFilter !== "all") where.status = statusFilter;

  const [requests, counts] = await Promise.all([
    prisma.cancellationRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.cancellationRequest.groupBy({
      by: ["status"],
      where: { shop: session.shop },
      _count: { _all: true },
    }),
  ]);

  const countMap: Record<string, number> = {
    all: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
  };
  for (const row of counts) {
    const key = row.status.replace("-", "_"); // auto-rejected → auto_rejected
    countMap[key] = row._count._all;
    countMap.all += row._count._all;
  }

  return {
    requests: requests.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      processedAt: r.processedAt?.toISOString() ?? null,
    })),
    counts: countMap,
    statusFilter,
  };
};

// ── Action ─────────────────────────────────────────────────────────────────
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const id = formData.get("id") as string;
  const orderId = formData.get("orderId") as string;

  if (intent === "approve") {
    // Attempt to cancel the order in Shopify
    let shopifyError: string | null = null;

    if (orderId) {
      const res = await admin.graphql(
        `#graphql
        mutation cancelOrder($orderId: ID!, $reason: OrderCancelReason!, $notifyCustomer: Boolean!) {
          orderCancel(orderId: $orderId, reason: $reason, notifyCustomer: $notifyCustomer) {
            orderCancelUserErrors { field message }
          }
        }`,
        { variables: { orderId, reason: "CUSTOMER", notifyCustomer: true } },
      );
      const json = await res.json();
      const errors = json.data?.orderCancel?.orderCancelUserErrors ?? [];
      if (errors.length > 0) shopifyError = errors[0].message;
    }

    await prisma.cancellationRequest.update({
      where: { id },
      data: {
        status: shopifyError ? "rejected" : "approved",
        processedAt: new Date(),
      },
    });

    return {
      success: !shopifyError,
      message: shopifyError
        ? `Could not cancel order in Shopify: ${shopifyError}`
        : "Order cancelled and customer notified.",
    };
  }

  if (intent === "reject") {
    await prisma.cancellationRequest.update({
      where: { id },
      data: { status: "rejected", processedAt: new Date() },
    });
    return { success: true, message: "Request rejected." };
  }

  return { success: false, message: "Unknown action." };
};

// ── Component ──────────────────────────────────────────────────────────────
export default function CancellationsPage() {
  const { requests, counts, statusFilter } = useLoaderData<typeof loader>() as {
    requests: CancelRequest[];
    counts: Record<string, number>;
    statusFilter: string;
  };

  const fetcher = useFetcher<{ success: boolean; message: string }>();
  const [, setSearchParams] = useSearchParams();

  const setFilter = (status: string) => setSearchParams({ status });

  return (
    <s-page heading="Cancellation Requests">
      {fetcher.data?.message && (
        <s-banner tone={fetcher.data.success ? "success" : "critical"}>
          {fetcher.data.message}
        </s-banner>
      )}

      {/* ── Filter buttons ─────────────────────────────────────────────── */}
      <s-section>
        <s-stack direction="inline" gap="base">
          {["all", "pending", "approved", "rejected"].map((s) => (
            <s-button
              key={s}
              variant={statusFilter === s ? "primary" : "secondary"}
              onClick={() => setFilter(s)}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)} ({counts[s] ?? 0})
            </s-button>
          ))}
        </s-stack>
      </s-section>

      {requests.length === 0 ? (
        <s-section>
          <s-stack direction="block" align="center" gap="base">
            <s-heading>No cancellation requests</s-heading>
            <s-paragraph>
              {statusFilter === "all"
                ? "When customers request order cancellations from your tracking page, they'll appear here."
                : `No ${statusFilter} requests at the moment.`}
            </s-paragraph>
          </s-stack>
        </s-section>
      ) : (
        <s-section>
          <s-table>
            <s-table-header-row>
              <s-table-header>Order</s-table-header>
              <s-table-header>Customer</s-table-header>
              <s-table-header>Reason</s-table-header>
              <s-table-header>Notes</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Requested</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {requests.map((r) => (
                <s-table-row key={r.id}>
                  <s-table-cell>
                    <s-text type="strong">{r.orderName}</s-text>
                  </s-table-cell>
                  <s-table-cell>{r.customerEmail}</s-table-cell>
                  <s-table-cell>
                    {REASON_LABELS[r.reason] ?? r.reason}
                  </s-table-cell>
                  <s-table-cell>
                    <s-text tone="info">{r.notes || "—"}</s-text>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={STATUS_TONES[r.status]}>
                      {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    {new Date(r.createdAt).toLocaleDateString()}
                  </s-table-cell>
                  <s-table-cell>
                    {r.status === "pending" && (
                      <s-stack direction="inline" gap="small">
                        <fetcher.Form
                          method="post"
                          style={{ display: "inline" }}
                        >
                          <input type="hidden" name="intent" value="approve" />
                          <input type="hidden" name="id" value={r.id} />
                          <input
                            type="hidden"
                            name="orderId"
                            value={r.orderId}
                          />
                          <s-button
                            type="submit"
                            variant="secondary"
                            tone="success"
                            {...(fetcher.state !== "idle"
                              ? { loading: true }
                              : {})}
                          >
                            Approve & Cancel
                          </s-button>
                        </fetcher.Form>
                        <fetcher.Form
                          method="post"
                          style={{ display: "inline" }}
                        >
                          <input type="hidden" name="intent" value="reject" />
                          <input type="hidden" name="id" value={r.id} />
                          <s-button
                            type="submit"
                            variant="secondary"
                            tone="critical"
                          >
                            Reject
                          </s-button>
                        </fetcher.Form>
                      </s-stack>
                    )}
                    {r.status !== "pending" && (
                      <s-text tone="subdued">
                        {r.processedAt
                          ? `Processed ${new Date(r.processedAt).toLocaleDateString()}`
                          : "Processed"}
                      </s-text>
                    )}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}

      <s-section slot="aside" heading="How it works">
        <s-paragraph>
          Customers can request cancellation within the time window you&apos;ve
          configured in Settings. Clicking &quot;Approve & Cancel&quot; will
          immediately cancel the order in Shopify and notify the customer.
        </s-paragraph>
        <s-divider />
        <s-link href="/app/settings">Configure cancellation window →</s-link>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
