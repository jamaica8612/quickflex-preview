export function bindSettingsEvents(ctx) {
  const {
    el,
    applyTheme,
    currentUserId,
    renderAll,
    saveGoalAmount,
    saveProfile,
    setCalendarRoutesPreference,
    shouldShowCalendarRoutes,
    toast,
  } = ctx;

  document.querySelectorAll('input[name="calendarRoutes"]').forEach((radio) => {
    radio.checked = shouldShowCalendarRoutes() === (radio.value === "show");
    radio.addEventListener("change", () => {
      setCalendarRoutesPreference(radio.value === "show");
      renderAll();
    });
  });
  document.querySelectorAll('input[name="monthView"], input[name="calendarMetric"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      ctx.setDisplayPreference({
        [radio.name === "monthView" ? "monthView" : "calendarMetric"]: radio.value,
      });
    });
  });
  document.querySelectorAll('input[name="freshbagMode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      if (ctx.state.profile) ctx.state.profile.freshbag_mode = radio.value;
    });
  });
  document.querySelectorAll('input[name="workShift"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      if (ctx.state.profile) ctx.state.profile.work_shift = radio.value === "night" ? "night" : "day";
    });
  });
  el.saveProfile?.addEventListener("click", () => saveProfile().catch((error) => toast(`가상 프로필 저장 실패: ${error.message}`, "error")));
  el.goalAmountInput?.addEventListener("input", () => {
    const raw = parseInt(el.goalAmountInput.value.replace(/,/g, ""), 10) || 0;
    el.goalAmountInput.value = raw > 0 ? raw.toLocaleString("ko-KR") : "";
  });
  el.saveAppSettings?.addEventListener("click", () => saveGoalAmount().catch((error) => toast(`가상 목표 저장 실패: ${error.message}`, "error")));
  document.querySelectorAll("[data-theme-set]").forEach((button) => {
    button.addEventListener("click", () => applyTheme(button.dataset.themeSet));
  });
  el.refreshApp?.addEventListener("click", () => location.reload());

  // Keep the preview profile scoped to one anonymous local fixture.
  void currentUserId;
}
