import {
  json,
  logInfo,
  normalizePositiveInt,
  normalizeQuery,
  parseSearchType,
  requireSearchConfig,
  searchSuggestions
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
    const queryCheck = normalizeQuery(params.get("query"), { min: 2, max: 100 });
    if (!queryCheck.ok) return json(400, { ok: false, error: queryCheck.error });
    const query = queryCheck.value;
    const type = parseSearchType(params.get("type"));
    const yearCheck = normalizePositiveInt(params.get("year"), {
      min: 1888,
      max: 2100,
      name: "year"
    });
    if (!yearCheck.ok) return json(400, { ok: false, error: yearCheck.error });
    const year = yearCheck.value;
    const limitCheck = normalizePositiveInt(params.get("limit") || 8, {
      min: 1,
      max: 12,
      name: "limit"
    });
    if (!limitCheck.ok) return json(400, { ok: false, error: limitCheck.error });
    const limit = Number(limitCheck.value || 8);

    const items = await searchSuggestions(query, type, year, limit);
    logInfo("suggestions success", {
      hasQuery: true,
      type,
      count: items.length,
      hasYear: Boolean(year)
    });
    return json(200, { ok: true, items });
  } catch (error) {
    return json(500, {
      ok: false,
      error: error.message || "Internal server error"
    });
  }
}

