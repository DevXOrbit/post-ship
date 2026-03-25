/**
 * app/routes/app.tickets.tsx
 *
 * Support Ticket Dashboard — merchant view.
 * Shows all customer support tickets with status management (Open → In Progress → Resolved).
 * Tickets are created by customers via the theme extension + proxy.support-ticket route.
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

// ── Types ──────────────────────────────────────────────────────────────────
type Ticket = {
  id: string;
  orderName: string;
  customerEmail: string;
  issueType: string;
  description: string;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
};

type StatusFilter = "all" | "open" | "in_progress" | "resolved";

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
};

const STATUS_TONES: Record<
  string,
  "critical" | "warning" | "success" | undefined
> = {
  open: "critical",
  in_progress: "warning",
  resolved: "success",
};

const ISSUE_LABELS: Record<string, string> = {
  damaged: "Item Damaged",
  missing: "Item Missing",
  wrong_item: "Wrong Item",
  not_delivered: "Not Delivered",
  other: "Other",
};

// ── Loader ─────────────────────────────────────────────────────────────────
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const statusFilter = (url.searchParams.get("status") ??
    "all") as StatusFilter;

  const where: { shop: string; status?: string } = { shop: session.shop };
  if (statusFilter !== "all") where.status = statusFilter;

  const [tickets, counts] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.supportTicket.groupBy({
      by: ["status"],
      where: { shop: session.shop },
      _count: { _all: true },
    }),
  ]);

  const countMap: Record<string, number> = {
    all: 0,
    open: 0,
    in_progress: 0,
    resolved: 0,
  };
  for (const row of counts) {
    countMap[row.status] = row._count._all;
    countMap.all += row._count._all;
  }

  return {
    tickets: tickets.map((t) => ({
      ...t,
      createdAt: t.createdAt.toISOString(),
      resolvedAt: t.resolvedAt?.toISOString() ?? null,
    })),
    counts: countMap,
    statusFilter,
  };
};

// ── Action ─────────────────────────────────────────────────────────────────
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const id = formData.get("id") as string;

  if (intent === "update-status") {
    const status = formData.get("status") as string;
    await prisma.supportTicket.update({
      where: { id },
      data: {
        status,
        resolvedAt: status === "resolved" ? new Date() : null,
      },
    });
    return { success: true };
  }

  if (intent === "delete") {
    await prisma.supportTicket.deleteMany({
      where: { id, shop: session.shop },
    });
    return { success: true };
  }

  return { success: false };
};

// ── Component ──────────────────────────────────────────────────────────────
export default function TicketsPage() {
  const { tickets, counts, statusFilter } = useLoaderData<typeof loader>() as {
    tickets: Ticket[];
    counts: Record<string, number>;
    statusFilter: StatusFilter;
  };

  const fetcher = useFetcher();
  const [, setSearchParams] = useSearchParams();

  const handleStatus = (id: string, status: string) => {
    fetcher.submit({ intent: "update-status", id, status }, { method: "post" });
  };

  const handleDelete = (id: string) => {
    fetcher.submit({ intent: "delete", id }, { method: "post" });
  };

  const setFilter = (status: string) => {
    setSearchParams({ status });
  };

  return (
    <s-page heading="Support Tickets">
      {/* ── Summary badges ─────────────────────────────────────────────── */}
      <s-section>
        <s-stack direction="inline" gap="base">
          <s-button
            variant={statusFilter === "all" ? "primary" : "secondary"}
            onClick={() => setFilter("all")}
          >
            All ({counts.all ?? 0})
          </s-button>
          <s-button
            variant={statusFilter === "open" ? "primary" : "secondary"}
            onClick={() => setFilter("open")}
          >
            Open ({counts.open ?? 0})
          </s-button>
          <s-button
            variant={statusFilter === "in_progress" ? "primary" : "secondary"}
            onClick={() => setFilter("in_progress")}
          >
            In Progress ({counts.in_progress ?? 0})
          </s-button>
          <s-button
            variant={statusFilter === "resolved" ? "primary" : "secondary"}
            onClick={() => setFilter("resolved")}
          >
            Resolved ({counts.resolved ?? 0})
          </s-button>
        </s-stack>
      </s-section>

      {/* ── Ticket table ───────────────────────────────────────────────── */}
      {tickets.length === 0 ? (
        <s-section>
          <s-stack direction="block" align="center" gap="base">
            <s-heading>No tickets found</s-heading>
            <s-paragraph>
              {statusFilter === "all"
                ? "When customers submit support tickets from your tracking page, they'll appear here."
                : `No ${STATUS_LABELS[statusFilter]?.toLowerCase()} tickets right now.`}
            </s-paragraph>
          </s-stack>
        </s-section>
      ) : (
        <s-section>
          <s-table>
            <s-table-header-row>
              <s-table-header>Order</s-table-header>
              <s-table-header>Customer</s-table-header>
              <s-table-header>Issue</s-table-header>
              <s-table-header>Description</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Date</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {tickets.map((t) => (
                <s-table-row key={t.id}>
                  <s-table-cell>
                    <s-text type="strong">{t.orderName}</s-text>
                  </s-table-cell>
                  <s-table-cell>{t.customerEmail}</s-table-cell>
                  <s-table-cell>
                    <s-badge>
                      {ISSUE_LABELS[t.issueType] ?? t.issueType}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-text tone="info">
                      {t.description.length > 80
                        ? t.description.slice(0, 80) + "…"
                        : t.description}
                    </s-text>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={STATUS_TONES[t.status]}>
                      {STATUS_LABELS[t.status] ?? t.status}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    {new Date(t.createdAt).toLocaleDateString()}
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small">
                      {t.status === "open" && (
                        <s-button
                          variant="secondary"
                          onClick={() => handleStatus(t.id, "in_progress")}
                        >
                          Start
                        </s-button>
                      )}
                      {t.status === "in_progress" && (
                        <s-button
                          variant="secondary"
                          tone="success"
                          onClick={() => handleStatus(t.id, "resolved")}
                        >
                          Resolve
                        </s-button>
                      )}
                      {t.status === "resolved" && (
                        <s-button
                          variant="secondary"
                          onClick={() => handleStatus(t.id, "open")}
                        >
                          Reopen
                        </s-button>
                      )}
                      <s-button
                        variant="tertiary"
                        tone="critical"
                        onClick={() => handleDelete(t.id)}
                      >
                        Delete
                      </s-button>
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}

      {/* ── Aside ──────────────────────────────────────────────────────────── */}
      <s-section slot="aside" heading="About Support Tickets">
        <s-paragraph>
          Customers submit tickets from your store's order tracking page when
          they have issues with their order — damaged items, missing packages,
          wrong items, or anything else.
        </s-paragraph>
        <s-divider />
        <s-stack direction="block" gap="small">
          <s-text type="strong">Workflow</s-text>
          <s-paragraph>
            Open → In Progress → Resolved. Customers can see their ticket status
            from the tracking page.
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Quick Stats">
        <s-stack direction="block" gap="small">
          <s-stack direction="inline" gap="small">
            <s-badge tone="critical">{counts.open ?? 0} open</s-badge>
            <s-badge tone="warning">
              {counts.in_progress ?? 0} in progress
            </s-badge>
          </s-stack>
          <s-badge tone="success">{counts.resolved ?? 0} resolved</s-badge>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
