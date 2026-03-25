/**
 * app/routes/app.feedback.tsx
 *
 * Delivery Feedback Dashboard — merchant view.
 * Shows 1–5 star ratings + comments left by customers after delivery.
 * Feedback is submitted via the theme extension + proxy.delivery-feedback route.
 */
import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

type Feedback = {
  id: string;
  orderName: string;
  customerEmail: string;
  rating: number;
  comment: string;
  createdAt: string;
};

// ── Loader ─────────────────────────────────────────────────────────────────
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const [feedback, aggregate] = await Promise.all([
    prisma.deliveryFeedback.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.deliveryFeedback.aggregate({
      where: { shop: session.shop },
      _avg: { rating: true },
      _count: { _all: true },
    }),
  ]);

  // Count per star rating
  const starCounts = await prisma.deliveryFeedback.groupBy({
    by: ["rating"],
    where: { shop: session.shop },
    _count: { _all: true },
  });

  const byRating: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of starCounts) {
    byRating[row.rating] = row._count._all;
  }

  return {
    feedback: feedback.map((f) => ({
      ...f,
      createdAt: f.createdAt.toISOString(),
    })),
    avgRating: aggregate._avg.rating ?? 0,
    totalCount: aggregate._count._all,
    byRating,
  };
};

// ── Star display helper ────────────────────────────────────────────────────
function Stars({ rating }: { rating: number }) {
  const stars = Array.from({ length: 5 }, (_, i) => (i < rating ? "★" : "☆"));
  const tone = rating >= 4 ? "success" : rating === 3 ? "warning" : "critical";
  return (
    <s-badge tone={tone}>
      {stars.join("")} {rating}/5
    </s-badge>
  );
}

// ── Component ──────────────────────────────────────────────────────────────
export default function FeedbackPage() {
  const { feedback, avgRating, totalCount, byRating } = useLoaderData<
    typeof loader
  >() as {
    feedback: Feedback[];
    avgRating: number;
    totalCount: number;
    byRating: Record<number, number>;
  };

  return (
    <s-page heading="Delivery Feedback">
      {/* ── Summary ────────────────────────────────────────────────────── */}
      {totalCount > 0 && (
        <s-section heading="Overview">
          <s-grid gridTemplateColumns="repeat(12, 1fr)" gap="base">
            {/* Average rating card */}
            <s-grid-item gridColumn="span 4">
              <s-box padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small" align="center">
                  <s-text tone="info">Average Rating</s-text>
                  <s-heading>{avgRating.toFixed(1)} / 5</s-heading>
                  <s-text>
                    {"★".repeat(Math.round(avgRating))}
                    {"☆".repeat(5 - Math.round(avgRating))}
                  </s-text>
                  <s-text tone="info">
                    {totalCount} review{totalCount !== 1 ? "s" : ""}
                  </s-text>
                </s-stack>
              </s-box>
            </s-grid-item>

            {/* Star breakdown */}
            <s-grid-item gridColumn="span 8">
              <s-box padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small">
                  {[5, 4, 3, 2, 1].map((star) => (
                    <s-stack key={star} direction="inline" gap="small">
                      <s-text style={{ width: "40px" }}>{star} ★</s-text>
                      <s-text tone="info">
                        {byRating[star] ?? 0} (
                        {totalCount > 0
                          ? Math.round(
                              ((byRating[star] ?? 0) / totalCount) * 100,
                            )
                          : 0}
                        %)
                      </s-text>
                    </s-stack>
                  ))}
                </s-stack>
              </s-box>
            </s-grid-item>
          </s-grid>
        </s-section>
      )}

      {/* ── Feedback table ─────────────────────────────────────────────── */}
      {feedback.length === 0 ? (
        <s-section>
          <s-stack direction="block" align="center" gap="base">
            <s-heading>No feedback yet</s-heading>
            <s-paragraph>
              After customers receive their orders, they can leave a star rating
              and comment from the tracking page. Feedback will appear here.
            </s-paragraph>
            <s-banner tone="info">
              Delivery feedback is available on the Starter plan and above.
            </s-banner>
          </s-stack>
        </s-section>
      ) : (
        <s-section heading="All Feedback">
          <s-table>
            <s-table-header-row>
              <s-table-header>Order</s-table-header>
              <s-table-header>Customer</s-table-header>
              <s-table-header>Rating</s-table-header>
              <s-table-header>Comment</s-table-header>
              <s-table-header>Date</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {feedback.map((f) => (
                <s-table-row key={f.id}>
                  <s-table-cell>
                    <s-text type="strong">{f.orderName}</s-text>
                  </s-table-cell>
                  <s-table-cell>{f.customerEmail}</s-table-cell>
                  <s-table-cell>
                    <Stars rating={f.rating} />
                  </s-table-cell>
                  <s-table-cell>
                    {f.comment ? (
                      <s-text tone="info">{f.comment}</s-text>
                    ) : (
                      <s-text tone="subdued">No comment</s-text>
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    {new Date(f.createdAt).toLocaleDateString()}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}

      {/* ── Aside ──────────────────────────────────────────────────────────── */}
      <s-section slot="aside" heading="About Delivery Feedback">
        <s-paragraph>
          After an order is delivered, customers can rate their experience (1–5
          stars) and leave a comment from your store&apos;s tracking page.
        </s-paragraph>
        <s-divider />
        <s-paragraph>
          Use this data to identify delivery issues early and improve your
          post-purchase experience.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
