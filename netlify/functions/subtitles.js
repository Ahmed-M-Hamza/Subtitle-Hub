import {
  aggregateSubtitles,
  json,
  logInfo,
  normalizeLanguageCode,
  normalizeProviderFilter,
  parseMediaType,
  requireSubtitlesConfig
} from "./_shared.js";

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
    const tmdbId = String(params.get("tmdbId") || "").trim();
    const mediaType = parseMediaType(params.get("mediaType"));
    const language = normalizeLanguageCode(params.get("language") || "ar");
    const season = String(params.get("season") || "").trim();
    const episode = String(params.get("episode") || "").trim();
    const year = String(params.get("year") || "").trim();
    const provider = normalizeProviderFilter(params.get("provider"));

    logInfo("subtitles called", {
      hasTmdbId: Boolean(tmdbId),
      mediaType,
      language,
      provider,
      hasSeason: Boolean(season),
      hasEpisode: Boolean(episode)
    });

    if (!tmdbId) {
      return json(400, { ok: false, error: "tmdbId is required" });
    }

    const agg = await aggregateSubtitles({
      tmdbId,
      mediaType,
      language,
      season,
      episode,
      year,
      provider
    });

    if (agg.allFailed) {
      logInfo("subtitles all providers failed", {
        provider,
        errors: agg.providerErrors.length
      });
      return json(502, {
        ok: false,
        error: "All subtitle providers failed",
        providerErrors: agg.providerErrors
      });
    }

    logInfo("subtitles success", {
      provider,
      count: agg.subtitles.length,
      providerErrors: agg.providerErrors.length
    });
    return json(200, {
      ok: true,
      provider: agg.provider,
      providerErrors: agg.providerErrors,
      subtitles: agg.subtitles
    });
  } catch (error) {
    return json(500, {
      ok: false,
      error: error.message || "Internal server error"
    });
  }
}

