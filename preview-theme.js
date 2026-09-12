(() => {
  const key = "quickflex-public-preview-theme";
  let theme = "dark";
  try {
    const saved = localStorage.getItem(key);
    if (["dark", "light", "system"].includes(saved)) theme = saved;
    else localStorage.setItem(key, theme);
  } catch (_) {}
  if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme;
})();
