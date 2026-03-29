import {
  aggregateSubtitles,
  json,
  logInfo,
  normalizeLanguageCode,
  normalizePositiveInt,
  normalizeProviderFilter,
  normalizeShortText,
  parseMediaType,
  requireSubtitlesConfig,
  SUBTITLES_PIPELINE_CACHE_REV,
  validateTvEpisodeContext
} from "./_shared.js";
import { cacheKey, getOrSetCache } from "./_shared/cache.js";

export async function handler(event) {
  try {
    const missing = requireSubtitlesConfig();
    if (missing.length) {
      return json(503, {
        ok: false,
        error: "Missing environment variables",
        missing
      });
    }

    const params = new URLSearchParams(event.queryStringParameters || {});
    const tmdbIdCheck = normalizePositiveInt(params.get("tmdbId"), {
      min: 1,
      max: 999999999,
      name: "tmdbId"
    });
    if (!tmdbIdCheck.ok) return json(400, { ok: false, error: tmdbIdCheck.error });
    const tmdbId = tmdbIdCheck.value;
    const mediaType = parseMediaType(params.get("mediaType"));
    const language = normalizeLanguageCode(params.get("language") || "");
    let season = "";
    let episode = "";
    if (mediaType === "tv") {
      const seasonCheck = normalizePositiveInt(params.get("season"), {
        min: 1,
        max: 200,
        name: "season"
      });
      if (!seasonCheck.ok) return json(400, { ok: false, error: seasonCheck.error });
      season = seasonCheck.value;
      if (!season) {
        return json(400, {
          ok: false,
          code: "tv_needs_season",
          error: "Season is required for TV subtitles",
          missing: ["season"]
        });
      }
      const epRaw = String(params.get("episode") || "").trim();
      if (epRaw) {
        const episodeCheck = normalizePositiveInt(epRaw, {
          min: 1,
          max: 5000,
          name: "episode"
        });
        if (!episodeCheck.ok) return json(400, { ok: false, error: episodeCheck.error });
        episode = String(episodeCheck.value);
      }
    } else {
      const seasonCheck = normalizePositiveInt(params.get("season"), {
        min: 1,
        max: 200,
        name: "season"
      });
      if (!seasonCheck.ok) return json(400, { ok: false, error: seasonCheck.error });
      season = seasonCheck.value;
      const episodeCheck = normalizePositiveInt(params.get("episode"), {
        min: 1,
        max: 5000,
        name: "episode"
      });
      if (!episodeCheck.ok) return json(400, { ok: false, error: episodeCheck.error });
      episode = episodeCheck.value;
    }
    const yearCheck = normalizePositiveInt(params.get("year"), {
      min: 1888,
      max: 2100,
      name: "year"
    });
    if (!yearCheck.ok) return json(400, { ok: false, error: yearCheck.error });
    const year = yearCheck.value;
    const fileNameCheck = normalizeShortText(params.get("fileName"), {
      max: 260,
      name: "fileName"
    });
    if (!fileNameCheck.ok) return json(400, { ok: false, error: fileNameCheck.error });
    const fileName = fileNameCheck.value;
    const provider = normalizeProviderFilter(params.get("provider"));
    const debug = String(params.get("debug") || "").trim() === "1";
    const diagnosticsFlag = String(params.get("diagnostics") || "").trim() === "1";
    const tvQueryMode = mediaType === "tv" ? (episode ? "episode" : "season") : null;

    logInfo("subtitles called", {
      hasTmdbId: Boolean(tmdbId),
      mediaType,
      language,
      provider,
      tvQueryMode,
      hasSeason: Boolean(season),
      hasEpisode: Boolean(episode),
      hasFileName: Boolean(fileName)
    });

    if (mediaType === "tv" && episode) {
      try {
        const tvContext = await validateTvEpisodeContext(tmdbId, season, episode);
        logInfo("tvmaze episode validation", {
          tmdbId,
          season,
          episode,
          attempted: tvContext.attempted,
          matchedShow: tvContext.matchedShow,
          episodeFound: tvContext.episodeFound,
          tvmazeId: tvContext.tvmazeId || null
        });
      } catch (error) {
        logInfo("tvmaze episode validation failed", {
          tmdbId,
          season,
          episode,
          error: error?.message || "unknown"
        });
      }
    }

    const agg = await getOrSetCache(
      "subtitles",
      cacheKey([
        tmdbId,
        mediaType,
        language,
        season,
        episode || "__season_only__",
        year,
        provider,
        fileName,
        diagnosticsFlag ? "diag1" : "diag0",
        `rev${SUBTITLES_PIPELINE_CACHE_REV}`
      ]),
      2 * 60 * 1000,
      () =>
        aggregateSubtitles({
          tmdbId,
          mediaType,
          language,
          season,
          episode,
          year,
          provider,
          fileName,
          tvQueryMode,
          includeClassificationTrace: diagnosticsFlag
        })
    );

    if (agg.allFailed) {
      logInfo("subtitles all providers failed", {
        provider,
        errors: agg.providerErrors.length
      });
      return json(502, {
        ok: false,
        error: "All subtitle providers failed",
        providerErrors: agg.providerErrors,
        ...(debug ? { debugCounts: agg.debugCounts } : {})
      });
    }

    logInfo("subtitles success", {
      provider,
      count: agg.subtitles.length,
      providerErrors: agg.providerErrors.length,
      ...agg.debugCounts,
      ...(diagnosticsFlag ? { diagnostics: agg.diagnostics } : {})
    });
    return json(200, {
      ok: true,
      tvQueryMode: tvQueryMode || undefined,
      provider: agg.provider,
      providerErrors: agg.providerErrors,
      subtitles: agg.subtitles,
      alternateSubtitles: Array.isArray(agg.alternateSubtitles) ? agg.alternateSubtitles : [],
      providerHealth: agg.providerHealth || null,
      ...(debug ? { debugCounts: agg.debugCounts } : {}),
      ...(diagnosticsFlag ? { diagnostics: agg.diagnostics } : {})
    });
  } catch (error) {
    return json(500, {
      ok: false,
      error: error.message || "Internal server error"
    });
  }
}

