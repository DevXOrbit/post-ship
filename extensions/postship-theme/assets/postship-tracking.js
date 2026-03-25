/**
 * PostShip — Order Tracking Extension
 * Customer-facing JS for the theme app extension block.
 * Communicates with the Shopify App Proxy at /apps/postship
 *
 * ── Plan gating ───────────────────────────────────────────────────────────
 * On init, fetches /apps/postship/config to get the merchant's active plan.
 * Tabs are shown/hidden based on the plan feature flags:
 *
 *   Free    → Cancel tab only
 *   Starter → Cancel + Returns + Get Help
 *   Pro     → Cancel + Returns + Get Help
 *
 * Block settings (show_cancel, show_returns, show_support) still act as
 * a secondary toggle — both the plan AND the block setting must be enabled.
 */

(function () {
  "use strict";

  // ── Config ────────────────────────────────────────────────────────────────
  const CFG = window.__postshipConfig || {};
  const PROXY = CFG.appProxy || "/apps/postship";

  // ── DOM helpers ───────────────────────────────────────────────────────────
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  /**
   * show/hide use BOTH the `hidden` attribute AND the `.ps-hidden` CSS class
   * so Shopify theme CSS that resets [hidden] { display: block } can't
   * accidentally make the loading overlay or gated tabs visible.
   */
  const show = (el) => {
    if (!el) return;
    el.removeAttribute("hidden");
    el.classList.remove("ps-hidden");
  };

  const hide = (el) => {
    if (!el) return;
    el.setAttribute("hidden", "");
    el.classList.add("ps-hidden");
  };

  const setText = (el, text) => el && (el.textContent = text);
  const setHTML = (el, html) => el && (el.innerHTML = html);

  // ── State ─────────────────────────────────────────────────────────────────
  let currentOrder = null;
  let currentEmail = "";

  // Populated after /config fetch — fail-open defaults (most restrictive)
  let planFeatures = { cancel: false, returns: false, support: false };

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    const root = $("#postship-tracking");
    if (!root) return;

    // Force-hide loading overlay and result panel immediately
    hide($("#ps-loading"));
    hide($("#ps-result"));
    show($("#ps-lookup"));

    // ── Fetch live plan features from proxy ───────────────────────────────
    await loadPlanConfig();

    // Apply plan gates BEFORE showing any tabs
    applyPlanGates();

    // Wire up interactions
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

  // ── Fetch plan config ─────────────────────────────────────────────────────
  async function loadPlanConfig() {
    try {
      const res = await fetch(PROXY + "/config", {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return; // fail open

      const data = await res.json();

      if (data.features) {
        planFeatures = {
          cancel: !!data.features.cancel,
          returns: !!data.features.returns,
          support: !!data.features.support,
        };
      }

      // Override block setting values with live DB values if present
      if (data.cancelWindowHours != null)
        CFG.cancelWindowHours = data.cancelWindowHours;
      if (data.whatsappNumber) CFG.whatsappNumber = data.whatsappNumber;
    } catch {
      // Network error — fail open, tracking form still works
    }
  }

  // ── Apply plan gates ──────────────────────────────────────────────────────
  // Shows a tab only if BOTH the plan allows it AND the block setting is enabled.
  function applyPlanGates() {
    const cancelAllowed = planFeatures.cancel && CFG.showCancel !== false;
    const returnsAllowed = planFeatures.returns && CFG.showReturns !== false;
    const supportAllowed = planFeatures.support && CFG.showSupport !== false;

    toggleTab("cancel", cancelAllowed);
    toggleTab("returns", returnsAllowed);
    toggleTab("support", supportAllowed);

    // If no action tabs are visible, hide the whole tabs section
    const tabsContainer = $("#ps-actions-tabs");
    if (tabsContainer) {
      cancelAllowed || returnsAllowed || supportAllowed
        ? show(tabsContainer)
        : hide(tabsContainer);
    }
  }

  function toggleTab(name, visible) {
    const btn = $(`[data-tab="${name}"]`);
    const panel = $(`#ps-panel-${name}`);
    if (visible) {
      if (btn) show(btn);
      // Panel visibility is controlled by tab click, not here
    } else {
      if (btn) hide(btn);
      if (panel) hide(panel);
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
            "We couldn't find an order matching those details. Please check your order number and email.",
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
    hide($("#ps-lookup"));
    show($("#ps-result"));

    setText($("#ps-order-name"), order.name);
    setText($("#ps-order-date"), "Placed " + formatDate(order.created_at));

    const badge = $("#ps-fulfillment-badge");
    if (badge) {
      badge.textContent = formatStatus(
        order.fulfillment_status || "unfulfilled",
      );
      badge.className =
        "ps-badge ps-badge--" + statusClass(order.fulfillment_status);
    }

    const tracking = order.fulfillments?.[0]?.tracking_info?.[0];
    const fulfillmentStatus = order.fulfillments?.[0]?.status;
    const trackingSection = $("#ps-tracking-section");
    if (tracking?.number && trackingSection) {
      show(trackingSection);
      setText($("#ps-tracking-number"), tracking.number);
      setText(
        "#ps-carrier-name" in document ? $("#ps-carrier-name") : null,
        tracking.company || order.fulfillments?.[0]?.tracking_company || "—",
      );
      setText(
        $("#ps-fulfillment-status"),
        formatStatus(fulfillmentStatus || "in_transit"),
      );
      const trackingLink = $("#ps-tracking-link");
      if (trackingLink && tracking.url) {
        trackingLink.href = tracking.url;
        show(trackingLink);
      }
    } else if (trackingSection) {
      hide(trackingSection);
    }

    const itemsList = $("#ps-items-list");
    if (itemsList && order.line_items?.length) {
      setHTML(
        itemsList,
        order.line_items
          .map(
            (item) => `
          <div class="ps-item">
            ${
              item.image
                ? `<img class="ps-item__img" src="${escHtml(item.image)}" alt="${escHtml(item.title)}" loading="lazy">`
                : `<div class="ps-item__img ps-item__img--placeholder"></div>`
            }
            <div class="ps-item__info">
              <span class="ps-item__title">${escHtml(item.title)}</span>
              ${item.variant_title ? `<span class="ps-item__variant">${escHtml(item.variant_title)}</span>` : ""}
              <span class="ps-item__qty">Qty: ${item.quantity}</span>
            </div>
            <span class="ps-item__price">${formatMoney(item.price, order.currency)}</span>
          </div>`,
          )
          .join(""),
      );
    }

    const addrSection = $("#ps-address-section");
    const addrEl = $("#ps-shipping-address");
    if (addrEl && order.shipping_address) {
      const a = order.shipping_address;
      addrEl.textContent = [
        a.name,
        a.address1,
        a.address2,
        `${a.city} ${a.province} ${a.zip}`,
        a.country,
      ]
        .filter(Boolean)
        .join(", ");
      if (addrSection) show(addrSection);
    }

    setText(
      $("#ps-order-total"),
      order.total_price ? formatMoney(order.total_price, order.currency) : "",
    );

    populateActionForms(order);
    updateCancelAvailability(order);
    activateFirstVisibleTab();
  }

  function activateFirstVisibleTab() {
    const firstVisible = $(".ps-tab:not([hidden]):not(.ps-hidden)");
    if (firstVisible) firstVisible.click();
  }

  function populateActionForms(order) {
    const returnItemsWrap = $("#ps-return-items-wrap");
    if (returnItemsWrap && order.line_items?.length) {
      setHTML(
        returnItemsWrap,
        order.line_items
          .map(
            (item) => `
          <label class="ps-checkbox-label">
            <input type="checkbox" name="return_items" value="${escHtml(item.id)}" data-title="${escHtml(item.title)}">
            <span>${escHtml(item.title)}${item.variant_title ? ` — ${escHtml(item.variant_title)}` : ""} (×${item.quantity})</span>
          </label>`,
          )
          .join(""),
      );
    }
  }

  function updateCancelAvailability(order) {
    const isCancelled = !!order.cancelled_at;
    const isFulfilled = order.fulfillment_status === "fulfilled";
    const orderAgeHours =
      (Date.now() - new Date(order.created_at).getTime()) / 3600000;
    const withinWindow = orderAgeHours <= (CFG.cancelWindowHours || 2);

    if (isCancelled || isFulfilled || !withinWindow) {
      hide($("#ps-cancel-allowed"));
      show($("#ps-cancel-blocked"));
    } else {
      show($("#ps-cancel-allowed"));
      hide($("#ps-cancel-blocked"));
    }
  }

  // ── Back button ───────────────────────────────────────────────────────────
  function bindBackButton() {
    const btn = $("#ps-back-btn");
    if (!btn) return;
    btn.addEventListener("click", () => {
      currentOrder = null;
      currentEmail = "";
      hide($("#ps-result"));
      show($("#ps-lookup"));
      hideLookupError();
    });
  }

  // ── Tabs ──────────────────────────────────────────────────────────────────
  function bindTabs() {
    const tabBtns = $$(".ps-tab");
    tabBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.tab;
        tabBtns.forEach((b) => b.setAttribute("aria-selected", "false"));
        $$(".ps-tab-panel").forEach((p) => hide(p));
        btn.setAttribute("aria-selected", "true");
        const panel = $(`#ps-panel-${target}`);
        if (panel) show(panel);
      });
    });
  }

  // ── Cancel form ───────────────────────────────────────────────────────────
  function bindCancelForm() {
    const form = $("#ps-cancel-form");
    if (!form) return;

    const reasonSelect = $("#ps-cancel-reason");
    if (reasonSelect) {
      reasonSelect.addEventListener("change", () => {
        const otherWrap = $("#ps-cancel-other-wrap");
        if (otherWrap) {
          reasonSelect.value === "other" ? show(otherWrap) : hide(otherWrap);
        }
      });
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!currentOrder) return;
      if (!planFeatures.cancel) {
        showFormMsg(
          "#ps-cancel-msg",
          "This feature requires an active PostShip subscription.",
          "error",
        );
        return;
      }

      const reason = $("#ps-cancel-reason")?.value || "customer";
      const notes = $("#ps-cancel-other")?.value || "";

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
      if (!planFeatures.returns) {
        showFormMsg(
          "#ps-return-msg",
          "Return requests require a Starter plan or above.",
          "error",
        );
        return;
      }

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
      if (!planFeatures.support) {
        showFormMsg(
          "#ps-support-msg",
          "Support tickets require a Starter plan or above.",
          "error",
        );
        return;
      }

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

  function formatMoney(amount, currency = "USD") {
    try {
      const value = typeof amount === "string" ? parseFloat(amount) : amount;
      return new Intl.NumberFormat(CFG.locale || "en-US", {
        style: "currency",
        currency: currency || "USD",
      }).format(isNaN(value) ? 0 : value);
    } catch {
      return amount;
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
