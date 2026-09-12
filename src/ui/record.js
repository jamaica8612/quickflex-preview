export function bindRecordEvents(ctx) {
  const {
    el,
    state,
    confirmOffWithExistingCounts,
    currentRecordDraft,
    defaultEntryRows,
    ensurePendingSavesFlushed,
    hasAutomaticEntries,
    hasEnteredCounts,
    isBackupDriver,
    refreshTotals,
    renderAll,
    renderEntryForm,
    renderMonth,
    saveCurrentRecordAndGoHome,
    scheduleSave,
    syncFormToRecord,
    toast,
    upsertRate,
    normalizeRoute,
    isKnownRateRoute,
    renderRates,
  } = ctx;

  el.offToggle.addEventListener("change", () => {
    const record = currentRecordDraft();
    if (el.offToggle.checked && hasEnteredCounts(record) && !confirmOffWithExistingCounts(state.selectedDate)) {
      el.offToggle.checked = false;
      return;
    }
    record.off = el.offToggle.checked;
    if (record.off) record.rows = [];
    else record.rows = defaultEntryRows();
    renderEntryForm();
    refreshTotals();
  });
  el.addRoute.addEventListener("click", () => {
    const record = currentRecordDraft();
    record.off = false;
    const firstRate = isBackupDriver() ? state.rates[0] || state.defaultRates[0] : null;
    const automatic = hasAutomaticEntries(record);
    const baseUnit = Number(firstRate?.unit || 0);
    const backupUnit = isBackupDriver() ? Number(record.backupUnit || 0) : 0;
    record.rows.push(automatic
      ? { route: firstRate?.route || "", count: "", unit: baseUnit + backupUnit, source: "override", readOnly: true, draft: false }
      : { route: firstRate?.route || "", count: "", unit: baseUnit, draft: !firstRate });
    renderEntryForm();
  });
  [el.freshCount, el.freshUnit, el.backupUnit].forEach((input) => input.addEventListener("input", () => {
    refreshTotals();
  }));
  [el.freshSoloCount, el.freshLinkedCount].forEach((input) => input.addEventListener("input", () => {
    syncFormToRecord();
    refreshTotals();
  }));
  document.querySelectorAll('input[name="freshbagMode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      if (state.profile) state.profile.freshbag_mode = radio.value;
      renderEntryForm();
    });
  });
  el.saveRecord.addEventListener("click", saveCurrentRecordAndGoHome);
  el.modeBtns.forEach((button) => button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    el.modeBtns.forEach((target) => {
      const selected = target === button;
      target.classList.toggle("active", selected);
      target.setAttribute("aria-pressed", String(selected));
    });
    ctx.setDisplayPreference({ calendarMetric: state.mode });
  }));
  el.saveRate.addEventListener("click", async () => {
    const route = normalizeRoute(el.rateRoute.value);
    if (route && isBackupDriver() && !isKnownRateRoute(route)) {
      const ok = window.confirm(`새 업무 구역 ${route}를 추가할까요? 추가하면 달력과 기록하기 화면에서 계속 사용할 수 있습니다.`);
      if (!ok) return;
    }
    if (!upsertRate(el.rateRoute.value, el.rateUnit.value)) return toast("구역과 단가를 확인해 주세요.", "error");
    el.rateRoute.value = "";
    el.rateUnit.value = "";
    renderRates();
    renderAll();
    scheduleSave({ rates: true, immediate: true });
    try {
      await ensurePendingSavesFlushed();
      toast("내 단가를 저장했습니다.", "success");
    } catch (error) {
      if (error?.quickflexHandled) return;
      toast(`단가 저장 실패: ${error.message}`, "error");
    }
  });
}
