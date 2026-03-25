/**
 * PostShip — Order Tracking Extension
 * Customer-facing JS for the theme app extension block.
 * Communicates with the Shopify App Proxy at /apps/postship
 */

(function () {
  "use strict";

  // ── Config ────────────────────────────────────────────────────────────────
  const CFG = window.__postshipConfig || {};
  const PROXY = CFG.appProxy || "/apps/postship";

  // ── DOM helpers ───────────────────────────────────────────────────────────
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
  const show = (el) => el && el.removeAttribute("hidden");
  const hide = (el) => el && el.setAttribute("hidden", "");
  const setText = (el, text) => el && (el.textContent = text);
  const setHTML = (el, html) => el && (el.innerHTML = html);

  // ── State ─────────────────────────────────────────────────────────────────
  let currentOrder = null;
  let currentEmail = "";

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    const root = $("#postship-tracking");
    if (!root) return;

    bindLookupForm();
    bindBackButton();
    bindTabs();
    bindCancelForm();
    bindReturnForm();
    bindSupportForm();

    // Pre-fill from URL params (?order=1001&email=...&auto=1)
    const params = new URLSearchParams(window.location.search);
    const orderParam = params.get("order") || params.get("order_number");
    const emailParam = params.get("email");
    if (orderParam) {
      const orderInput = $("#ps-order-number");
      const emailInput = $("#ps-email");
      if (orderInput) orderInput.value = orderParam;
      if (emailInput && emailParam) emailInput.value = emailParam;
      if (params.get("auto") === "1" && orderParam && emailParam) {
        lookupOrder(orderParam, emailParam);
      }
    }
  }

  // ── Lookup form ───────────────────────────────────────────────────────────
  function bindLookupForm() {
    const form = $("#ps-lookup-form");
    if (!form) return;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const orderNumber = $("#ps-order-number").value.trim();
      const email = $("#ps-email").value.trim();
      lookupOrder(orderNumber, email);
    });
  }

  async function lookupOrder(orderNumber, email) {
    if (!orderNumber || !email) {
      showLookupError("Please enter both your order number and email address.");
      return;
    }

    setLookupLoading(true);
    hideLookupError();

    try {
      const res = await apiFetch("/order-lookup", {
        method: "POST",
        body: JSON.stringify({ order_number: orderNumber, email }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          data.error ||
            `We couldn't find an order matching those details. Please check your order number and email.`,
        );
      }

      const order = await res.json();
      currentOrder = order;
      currentEmail = email;
      renderOrder(order);
    } catch (err) {
      showLookupError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLookupLoading(false);
    }
  }

  function setLookupLoading(loading) {
    const btn = $("#ps-lookup-btn");
    const spinner = btn && $(".ps-btn__spinner", btn);
    const text = btn && $(".ps-btn__text", btn);
    if (!btn) return;
    btn.disabled = loading;
    if (spinner) loading ? show(spinner) : hide(spinner);
    if (text) text.style.opacity = loading ? "0.5" : "1";
  }

  function showLookupError(msg) {
    const el = $("#ps-lookup-error");
    if (!el) return;
    el.textContent = msg;
    show(el);
  }

  function hideLookupError() {
    hide($("#ps-lookup-error"));
  }

  // ── Render order ──────────────────────────────────────────────────────────
  function renderOrder(order) {
    // Switch panels
    hide($("#ps-lookup"));
    show($("#ps-result"));

    // Header
    setText($("#ps-order-name"), order.name);
    setText($("#ps-order-date"), "Placed " + formatDate(order.created_at));

    // Fulfillment badge
    const badge = $("#ps-fulfillment-badge");
    if (badge) {
      badge.textContent = formatStatus(
        order.fulfillment_status || "unfulfilled",
      );
      badge.className =
        "ps-badge ps-badge--" + statusClass(order.fulfillment_status);
    }

    // Tracking
    const tracking = order.fulfillments?.[0]?.tracking_info?.[0];
    const fulfillmentStatus = order.fulfillments?.[0]?.status;
    if (tracking?.number) {
      show($("#ps-tracking-section"));
      setText(
        $("#ps-carrier"),
        order.fulfillments[0].tracking_company || tracking.company || "—",
      );
      setText($("#ps-tracking-number"), tracking.number);
      const link = $("#ps-track-link");
      if (link && tracking.url) {
        link.href = tracking.url;
        show(link);
      }
    }

    // Line items
    renderItems(order.line_items || []);

    // Address
    if (order.shipping_address) {
      show($("#ps-address-section"));
      renderAddress(order.shipping_address);
    }

    // Cancel tab: check if cancellable
    setupCancelTab(order);

    // Return items checklist
    setupReturnItems(order.line_items || []);

    // WhatsApp button
    setupWhatsApp(order);

    // Reset tabs
    $$(".ps-tab-panel").forEach(hide);
    $$(".ps-tab[data-tab]").forEach((t) =>
      t.setAttribute("aria-selected", "false"),
    );
  }

  function renderItems(items) {
    const list = $("#ps-items-list");
    if (!list) return;
    list.innerHTML = items
      .map(
        (item) => `
      <div class="ps-item">
        ${item.image ? `<img class="ps-item__img" src="${escHtml(item.image)}" alt="${escHtml(item.title)}" loading="lazy" />` : '<div class="ps-item__img ps-item__img--placeholder"></div>'}
        <div class="ps-item__info">
          <span class="ps-item__title">${escHtml(item.title)}</span>
          ${item.variant_title ? `<span class="ps-item__variant">${escHtml(item.variant_title)}</span>` : ""}
          <span class="ps-item__qty">Qty: ${item.quantity}</span>
        </div>
        <div class="ps-item__price">${formatMoney(item.price, item.currency)}</div>
      </div>
    `,
      )
      .join("");
  }

  function renderAddress(addr) {
    const el = $("#ps-address");
    if (!el) return;
    const parts = [
      addr.name,
      addr.address1,
      addr.address2,
      [addr.city, addr.province, addr.zip].filter(Boolean).join(", "),
      addr.country,
    ].filter(Boolean);
    el.innerHTML = parts.map((p) => `<span>${escHtml(p)}</span>`).join("");
  }

  function setupCancelTab(order) {
    const allowed = $("#ps-cancel-allowed");
    const blocked = $("#ps-cancel-blocked");
    if (!allowed || !blocked) return;

    const canCancel = isCancellable(order);
    if (canCancel) {
      show(allowed);
      hide(blocked);
    } else {
      hide(allowed);
      show(blocked);
    }
  }

  function isCancellable(order) {
    if (order.cancelled_at) return false;
    if (order.fulfillment_status === "fulfilled") return false;
    const windowHours = CFG.cancelWindowHours || 2;
    const placed = new Date(order.created_at).getTime();
    const now = Date.now();
    const diff = (now - placed) / (1000 * 60 * 60); // hours
    return diff <= windowHours;
  }

  function setupReturnItems(items) {
    const list = $("#ps-return-items-list");
    if (!list) return;
    list.innerHTML = items
      .map(
        (item, i) => `
      <label class="ps-checkbox-label">
        <input type="checkbox" name="return_items" value="${escHtml(item.id || String(i))}" data-title="${escHtml(item.title)}" />
        <span>${escHtml(item.title)}${item.variant_title ? " — " + escHtml(item.variant_title) : ""}</span>
        <span class="ps-item__qty">×${item.quantity}</span>
      </label>
    `,
      )
      .join("");
  }

  function setupWhatsApp(order) {
    const btn = $("#ps-whatsapp-btn");
    if (!btn || !CFG.whatsappNumber) return;
    const msg = encodeURIComponent(
      `Hi! I need help with my order ${order.name}. My email is ${currentEmail}.`,
    );
    const number = CFG.whatsappNumber.replace(/\D/g, "");
    btn.href = `https://wa.me/${number}?text=${msg}`;
  }

  // ── Back button ───────────────────────────────────────────────────────────
  function bindBackButton() {
    const btn = $("#ps-back-btn");
    if (!btn) return;
    btn.addEventListener("click", () => {
      hide($("#ps-result"));
      show($("#ps-lookup"));
      currentOrder = null;
    });
  }

  // ── Tabs ──────────────────────────────────────────────────────────────────
  function bindTabs() {
    $$(".ps-tab[data-tab]").forEach((tab) => {
      tab.addEventListener("click", () => {
        const name = tab.dataset.tab;
        $$(".ps-tab[data-tab]").forEach((t) =>
          t.setAttribute("aria-selected", "false"),
        );
        tab.setAttribute("aria-selected", "true");
        $$(".ps-tab-panel").forEach(hide);
        const panel = $(`#ps-panel-${name}`);
        if (panel) show(panel);
      });
    });

    // Cancel "other" reason reveal
    const cancelReason = $("#ps-cancel-reason");
    if (cancelReason) {
      cancelReason.addEventListener("change", () => {
        const wrap = $("#ps-cancel-other-wrap");
        cancelReason.value === "other" ? show(wrap) : hide(wrap);
      });
    }
  }

  // ── Cancel form ───────────────────────────────────────────────────────────
  function bindCancelForm() {
    const form = $("#ps-cancel-form");
    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!currentOrder) return;
      const reason = $("#ps-cancel-reason").value;
      const notes =
        ($("#ps-cancel-other") && $("#ps-cancel-other").value) || "";

      setFormLoading(form, true);
      hideFormMsg("#ps-cancel-msg");

      try {
        const res = await apiFetch("/cancel-request", {
          method: "POST",
          body: JSON.stringify({
            order_id: currentOrder.id,
            order_name: currentOrder.name,
            email: currentEmail,
            reason,
            notes,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Request failed");
        showFormMsg(
          "#ps-cancel-msg",
          data.message || "Cancellation request submitted!",
          "success",
        );
        form.reset();
      } catch (err) {
        showFormMsg("#ps-cancel-msg", err.message, "error");
      } finally {
        setFormLoading(form, false);
      }
    });
  }

  // ── Return form ───────────────────────────────────────────────────────────
  function bindReturnForm() {
    const form = $("#ps-return-form");
    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!currentOrder) return;

      const checkedItems = $$('input[name="return_items"]:checked', form);
      if (checkedItems.length === 0) {
        showFormMsg(
          "#ps-return-msg",
          "Please select at least one item.",
          "error",
        );
        return;
      }

      const items = checkedItems.map((cb) => ({
        id: cb.value,
        title: cb.dataset.title,
      }));

      const returnType =
        $('input[name="return_type"]:checked', form)?.value || "return";
      const reason = $("#ps-return-reason").value;
      const notes = $("#ps-return-notes").value;

      setFormLoading(form, true);
      hideFormMsg("#ps-return-msg");

      try {
        const res = await apiFetch("/return-request", {
          method: "POST",
          body: JSON.stringify({
            order_id: currentOrder.id,
            order_name: currentOrder.name,
            email: currentEmail,
            return_type: returnType,
            items,
            reason,
            notes,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Request failed");
        showFormMsg(
          "#ps-return-msg",
          data.message || "Return request submitted!",
          "success",
        );
        form.reset();
      } catch (err) {
        showFormMsg("#ps-return-msg", err.message, "error");
      } finally {
        setFormLoading(form, false);
      }
    });
  }

  // ── Support form ──────────────────────────────────────────────────────────
  function bindSupportForm() {
    const form = $("#ps-support-form");
    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!currentOrder) return;

      const issueType = $("#ps-issue-type").value;
      const description = $("#ps-issue-desc").value.trim();

      if (!description) {
        showFormMsg("#ps-support-msg", "Please describe your issue.", "error");
        return;
      }

      setFormLoading(form, true);
      hideFormMsg("#ps-support-msg");

      try {
        const res = await apiFetch("/support-ticket", {
          method: "POST",
          body: JSON.stringify({
            order_id: currentOrder.id,
            order_name: currentOrder.name,
            email: currentEmail,
            issue_type: issueType,
            description,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Request failed");
        showFormMsg(
          "#ps-support-msg",
          data.message || "Support ticket submitted!",
          "success",
        );
        form.reset();
      } catch (err) {
        showFormMsg("#ps-support-msg", err.message, "error");
      } finally {
        setFormLoading(form, false);
      }
    });
  }

  // ── API helper ────────────────────────────────────────────────────────────
  function apiFetch(path, options = {}) {
    return fetch(PROXY + path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(options.headers || {}),
      },
    });
  }

  // ── Form helpers ──────────────────────────────────────────────────────────
  function setFormLoading(form, loading) {
    const btn = $('[type="submit"]', form);
    if (btn) btn.disabled = loading;
  }

  function showFormMsg(selector, msg, type = "info") {
    const el = $(selector);
    if (!el) return;
    el.textContent = msg;
    el.className = `ps-alert ps-alert--${type}`;
    show(el);
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function hideFormMsg(selector) {
    hide($(selector));
  }

  // ── Formatters ────────────────────────────────────────────────────────────
  function formatDate(str) {
    if (!str) return "";
    try {
      return new Date(str).toLocaleDateString(CFG.locale || "en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch {
      return str;
    }
  }

  function formatMoney(cents, currency = "USD") {
    try {
      const amount =
        typeof cents === "string" ? parseFloat(cents) : cents / 100;
      return new Intl.NumberFormat(CFG.locale || "en-US", {
        style: "currency",
        currency,
      }).format(isNaN(amount) ? 0 : amount);
    } catch {
      return cents;
    }
  }

  function formatStatus(status) {
    if (!status) return "Pending";
    return status
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (l) => l.toUpperCase());
  }

  function statusClass(status) {
    const map = {
      fulfilled: "success",
      unfulfilled: "warning",
      partial: "info",
      in_transit: "info",
      out_for_delivery: "info",
      delivered: "success",
      cancelled: "danger",
      failed: "danger",
    };
    return map[(status || "").toLowerCase()] || "neutral";
  }

  function escHtml(str) {
    if (typeof str !== "string") return String(str || "");
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
