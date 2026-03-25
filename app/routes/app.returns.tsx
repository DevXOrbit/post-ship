import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

// Loader - fetch return requests from our DB
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const returns = await prisma.returnRequest.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 50,
  }).catch(() => []);

  return { returns };
};

// Action - update return request status
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const id = formData.get("id") as string;
  const shop = session.shop;

  if (intent === "update-status") {
    const status = formData.get("status") as string;
    await prisma.returnRequest.update({
      where: { id, shop },
      data: { status },
    }).catch(() => null);
    return { success: true };
  }

  return { success: false };
};

type ReturnRequest = {
  id: string;
  orderName: string;
  customerEmail: string;
  items: string;
  reason: string;
  status: string;
  createdAt: Date;
};

function getStatusTone(status: string): "success" | "warning" | "info" | "critical" | undefined {
  const map: Record<string, "success" | "warning" | "info" | "critical"> = {
    pending: "warning",
    approved: "success",
    rejected: "critical",
    processing: "info",
  };
  return map[status.toLowerCase()];
}

export default function ReturnsPage() {
  const { returns } = useLoaderData<typeof loader>() as { returns: ReturnRequest[] };
  const fetcher = useFetcher();

  const handleStatusChange = (id: string, status: string) => {
    fetcher.submit(
      { intent: "update-status", id, status },
      { method: "post" }
    );
  };

  return (
    <s-page heading="Return & Exchange Requests">
      <s-banner tone="info" slot="primary-action">
        Phase 2 Feature — Available on Starter Plan
      </s-banner>

      {returns.length === 0 ? (
        <s-section>
          <s-stack direction="block" align="center" gap="base">
            <s-icon name="return" />
            <s-heading>No return requests yet</s-heading>
            <s-paragraph>
              When customers submit return or exchange requests, they'll appear here.
              Return requests are available on the Starter plan and above.
            </s-paragraph>
            <s-button href="/app/billing">Upgrade to Starter</s-button>
          </s-stack>
        </s-section>
      ) : (
        <s-section heading="Return Requests">
          <s-table>
            <s-table-header-row>
              <s-table-header-cell>Order</s-table-header-cell>
              <s-table-header-cell>Customer</s-table-header-cell>
              <s-table-header-cell>Items</s-table-header-cell>
              <s-table-header-cell>Reason</s-table-header-cell>
              <s-table-header-cell>Status</s-table-header-cell>
              <s-table-header-cell>Date</s-table-header-cell>
              <s-table-header-cell>Actions</s-table-header-cell>
            </s-table-header-row>
            <s-table-body>
              {returns.map((r) => (
                <s-table-row key={r.id}>
                  <s-table-cell>{r.orderName}</s-table-cell>
                  <s-table-cell>{r.customerEmail}</s-table-cell>
                  <s-table-cell>{r.items}</s-table-cell>
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
                    <s-button-group>
                      {r.status === "pending" && (
                        <>
                          <s-button
                            variant="secondary"
                            tone="success"
                            onClick={() => handleStatusChange(r.id, "approved")}
                          >
                            Approve
                          </s-button>
                          <s-button
                            variant="secondary"
                            tone="critical"
                            onClick={() => handleStatusChange(r.id, "rejected")}
                          >
                            Reject
                          </s-button>
                        </>
                      )}
                      {r.status !== "pending" && (
                        <s-text tone="subdued">
                          {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                        </s-text>
                      )}
                    </s-button-group>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}

      <s-section slot="aside" heading="About Returns">
        <s-paragraph>
          Customers can submit return and exchange requests from your store's
          tracking page. You'll receive email notifications for new requests.
        </s-paragraph>
        <s-paragraph>
          <s-text fontWeight="semibold">Statuses:</s-text>
        </s-paragraph>
        <s-unordered-list>
          <s-list-item><s-badge tone="warning">Pending</s-badge> — Awaiting review</s-list-item>
          <s-list-item><s-badge tone="success">Approved</s-badge> — Return approved</s-list-item>
          <s-list-item><s-badge tone="critical">Rejected</s-badge> — Return declined</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
