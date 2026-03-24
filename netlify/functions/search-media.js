import {
  json,
  logInfo,
  parseSearchType,
  requireSearchConfig,
  searchMedia
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
    const query = String(params.get("query") || "").trim();
    const type = parseSearchType(params.get("type"));
    const year = String(params.get("year") || "").trim();

    logInfo("search-media called", {
      hasQuery: Boolean(query),
      type,
      hasYear: Boolean(year)
    });

    if (!query) {
      return json(400, { ok: false, error: "query is required" });
    }

    const results = await searchMedia(query, type, year);
    logInfo("search-media success", { count: results.length, type });
    return json(200, { ok: true, results });
  } catch (error) {
    return json(500, {
      ok: false,
      error: error.message || "Internal server error"
    });
  }
}

