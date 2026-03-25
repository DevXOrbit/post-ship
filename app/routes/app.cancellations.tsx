import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

interface CancelRequest {
  orderId: string;
  orderName: string;
  email: string;
  reason: string;
  requestedAt: string;
  status: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  // In Phase 1, cancel requests are handled directly from the order detail page.
  // This page will show a log once we have the DB table in Phase 2.
  return { requests: [] as CancelRequest[] };
};

export default function CancellationsPage() {
  const { requests } = useLoaderData<typeof loader>() as { requests: CancelRequest[] };
  const navigate = useNavigate();

  return (
    <s-page heading="Cancellation Requests">
      {requests.length === 0 ? (
        <s-section>
          <s-stack direction="block" align="center" gap="base">
            <s-icon name="order-canceled" />
            <s-heading>No cancellation requests</s-heading>
            <s-paragraph>
              Order cancellations can be processed directly from the order detail page.
              A full cancellation request log will be available in Phase 2.
            </s-paragraph>
            <s-button onClick={() => navigate("/app")}>
              View Orders
            </s-button>
          </s-stack>
        </s-section>
      ) : (
        <s-section>
          <s-table>
            <s-table-header-row>
              <s-table-header-cell>Order</s-table-header-cell>
              <s-table-header-cell>Customer</s-table-header-cell>
              <s-table-header-cell>Reason</s-table-header-cell>
              <s-table-header-cell>Requested At</s-table-header-cell>
              <s-table-header-cell>Status</s-table-header-cell>
            </s-table-header-row>
            <s-table-body>
              {requests.map((r) => (
                <s-table-row key={r.orderId}>
                  <s-table-cell>
                    <s-link onClick={() => navigate(`/app/orders/${r.orderId}`)}>
                      {r.orderName}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{r.email}</s-table-cell>
                  <s-table-cell>{r.reason}</s-table-cell>
                  <s-table-cell>{new Date(r.requestedAt).toLocaleDateString()}</s-table-cell>
                  <s-table-cell>
                    <s-badge>{r.status}</s-badge>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
