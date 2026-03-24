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

  return {
    providerFilter,
    requestedProviders: providersRequested,
    providerErrors,
    subtitles: merged,
    successCount,
    allFailed: providersRequested.length > 0 && successCount === 0
  };
}
