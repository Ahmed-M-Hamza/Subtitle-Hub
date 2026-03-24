import {
  getMediaDetailsById,
  json,
  logInfo,
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
    const tmdbId = String(params.get("tmdbId") || "").trim();
    const mediaType = parseMediaType(params.get("mediaType"));

    logInfo("media-details called", {
      hasTmdbId: Boolean(tmdbId),
      mediaType
    });

    if (!tmdbId) {
      return json(400, { ok: false, error: "tmdbId is required" });
    }
    if (!/^\d+$/.test(tmdbId)) {
      return json(400, { ok: false, error: "tmdbId must be numeric" });
    }

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

