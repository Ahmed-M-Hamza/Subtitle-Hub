import { OPENSUBTITLES_READY, SUBDL_READY } from "./config.js";
import { searchOpenSubtitles } from "./opensubtitles.js";
import { buildSubdlParams, mapSubdlSubtitles, subdlFetch } from "./subdl.js";

export const SUBTITLE_PROVIDERS = ["all", "subdl", "opensubtitles"];

export function normalizeProviderFilter(raw) {
  const value = String(raw || "all").trim().toLowerCase();
  return SUBTITLE_PROVIDERS.includes(value) ? value : "all";
}

function dedupeSubtitles(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = [
      String(item.language || "").toLowerCase(),
      String(item.releaseName || "").toLowerCase(),
      String(item.season || ""),
      String(item.episode || ""),
      String(item.downloadUrl || "").toLowerCase()
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function sortSubtitles(items) {
  return items.sort((a, b) => {
    const byProvider = String(a.provider).localeCompare(String(b.provider));
    if (byProvider !== 0) return byProvider;
    const byLang = String(a.language).localeCompare(String(b.language));
    if (byLang !== 0) return byLang;
    return String(a.releaseName).localeCompare(String(b.releaseName));
  });
}

function classifyProviderFailureKind(message) {
  const m = String(message || "").toLowerCase();
  if (/\b429\b/.test(m) || m.includes("rate limit") || m.includes("too many requests") || m.includes("quota exceeded")) {
    return "limit";
  }
  if (m.includes("not configured") || m.includes("api_key")) return "config";
  return "generic";
}

function buildProviderHealthSummary({ providerFilter, requestedProviders, providerErrors, subtitles }) {
  const req = (requestedProviders || []).map((p) => String(p || "").toLowerCase()).filter(Boolean);
  const failedSet = new Set();
  const failureKinds = {};
  for (const e of providerErrors || []) {
    const id = String(e.provider || "").toLowerCase();
    if (!id) continue;
    failedSet.add(id);
    if (!failureKinds[id]) failureKinds[id] = classifyProviderFailureKind(e.message);
  }
  const failed = [...failedSet];
  const succeeded = req.filter((p) => !failedSet.has(p));
  const inResults = new Set();
  for (const s of subtitles || []) {
    const p = String(s.provider || "").toLowerCase();
    if (p) inResults.add(p);
  }
  const providersWithData = [...inResults];
  const anyRateLimited = Object.values(failureKinds).some((k) => k === "limit");
  const wantBoth = req.length >= 2;
  let tier = "full";
  if (providerFilter !== "all") {
    if (failed.length >= req.length) tier = "unavailable";
    else if (succeeded.length) tier = "focused";
    else tier = "unavailable";
  } else if (wantBoth) {
    if (failed.length === 0) {
      if (!subtitles.length) tier = "no_matches_upstream";
      else if (providersWithData.length >= 2) tier = subtitles.length <= 4 ? "sparse" : "full";
      else tier = "partial_catalog";
    } else if (failed.length === 1) {
      tier = subtitles.length ? "partial_outage" : "partial_outage_empty";
    } else tier = "unavailable";
  } else if (!succeeded.length) tier = "unavailable";
  else if (!subtitles.length) tier = "no_matches_upstream";

  return {
    tier,
    requestedProviders: req,
    failedProviders: failed,
    succeededProviders: succeeded,
    providersWithData,
    failureKinds,
    anyRateLimited,
    fallbackAssisted: false,
    alternateRouteOffered: false
  };
}

export async function aggregateSubtitles(params, options = {}) {
  const {
    tmdbId,
    mediaType,
    language,
    season,
    episode,
    year,
    provider
  } = params;
  const log = options.log || (() => {});
  const providerFilter = normalizeProviderFilter(provider);
  const providersRequested =
    providerFilter === "all" ? ["subdl", "opensubtitles"] : [providerFilter];

  const providerErrors = [];
  const all = [];
  let successCount = 0;

  if (providersRequested.includes("subdl")) {
    if (!SUBDL_READY) {
      providerErrors.push({
        provider: "subdl",
        message: "SUBDL_API_KEY is not configured"
      });
    } else {
      try {
        const payload = await subdlFetch(
          buildSubdlParams({
            tmdbId,
            mediaType,
            languages: language,
            season,
            episode,
            year
          })
        );
        all.push(...mapSubdlSubtitles(payload, language));
        successCount += 1;
      } catch (error) {
        providerErrors.push({ provider: "subdl", message: error.message });
        log("SubDL fetch failed", { error: error.message, tmdbId, mediaType });
      }
    }
  }

  if (providersRequested.includes("opensubtitles")) {
    if (!OPENSUBTITLES_READY) {
      providerErrors.push({
        provider: "opensubtitles",
        message: "OPENSUBTITLES_API_KEY is not configured"
      });
    } else {
      try {
        const results = await searchOpenSubtitles(
          { tmdbId, mediaType, language, season, episode, year },
          (message, meta) => log(message, { ...meta, provider: "opensubtitles" })
        );
        all.push(...results);
        successCount += 1;
      } catch (error) {
        providerErrors.push({ provider: "opensubtitles", message: error.message });
        log("OpenSubtitles fetch failed", { error: error.message, tmdbId, mediaType });
      }
    }
  }

  const merged = sortSubtitles(dedupeSubtitles(all));
  const providerHealth = buildProviderHealthSummary({
    providerFilter,
    requestedProviders: providersRequested,
    providerErrors,
    subtitles: merged
  });

  return {
    providerFilter,
    requestedProviders: providersRequested,
    providerErrors,
    subtitles: merged,
    successCount,
    allFailed: providersRequested.length > 0 && successCount === 0,
    providerHealth
  };
}
