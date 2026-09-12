export function bindCalendarEvents(ctx) {
  const {
    el,
    state,
    addDays,
    confirmOffWithExistingCounts,
    defaultEntryRows,
    discardRecordDraft,
    getRecord,
    hasEnteredCounts,
    moveMonth,
    renderAll,
    renderEntryForm,
    scheduleSave,
    selectDate,
    selectToday,
    showView,
    startRecordDraft,
  } = ctx;

  el.navTabs.forEach((tab) => tab.addEventListener("click", () => showView(tab.dataset.view)));
  el.openSettings.addEventListener("click", () => showView("settings"));
  el.backFromSettings.addEventListener("click", () => showView("home"));
  el.prevMonth.addEventListener("click", () => moveMonth(-1));
  el.nextMonth.addEventListener("click", () => moveMonth(1));
  el.todayButton.addEventListener("click", selectToday);
  el.homeOffToggle.addEventListener("click", () => {
    const record = getRecord(state.selectedDate, true);
    const nextOff = !record.off;
    if (nextOff && hasEnteredCounts(record) && !confirmOffWithExistingCounts(state.selectedDate)) return;
    record.off = nextOff;
    if (record.off) record.rows = [];
    else record.rows = defaultEntryRows();
    scheduleSave({ dateKeys: [state.selectedDate] });
    renderAll();
  });
  el.openRecord.addEventListener("click", () => { startRecordDraft(); showView("record"); });
  el.backToCalendar.addEventListener("click", () => { discardRecordDraft(); renderAll(); showView("home"); });
  el.prevDay.addEventListener("click", () => { discardRecordDraft(); selectDate(addDays(state.selectedDate, -1)); renderEntryForm(); });
  el.nextDay.addEventListener("click", () => { discardRecordDraft(); selectDate(addDays(state.selectedDate, 1)); renderEntryForm(); });
}
