export function bindStatsEvents(ctx) {
  const {
    el,
    state,
    moveStatsMonth,
    renderStats,
    showChartTooltip,
    showChartTooltipAtIndex,
    statsRangeDayCount,
    maxStatsCustomRangeDays,
    syncStatsToCurrentPeriod,
    trackStatsControl,
    toDateKey,
    toast,
  } = ctx;

  const customToggle = document.getElementById("statsRangeCustomToggle");
  const emptyCalendarButton = document.getElementById("statsEmptyCalendarButton");
  document.getElementById("statsMoreDetails")?.addEventListener("toggle", (event) => {
    if (event.currentTarget.open) renderStats();
  });

  // Keep any extension-provided legacy tabs accessible without restoring the old tabbed UI.
  el.statsTabs?.forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.classList.contains("active")));
  });
  el.statsPanels?.forEach((panel) => {
    const selected = panel.classList.contains("active");
    panel.hidden = !selected;
  });

  const syncCustomRangeDisclosure = () => {
    const customSelected = state.statsRangeMode === "custom";
    if (customToggle) {
      customToggle.classList.toggle("active", customSelected);
      customToggle.setAttribute("aria-pressed", String(customSelected));
      customToggle.setAttribute("aria-expanded", String(customSelected));
    }
    if (el.statsRangeCustom) el.statsRangeCustom.hidden = !customSelected;
  };

  const selectStatsRange = (next) => {
    if (state.statsRangeMode === next) {
      if (next !== "custom") {
        if (syncStatsToCurrentPeriod?.()) state.statsDetailDate = "";
        renderStats();
      }
      syncCustomRangeDisclosure();
      return;
    }
    state.statsRangeMode = next;
    state.statsDetailDate = "";
    if (next !== "custom") {
      syncStatsToCurrentPeriod?.();
    }
    if (next === "custom" && (!state.statsRangeCustom.from || !state.statsRangeCustom.to)) {
      const today = new Date();
      const monthAgo = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
      state.statsRangeCustom = { from: toDateKey(monthAgo), to: toDateKey(today) };
      if (el.statsRangeFrom) el.statsRangeFrom.value = state.statsRangeCustom.from;
      if (el.statsRangeTo) el.statsRangeTo.value = state.statsRangeCustom.to;
    }
    renderStats();
    syncCustomRangeDisclosure();
    trackStatsControl?.("range_changed");
  };

  el.statsPrevMonth?.addEventListener("click", () => {
    if (state.statsRangeMode !== "thisMonth") return;
    moveStatsMonth(-1);
  });
  el.statsNextMonth?.addEventListener("click", () => {
    if (state.statsRangeMode !== "thisMonth") return;
    moveStatsMonth(1);
  });

  if (el.statsRangeTabs) {
    el.statsRangeTabs.querySelectorAll("button[data-range]").forEach((button) => {
      button.addEventListener("click", () => selectStatsRange(button.dataset.range));
    });
  }
  if (customToggle) customToggle.addEventListener("click", () => selectStatsRange("custom"));
  if (el.statsRangeApply) {
    el.statsRangeApply.addEventListener("click", () => {
      const from = el.statsRangeFrom.value || "";
      const to = el.statsRangeTo.value || "";
      if (!from || !to || from > to) {
        toast?.("조회 시작일과 종료일을 확인해 주세요.", "error");
        (from && to && from > to ? el.statsRangeTo : el.statsRangeFrom)?.focus();
        return;
      }
      const dayCount = statsRangeDayCount?.(from, to) || 0;
      if (dayCount > maxStatsCustomRangeDays) {
        toast?.(`직접 조회는 최대 ${maxStatsCustomRangeDays}일(약 3년)까지 가능합니다.`, "error");
        el.statsRangeTo?.focus();
        return;
      }
      state.statsRangeCustom = {
        from,
        to,
      };
      state.statsRangeMode = "custom";
      state.statsDetailDate = "";
      renderStats();
      syncCustomRangeDisclosure();
      trackStatsControl?.("custom_range_applied");
    });
  }

  if (el.statsChartToggle) {
    el.statsChartToggle.querySelectorAll("button[data-metric]").forEach((button) => {
      button.addEventListener("click", () => {
        const next = button.dataset.metric === "count" ? "count" : "revenue";
        if (state.statsChartMetric === next) return;
        state.statsChartMetric = next;
        renderStats();
        trackStatsControl?.("chart_metric_changed");
      });
    });
  }

  if (el.statsChart) {
    const handler = (event) => {
      const pointer = event.touches ? event.touches[0] : event;
      showChartTooltip(pointer.clientX);
    };
    el.statsChart.addEventListener("click", handler);
    el.statsChart.addEventListener("touchstart", handler, { passive: true });
    el.statsChart.addEventListener("keydown", (event) => {
      const pointCount = Number.parseInt(el.statsChart.dataset.pointCount || "0", 10);
      if (!pointCount) return;
      let index = Number.parseInt(el.statsChart.dataset.keyboardIndex || "-1", 10);
      const hasCurrentIndex = Number.isInteger(index) && index >= 0 && index < pointCount;
      if (event.key === "ArrowLeft") index = hasCurrentIndex ? Math.max(0, index - 1) : 0;
      else if (event.key === "ArrowRight") index = hasCurrentIndex ? Math.min(pointCount - 1, index + 1) : 0;
      else if (event.key === "Home") index = 0;
      else if (event.key === "End") index = pointCount - 1;
      else if (event.key === "Enter" || event.key === " ") index = hasCurrentIndex ? index : 0;
      else if (event.key === "Escape") {
        if (el.statsChartTooltip) el.statsChartTooltip.hidden = true;
        return;
      } else return;
      event.preventDefault();
      el.statsChart.dataset.keyboardIndex = String(index);
      showChartTooltipAtIndex?.(index);
    });
    document.addEventListener("click", (event) => {
      if (!el.statsChartTooltip || el.statsChartTooltip.hidden) return;
      if (event.target === el.statsChart) return;
      el.statsChartTooltip.hidden = true;
    });
  }

  if (emptyCalendarButton) {
    emptyCalendarButton.addEventListener("click", () => {
      document.querySelector('.nav-tab[data-view="home"]')?.click();
    });
  }

  syncCustomRangeDisclosure();
}
