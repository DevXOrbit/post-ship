/**
 * app/routes/app.analytics.tsx
 *
 * Advanced Analytics Dashboard — Pro plan required.
 *
 * Data sources:
 *  1. Shopify Admin GraphQL — orders revenue, fulfillment rates, last 30 days
 *  2. Afyro DB           — tickets, returns, cancellations, feedback, emails
 *
 * Sections:
 *  A. Revenue Summary        — total revenue, order count, AOV, paid vs pending
 *  B. Fulfillment Health     — fulfilled %, unfulfilled, in-transit counts
 *  C. Afyro Activity      — cancel requests, returns, support tickets, feedback
 *  D. Customer Satisfaction  — average feedback rating, ticket resolution rate
 *  E. Email Performance      — tracking emails sent, review emails sent
 */
import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getSettings } from "../lib/settings.server";
import prisma from "../db.server";

// ── Types ──────────────────────────────────────────────────────────────────

interface RevenueData {
  totalRevenue: number;
  currency: string;
  orderCount: number;
  aov: number;
  paidCount: number;
  pendingCount: number;
  refundedCount: number;
}

interface FulfillmentData {
  fulfilledCount: number;
  unfulfilledCount: number;
  partialCount: number;
  fulfilledPct: number;
}

interface ActivityData {
  cancelRequests: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
  };
  returnRequests: { total: number; pending: number; approved: number };
  supportTickets: {
    total: number;
    open: number;
    inProgress: number;
    resolved: number;
    resolutionRate: number;
  };
  feedback: { total: number; avgRating: number; positive: number };
  emailsSent: { tracking: number; delivered: number; reviews: number };
}

// ── Loader ─────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const settings = await getSettings(shop);

  // Pro plan gate
  if (settings.plan !== "pro") {
    return {
      locked: true,
      plan: settings.plan,
      revenue: null,
      fulfillment: null,
      activity: null,
    };
  }

  // ── Date range: last 30 days ─────────────────────────────────────────────
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const sinceISO = since.toISOString();

  // ── 1. Shopify: revenue + fulfillment stats ──────────────────────────────
  // Fetch up to 250 orders from the last 30 days (sufficient for analytics)
  const ordersResponse = await admin.graphql(
    `#graphql
    query analyticsOrders($query: String!) {
      orders(first: 250, query: $query, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            displayFinancialStatus
            displayFulfillmentStatus
            totalPriceSet {
              shopMoney { amount currencyCode }
            }
          }
        }
      }
    }`,
    { variables: { query: `created_at:>${sinceISO}` } },
  );

  const ordersJson = await ordersResponse.json();
  const orders =
    ordersJson.data?.orders?.edges?.map(
      (e: {
        node: {
          id: string;
          displayFinancialStatus: string;
          displayFulfillmentStatus: string;
          totalPriceSet: {
            shopMoney: { amount: string; currencyCode: string };
          };
        };
      }) => e.node,
    ) ?? [];

  // Revenue
  let totalRevenue = 0;
  let currency = "USD";
  let paidCount = 0;
  let pendingCount = 0;
  let refundedCount = 0;

  for (const order of orders) {
    const amount = parseFloat(order.totalPriceSet?.shopMoney?.amount ?? "0");
    currency = order.totalPriceSet?.shopMoney?.currencyCode ?? "USD";
    const fs = order.displayFinancialStatus;
    if (fs === "PAID") {
      totalRevenue += amount;
      paidCount++;
    } else if (fs === "PENDING" || fs === "AUTHORIZED") pendingCount++;
    else if (fs === "REFUNDED" || fs === "PARTIALLY_REFUNDED") refundedCount++;
  }

  const orderCount = orders.length;
  const aov = orderCount > 0 ? totalRevenue / orderCount : 0;

  const revenue: RevenueData = {
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    currency,
    orderCount,
    aov: Math.round(aov * 100) / 100,
    paidCount,
    pendingCount,
    refundedCount,
  };

  // Fulfillment
  let fulfilledCount = 0;
  let unfulfilledCount = 0;
  let partialCount = 0;

  for (const order of orders) {
    const fs = order.displayFulfillmentStatus;
    if (fs === "FULFILLED") fulfilledCount++;
    else if (fs === "UNFULFILLED") unfulfilledCount++;
    else partialCount++;
  }

  const fulfillment: FulfillmentData = {
    fulfilledCount,
    unfulfilledCount,
    partialCount,
    fulfilledPct:
      orderCount > 0 ? Math.round((fulfilledCount / orderCount) * 100) : 0,
  };

  // ── 2. Afyro DB stats ─────────────────────────────────────────────────
  const sinceDate = since;

  const [cancelStats, returnStats, ticketStats, feedbackStats, emailStats] =
    await Promise.all([
      // Cancel requests
      prisma.cancellationRequest.groupBy({
        by: ["status"],
        where: { shop, createdAt: { gte: sinceDate } },
        _count: { _all: true },
      }),
      // Return requests
      prisma.returnRequest.groupBy({
        by: ["status"],
        where: { shop, createdAt: { gte: sinceDate } },
        _count: { _all: true },
      }),
      // Support tickets
      prisma.supportTicket.groupBy({
        by: ["status"],
        where: { shop, createdAt: { gte: sinceDate } },
        _count: { _all: true },
      }),
      // Feedback
      prisma.deliveryFeedback.aggregate({
        where: { shop, createdAt: { gte: sinceDate } },
        _avg: { rating: true },
        _count: { _all: true },
        _sum: { rating: true },
      }),
      // Email log
      prisma.emailLog.groupBy({
        by: ["type"],
        where: { shop, sentAt: { gte: sinceDate } },
        _count: { _all: true },
      }),
    ]);

  // Map cancel stats
  const cancelMap: Record<string, number> = {};
  for (const r of cancelStats) cancelMap[r.status] = r._count._all;

  // Map return stats
  const returnMap: Record<string, number> = {};
  for (const r of returnStats) returnMap[r.status] = r._count._all;

  // Map ticket stats
  const ticketMap: Record<string, number> = {};
  for (const r of ticketStats) ticketMap[r.status] = r._count._all;
  const totalTickets = Object.values(ticketMap).reduce((a, b) => a + b, 0);
  const resolvedTickets = ticketMap["resolved"] ?? 0;
  const resolutionRate =
    totalTickets > 0 ? Math.round((resolvedTickets / totalTickets) * 100) : 0;

  // Map email stats
  const emailMap: Record<string, number> = {};
  for (const r of emailStats) emailMap[r.type] = r._count._all;

  // Feedback: count positive (4-5 stars)
  const avgRating = feedbackStats._avg.rating ?? 0;
  const totalFeedback = feedbackStats._count._all;
  const positiveFeedback = await prisma.deliveryFeedback.count({
    where: { shop, createdAt: { gte: sinceDate }, rating: { gte: 4 } },
  });

  const activity: ActivityData = {
    cancelRequests: {
      total: Object.values(cancelMap).reduce((a, b) => a + b, 0),
      pending: cancelMap["pending"] ?? 0,
      approved: cancelMap["approved"] ?? 0,
      rejected: cancelMap["rejected"] ?? 0,
    },
    returnRequests: {
      total: Object.values(returnMap).reduce((a, b) => a + b, 0),
      pending: returnMap["pending"] ?? 0,
      approved: returnMap["approved"] ?? 0,
    },
    supportTickets: {
      total: totalTickets,
      open: ticketMap["open"] ?? 0,
      inProgress: ticketMap["in_progress"] ?? 0,
      resolved: resolvedTickets,
      resolutionRate,
    },
    feedback: {
      total: totalFeedback,
      avgRating: Math.round(avgRating * 10) / 10,
      positive: positiveFeedback,
    },
    emailsSent: {
      tracking: emailMap["tracking_shipped"] ?? 0,
      delivered: emailMap["tracking_delivered"] ?? 0,
      reviews: emailMap["review_request"] ?? 0,
    },
  };

  return { locked: false, plan: settings.plan, revenue, fulfillment, activity };
};

// ── Helpers ────────────────────────────────────────────────────────────────

function formatCurrency(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "success" | "warning" | "critical" | "info";
}) {
  return (
    <s-grid-item gridColumn="span 3">
      <s-box padding="base" borderWidth="base" borderRadius="base">
        <s-stack direction="block" gap="small">
          <s-text tone="info">{label}</s-text>
          <s-heading>{value}</s-heading>
          {sub && <s-text tone={tone ?? "info"}>{sub}</s-text>}
        </s-stack>
      </s-box>
    </s-grid-item>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const { locked, plan, revenue, fulfillment, activity } = useLoaderData<
    typeof loader
  >() as {
    locked: boolean;
    plan: string;
    revenue: RevenueData | null;
    fulfillment: FulfillmentData | null;
    activity: ActivityData | null;
  };

  if (locked) {
    return (
      <s-page heading="Advanced Analytics">
        <s-section>
          <s-stack direction="block" align="center" gap="base">
            <s-heading>Analytics requires the Pro plan</s-heading>
            <s-paragraph>
              Upgrade to Pro ($19/mo) to unlock the full analytics dashboard —
              revenue insights, fulfillment health, customer satisfaction
              scores, and Afyro activity metrics all in one place.
            </s-paragraph>
            <s-stack direction="inline" gap="base">
              <s-button href="/app/billing" tone="success">
                Upgrade to Pro
              </s-button>
              <s-text tone="info">
                Current plan: {plan.charAt(0).toUpperCase() + plan.slice(1)}
              </s-text>
            </s-stack>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Advanced Analytics">
      <s-paragraph slot="subtitle">Last 30 days</s-paragraph>

      {/* ── A. Revenue Summary ──────────────────────────────────────────── */}
      <s-section heading="Revenue">
        <s-grid gridTemplateColumns="repeat(12, 1fr)" gap="base">
          <StatCard
            label="Total Revenue"
            value={formatCurrency(revenue!.totalRevenue, revenue!.currency)}
            sub={`${revenue!.orderCount} orders`}
          />
          <StatCard
            label="Avg Order Value"
            value={formatCurrency(revenue!.aov, revenue!.currency)}
          />
          <StatCard
            label="Paid Orders"
            value={revenue!.paidCount}
            tone="success"
            sub="Successfully charged"
          />
          <StatCard
            label="Pending / Refunded"
            value={revenue!.pendingCount + revenue!.refundedCount}
            tone={revenue!.refundedCount > 0 ? "warning" : "info"}
            sub={`${revenue!.pendingCount} pending · ${revenue!.refundedCount} refunded`}
          />
        </s-grid>
      </s-section>

      {/* ── B. Fulfillment Health ───────────────────────────────────────── */}
      <s-section heading="Fulfillment Health">
        <s-grid gridTemplateColumns="repeat(12, 1fr)" gap="base">
          <StatCard
            label="Fulfillment Rate"
            value={`${fulfillment!.fulfilledPct}%`}
            tone={fulfillment!.fulfilledPct >= 80 ? "success" : "warning"}
            sub="Orders fulfilled"
          />
          <StatCard
            label="Fulfilled"
            value={fulfillment!.fulfilledCount}
            tone="success"
          />
          <StatCard
            label="Unfulfilled"
            value={fulfillment!.unfulfilledCount}
            tone={fulfillment!.unfulfilledCount > 10 ? "warning" : "info"}
          />
          <StatCard
            label="Partial / Other"
            value={fulfillment!.partialCount}
            tone="info"
          />
        </s-grid>
      </s-section>

      {/* ── C. Afyro Activity ────────────────────────────────────────── */}
      <s-section heading="Afyro Activity">
        <s-grid gridTemplateColumns="repeat(12, 1fr)" gap="base">
          {/* Cancel requests */}
          <s-grid-item gridColumn="span 4">
            <s-box padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="small">
                <s-text type="strong">Cancellation Requests</s-text>
                <s-heading>{activity!.cancelRequests.total}</s-heading>
                <s-stack direction="inline" gap="small">
                  <s-badge tone="warning">
                    {activity!.cancelRequests.pending} pending
                  </s-badge>
                  <s-badge tone="success">
                    {activity!.cancelRequests.approved} approved
                  </s-badge>
                  <s-badge tone="critical">
                    {activity!.cancelRequests.rejected} rejected
                  </s-badge>
                </s-stack>
              </s-stack>
            </s-box>
          </s-grid-item>

          {/* Return requests */}
          <s-grid-item gridColumn="span 4">
            <s-box padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="small">
                <s-text type="strong">Return / Exchange Requests</s-text>
                <s-heading>{activity!.returnRequests.total}</s-heading>
                <s-stack direction="inline" gap="small">
                  <s-badge tone="warning">
                    {activity!.returnRequests.pending} pending
                  </s-badge>
                  <s-badge tone="success">
                    {activity!.returnRequests.approved} approved
                  </s-badge>
                </s-stack>
              </s-stack>
            </s-box>
          </s-grid-item>

          {/* Support tickets */}
          <s-grid-item gridColumn="span 4">
            <s-box padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="small">
                <s-text type="strong">Support Tickets</s-text>
                <s-heading>{activity!.supportTickets.total}</s-heading>
                <s-stack direction="inline" gap="small">
                  <s-badge tone="critical">
                    {activity!.supportTickets.open} open
                  </s-badge>
                  <s-badge tone="warning">
                    {activity!.supportTickets.inProgress} in progress
                  </s-badge>
                  <s-badge tone="success">
                    {activity!.supportTickets.resolved} resolved
                  </s-badge>
                </s-stack>
              </s-stack>
            </s-box>
          </s-grid-item>
        </s-grid>
      </s-section>

      {/* ── D. Customer Satisfaction ────────────────────────────────────── */}
      <s-section heading="Customer Satisfaction">
        <s-grid gridTemplateColumns="repeat(12, 1fr)" gap="base">
          <StatCard
            label="Avg Delivery Rating"
            value={
              activity!.feedback.total > 0
                ? `${activity!.feedback.avgRating} / 5`
                : "No data yet"
            }
            tone={
              activity!.feedback.avgRating >= 4
                ? "success"
                : activity!.feedback.avgRating >= 3
                  ? "warning"
                  : activity!.feedback.avgRating > 0
                    ? "critical"
                    : "info"
            }
            sub={`${activity!.feedback.total} review${activity!.feedback.total !== 1 ? "s" : ""}`}
          />
          <StatCard
            label="Positive Ratings (4–5★)"
            value={
              activity!.feedback.total > 0
                ? `${Math.round((activity!.feedback.positive / activity!.feedback.total) * 100)}%`
                : "—"
            }
            tone="success"
            sub={`${activity!.feedback.positive} of ${activity!.feedback.total}`}
          />
          <StatCard
            label="Ticket Resolution Rate"
            value={`${activity!.supportTickets.resolutionRate}%`}
            tone={
              activity!.supportTickets.resolutionRate >= 70
                ? "success"
                : activity!.supportTickets.resolutionRate >= 40
                  ? "warning"
                  : activity!.supportTickets.total > 0
                    ? "critical"
                    : "info"
            }
            sub={`${activity!.supportTickets.resolved} resolved`}
          />
          <StatCard
            label="Open Tickets"
            value={activity!.supportTickets.open}
            tone={
              activity!.supportTickets.open > 5
                ? "critical"
                : activity!.supportTickets.open > 0
                  ? "warning"
                  : "success"
            }
            sub="Needs attention"
          />
        </s-grid>
      </s-section>

      {/* ── E. Email Performance ────────────────────────────────────────── */}
      <s-section heading="Emails Sent">
        <s-grid gridTemplateColumns="repeat(12, 1fr)" gap="base">
          <StatCard
            label="Tracking Shipped"
            value={activity!.emailsSent.tracking}
            sub="Order shipped notifications"
            tone="info"
          />
          <StatCard
            label="Delivery Confirmed"
            value={activity!.emailsSent.delivered}
            sub="Order delivered notifications"
            tone="info"
          />
          <StatCard
            label="Review Requests"
            value={activity!.emailsSent.reviews}
            sub="Post-delivery review emails"
            tone="info"
          />
          <StatCard
            label="Total Emails"
            value={
              activity!.emailsSent.tracking +
              activity!.emailsSent.delivered +
              activity!.emailsSent.reviews
            }
            tone="success"
          />
        </s-grid>
      </s-section>

      {/* ── Aside ──────────────────────────────────────────────────────────── */}
      <s-section slot="aside" heading="About Analytics">
        <s-paragraph>
          All metrics show data from the last 30 days. Revenue data comes
          directly from your Shopify store. Activity metrics come from Afyro's
          database.
        </s-paragraph>
        <s-divider />
        <s-stack direction="block" gap="small">
          <s-link href="/app/tickets">View Support Tickets →</s-link>
          <s-link href="/app/feedback">View Feedback →</s-link>
          <s-link href="/app/returns">View Returns →</s-link>
          <s-link href="/app/cancellations">View Cancellations →</s-link>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
