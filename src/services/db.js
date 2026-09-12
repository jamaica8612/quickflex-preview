import { DEFAULT_ROUTE_MASTER } from "../config.js";
import { normalizeRoute } from "../lib/route.js";
import { toNum } from "../lib/revenue.js";

const GOAL_SETTING_ROUTE = "__GOAL__";

export function ratesFromDb(rows) {
  return (rows || []).map((row) => ({
    route: normalizeRoute(row.route),
    unit: toNum(row.current_unit),
    count: 0,
    amount: 0,
  }))
    .filter((row) => row.route && row.route !== GOAL_SETTING_ROUTE)
    .sort((a, b) => a.route.localeCompare(b.route));
}

export function mergeDefaultRouteMaster(rates) {
  const byRoute = new Map((rates || []).map((rate) => {
    const route = normalizeRoute(rate.route);
    return [route, { ...rate, route, unit: toNum(rate.unit) }];
  }));
  let changed = false;
  DEFAULT_ROUTE_MASTER.forEach((route) => {
    if (byRoute.has(route)) return;
    byRoute.set(route, { route, unit: 0, count: 0, amount: 0 });
    changed = true;
  });
  return { rates: [...byRoute.values()].sort((a, b) => a.route.localeCompare(b.route)), changed };
}
