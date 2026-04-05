/**
 * Subtitle Hub product analytics — pluggable adapters, privacy-minded payloads.
 * Debug logging: localStorage subtitlehub.analyticsDebug=1, or ?analyticsDebug=1, or localhost.
 * Reporting plan (dashboards, KPIs, funnels): docs/analytics-reporting.md
 */

const adapters = [];
let debugResolved = false;
let debugEnabled = false;

function resolveDebug() {
  if (debugResolved) return debugEnabled;
  debugResolved = true;
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem("subtitlehub.analyticsDebug") === "1") {
      debugEnabled = true;
      return true;
    }
  } catch {
    /* ignore */
  }
  if (typeof location !== "undefined") {
    if (location.search.includes("analyticsDebug=1")) {
      debugEnabled = true;
      return true;
    }
    const h = location.hostname;
    if (h === "localhost" || h === "127.0.0.1") {
      debugEnabled = true;
      return true;
    }
  }
  return false;
}

/** Register a backend (Segment, custom API, etc.). Receives one normalized event object per call. */
export function registerAnalyticsAdapter(fn) {
  if (typeof fn === "function") adapters.push(fn);
}

function omitEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    out[k] = v;
  }
  return out;
}

/**
 * Route-derived context for events (no raw search queries).
 * @param {object} route - parseLocation() shape
 */
export function contextFromRoute(route) {
  if (!route || typeof route !== "object") return {};
  const sourceAreaByPage = { home: "homepage", search: "search", media: "media", subtitles: "subtitles" };
  return omitEmpty({
    sourceArea: sourceAreaByPage[route.page],
    mediaType: route.mediaType,
    tmdbId: route.tmdbId,
    season: route.season,
    episode: route.episode,
    language: route.language,
    provider: route.provider
  });
}

/** Merge route context with subtitle API fields (tvQueryMode, health tier, counts). */
export function subtitlesViewContext(route, extras = {}) {
  return omitEmpty({
    ...contextFromRoute(route),
    ...extras
  });
}

/**
 * @param {string} name - use AnalyticsEvent.*
 * @param {Record<string, unknown>} props - actionKind, resultCount, hasBestPick, etc.
 */
export function trackProductEvent(name, props = {}) {
  const event = omitEmpty({
    event: name,
    v: 1,
    app: "subtitlehub",
    ts: new Date().toISOString(),
    ...props
  });
  for (const fn of adapters) {
    try {
      fn(event);
    } catch {
      /* never break product flow */
    }
  }
  if (typeof window !== "undefined" && Array.isArray(window.dataLayer)) {
    window.dataLayer.push({ ...event });
  }
  try {
    window.dispatchEvent(new CustomEvent("subtitlehub:track", { detail: event }));
  } catch {
    /* ignore */
  }
  if (resolveDebug()) console.info("[subtitlehub:analytics]", event);
}

/** Canonical event names (stable for warehouses / dashboards). */
export const AnalyticsEvent = {
  SEARCH_SUBMITTED: "search_submitted",
  SEARCH_SUGGESTION_SELECTED: "search_suggestion_selected",
  SEARCH_RESULT_CLICKED: "search_result_clicked",
  SEARCH_RESULTS_VIEWED: "search_results_viewed",
  RECENT_SEARCH_CLICKED: "recent_search_clicked",
  MEDIA_PAGE_VIEWED: "media_page_viewed",
  SUBTITLES_PAGE_VIEWED: "subtitles_page_viewed",
  /** Subtitle API fetch threw or non-OK before any rows rendered (hard failure). */
  SUBTITLES_LOAD_FAILED: "subtitles_load_failed",
  SUBTITLE_FILTERS_CHANGED: "subtitle_filters_changed",
  SUBTITLE_LANGUAGE_FILTER_CHANGED: "subtitle_language_filter_changed",
  SUBTITLE_PROVIDER_FILTER_CHANGED: "subtitle_provider_filter_changed",
  SUBTITLE_BEST_PICK_SHOWN: "subtitle_best_pick_shown",
  SUBTITLE_BEST_PICK_DOWNLOAD_CLICKED: "subtitle_best_pick_download_clicked",
  SUBTITLE_DOWNLOAD_CLICKED: "subtitle_download_clicked",
  SUBTITLE_DOWNLOAD_RESOLVED: "subtitle_download_resolved",
  VIEW_SOURCE_CLICKED: "view_source_clicked",
  LOAD_MORE_CLICKED: "load_more_clicked",
  NO_RESULTS_SHOWN: "no_results_shown",
  NO_RESULTS_RECOVERY_CLICKED: "no_results_recovery_clicked",
  CONTINUE_BROWSING_CLICKED: "continue_browsing_clicked",
  HOME_CARD_CLICKED: "home_card_clicked",
  PROVIDER_HEALTH_DEGRADED_SHOWN: "provider_health_degraded_shown",
  FILENAME_MATCHING_USED: "filename_matching_used"
};

registerAnalyticsAdapter((event) => {
  if (typeof window.gtag === "function") {
    const { event: name, ...rest } = event;
    window.gtag("event", name, { event_category: "subtitlehub", ...rest });
  }
});

registerAnalyticsAdapter((event) => {
  if (typeof window.plausible === "function") {
    const { event: name, ...rest } = event;
    window.plausible(name, { props: rest });
  }
});

registerAnalyticsAdapter((event) => {
  if (window.posthog && typeof window.posthog.capture === "function") {
    const { event: name, ...rest } = event;
    window.posthog.capture(name, rest);
  }
});

/** Optional global hook for non-module boot scripts: `SubtitleHubAnalytics.registerAnalyticsAdapter(fn)`. */
if (typeof window !== "undefined") {
  window.SubtitleHubAnalytics = {
    registerAnalyticsAdapter,
    trackProductEvent,
    AnalyticsEvent,
    contextFromRoute,
    subtitlesViewContext
  };
}
