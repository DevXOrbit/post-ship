import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  HeadersFunction,
} from "react-router";
import { useLoaderData, useNavigate, useFetcher } from "react-router";

import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "app/shopify.server";

interface LineItem {
  id: string;
  title: string;
  quantity: number;
  sku: string;
  variant: {
    price: string;
    image: { url: string; altText: string } | null;
  } | null;
}

interface Fulfillment {
  status: string;
  createdAt: string;
  trackingInfo: Array<{ number: string; url: string; company: string }>;
  trackingCompany: string;
}

interface OrderDetail {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  createdAt: string;
  displayFulfillmentStatus: string;
  displayFinancialStatus: string;
  cancelledAt: string | null;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  subtotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  totalShippingPriceSet: {
    shopMoney: { amount: string; currencyCode: string };
  };
  totalTaxSet: { shopMoney: { amount: string; currencyCode: string } };
  lineItems: { edges: Array<{ node: LineItem }> };
  shippingAddress: {
    name: string;
    address1: string;
    address2: string | null;
    city: string;
    province: string;
    zip: string;
    country: string;
    phone: string | null;
  } | null;
  fulfillments: Fulfillment[];
  tags: string[];
  note: string | null;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const orderId = `gid://shopify/Order/${params.orderId}`;

  const response = await admin.graphql(
    `
    #graphql
    query getOrder($id: ID!) {
      order(id: $id) {
        id
        name
        email
        phone
        createdAt
        cancelledAt
        displayFulfillmentStatus
        displayFinancialStatus
        tags
        note
        totalPriceSet { shopMoney { amount currencyCode } }
        subtotalPriceSet { shopMoney { amount currencyCode } }
        totalShippingPriceSet { shopMoney { amount currencyCode } }
        totalTaxSet { shopMoney { amount currencyCode } }
        lineItems(first: 20) {
          edges {
            node {
              id
              title
              quantity
              sku
              variant {
                price
                image { url altText }
              }
            }
          }
        }
        shippingAddress {
          name
          address1
          address2
          city
          province
          zip
          country
          phone
        }
        fulfillments(first: 5) {
          status
          createdAt
          trackingCompany
          trackingInfo {
            number
            url
            company
          }
        }
      }
    }
  `,
    { variables: { id: orderId } },
  );

  const json = await response.json();
  const order: OrderDetail | null = json.data?.order ?? null;

  if (!order) {
    throw new Response("Order not found", { status: 404 });
  }

  // Determine if order can be cancelled (not already cancelled/fulfilled)
  const canCancel =
    !order.cancelledAt &&
    order.displayFulfillmentStatus === "UNFULFILLED" &&
    order.displayFinancialStatus !== "REFUNDED";

  return { order, canCancel };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "cancel") {
    const orderId = `gid://shopify/Order/${params.orderId}`;
    const reason = (formData.get("reason") as string) || "CUSTOMER";

    const response = await admin.graphql(
      `
      #graphql
      mutation cancelOrder($orderId: ID!, $reason: OrderCancelReason!, $notifyCustomer: Boolean!) {
        orderCancel(orderId: $orderId, reason: $reason, notifyCustomer: $notifyCustomer) {
          orderCancelUserErrors {
            field
            message
          }
        }
      }
    `,
      {
        variables: {
          orderId,
          reason,
          notifyCustomer: true,
        },
      },
    );

    const json = await response.json();
    const errors = json.data?.orderCancel?.orderCancelUserErrors ?? [];

    if (errors.length > 0) {
      return { success: false, error: errors[0].message };
    }
    return {
      success: true,
      message: "Order has been cancelled and customer notified.",
    };
  }

  return { success: false, error: "Unknown action" };
};

function formatStatus(status: string): string {
  return status
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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
    DELIVERED: "success",
    FAILED: "critical",
    CANCELLED: "critical",
  };
  return map[status];
}

export default function OrderDetail() {
  const { order, canCancel } = useLoaderData<typeof loader>() as {
    order: OrderDetail;
    canCancel: boolean;
  };
  const navigate = useNavigate();
  const fetcher = useFetcher<{
    success: boolean;
    error?: string;
    message?: string;
  }>();

  const isSubmitting = fetcher.state !== "idle";
  const actionResult = fetcher.data;

  const primary = order.fulfillments?.[0];
  const tracking = primary?.trackingInfo?.[0];
  const currency = order.totalPriceSet.shopMoney.currencyCode;
  const fmt = (amount: string) =>
    `${currency} ${parseFloat(amount).toFixed(2)}`;

  return (
    <s-page heading={`Order ${order.name}`}>
      <s-button
        slot="primary-action"
        variant="secondary"
        icon="arrow-left"
        onClick={() => navigate("/app")}
      >
        Back to Orders
      </s-button>

      {/* Action result banner */}
      {actionResult?.success && (
        <s-banner tone="success">{actionResult.message}</s-banner>
      )}
      {actionResult?.error && (
        <s-banner tone="critical">{actionResult.error}</s-banner>
      )}

      {/* Cancelled banner */}
      {order.cancelledAt && (
        <s-banner tone="warning">
          This order was cancelled on {formatDate(order.cancelledAt)}.
        </s-banner>
      )}

      {/* Status row */}
      <s-section>
        <s-stack direction="inline" gap="base">
          <s-stack direction="block" gap="small">
            <s-text tone="info">Fulfillment Status</s-text>
            <s-badge tone={getFulfillmentTone(order.displayFulfillmentStatus)}>
              {formatStatus(order.displayFulfillmentStatus)}
            </s-badge>
          </s-stack>
          <s-stack direction="block" gap="small">
            <s-text tone="info">Payment Status</s-text>
            <s-badge
              tone={
                order.displayFinancialStatus === "PAID" ? "success" : "warning"
              }
            >
              {formatStatus(order.displayFinancialStatus)}
            </s-badge>
          </s-stack>
          <s-stack direction="block" gap="small">
            <s-text tone="info">Order Date</s-text>
            <s-text>{formatDate(order.createdAt)}</s-text>
          </s-stack>
        </s-stack>
      </s-section>

      {/* Tracking info */}
      {tracking ? (
        <s-section heading="Tracking Information">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="small">
              <s-stack direction="block" gap="small">
                <s-text tone="info">Carrier</s-text>
                <s-text type="strong">
                  {primary?.trackingCompany || tracking.company || "Unknown"}
                </s-text>
              </s-stack>
              <s-stack direction="block" gap="small">
                <s-text tone="info">Tracking Number</s-text>
                <s-text type="strong">{tracking.number}</s-text>
              </s-stack>
              <s-stack direction="block" gap="small">
                <s-text tone="info">Status</s-text>
                <s-badge tone={getFulfillmentTone(primary?.status ?? "")}>
                  {formatStatus(primary?.status ?? "Unknown")}
                </s-badge>
              </s-stack>
            </s-stack>
            {tracking.url && (
              <s-button href={tracking.url} target="_blank" icon="delivery">
                Track Package
              </s-button>
            )}
          </s-stack>
        </s-section>
      ) : (
        <s-section heading="Tracking Information">
          <s-banner tone="info">
            No tracking information available yet. Tracking will appear once the
            order is fulfilled.
          </s-banner>
        </s-section>
      )}

      {/* Line items */}
      <s-section heading="Order Items">
        <s-table>
          <s-table-header-row>
            <s-table-header>Product</s-table-header>
            <s-table-header>SKU</s-table-header>
            <s-table-header>Qty</s-table-header>
            <s-table-header>Price</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {order.lineItems.edges.map(({ node: item }) => (
              <s-table-row key={item.id}>
                <s-table-cell>
                  <s-stack direction="inline" gap="small" align="center">
                    {item.variant?.image && (
                      <s-thumbnail
                        src={item.variant.image.url}
                        alt={item.variant.image.altText ?? item.title}
                        size="small"
                      />
                    )}
                    <s-text>{item.title}</s-text>
                  </s-stack>
                </s-table-cell>
                <s-table-cell>
                  <s-text tone="info">{item.sku || "—"}</s-text>
                </s-table-cell>
                <s-table-cell>{item.quantity}</s-table-cell>
                <s-table-cell>
                  {item.variant?.price ? fmt(item.variant.price) : "—"}
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>

        {/* Order totals */}
        <s-divider />
        <s-stack direction="block" gap="small">
          <s-stack direction="inline" gap="small">
            <s-text tone="info">Subtotal</s-text>
            <s-text>{fmt(order.subtotalPriceSet.shopMoney.amount)}</s-text>
          </s-stack>
          <s-stack direction="inline" gap="small">
            <s-text tone="info">Shipping</s-text>
            <s-text>{fmt(order.totalShippingPriceSet.shopMoney.amount)}</s-text>
          </s-stack>
          <s-stack direction="inline" gap="small">
            <s-text tone="info">Tax</s-text>
            <s-text>{fmt(order.totalTaxSet.shopMoney.amount)}</s-text>
          </s-stack>
          <s-divider />
          <s-stack direction="inline" gap="small">
            <s-text type="strong">Total</s-text>
            <s-text type="strong">
              {fmt(order.totalPriceSet.shopMoney.amount)}
            </s-text>
          </s-stack>
        </s-stack>
      </s-section>

      {/* Cancel order */}
      {canCancel && (
        <s-section heading="Cancel Order">
          <s-paragraph>
            This order can be cancelled since it hasn't been fulfilled yet. The
            customer will be notified by email.
          </s-paragraph>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="cancel" />
            <s-stack direction="block" gap="base">
              <s-select name="reason" label="Cancellation reason">
                <s-option value="CUSTOMER">Customer requested</s-option>
                <s-option value="FRAUD">Fraudulent order</s-option>
                <s-option value="INVENTORY">Out of stock</s-option>
                <s-option value="OTHER">Other</s-option>
              </s-select>
              <s-button
                tone="critical"
                type="submit"
                {...(isSubmitting ? { loading: true } : {})}
              >
                Cancel Order
              </s-button>
            </s-stack>
          </fetcher.Form>
        </s-section>
      )}

      {/* Aside: shipping address */}
      <s-section slot="aside" heading="Ship To">
        {order.shippingAddress ? (
          <s-stack direction="block" gap="small">
            <s-text type="strong">{order.shippingAddress.name}</s-text>
            <s-text>{order.shippingAddress.address1}</s-text>
            {order.shippingAddress.address2 && (
              <s-text>{order.shippingAddress.address2}</s-text>
            )}
            <s-text>
              {order.shippingAddress.city}, {order.shippingAddress.province}{" "}
              {order.shippingAddress.zip}
            </s-text>
            <s-text>{order.shippingAddress.country}</s-text>
            {order.shippingAddress.phone && (
              <s-text tone="info">{order.shippingAddress.phone}</s-text>
            )}
          </s-stack>
        ) : (
          <s-text tone="info">No shipping address</s-text>
        )}
      </s-section>

      {/* Aside: customer info */}
      <s-section slot="aside" heading="Customer">
        <s-stack direction="block" gap="small">
          <s-text type="strong">{order.email ?? "—"}</s-text>
          {order.phone && <s-text tone="info">{order.phone}</s-text>}
        </s-stack>
      </s-section>

      {/* Aside: order notes */}
      {order.note && (
        <s-section slot="aside" heading="Order Notes">
          <s-paragraph>{order.note}</s-paragraph>
        </s-section>
      )}

      {/* Aside: tags */}
      {order.tags?.length > 0 && (
        <s-section slot="aside" heading="Tags">
          <s-stack direction="inline" gap="small">
            {order.tags.map((tag) => (
              <s-chip key={tag}>{tag}</s-chip>
            ))}
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
