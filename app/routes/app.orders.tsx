import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

interface Order {
  id: string;
  name: string;
  createdAt: string;
  displayFulfillmentStatus: string;
  displayFinancialStatus: string;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  lineItems: { edges: Array<{ node: { title: string; quantity: number } }> };
  fulfillments: Array<{
    trackingInfo: Array<{ number: string; url: string }>;
    status: string;
  }>;
}

interface LoaderData {
  orders: Order[];
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  endCursor: string | null;
  startCursor: string | null;
  stats: {
    total: number;
    fulfilled: number;
    unfulfilled: number;
    inTransit: number;
  };
  statusFilter: string;
  error: string | null;
  needsAccess: boolean;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const direction = url.searchParams.get("direction") || "next";
  const statusFilter = url.searchParams.get("status") || "any";

  const paginationArgs =
    direction === "prev" && cursor
      ? `last: 20, before: "${cursor}"`
      : cursor
        ? `first: 20, after: "${cursor}"`
        : "first: 20";

  const queryFilter =
    statusFilter !== "any"
      ? `, query: "fulfillment_status:${statusFilter}"`
      : "";

  try {
    const response = await admin.graphql(`
      #graphql
      query getOrders {
        orders(${paginationArgs}${queryFilter}, sortKey: CREATED_AT, reverse: true) {
          pageInfo {
            hasNextPage
            hasPreviousPage
            startCursor
            endCursor
          }
          edges {
            node {
              id
              name
              createdAt
              displayFulfillmentStatus
              displayFinancialStatus
              totalPriceSet {
                shopMoney { amount currencyCode }
              }
              lineItems(first: 3) {
                edges {
                  node { title quantity }
                }
              }
              fulfillments(first: 1) {
                status
                trackingInfo { number url }
              }
            }
          }
        }
      }
    `);

    const json = await response.json();

    if (json.errors?.length) {
      const msg = json.errors[0]?.message ?? "GraphQL error";
      const isAccessError =
        msg.toLowerCase().includes("not approved") ||
        msg.toLowerCase().includes("protected") ||
        msg.toLowerCase().includes("order object");
      return {
        orders: [],
        hasNextPage: false,
        hasPreviousPage: false,
        endCursor: null,
        startCursor: null,
        stats: { total: 0, fulfilled: 0, unfulfilled: 0, inTransit: 0 },
        statusFilter,
        error: msg,
        needsAccess: isAccessError,
      };
    }

    const ordersData = json.data?.orders;
    const orders: Order[] =
      ordersData?.edges?.map((e: { node: Order }) => e.node) ?? [];
    const pageInfo = ordersData?.pageInfo ?? {};

    return {
      orders,
      hasNextPage: pageInfo.hasNextPage ?? false,
      hasPreviousPage: pageInfo.hasPreviousPage ?? false,
      endCursor: pageInfo.endCursor ?? null,
      startCursor: pageInfo.startCursor ?? null,
      stats: {
        total: orders.length,
        fulfilled: orders.filter(
          (o) => o.displayFulfillmentStatus === "FULFILLED",
        ).length,
        unfulfilled: orders.filter(
          (o) => o.displayFulfillmentStatus === "UNFULFILLED",
        ).length,
        inTransit: orders.filter(
          (o) =>
            o.displayFulfillmentStatus === "IN_TRANSIT" ||
            o.displayFulfillmentStatus === "PARTIALLY_FULFILLED",
        ).length,
      },
      statusFilter,
      error: null,
      needsAccess: false,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    const isAccessError =
      msg.toLowerCase().includes("not approved") ||
      msg.toLowerCase().includes("protected") ||
      msg.toLowerCase().includes("order object");
    return {
      orders: [],
      hasNextPage: false,
      hasPreviousPage: false,
      endCursor: null,
      startCursor: null,
      stats: { total: 0, fulfilled: 0, unfulfilled: 0, inTransit: 0 },
      statusFilter,
      error: msg,
      needsAccess: isAccessError,
    };
  }
};

function getFulfillmentTone(
  status: string,
): "success" | "warning" | "info" | "critical" | "new" | undefined {
  const map: Record<
    string,
    "success" | "warning" | "info" | "critical" | "new"
  > = {
    FULFILLED: "success",
    UNFULFILLED: "warning",
    PARTIALLY_FULFILLED: "info",
    IN_TRANSIT: "info",
    OUT_FOR_DELIVERY: "info",
    DELIVERED: "success",
    FAILED: "critical",
    CANCELLED: "critical",
    ON_HOLD: "new",
  };
  return map[status];
}

function formatStatus(s: string): string {
  return s
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function Dashboard() {
  const data = useLoaderData<typeof loader>() as LoaderData;
  const navigate = useNavigate();
  const {
    orders,
    hasNextPage,
    hasPreviousPage,
    stats,
    statusFilter,
    error,
    needsAccess,
  } = data;

  return (
    <s-page heading="PostShip — Order Tracking">
      <s-button
        slot="primary-action"
        icon="refresh"
        onClick={() => navigate("/app")}
      >
        Refresh
      </s-button>

      {/* ── Protected data access guide ── */}
      {needsAccess && (
        <s-banner tone="critical">
          <s-stack direction="block" gap="base">
            <s-text type="strong">
              Protected Customer Data Access Required
            </s-text>
            <s-paragraph>
              Your app needs approval in the Shopify Partner Dashboard to access
              the Orders API. This is required even for development stores.
            </s-paragraph>
            <s-ordered-list>
              <s-list-item>
                Open your{" "}
                <s-link
                  href="https://partners.shopify.com/current/apps"
                  target="_blank"
                >
                  Shopify Partner Dashboard
                </s-link>{" "}
                → select your app
              </s-list-item>
              <s-list-item>
                Click <s-text type="strong">API access requests</s-text> in the
                sidebar
              </s-list-item>
              <s-list-item>
                Find{" "}
                <s-text type="strong">Protected customer data access</s-text> →
                click <s-text type="strong">Request access</s-text>
              </s-list-item>
              <s-list-item>
                Check: <s-text type="strong">Protected customer data</s-text>,{" "}
                <s-text type="strong">Name</s-text>,{" "}
                <s-text type="strong">Email</s-text>,{" "}
                <s-text type="strong">Address</s-text>,{" "}
                <s-text type="strong">Phone</s-text>
              </s-list-item>
              <s-list-item>
                For dev stores — approval is instant. For public apps — review
                is required.
              </s-list-item>
            </s-ordered-list>
            <s-link
              href="https://shopify.dev/docs/apps/launch/protected-customer-data"
              target="_blank"
            >
              Read Shopify docs on protected customer data →
            </s-link>
          </s-stack>
        </s-banner>
      )}

      {error && !needsAccess && (
        <s-banner tone="warning">Error loading orders: {error}</s-banner>
      )}

      {/* ── Stats ── */}
      {!needsAccess && (
        <s-section>
          <s-grid gridTemplateColumns="repeat(12, 1fr)" gap="base">
            {[
              { label: "Total (this page)", value: stats.total },
              { label: "Fulfilled", value: stats.fulfilled },
              { label: "Unfulfilled", value: stats.unfulfilled },
              { label: "In Transit", value: stats.inTransit },
            ].map(({ label, value }) => (
              <s-grid-item key={label} gridColumn="span 6" gridRow="span 1">
                <s-box
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background="subdued"
                >
                  <s-stack direction="block" gap="small">
                    <s-text tone="info">{label}</s-text>
                    <s-heading>{value}</s-heading>
                  </s-stack>
                </s-box>
              </s-grid-item>
            ))}
          </s-grid>
        </s-section>
      )}

      {/* ── Orders table ── */}
      <s-section heading="Orders">
        <s-table
          paginate={hasNextPage || hasPreviousPage}
          hasNextPage={hasNextPage}
          hasPreviousPage={hasPreviousPage}
          onNextPage={() =>
            navigate(
              `/app?cursor=${data.endCursor}&direction=next&status=${statusFilter}`,
            )
          }
          onPreviousPage={() =>
            navigate(
              `/app?cursor=${data.startCursor}&direction=prev&status=${statusFilter}`,
            )
          }
        >
          <s-select
            slot="filters"
            label="Fulfillment status"
            value={statusFilter}
            onChange={(e: Event) => {
              const val = (e.currentTarget as HTMLSelectElement).value;
              navigate(`/app?status=${val}`);
            }}
          >
            <s-option value="any">All orders</s-option>
            <s-option value="unfulfilled">Unfulfilled</s-option>
            <s-option value="fulfilled">Fulfilled</s-option>
            <s-option value="partial">Partially fulfilled</s-option>
          </s-select>

          <s-table-header-row>
            <s-table-header>Order</s-table-header>
            <s-table-header>Date</s-table-header>
            <s-table-header>Items</s-table-header>
            <s-table-header>Total</s-table-header>
            <s-table-header>Fulfillment</s-table-header>
            <s-table-header>Payment</s-table-header>
            <s-table-header>Tracking</s-table-header>
            <s-table-header></s-table-header>
          </s-table-header-row>

          <s-table-body>
            {orders.length === 0 ? (
              <s-table-row>
                <s-table-cell>
                  <s-paragraph>
                    {needsAccess
                      ? "Complete the API access setup above to see orders."
                      : "No orders found."}
                  </s-paragraph>
                </s-table-cell>
              </s-table-row>
            ) : (
              orders.map((order) => {
                const tracking = order.fulfillments?.[0]?.trackingInfo?.[0];
                const total = order.totalPriceSet?.shopMoney;
                return (
                  <s-table-row key={order.id}>
                    <s-table-cell>
                      <s-link
                        onClick={() =>
                          navigate(`/app/orders/${order.id.split("/").pop()}`)
                        }
                      >
                        {order.name}
                      </s-link>
                    </s-table-cell>
                    <s-table-cell>{formatDate(order.createdAt)}</s-table-cell>
                    <s-table-cell>
                      {order.lineItems.edges.length} item
                      {order.lineItems.edges.length !== 1 ? "s" : ""}
                    </s-table-cell>
                    <s-table-cell>
                      {total
                        ? `${total.currencyCode} ${parseFloat(total.amount).toFixed(2)}`
                        : "—"}
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge
                        tone={getFulfillmentTone(
                          order.displayFulfillmentStatus,
                        )}
                      >
                        {formatStatus(order.displayFulfillmentStatus)}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge
                        tone={
                          order.displayFinancialStatus === "PAID"
                            ? "success"
                            : order.displayFinancialStatus === "PENDING"
                              ? "warning"
                              : "critical"
                        }
                      >
                        {formatStatus(order.displayFinancialStatus)}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      {tracking ? (
                        <s-link href={tracking.url} target="_blank">
                          {tracking.number}
                        </s-link>
                      ) : (
                        <s-text tone="info">No tracking</s-text>
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      <s-button
                        variant="tertiary"
                        onClick={() =>
                          navigate(`/app/orders/${order.id.split("/").pop()}`)
                        }
                      >
                        View
                      </s-button>
                    </s-table-cell>
                  </s-table-row>
                );
              })
            )}
          </s-table-body>
        </s-table>
      </s-section>

      <s-section slot="aside" heading="PostShip">
        <s-paragraph>
          Manage post-purchase experience — tracking, returns, cancellations,
          and support.
        </s-paragraph>
        <s-divider />
        <s-unordered-list>
          <s-list-item>
            <s-link href="/app/settings">⚙️ Settings</s-link>
          </s-list-item>
          <s-list-item>
            <s-link href="/app/returns">↩️ Returns</s-link>
          </s-list-item>
          <s-list-item>
            <s-link href="/app/cancellations">🚫 Cancellations</s-link>
          </s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section slot="aside" heading="Current Plan">
        <s-badge tone="success" icon="check-circle">
          Free Plan
        </s-badge>
        <s-paragraph>
          Upgrade to <s-text type="strong">Starter ($9/mo)</s-text> to unlock
          returns, review requests, and delivery feedback.
        </s-paragraph>
        <s-button href="/app/billing" variant="secondary">
          Upgrade Plan
        </s-button>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
