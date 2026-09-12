export const PUBLIC_SUPABASE_CONFIG = Object.freeze({ url: "", anonKey: "" });
export const PUBLIC_SITE_URL = "";

// The public preview intentionally has no production table or RPC identities.
export const TABLES = Object.freeze({
  profiles: "", rates: "", days: "", items: "", workResults: "",
  workResultRoutes: "", workResultRouteDetails: "", automaticSalesOverrides: "",
  salesWorkResults: "", salesWorkRoutes: "", salesWorkDetails: "",
  salesOverrides: "", bundles: "", inspections: "", inspectionSignatures: "",
});
export const RPC = Object.freeze({
  replaceManualDayRecord: "preview_replace_manual_day",
  replaceAutomaticSalesOverride: "preview_replace_automatic_sales",
  replaceTeamSalesOverride: "preview_replace_team_sales",
  updateSalesDay: "preview_update_sales_day",
});

export const DB_KEY = "quickflex-public-preview-config";
export const GOAL = 6_000_000;
export const DEFAULT_BACKUP_UNIT = 30;
export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
export const SAMPLE_SETTLEMENT = [];
export const RATE_UPDATE_OFFER = Object.freeze({ id: "public-preview", rates: [] });
export const APP_UPDATE_NOTICE = Object.freeze({ id: "public-preview", items: [] });
export const DEFAULT_ROUTE_MASTER = ["302B", "303A", "304C", "310C"];
export const DEFAULT_ROUTE_BUNDLES = [];
