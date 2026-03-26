import {
  getMediaDetailsById,
  json,
  logInfo,
  normalizePositiveInt,
  parseMediaType,
  requireSearchConfig
} from "./_shared.js";

export async function handler(event) {
  try {
    const missing = requireSearchConfig();
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

    logInfo("media-details called", {
      hasTmdbId: Boolean(tmdbId),
      mediaType
    });

    const media = await getMediaDetailsById(mediaType, tmdbId);
    logInfo("media-details success", {
      tmdbId: media.tmdbId,
      mediaType: media.mediaType
    });
    return json(200, { ok: true, media });
  } catch (error) {
    return json(500, {
      ok: false,
      error: error.message || "Internal server error"
    });
  }
}

