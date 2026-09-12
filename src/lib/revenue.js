export function toNum(value) {
  return Number(String(value ?? "").replace(/[^\d.-]/g, "")) || 0;
}

export function routeRevenue(count, unit) {
  return (Number(count) || 0) * (Number(unit) || 0);
}
