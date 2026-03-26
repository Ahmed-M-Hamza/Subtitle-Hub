import dotenv from "dotenv";
import {
  fetchTvMazeEpisodeByNumber,
  fetchTvMazeSeasons,
  fetchTvMazeShowByImdb,
  fetchTvMazeShowByQuery
} from "./_shared/tvmaze.js";
import { cacheKey, getOrSetCache } from "./_shared/cache.js";

dotenv.config({ quiet: true });

const TMDB_BEARER_TOKEN = String(process.env.TMDB_BEARER_TOKEN || "").trim();
const SUBDL_API_KEY = String(process.env.SUBDL_API_KEY || "").trim();
const OPENSUBTITLES_API_KEY = String(process.env.OPENSUBTITLES_API_KEY || "").trim();
const OPENSUBTITLES_USERNAME = String(process.env.OPENSUBTITLES_USERNAME || "").trim();
const OPENSUBTITLES_PASSWORD = String(process.env.OPENSUBTITLES_PASSWORD || "").trim();
const OPENSUBTITLES_USER_AGENT = String(
  process.env.OPENSUBTITLES_USER_AGENT || "SubtitleHub-Netlify/1.0"
).trim();
const APP_NAME = String(process.env.APP_NAME || "Subtitle Hub").trim() || "Subtitle Hub";
const BOOTED_AT = Date.now();

/** Bump when TV classification / subtitle aggregation changes — included in subtitles cache key (see subtitles.js). */
export const SUBTITLES_PIPELINE_CACHE_REV = 16;
export const HOME_FEED_CACHE_REV = 1;
const SUBDL_SEASON_HTML_LOW_COUNT_THRESHOLD = 20;
const HOME_FEED_TIME_BUDGET_MS = 25000;

const TOKEN_TTL_MS = 50 * 60 * 1000;
const DOWNLOAD_LINK_TTL_MS = 10 * 60 * 1000;
const OPENSUBTITLES_API = "https://api.opensubtitles.com/api/v1";

let cachedOpenSubToken = "";
let cachedOpenSubTokenExp = 0;
let openSubLoginPromise = null;
const openSubDownloadCache = new Map();
let homeFeedBuildPromise = null;

export function logInfo(message, meta = {}) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      message,
      ...meta
    })
  );
}

export function logError(message, err, meta = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level: "error",
    message,
    ...meta
  };
  if (err && err.message) payload.error = err.message;
  console.error(JSON.stringify(payload));
}

export function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

export async function readJsonResponse(response) {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON (${response.status}): ${text.slice(0, 240)}`);
  }
}

export function normalizeLanguageCode(code = "") {
  const lower = String(code).toLowerCase().trim().replace(/_/g, "-");
  if (!lower || lower === "all" || lower === "any") return "";
  const base = lower.split("-")[0];
  const aliases = {
    arabic: "ar",
    ara: "ar",
    english: "en",
    eng: "en",
    french: "fr",
    fre: "fr",
    german: "de",
    deu: "de",
    spanish: "es",
    spa: "es",
    italian: "it",
    turkish: "tr",
    farsi: "fa",
    persian: "fa",
    "persian-farsi": "fa"
  };
  if (aliases[lower]) return aliases[lower];
  if (aliases[base]) return aliases[base];
  if (/^[a-z]{2}$/.test(base)) return base;
  return lower;
}

/**
 * SubDL language_list.json uses uppercase codes (AR, EN, FA, …). Sending lowercase can miss matches.
 */
function subdlLanguagesQueryParam(internalLang) {
  const norm = normalizeLanguageCode(String(internalLang || "").trim());
  if (!norm) return undefined;
  const two = norm.length === 2 ? norm : norm.slice(0, 2);
  if (!/^[a-z]{2}$/i.test(two)) return norm.toUpperCase();
  return two.toUpperCase();
}

export function parseMediaType(raw) {
  const v = String(raw || "").trim().toLowerCase();
  return v === "tv" ? "tv" : "movie";
}

export function parseSearchType(raw) {
  const v = String(raw || "multi").trim().toLowerCase();
  return v === "movie" || v === "tv" || v === "multi" ? v : "multi";
}

export function normalizeProviderFilter(raw) {
  const v = String(raw || "all").trim().toLowerCase();
  if (v === "subdl" || v === "opensubtitles" || v === "all") return v;
  return "all";
}

export function getHealth() {
  return {
    ok: true,
    app: APP_NAME,
    tmdbConfigured: Boolean(TMDB_BEARER_TOKEN),
    subdlConfigured: Boolean(SUBDL_API_KEY),
    opensubtitlesConfigured: Boolean(OPENSUBTITLES_API_KEY),
    ready: Boolean(TMDB_BEARER_TOKEN) && Boolean(SUBDL_API_KEY || OPENSUBTITLES_API_KEY),
    uptimeSec: Math.round((Date.now() - BOOTED_AT) / 1000),
    features: {
      suggestions: true,
      ranking: true,
      tvmazeEnrichment: true
    },
    timestamp: new Date().toISOString()
  };
}

export function normalizeQuery(raw = "", { min = 2, max = 120 } = {}) {
  const query = String(raw || "").trim().replace(/\s+/g, " ");
  if (!query) return { ok: false, error: "query is required" };
  if (query.length < min) return { ok: false, error: `query must be at least ${min} characters` };
  if (query.length > max) return { ok: false, error: `query must be <= ${max} characters` };
  return { ok: true, value: query };
}

export function normalizePositiveInt(raw = "", { min = 1, max = 9999, name = "value" } = {}) {
  const v = String(raw || "").trim();
  if (!v) return { ok: true, value: "" };
  if (!/^\d+$/.test(v)) return { ok: false, error: `${name} must be numeric` };
  const num = Number(v);
  if (num < min || num > max) return { ok: false, error: `${name} must be between ${min} and ${max}` };
  return { ok: true, value: String(num) };
}

export function normalizeShortText(raw = "", { max = 240, name = "value" } = {}) {
  const v = String(raw || "").trim();
  if (!v) return { ok: true, value: "" };
  if (v.length > max) return { ok: false, error: `${name} must be <= ${max} characters` };
  return { ok: true, value: v };
}

function tmdbHeaders() {
  return {
    Authorization: `Bearer ${TMDB_BEARER_TOKEN}`,
    Accept: "application/json"
  };
}

function tmdbErrorMessage(payload, code) {
  if (payload?.status_message) return String(payload.status_message);
  if (Array.isArray(payload?.errors) && payload.errors[0]) return String(payload.errors[0]);
  return `TMDb request failed (${code})`;
}

export async function tmdbFetch(path, searchParams = {}) {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  for (const [key, value] of Object.entries(searchParams)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url, { headers: tmdbHeaders() });
  const payload = await readJsonResponse(response);
  if (!response.ok) throw new Error(tmdbErrorMessage(payload, response.status));
  return payload;
}

export async function searchMedia(query, type, year) {
  const key = cacheKey(["searchMedia", query.toLowerCase(), type, year || ""]);
  return getOrSetCache("tmdb", key, 5 * 60 * 1000, async () => {
    const endpoint = type === "movie" ? "/search/movie" : type === "tv" ? "/search/tv" : "/search/multi";
    const pagesToFetch = 3;
    const merged = [];
    for (let page = 1; page <= pagesToFetch; page += 1) {
      const payload = await tmdbFetch(endpoint, {
        query,
        language: "en-US",
        include_adult: "false",
        year: type === "movie" ? year : undefined,
        first_air_date_year: type === "tv" ? year : undefined,
        page
      });
      const list = Array.isArray(payload.results) ? payload.results : [];
      merged.push(...list);
      if (!list.length) break;
    }
    return merged
      .filter((item) => {
        const mediaType = type === "multi" ? item.media_type : type;
        return mediaType === "movie" || mediaType === "tv";
      })
      .slice(0, 60)
      .map((item) => {
        const mediaType = type === "multi" ? item.media_type : type;
        const title = mediaType === "movie" ? item.title || item.name || "—" : item.name || item.title || "—";
        const date = mediaType === "movie" ? item.release_date : item.first_air_date;
        return {
          id: item.id,
          mediaType,
          title,
          year: date ? String(date).slice(0, 4) : "",
          overview: item.overview || "",
          poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : "",
          backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : "",
          voteAverage: Number(item.vote_average || 0),
          popularity: Number(item.popularity || 0),
          tmdbId: item.id
        };
      });
  });
}

export async function searchSuggestions(query, type, year, limit = 8) {
  const key = cacheKey(["suggestions", query.toLowerCase(), type, year || "", limit]);
  return getOrSetCache("tmdb", key, 3 * 60 * 1000, async () => {
    const endpoint = type === "movie" ? "/search/movie" : type === "tv" ? "/search/tv" : "/search/multi";
    const payload = await tmdbFetch(endpoint, {
      query,
      language: "en-US",
      include_adult: "false",
      year: type === "movie" ? year : undefined,
      first_air_date_year: type === "tv" ? year : undefined,
      page: 1
    });
    const max = Math.max(1, Math.min(Number(limit || 8), 12));
    return (payload.results || [])
      .filter((item) => {
        const mediaType = type === "multi" ? item.media_type : type;
        return mediaType === "movie" || mediaType === "tv";
      })
      .slice(0, max)
      .map((item) => {
        const mediaType = type === "multi" ? item.media_type : type;
        const title = mediaType === "movie" ? item.title || item.name || "—" : item.name || item.title || "—";
        const date = mediaType === "movie" ? item.release_date : item.first_air_date;
        return {
          tmdbId: item.id,
          mediaType,
          title,
          year: date ? String(date).slice(0, 4) : "",
          poster: item.poster_path ? `https://image.tmdb.org/t/p/w185${item.poster_path}` : ""
        };
      });
  });
}

function mapDiscoveryItem(item, forcedMediaType = "") {
  const mediaType = forcedMediaType || (item?.media_type === "tv" ? "tv" : item?.media_type === "movie" ? "movie" : "");
  if (mediaType !== "movie" && mediaType !== "tv") return null;
  const title = mediaType === "movie" ? item?.title || item?.name || "—" : item?.name || item?.title || "—";
  const date = mediaType === "movie" ? item?.release_date : item?.first_air_date;
  const year = date ? String(date).slice(0, 4) : "";
  return {
    tmdbId: Number(item?.id || 0),
    mediaType,
    title,
    year,
    overview: String(item?.overview || ""),
    poster: item?.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : "",
    backdrop: item?.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : "",
    voteAverage: Number(item?.vote_average || 0),
    popularity: Number(item?.popularity || 0)
  };
}

function dedupeDiscoveryItems(rows = []) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const mediaType = String(row?.mediaType || "").toLowerCase();
    const tmdbId = String(row?.tmdbId || "").trim();
    if (!mediaType || !tmdbId) continue;
    const key = `${mediaType}:${tmdbId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

async function probeSubdlAvailability({ tmdbId, mediaType, language = "", season = "" }) {
  if (!SUBDL_API_KEY) return { ok: false, hasSubtitles: false };
  try {
    const params =
      mediaType === "tv"
        ? {
            tmdb_id: tmdbId,
            type: "tv",
            season_number: season || 1,
            full_season: 1,
            languages: subdlLanguagesQueryParam(language),
            subs_per_page: 1
          }
        : {
            tmdb_id: tmdbId,
            type: mediaType,
            languages: subdlLanguagesQueryParam(language),
            subs_per_page: 1
          };
    const payload = await withTimeout(
      subdlFetch(params),
      2200,
      "homefeed.subdlProbe"
    );
    const rows = mapSubdl(payload, language);
    return { ok: true, hasSubtitles: rows.length > 0 };
  } catch (err) {
    logError("home-feed subdl probe failed", err, {
      tmdbId,
      mediaType,
      season: season || null,
      language: language || "all"
    });
    return { ok: false, hasSubtitles: false };
  }
}

async function probeOpenSubAvailability({ tmdbId, mediaType, language = "", season = "" }) {
  if (!OPENSUBTITLES_API_KEY) return { ok: false, hasSubtitles: false };
  try {
    const rows = await withTimeout(
      searchOpenSubtitles({
        tmdbId,
        mediaType,
        language: normalizeLanguageCode(language),
        season: mediaType === "tv" ? String(season || 1) : "",
        page: 1,
        resolveDownloads: false,
        maxResolve: 0,
        resolveTimeoutMs: 900
      }),
      2200,
      "homefeed.opensubProbe"
    );
    return { ok: true, hasSubtitles: Array.isArray(rows) && rows.length > 0 };
  } catch (err) {
    logError("home-feed opensubtitles probe failed", err, {
      tmdbId,
      mediaType,
      season: season || null,
      language: language || "all"
    });
    return { ok: false, hasSubtitles: false };
  }
}

async function subtitleAvailabilityForItem(item, { language = "" } = {}) {
  const tmdbId = Number(item?.tmdbId || 0);
  const mediaType = String(item?.mediaType || "").toLowerCase();
  if (!tmdbId || (mediaType !== "movie" && mediaType !== "tv")) {
    return { hasSubtitles: false, providers: [] };
  }
  const seasonProbe = mediaType === "tv" ? 1 : "";
  const providers = [];
  const probes = await Promise.allSettled([
    probeSubdlAvailability({ tmdbId, mediaType, language, season: seasonProbe }),
    probeOpenSubAvailability({ tmdbId, mediaType, language, season: seasonProbe })
  ]);
  const subdl = probes[0]?.status === "fulfilled" ? probes[0].value : { ok: false, hasSubtitles: false };
  const opensub = probes[1]?.status === "fulfilled" ? probes[1].value : { ok: false, hasSubtitles: false };
  if (subdl.hasSubtitles) providers.push("subdl");
  if (opensub.hasSubtitles) providers.push("opensubtitles");
  const probeSuccessCount = Number(Boolean(subdl.ok)) + Number(Boolean(opensub.ok));
  const reason = providers.length ? "matched" : probeSuccessCount === 0 ? "all-provider-probes-failed" : "no-subtitles-found";
  return {
    hasSubtitles: providers.length > 0,
    providers,
    reason,
    probeSuccessCount
  };
}

async function filterBySubtitleAvailability(items, { language = "", limit = 10, maxProbe = 40, deadlineAt = 0, sectionName = "" }) {
  const candidates = dedupeDiscoveryItems(items).slice(0, Math.max(limit, maxProbe));
  const out = [];
  let attempted = 0;
  let matched = 0;
  let timeBudgetHit = false;
  const reasonCounts = {
    "all-provider-probes-failed": 0,
    "no-subtitles-found": 0
  };
  for (const item of candidates) {
    if (deadlineAt && Date.now() >= deadlineAt) {
      timeBudgetHit = true;
      break;
    }
    if (out.length >= limit) break;
    attempted += 1;
    const availability = await subtitleAvailabilityForItem(item, { language });
    if (!availability.hasSubtitles) {
      if (reasonCounts[availability.reason] != null) reasonCounts[availability.reason] += 1;
      continue;
    }
    matched += 1;
    out.push({
      ...item,
      subtitleProviders: availability.providers,
      subtitleCoverage: {
        any: true,
        arabic: normalizeLanguageCode(language) === "ar"
      }
    });
  }
  logInfo("home-feed section subtitle filtering", {
    section: sectionName || "unknown",
    language: language || "all",
    candidateCount: candidates.length,
    attempted,
    matched,
    returned: out.length,
    timeBudgetHit,
    droppedByReason: reasonCounts
  });
  return {
    rows: out,
    diag: {
      section: sectionName || "unknown",
      candidateCount: candidates.length,
      attempted,
      matched,
      returned: out.length,
      timeBudgetHit,
      droppedByReason: reasonCounts
    }
  };
}

export async function buildHomeFeed() {
  const key = cacheKey(["homefeed", `rev${HOME_FEED_CACHE_REV}`]);
  logInfo("home-feed cache lookup", { key, rev: HOME_FEED_CACHE_REV });
  if (homeFeedBuildPromise) {
    logInfo("home-feed awaiting in-flight build");
    return homeFeedBuildPromise;
  }
  homeFeedBuildPromise = getOrSetCache("homefeed", key, 15 * 60 * 1000, async () => {
    const startedAt = Date.now();
    const deadlineAt = startedAt + HOME_FEED_TIME_BUDGET_MS;
    logInfo("home-feed cache miss: build started", { budgetMs: HOME_FEED_TIME_BUDGET_MS });

    const fetchSourceSafe = async (sourceName, path, params) => {
      try {
        logInfo("home-feed tmdb fetch start", { source: sourceName, path });
        const payload = await withTimeout(tmdbFetch(path, params), 3500, `homefeed.tmdb.${sourceName}`);
        const count = Array.isArray(payload?.results) ? payload.results.length : 0;
        logInfo("home-feed tmdb fetch success", { source: sourceName, count });
        return payload;
      } catch (err) {
        logError("home-feed tmdb fetch failed", err, { source: sourceName, path });
        return { results: [] };
      }
    };

    const [latestMoviesRaw, latestTvRaw, trendingRaw] = await Promise.all([
      fetchSourceSafe("latestMovies", "/movie/now_playing", { language: "en-US", page: 1, region: "US" }),
      fetchSourceSafe("latestTv", "/tv/on_the_air", { language: "en-US", page: 1 }),
      fetchSourceSafe("trending", "/trending/all/week", { language: "en-US", page: 1 })
    ]);

    const latestMoviesPool = dedupeDiscoveryItems((latestMoviesRaw?.results || []).map((row) => mapDiscoveryItem(row, "movie")).filter(Boolean));
    const latestTvPool = dedupeDiscoveryItems((latestTvRaw?.results || []).map((row) => mapDiscoveryItem(row, "tv")).filter(Boolean));
    const trendingPool = dedupeDiscoveryItems((trendingRaw?.results || []).map((row) => mapDiscoveryItem(row, "")).filter(Boolean));
    logInfo("home-feed normalization/dedupe", {
      latestMoviesPool: latestMoviesPool.length,
      latestTvPool: latestTvPool.length,
      trendingPool: trendingPool.length
    });

    const runSectionSafe = async (sectionName, resolver) => {
      if (Date.now() >= deadlineAt) {
        logError("home-feed section skipped due budget", new Error("build time budget exceeded"), { section: sectionName });
        return {
          rows: [],
          diag: {
            section: sectionName,
            candidateCount: 0,
            attempted: 0,
            matched: 0,
            returned: 0,
            timeBudgetHit: true,
            droppedByReason: {}
          }
        };
      }
      try {
        logInfo("home-feed section start", { section: sectionName });
        const result = await resolver();
        const rows = Array.isArray(result?.rows) ? result.rows : [];
        logInfo("home-feed section success", { section: sectionName, count: rows.length, diag: result?.diag || {} });
        return {
          rows,
          diag: result?.diag || {}
        };
      } catch (err) {
        logError("home-feed section failed", err, { section: sectionName });
        return {
          rows: [],
          diag: {
            section: sectionName,
            failed: true,
            reason: String(err?.message || err)
          }
        };
      }
    };

    const latestMoviesWithSubsResult = await runSectionSafe("latestMoviesWithSubs", () =>
      filterBySubtitleAvailability(latestMoviesPool, {
        language: "",
        limit: 10,
        maxProbe: 10,
        deadlineAt,
        sectionName: "latestMoviesWithSubs"
      })
    );
    const latestTvWithSubsResult = await runSectionSafe("latestTvWithSubs", () =>
      filterBySubtitleAvailability(latestTvPool, {
        language: "",
        limit: 10,
        maxProbe: 10,
        deadlineAt,
        sectionName: "latestTvWithSubs"
      })
    );
    const trendingWithSubsResult = await runSectionSafe("trendingWithSubs", () =>
      filterBySubtitleAvailability(trendingPool, {
        language: "",
        limit: 8,
        maxProbe: 10,
        deadlineAt,
        sectionName: "trendingWithSubs"
      })
    );
    const latestArabicMoviesResult = await runSectionSafe("latestArabicMovies", () =>
      filterBySubtitleAvailability(latestMoviesPool, {
        language: "ar",
        limit: 10,
        maxProbe: 10,
        deadlineAt,
        sectionName: "latestArabicMovies"
      })
    );
    const latestMoviesWithSubs = latestMoviesWithSubsResult.rows;
    const latestArabicMovies = latestArabicMoviesResult.rows;
    const latestTvWithSubs = latestTvWithSubsResult.rows;
    const trendingWithSubs = trendingWithSubsResult.rows;

    if (!latestTvWithSubs.length) {
      logError("home-feed tv section empty", new Error("no tv items survived filtering"), {
        latestTvPoolCandidates: latestTvPool.length,
        tvDiag: latestTvWithSubsResult.diag
      });
    }

    logInfo("home-feed section assembly complete", {
      latestMoviesWithSubs: latestMoviesWithSubs.length,
      latestArabicMovies: latestArabicMovies.length,
      latestTvWithSubs: latestTvWithSubs.length,
      trendingWithSubs: trendingWithSubs.length,
      elapsedMs: Date.now() - startedAt
    });

    return {
      generatedAt: new Date().toISOString(),
      sections: {
        latestMoviesWithSubs,
        latestArabicMovies,
        latestTvWithSubs,
        trendingWithSubs
      }
    };
  });
  try {
    return await homeFeedBuildPromise;
  } finally {
    homeFeedBuildPromise = null;
  }
}

function mapTvMazeShow(payload) {
  if (!payload || typeof payload !== "object") return null;
  return {
    tvmazeId: payload.id || null,
    tvmazeStatus: payload.status || "",
    tvmazeRuntime: Number(payload.runtime || payload.averageRuntime || 0),
    tvmazePremiered: payload.premiered || "",
    tvmazeEnded: payload.ended || "",
    tvmazeOfficialSite: payload.officialSite || "",
    tvmazeNetwork: payload.network?.name || payload.webChannel?.name || "",
    tvmazeName: payload.name || ""
  };
}

export async function getMediaDetailsById(mediaType, tmdbId) {
  const key = cacheKey(["mediaDetails", mediaType, tmdbId]);
  return getOrSetCache("tmdb", key, 30 * 60 * 1000, async () => {
    const path = mediaType === "tv" ? `/tv/${tmdbId}` : `/movie/${tmdbId}`;
    const payload = await tmdbFetch(path, {
      language: "ar-SA",
      append_to_response: mediaType === "tv" ? "external_ids" : undefined
    });
  const date =
    mediaType === "tv"
      ? payload.first_air_date || ""
      : payload.release_date || "";
  let tvmaze = null;
  if (mediaType === "tv") {
    const imdbId = payload?.external_ids?.imdb_id || "";
    logInfo("tvmaze enrichment attempted", {
      tmdbId,
      hasImdbId: Boolean(imdbId)
    });
    try {
      const byImdb = await fetchTvMazeShowByImdb(imdbId);
      tvmaze = mapTvMazeShow(byImdb);
      if (!tvmaze) {
        const query = payload?.name || payload?.original_name || "";
        const searchResults = await fetchTvMazeShowByQuery(query);
        const picked = searchResults.find((it) => {
          const show = it?.show;
          if (!show) return false;
          const premieredYear = String(show.premiered || "").slice(0, 4);
          const tmdbYear = String(payload.first_air_date || "").slice(0, 4);
          return !tmdbYear || !premieredYear || premieredYear === tmdbYear;
        })?.show;
        tvmaze = mapTvMazeShow(picked);
      }
      logInfo("tvmaze enrichment result", {
        tmdbId,
        matched: Boolean(tvmaze),
        tvmazeId: tvmaze?.tvmazeId || null
      });
    } catch (err) {
      logError("TVMaze enrichment failed", err, { tmdbId, hasImdbId: Boolean(imdbId) });
    }
  }

    return {
    id: payload.id,
    tmdbId: payload.id,
    mediaType,
    title:
      mediaType === "tv"
        ? payload.name || payload.original_name || "—"
        : payload.title || payload.original_title || "—",
    year: date ? String(date).slice(0, 4) : "",
    overview: payload.overview || "",
    backdrop: payload.backdrop_path ? `https://image.tmdb.org/t/p/w1280${payload.backdrop_path}` : "",
    poster: payload.poster_path
      ? `https://image.tmdb.org/t/p/w500${payload.poster_path}`
      : "",
    voteAverage: Number(payload.vote_average || 0),
    voteCount: Number(payload.vote_count || 0),
    genres: Array.isArray(payload.genres) ? payload.genres.map((g) => g?.name).filter(Boolean) : [],
    seasonCount: mediaType === "tv" ? Number(payload.number_of_seasons || 0) : 0,
    episodeCount: mediaType === "tv" ? Number(payload.number_of_episodes || 0) : 0,
    seasons:
      mediaType === "tv" && Array.isArray(payload.seasons)
        ? payload.seasons
            .map((s) => ({
              seasonNumber: Number(s?.season_number || 0),
              episodeCount: Number(s?.episode_count || 0),
              name: String(s?.name || "").trim(),
              airDate: String(s?.air_date || "").trim()
            }))
            .filter((s) => s.seasonNumber > 0)
            .sort((a, b) => a.seasonNumber - b.seasonNumber)
        : [],
    status: String(payload.status || tvmaze?.tvmazeStatus || "").trim(),
    runtime: mediaType === "movie" ? Number(payload.runtime || 0) : 0,
    releaseDate: mediaType === "movie" ? String(payload.release_date || "").trim() : "",
    firstAirDate: mediaType === "tv" ? String(payload.first_air_date || tvmaze?.tvmazePremiered || "").trim() : "",
      tvmaze: tvmaze || undefined
    };
  });
}

export async function validateTvEpisodeContext(tmdbId, season, episode) {
  const tmdbTv = await tmdbFetch(`/tv/${tmdbId}`, { append_to_response: "external_ids", language: "en-US" });
  const imdbId = String(tmdbTv?.external_ids?.imdb_id || "").trim();
  let show = null;
  if (imdbId) {
    show = await fetchTvMazeShowByImdb(imdbId);
  }
  if (!show) {
    const query = tmdbTv?.name || tmdbTv?.original_name || "";
    const searchResults = await fetchTvMazeShowByQuery(query);
    show = searchResults[0]?.show || null;
  }
  if (!show?.id) {
    return {
      attempted: true,
      matchedShow: false,
      episodeFound: null
    };
  }
  const [episodeInfo, seasons] = await Promise.all([
    fetchTvMazeEpisodeByNumber(show.id, season, episode),
    fetchTvMazeSeasons(show.id)
  ]);
  return {
    attempted: true,
    matchedShow: true,
    tvmazeId: show.id,
    showName: show.name || "",
    seasonCount: Array.isArray(seasons) ? seasons.length : 0,
    episodeFound: Boolean(episodeInfo),
    episodeName: episodeInfo?.name || ""
  };
}

function normalizeSubdlDownloadUrl(url) {
  const u = String(url || "").trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("/")) return `https://dl.subdl.com${u}`;
  return `https://dl.subdl.com/${u}`;
}

async function subdlFetch(searchParams = {}) {
  const url = new URL("https://api.subdl.com/api/v1/subtitles");
  url.searchParams.set("api_key", SUBDL_API_KEY);
  for (const [key, value] of Object.entries(searchParams)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const payload = await readJsonResponse(response);
  if (!response.ok) throw new Error(payload?.error || `SubDL HTTP ${response.status}`);
  if (payload?.status === false) throw new Error(payload.error || "SubDL reported an error");
  return payload;
}

function echoSubdlParamsForDiag(params) {
  const p = params || {};
  return {
    tmdb_id: p.tmdb_id != null && p.tmdb_id !== "" ? String(p.tmdb_id) : null,
    film_name: p.film_name != null && String(p.film_name).trim() !== "" ? String(p.film_name).trim().slice(0, 96) : null,
    type: p.type || null,
    season_number: p.season_number != null && p.season_number !== "" ? String(p.season_number) : null,
    episode_number: p.episode_number != null && p.episode_number !== "" ? String(p.episode_number) : null,
    full_season: p.full_season != null && p.full_season !== "" ? Number(p.full_season) : null,
    languages: p.languages || null
  };
}

async function fetchTmdbTvNameForSubdl(tmdbId) {
  try {
    const payload = await tmdbFetch(`/tv/${Number(tmdbId)}`, { language: "en-US" });
    const name = String(payload?.name || payload?.original_name || "").trim();
    return name.slice(0, 200);
  } catch {
    return "";
  }
}

async function fetchTmdbMovieIdentityForFallback(tmdbId) {
  try {
    const payload = await tmdbFetch(`/movie/${Number(tmdbId)}`, {
      language: "en-US",
      append_to_response: "external_ids"
    });
    const title = String(payload?.title || payload?.original_title || "").trim().slice(0, 220);
    const imdbId = String(payload?.external_ids?.imdb_id || "").trim();
    const releaseYear = String(payload?.release_date || "").slice(0, 4);
    return {
      title,
      imdbId,
      year: releaseYear
    };
  } catch (err) {
    logError("TMDb movie identity fallback fetch failed", err, { tmdbId });
    return {
      title: "",
      imdbId: "",
      year: ""
    };
  }
}

function slugifyForUrl(input = "") {
  return String(input || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function sanitizeSubdlFilmNameForQuery(input = "") {
  return String(input || "")
    .replace(/['"`]+/g, "")
    .replace(/[^\p{L}\p{N}\s\-:&.,!()?]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function seasonOrdinalSlug(seasonNumRaw) {
  const n = Number(seasonNumRaw || 0);
  if (!Number.isFinite(n) || n < 1) return "";
  const ord = {
    1: "first",
    2: "second",
    3: "third",
    4: "fourth",
    5: "fifth",
    6: "sixth",
    7: "seventh",
    8: "eighth",
    9: "ninth",
    10: "tenth"
  };
  if (ord[n]) return `${ord[n]}-season`;
  if (n % 10 === 1 && n % 100 !== 11) return `${n}st-season`;
  if (n % 10 === 2 && n % 100 !== 12) return `${n}nd-season`;
  if (n % 10 === 3 && n % 100 !== 13) return `${n}rd-season`;
  return `${n}th-season`;
}

function seasonSlugVariants(seasonNumRaw) {
  const n = Number(seasonNumRaw || 0);
  if (!Number.isFinite(n) || n < 1) return [];
  const out = new Set([seasonOrdinalSlug(n), `season-${n}`, `${n}-season`, `s${n}`]);
  return Array.from(out).filter(Boolean);
}

function decodeHtmlEntities(text = "") {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function stripHtmlTags(text = "") {
  return decodeHtmlEntities(String(text || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function extractSubdlSdIdFromResults(payload) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  for (const r of results) {
    const raw = String(r?.sd_id || r?.sdid || r?.sd || "").trim();
    if (!raw) continue;
    const digits = raw.replace(/\D+/g, "");
    if (digits) return digits;
  }
  return "";
}

function buildSubdlSeasonPageCandidates({ sdId, showTitle, season }) {
  const candidates = [];
  const slug = slugifyForUrl(showTitle);
  const slugNoThe = slug.replace(/^the-/, "");
  const seasonSlugs = seasonSlugVariants(season);
  if (!slug || !seasonSlugs.length) return candidates;
  const slugVariants = Array.from(new Set([slug, slugNoThe])).filter(Boolean);
  for (const s of seasonSlugs) {
    if (sdId) {
      for (const showSlug of slugVariants) {
        candidates.push(`https://subdl.com/subtitle/sd${sdId}/${showSlug}/${s}`);
        candidates.push(`https://subdl.com/en/subtitle/sd${sdId}/${showSlug}/${s}`);
      }
    }
    for (const showSlug of slugVariants) {
      candidates.push(`https://subdl.com/subtitle/${showSlug}/${s}`);
      candidates.push(`https://subdl.com/en/subtitle/${showSlug}/${s}`);
    }
  }
  return Array.from(new Set(candidates)).slice(0, 24);
}

function buildSubdlMoviePageCandidates({ sdId, movieTitle, year = "" }) {
  const candidates = [];
  const titleSlug = slugifyForUrl(movieTitle);
  const yearStr = String(year || "").trim();
  if (!titleSlug) return candidates;
  const slugVariants = Array.from(
    new Set([titleSlug, titleSlug.replace(/^the-/, ""), yearStr ? `${titleSlug}-${yearStr}` : ""])
  ).filter(Boolean);
  for (const s of slugVariants) {
    if (sdId) {
      candidates.push(`https://subdl.com/subtitle/sd${sdId}/${s}`);
      candidates.push(`https://subdl.com/en/subtitle/sd${sdId}/${s}`);
    }
    candidates.push(`https://subdl.com/subtitle/${s}`);
    candidates.push(`https://subdl.com/en/subtitle/${s}`);
  }
  return Array.from(new Set(candidates)).slice(0, 18);
}

function parseSubdlSeasonPageHtmlRows(html, fallbackLanguage = "") {
  const body = String(html || "");
  if (!body.trim()) {
    return {
      rows: [],
      diag: {
        languageHeadersFound: 0,
        rowCardsFound: 0,
        downloadLinksFound: 0,
        uploaderLinksFound: 0,
        headerSnippets: [],
        rowSnippets: []
      }
    };
  }
  const languageHeaders = [];
  const h2Re = /<h2[^>]*>\s*([^<]{2,40})\s*<\/h2>/gi;
  const headerSnippets = [];
  let hm;
  while ((hm = h2Re.exec(body))) {
    const langNorm = normalizeLanguageCode(decodeHtmlEntities(hm[1]));
    if (!langNorm) continue;
    languageHeaders.push({ idx: hm.index, lang: langNorm });
    if (headerSnippets.length < 3) {
      headerSnippets.push(
        body
          .slice(Math.max(0, hm.index - 60), Math.min(body.length, hm.index + 140))
          .replace(/\s+/g, " ")
      );
    }
  }
  const inferLangAt = (idx) => {
    let picked = normalizeLanguageCode(fallbackLanguage) || "";
    for (const h of languageHeaders) {
      if (h.idx <= idx) picked = h.lang;
      else break;
    }
    return picked || "und";
  };
  const rowRe =
    /<h4[^>]*>\s*([^<]{3,260})\s*<\/h4>[\s\S]{0,2200}?href="(https?:\/\/dl\.subdl\.com\/subtitle\/[^"]+)"/gi;
  const rows = [];
  const rowSnippets = [];
  let rowCardsFound = 0;
  let uploaderLinksFound = 0;
  const downloadLinksFound = (body.match(/https?:\/\/dl\.subdl\.com\/subtitle\/[^"]+/gi) || []).length;
  let m;
  while ((m = rowRe.exec(body))) {
    rowCardsFound += 1;
    const releaseName = decodeHtmlEntities(m[1]);
    const downloadUrl = normalizeSubdlDownloadUrl(m[2]);
    if (!releaseName || !downloadUrl) continue;
    const localChunk = body.slice(Math.max(0, m.index - 300), Math.min(body.length, m.index + 2200));
    const uploaderRel = localChunk.match(/href="(\/u\/[^"]+)"/i);
    const uploaderAbs = localChunk.match(/href="(https?:\/\/subdl\.com\/u\/[^"]+)"/i);
    const uploaderUrl = String((uploaderRel && uploaderRel[1]) || (uploaderAbs && uploaderAbs[1]) || "");
    const authorRaw = decodeURIComponent((uploaderUrl.split("/u/")[1] || "").split("?")[0] || "").trim();
    const author = stripHtmlTags(authorRaw);
    if (uploaderUrl) uploaderLinksFound += 1;
    const lang = inferLangAt(m.index).toUpperCase();
    if (rowSnippets.length < 3) {
      rowSnippets.push(localChunk.slice(0, 260).replace(/\s+/g, " "));
    }
    rows.push({
      provider: "subdl",
      id: downloadUrl.replace(/^.*\/subtitle\//, "").replace(/\.zip.*$/i, "") || downloadUrl,
      language: lang,
      releaseName,
      author,
      hearingImpaired: false,
      downloads: 0,
      downloadUrl,
      comment: "html_fallback",
      season: "",
      episode: "",
      releases: []
    });
  }
  return {
    rows,
    diag: {
      languageHeadersFound: languageHeaders.length,
      rowCardsFound,
      downloadLinksFound,
      uploaderLinksFound,
      headerSnippets,
      rowSnippets
    }
  };
}

function subdlHearingFlag(raw) {
  if (raw === true || raw === 1) return true;
  if (raw === false || raw === 0 || raw == null) return false;
  const s = String(raw).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function mapSubdl(payload, defaultLang) {
  const raw = payload?.subtitles || payload?.data || [];
  return raw
    .map((sub) => {
      const rawLang = String(sub.language || sub.lang || "").trim();
      const langNorm = normalizeLanguageCode(rawLang || String(defaultLang || "").trim() || "");
      const langDisp = (langNorm || rawLang || String(defaultLang || "").trim() || "und")
        .toUpperCase()
        .slice(0, 12);
      return {
        provider: "subdl",
        id: String(sub.id || sub.sd_id || `${sub.url}-${sub.release_name || "sub"}`),
        language: langDisp,
        releaseName: sub.release_name || sub.release || sub.name || "Subtitle",
        author: sub.author || sub.uploader || "",
        hearingImpaired: subdlHearingFlag(sub.hi),
        downloads: Number(sub.download_count || sub.downloads || 0),
        downloadUrl: normalizeSubdlDownloadUrl(sub.url || sub.download_link || sub.download_url || ""),
        comment: sub.comment || "",
        season: sub.season != null && sub.season !== "" ? String(sub.season) : "",
        episode: sub.episode != null && sub.episode !== "" ? String(sub.episode) : "",
        releases: sub.releases || []
      };
    })
    .filter((sub) => sub.downloadUrl);
}

function openSubHeaders(token = "") {
  const h = {
    "Api-Key": OPENSUBTITLES_API_KEY,
    "User-Agent": OPENSUBTITLES_USER_AGENT,
    Accept: "application/json"
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function openSubFetch(path, options = {}) {
  const response = await fetch(`${OPENSUBTITLES_API}${path}`, options);
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(
      payload?.message ||
        payload?.errors?.[0]?.detail ||
        payload?.errors?.[0]?.title ||
        `OpenSubtitles HTTP ${response.status}`
    );
  }
  return payload;
}

async function getOpenSubToken() {
  const now = Date.now();
  if (cachedOpenSubToken && cachedOpenSubTokenExp > now) return cachedOpenSubToken;
  if (!OPENSUBTITLES_USERNAME || !OPENSUBTITLES_PASSWORD) return "";
  if (openSubLoginPromise) return openSubLoginPromise;

  openSubLoginPromise = (async () => {
    const payload = await openSubFetch("/login", {
      method: "POST",
      headers: {
        ...openSubHeaders(),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username: OPENSUBTITLES_USERNAME,
        password: OPENSUBTITLES_PASSWORD
      })
    });
    const token = String(payload?.token || "").trim();
    if (!token) throw new Error("OpenSubtitles login did not return token");
    cachedOpenSubToken = token;
    cachedOpenSubTokenExp = Date.now() + TOKEN_TTL_MS;
    return token;
  })();

  try {
    return await openSubLoginPromise;
  } finally {
    openSubLoginPromise = null;
  }
}

function openSubFileId(item) {
  const files = item?.attributes?.files;
  if (!Array.isArray(files) || !files.length) return "";
  return String(files[0]?.file_id || "");
}

async function openSubDownload(fileId, token) {
  if (!fileId) return "";
  const cached = openSubDownloadCache.get(fileId);
  if (cached && cached.exp > Date.now()) return cached.link;
  const payload = await openSubFetch("/download", {
    method: "POST",
    headers: {
      ...openSubHeaders(token),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ file_id: Number(fileId) })
  });
  const link = String(payload?.link || "").trim();
  if (link) openSubDownloadCache.set(fileId, { link, exp: Date.now() + DOWNLOAD_LINK_TTL_MS });
  return link;
}

async function withTimeout(promise, timeoutMs, label = "operation") {
  const ms = Math.max(200, Number(timeoutMs || 0));
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
  ]);
}

function mapOpenSub(item, link, fallbackLang) {
  const a = item?.attributes || {};
  const releaseName = a.release || a.feature_details?.title || a.files?.[0]?.file_name || "Subtitle";
  const releases = Array.isArray(a.files) ? a.files.map((f) => f?.file_name).filter(Boolean) : [];
  return {
    provider: "opensubtitles",
    id: String(item?.id || openSubFileId(item) || releaseName),
    language: String(a.language || fallbackLang || "").toUpperCase(),
    releaseName,
    author: a.uploader?.name || "",
    hearingImpaired: Boolean(a.hearing_impaired),
    downloads: Number(a.download_count || 0),
    downloadUrl: link,
    comment: a.comments || "",
    season: a.feature_details?.season_number || "",
    episode: a.feature_details?.episode_number || "",
    releases
  };
}

async function searchOpenSubtitles({
  tmdbId,
  imdbId,
  query,
  mediaType,
  language,
  season,
  episode,
  year,
  page = 1,
  resolveDownloads = true,
  maxResolve = Infinity,
  resolveTimeoutMs = 3500
}) {
  if (!OPENSUBTITLES_API_KEY) throw new Error("OPENSUBTITLES_API_KEY is not configured");
  let token = "";
  try {
    token = await getOpenSubToken();
  } catch (err) {
    logError("OpenSubtitles token login failed; fallback to API-key request", err);
  }
  const url = new URL(`${OPENSUBTITLES_API}/subtitles`);
  const tmdbKey = String(tmdbId || "").trim();
  const imdbKey = String(imdbId || "").trim();
  const queryKey = String(query || "").trim();
  if (tmdbKey) url.searchParams.set("tmdb_id", tmdbKey);
  else if (imdbKey) url.searchParams.set("imdb_id", imdbKey);
  else if (queryKey) url.searchParams.set("query", queryKey);
  else throw new Error("OpenSubtitles search requires tmdb_id, imdb_id, or query");
  url.searchParams.set("type", mediaType);
  if (language) url.searchParams.set("languages", language);
  if (year) url.searchParams.set("year", String(year));
  if (mediaType === "tv" && season) url.searchParams.set("season_number", String(season));
  if (mediaType === "tv" && episode) url.searchParams.set("episode_number", String(episode));
  url.searchParams.set("page", String(page));
  url.searchParams.set("order_by", "download_count");
  url.searchParams.set("order_direction", "desc");

  const response = await fetch(url, { headers: openSubHeaders(token) });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(
      payload?.message ||
        payload?.errors?.[0]?.detail ||
        payload?.errors?.[0]?.title ||
        `OpenSubtitles HTTP ${response.status}`
    );
  }
  const list = Array.isArray(payload?.data) ? payload.data : [];
  const out = [];
  const resolveLimit = Number.isFinite(Number(maxResolve)) ? Number(maxResolve) : Infinity;
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    const fallback = `https://www.opensubtitles.com/en/subtitles/${encodeURIComponent(String(item?.id || ""))}`;
    const shouldResolve = Boolean(resolveDownloads) && i < resolveLimit;
    if (!shouldResolve) {
      out.push(mapOpenSub(item, fallback, language));
      continue;
    }
    try {
      const link = await withTimeout(
        openSubDownload(openSubFileId(item), token),
        resolveTimeoutMs,
        "opensubtitles.downloadResolve"
      );
      const mapped = mapOpenSub(item, link || fallback, language);
      out.push(mapped);
    } catch (err) {
      out.push(mapOpenSub(item, fallback, language));
      logError("OpenSubtitles item download resolve failed", err, {
        itemId: item?.id,
        usedFallbackUrl: true
      });
    }
  }
  return { items: out, rawCount: list.length };
}

function countByProvider(items) {
  return items.reduce((acc, x) => {
    const p = String(x.provider || "unknown");
    acc[p] = (acc[p] || 0) + 1;
    return acc;
  }, {});
}

function countByNormalizedSubtitleLang(items) {
  const acc = Object.create(null);
  for (const x of items) {
    const raw = String(x.language || "").trim();
    const k = normalizeLanguageCode(raw) || raw.toLowerCase() || "?";
    acc[k] = (acc[k] ?? 0) + 1;
  }
  return acc;
}

function countSubdlByTvMatch(items) {
  const acc = Object.create(null);
  for (const x of items) {
    if (String(x.provider || "") !== "subdl") continue;
    const k = String(x.tvMatchKind || "?");
    acc[k] = (acc[k] ?? 0) + 1;
  }
  return acc;
}

/** SubDL rows only: counts tvMatchKind per API probe (episode-chain tagging). */
function foldSubdlByProbeAndKind(items) {
  const out = Object.create(null);
  for (const x of items) {
    if (String(x.provider || "") !== "subdl") continue;
    const probe = String(x.subdlProbe || "unknown");
    const kind = String(x.tvMatchKind || "?");
    if (!out[probe]) out[probe] = Object.create(null);
    out[probe][kind] = (out[probe][kind] ?? 0) + 1;
  }
  return out;
}

function stripSubdlProbeFromRows(rows) {
  return rows.map((row) => {
    if (row == null || row.subdlProbe == null) return row;
    const { subdlProbe: _p, ...rest } = row;
    return rest;
  });
}

function dedupeSubtitles(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const provider = String(item.provider || "");
    const stableId = String(item.id || "").trim();
    const urlKey = String(item.downloadUrl || "")
      .slice(0, 120)
      .toLowerCase();
    const key = stableId
      ? `${provider}|${stableId}|${urlKey.slice(0, 48)}`
      : [
          provider,
          String(item.language || "").toLowerCase(),
          String(item.releaseName || "").toLowerCase(),
          String(item.season || ""),
          String(item.episode || ""),
          urlKey
        ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function normalizeTokens(input = "") {
  return String(input || "")
    .toLowerCase()
    .replace(/[\[\]().,_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t.length > 1);
}

function tokenSimilarity(a = "", b = "") {
  const at = new Set(normalizeTokens(a));
  const bt = new Set(normalizeTokens(b));
  if (!at.size || !bt.size) return 0;
  let common = 0;
  for (const token of at) {
    if (bt.has(token)) common += 1;
  }
  return common / Math.max(at.size, bt.size);
}

function releaseTextBundle(item) {
  return `${item.releaseName || ""} ${(Array.isArray(item.releases) ? item.releases.join(" ") : "").trim()}`.trim();
}

function parseOptionalEpisodeNumber(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse S01E05 / s1e12 / 1x05 / isolated E01 / EP12 / standalone S01 / Season 1 from release text.
 * episodeMatchQuality: strict = SxxExx / NxN style; weak = EP/E# heuristics.
 * seasonMatchQuality: strict when tied to SxxExx or dot-ep; weak for lone "Season N" / "Snn" tokens (false positives).
 */
function parseSeasonEpisodeFromReleaseText(text = "") {
  const t = String(text || "");
  const none = {
    season: null,
    episode: null,
    episodeMatchQuality: null,
    seasonMatchQuality: null
  };
  const combined =
    t.match(/\bS(\d{1,2})\s*[\.\-]?\s*E(\d{1,4})\b/i) ||
    t.match(/\bS(\d{1,2})[\.\-_]?\s*E(\d{1,4})\b/i) ||
    t.match(/\b(\d{1,2})[xX](\d{1,4})\b/);
  if (combined) {
    return {
      season: Number(combined[1]),
      episode: Number(combined[2]),
      seasonMatchQuality: "strict",
      episodeMatchQuality: "strict"
    };
  }
  const epOnly = t.match(/\bEP(?:ISODE)?[\s.\-_]*0*(\d{1,4})\b/i);
  if (epOnly) {
    const epNum = Number(epOnly[1]);
    if (Number.isFinite(epNum))
      return { season: null, episode: epNum, seasonMatchQuality: null, episodeMatchQuality: "weak" };
  }
  const sDotE = t.match(/\bS(\d{1,2})\.(\d{1,4})\b/i);
  if (sDotE) {
    return {
      season: Number(sDotE[1]),
      episode: Number(sDotE[2]),
      seasonMatchQuality: "strict",
      episodeMatchQuality: "strict"
    };
  }
  const looseXE = t.match(/\b(\d{1,2})\s*[xX]\s*(\d{1,4})\b/);
  if (looseXE) {
    return {
      season: Number(looseXE[1]),
      episode: Number(looseXE[2]),
      seasonMatchQuality: "strict",
      episodeMatchQuality: "strict"
    };
  }
  const epHash = t.match(/\bE(?:P|PS)?[\s#]*0*(\d{1,4})\b/i);
  if (epHash) {
    const n = Number(epHash[1]);
    if (Number.isFinite(n))
      return { season: null, episode: n, seasonMatchQuality: null, episodeMatchQuality: "weak" };
  }
  const wordSeason = t.match(/\bSEASON[\s.\-_]*0*(\d{1,2})\b/i);
  if (wordSeason) {
    const sn = Number(wordSeason[1]);
    if (Number.isFinite(sn))
      return { season: sn, episode: null, seasonMatchQuality: "weak", episodeMatchQuality: null };
  }
  const standaloneS = t.match(/\bS(\d{1,2})\b(?!\s*[\.\-]?\s*E\d)/i);
  if (standaloneS) {
    const sn = Number(standaloneS[1]);
    if (Number.isFinite(sn))
      return { season: sn, episode: null, seasonMatchQuality: "weak", episodeMatchQuality: null };
  }
  return none;
}

function seasonPackHintsInText(text = "", ctxSeason) {
  const t = String(text || "").toLowerCase();
  if (!t) return false;
  if (
    /\bcomplete\s+season\b/.test(t) ||
    /\bfull\s+season\b/.test(t) ||
    /\bseason\s+pack\b/.test(t) ||
    /\bcomplete\s+series\b/.test(t) ||
    /\bentire\s+season\b/.test(t) ||
    /\ball\s+episodes\b/.test(t) ||
    /\bseason\s+complete\b/.test(t) ||
    /\bseason\s+collection\b/.test(t) ||
    /\bbluray\s+set\b/.test(t) ||
    /\bdisc\s+set\b/.test(t)
  ) {
    return true;
  }
  if (/\b(?:complete|full)\s+s\d{1,2}\b/i.test(t)) return true;
  if (/\bs\d{1,2}\s*(?:complete|pack|collection)\b/i.test(t)) return true;
  if (/\bpack\b/.test(t) && /\bseason\b/.test(t)) return true;
  if (/e\d{1,2}\s*to\s*e?\d{1,4}\b/i.test(t)) return true;
  if (/e\d{1,2}\s*[-–]\s*e?\d{1,4}\b/i.test(t)) return true;
  if (/\bepisodes?\s*\d{1,2}\s*[-–]\s*\d{1,4}\b/i.test(t)) return true;
  if (/\b\d{1,2}x\d{1,2}\s*[-–]\s*\d{1,2}x\d{1,4}\b/i.test(t)) return true;
  if (/\bs\d{1,2}\s*[-–]\s*s\d{1,2}\b/i.test(t)) return true;
  if (ctxSeason != null && Number.isFinite(ctxSeason)) {
    const compact = t.replace(/\s+/g, "");
    if (
      /\bs\d{1,2}\b/i.test(compact) &&
      !/\be\d{1,4}\b/i.test(compact) &&
      new RegExp(`s0?${ctxSeason}`, "i").test(compact)
    ) {
      return true;
    }
  }
  return false;
}

const SUBDL_SEASON_MODE_FULL_PROBES = new Set([
  "tvSeasonMode",
  "seasonModeFullSeasonTmdb",
  "seasonModeFilmNameFull"
]);

function tvClassifyResult(kind, tier, classifyBranch) {
  return { tvMatchKind: kind, tvMatchTier: tier, classifyBranch };
}

/**
 * SubDL episode-chain fallbacks (seasonOnly / fullSeason / filmName season-only|full):
 * only these count as "strong" reasons for `other`. Cross-season noise in filenames alone is not enough.
 */
function subdlFallbackProbeContradictionReason(parsed, metaS, metaE, ctxS, ctxE) {
  if (ctxS == null || ctxE == null) return null;
  const sameSeasonStrictEpisodeMismatch =
    parsed.episodeMatchQuality === "strict" &&
    parsed.episode != null &&
    parsed.episode !== ctxE &&
    (parsed.season == null || parsed.season === ctxS);
  if (sameSeasonStrictEpisodeMismatch) return "sameSeasonStrictEpisodeMismatch";
  const metaAndTextAgreeWrongSeason =
    metaS != null &&
    parsed.season != null &&
    parsed.seasonMatchQuality === "strict" &&
    metaS === parsed.season &&
    metaS !== ctxS;
  if (metaAndTextAgreeWrongSeason) return "metaAndTextAgreeWrongSeason";
  return null;
}

/**
 * TV contract:
 * - episode mode (season + episode): main list = exactEpisode only.
 * - season mode (season only): main list = seasonPack + seasonScoped.
 *   seasonScoped includes generic season rows and same-season episode rows.
 * Every path sets `classifyBranch` for diagnostics (`diagnostics=1` → subdlClassifySamples).
 */
function classifyTvSubtitleMatch(item, ctx) {
  if (ctx.mediaType !== "tv") return tvClassifyResult("movie", 0, "notTv");

  const ctxS = parseOptionalEpisodeNumber(ctx.season);
  const ctxE = parseOptionalEpisodeNumber(ctx.episode);
  const seasonBrowse =
    ctx.mediaType === "tv" &&
    (ctx.tvQueryMode === "season" ||
      (ctx.tvQueryMode !== "episode" && ctxE == null));

  if (ctxS == null) return tvClassifyResult("other", 0, "tv.noCtxSeason");

  const metaS = parseOptionalEpisodeNumber(item.season);
  const metaE = parseOptionalEpisodeNumber(item.episode);
  const releaseText = releaseTextBundle(item);
  const parsed = parseSeasonEpisodeFromReleaseText(releaseText);

  const isSubdl = String(item.provider || "") === "subdl";
  const subdlProbeKey = isSubdl
    ? String(item.subdlProbe || ctx.subdlWinningProbe || "").trim()
    : "";

  const textSeasonContradictsCtx =
    parsed.season != null &&
    parsed.season !== ctxS &&
    parsed.seasonMatchQuality !== "weak";

  if (seasonBrowse) {
    const packLike = seasonPackHintsInText(releaseText, ctxS);
    if (packLike && !(metaS != null && metaS !== ctxS)) {
      return tvClassifyResult("seasonPack", 2, "seasonBrowse.packHints");
    }
    if (SUBDL_SEASON_MODE_FULL_PROBES.has(subdlProbeKey)) {
      const seasonConflict = (metaS != null && metaS !== ctxS) || textSeasonContradictsCtx;
      if (seasonConflict) return tvClassifyResult("other", 0, "seasonBrowse.subdlFullProbe.seasonConflict");
      return tvClassifyResult("seasonPack", 2, "seasonBrowse.subdlFullProbe.defaultPack");
    }
    const seasonConflict = (metaS != null && metaS !== ctxS) || textSeasonContradictsCtx;
    if (seasonConflict) return tvClassifyResult("other", 0, "seasonBrowse.seasonConflict");
    return tvClassifyResult("seasonScoped", 1, "seasonBrowse.defaultSeasonScoped");
  }

  if (ctxE == null) return tvClassifyResult("other", 0, "episode.noCtxEpisode");

  const probeImpliesSeasonPack =
    subdlProbeKey === "seasonFullSeasonTmdb" || subdlProbeKey === "filmNameSeasonFull";
  const probeImpliesSeasonScoped =
    subdlProbeKey === "seasonOnlyTmdb" || subdlProbeKey === "filmNameSeasonOnly";

  /**
   * SubDL episode-chain fallbacks: rows tagged with `subdlProbe`. API season is authoritative;
   * lone "S02"/"Season 2" tokens in filenames are weak — do not force `other`.
   */
  if (!seasonBrowse && isSubdl && (probeImpliesSeasonPack || probeImpliesSeasonScoped)) {
    const exactByTextEarly = parsed.episode != null && parsed.episode === ctxE;
    const exactByMetaEarly =
      metaE != null &&
      metaE === ctxE &&
      (parsed.episode == null || parsed.episode === metaE);
    if (exactByTextEarly || exactByMetaEarly) {
      return tvClassifyResult("exactEpisode", 3, "subdl.probe.exactEpisodeEvidence");
    }
    if (seasonPackHintsInText(releaseText, ctxS)) {
      return tvClassifyResult("seasonPack", 2, "subdl.probe.packHintsInText");
    }
    const contra = subdlFallbackProbeContradictionReason(parsed, metaS, metaE, ctxS, ctxE);
    if (contra) {
      return tvClassifyResult("other", 0, `subdl.probe.strongContradiction.${contra}`);
    }
    if (probeImpliesSeasonPack) {
      return tvClassifyResult("seasonPack", 2, "subdl.probe.defaultSeasonPack");
    }
    return tvClassifyResult("seasonScoped", 1, "subdl.probe.defaultSeasonScoped");
  }

  /**
   * Remaining episode mode (OpenSubtitles, SubDL exactEpisodeTmdb / filmNameSeasonEpisode, …).
   * SubDL: ignore weak standalone E## / EP matches when deciding text episode conflicts.
   */
  if (seasonPackHintsInText(releaseText, ctxS)) {
    return tvClassifyResult("seasonPack", 2, "episode.packHintsInText");
  }

  const textSeasonConflict = textSeasonContradictsCtx;
  const metaSeasonConflict = !isSubdl && metaS != null && metaS !== ctxS;
  const subdlSeasonMetaConflict =
    isSubdl && metaS != null && metaS !== ctxS && (parsed.season == null || parsed.season === metaS);
  const seasonConflict = textSeasonConflict || metaSeasonConflict || subdlSeasonMetaConflict;

  const textEpisodeConflict =
    parsed.episode != null &&
    parsed.episode !== ctxE &&
    (!isSubdl || parsed.episodeMatchQuality === "strict");
  const metaEpisodeConflict = !isSubdl && metaE != null && metaE !== ctxE;
  const episodeConflict = textEpisodeConflict || metaEpisodeConflict;

  if (seasonConflict || episodeConflict) {
    return tvClassifyResult("other", 0, "episode.generalConflict");
  }

  const exactByText = parsed.episode != null && parsed.episode === ctxE;
  const exactByMeta =
    metaE != null &&
    metaE === ctxE &&
    (!isSubdl || parsed.episode == null || parsed.episode === metaE);

  if (exactByText || exactByMeta) {
    return tvClassifyResult("exactEpisode", 3, "episode.exactEpisodeEvidence");
  }

  if (isSubdl) {
    return tvClassifyResult("seasonScoped", 1, "episode.subdl.defaultSeasonScoped");
  }

  return tvClassifyResult("exactEpisode", 3, "episode.opensubtitles.defaultExact");
}

const TV_TIER_BOOST = { 3: 34, 2: 20, 1: 8, 0: 0 };

function scoreWithBreakdown(item, ctx, classifiedOpt) {
  const { tvMatchKind, tvMatchTier } = classifiedOpt || classifyTvSubtitleMatch(item, ctx);
  const breakdown = {
    language: 0,
    episodeMatch: 0,
    tvTierBoost: TV_TIER_BOOST[tvMatchTier] || 0,
    providerTrust: 0,
    downloads: 0,
    filenameSimilarity: 0,
    completeness: 0
  };
  const providerRank = { opensubtitles: 20, subdl: 14 };
  breakdown.providerTrust = providerRank[String(item.provider || "")] || 8;
  if (
    ctx.language &&
    normalizeLanguageCode(String(item.language || "")) === normalizeLanguageCode(String(ctx.language || ""))
  ) {
    breakdown.language += 18;
  }
  if (ctx.mediaType === "tv") {
    if (ctx.season && String(item.season || "") === String(ctx.season)) breakdown.episodeMatch += 20;
    if (ctx.episode && String(item.episode || "") === String(ctx.episode)) breakdown.episodeMatch += 24;
    if (ctx.season && item.season && String(item.season || "") !== String(ctx.season)) breakdown.episodeMatch -= 15;
    if (ctx.episode && item.episode && String(item.episode || "") !== String(ctx.episode)) breakdown.episodeMatch -= 18;
  }
  breakdown.downloads = Math.min(Number(item.downloads || 0), 50000) / 2000;
  const releaseText = releaseTextBundle(item);
  if (ctx.fileName) {
    breakdown.filenameSimilarity = tokenSimilarity(releaseText, ctx.fileName) * 40;
  }
  if (releaseText.length > 8) breakdown.completeness += 4;
  if (item.author) breakdown.completeness += 2;
  if (item.comment) breakdown.completeness += 1;
  if (item.hearingImpaired) breakdown.completeness -= 1;

  const score = Object.values(breakdown).reduce((acc, n) => acc + n, 0);
  const reasons = [];
  if (tvMatchKind === "exactEpisode") {
    reasons.push({ key: "exactEpisodeMatch", weight: 95 });
  } else if (tvMatchKind === "seasonPack") {
    reasons.push({ key: "seasonPackMatch", weight: 70 });
  } else if (tvMatchKind === "seasonScoped") {
    reasons.push({ key: "seasonGenericMatch", weight: 45 });
  } else if (breakdown.episodeMatch >= 20) {
    reasons.push({ key: "exactEpisodeMatch", weight: breakdown.episodeMatch });
  }
  if (breakdown.language >= 18) reasons.push({ key: "exactLanguageMatch", weight: breakdown.language });
  if (breakdown.providerTrust >= 18) reasons.push({ key: "trustedProvider", weight: breakdown.providerTrust });
  if (breakdown.downloads >= 8) reasons.push({ key: "highDownloads", weight: breakdown.downloads });
  if (breakdown.filenameSimilarity >= 12) {
    reasons.push({ key: "strongFilenameMatch", weight: breakdown.filenameSimilarity });
  }
  if (breakdown.completeness >= 5) reasons.push({ key: "completeMetadata", weight: breakdown.completeness });
  const topReasons = reasons
    .sort((a, b) => b.weight - a.weight)
    .map((r) => r.key)
    .slice(0, 4);
  const confidence = score >= 74 ? "excellent" : score >= 46 ? "strong" : "medium";
  return {
    ...item,
    tvMatchKind,
    tvMatchTier,
    score: Number(score.toFixed(2)),
    confidence,
    topReasons,
    scoreBreakdown: {
      language: Number(breakdown.language.toFixed(2)),
      episodeMatch: Number(breakdown.episodeMatch.toFixed(2)),
      tvTierBoost: Number(breakdown.tvTierBoost.toFixed(2)),
      providerTrust: Number(breakdown.providerTrust.toFixed(2)),
      downloads: Number(breakdown.downloads.toFixed(2)),
      filenameSimilarity: Number(breakdown.filenameSimilarity.toFixed(2)),
      completeness: Number(breakdown.completeness.toFixed(2))
    }
  };
}

function summarizeSubtitlePipeline(sortCtx, sorted, finalList, debugCounts) {
  const fold = (items) => {
    const byProvider = {};
    const byTvMatch = {};
    const byProviderTvMatch = {};
    for (const x of items) {
      const p = String(x.provider || "unknown");
      const k = String(x.tvMatchKind || "?");
      byProvider[p] = (byProvider[p] || 0) + 1;
      byTvMatch[k] = (byTvMatch[k] || 0) + 1;
      if (!byProviderTvMatch[p]) byProviderTvMatch[p] = {};
      byProviderTvMatch[p][k] = (byProviderTvMatch[p][k] || 0) + 1;
    }
    return { total: items.length, byProvider, byTvMatch, byProviderTvMatch };
  };

  return {
    tvQueryMode: sortCtx.tvQueryMode || null,
    rawFetched: {
      subdlRawItems: debugCounts.subdlRaw,
      subdlRowsAfterMap: debugCounts.subdlMapped,
      opensubtitlesRawItems: debugCounts.opensubtitlesRaw,
      opensubtitlesRowsAfterMap: debugCounts.opensubtitlesMapped
    },
    subdlTrace: {
      request: debugCounts.subdlRequestEcho || null,
      rawRows: debugCounts.subdlRaw,
      mappedRows: debugCounts.subdlMapped,
      attempts: debugCounts.subdlTvAttempts || [],
      winningProbe: debugCounts.subdlWinningProbe || null,
      seasonBroadMergedLangs: debugCounts.subdlSeasonBroadMergedLangs || {},
      htmlFallbackUsed: Boolean(debugCounts.subdlHtmlFallbackUsed),
      htmlFallbackTriggerReason: debugCounts.subdlHtmlFallbackTriggerReason || null,
      htmlFallbackSkipReason: debugCounts.subdlHtmlFallbackSkipReason || null,
      htmlMoviePageUrl: debugCounts.subdlHtmlMoviePageUrl || null,
      htmlSeasonPageUrl: debugCounts.subdlHtmlSeasonPageUrl || null,
      htmlCandidateUrlsTried: debugCounts.subdlHtmlCandidateUrlsTried || [],
      htmlFetchStatus: debugCounts.subdlHtmlFetchStatus || [],
      htmlAnyCandidateReturnedHtml: Boolean(debugCounts.subdlHtmlAnyCandidateReturnedHtml),
      htmlParserStageCounts: debugCounts.subdlHtmlParserStageCounts || {},
      htmlHeaderSnippets: debugCounts.subdlHtmlHeaderSnippets || [],
      htmlRowSnippets: debugCounts.subdlHtmlRowSnippets || [],
      htmlRowsFound: Number(debugCounts.subdlHtmlRowsFound || 0),
      htmlByLang: debugCounts.subdlHtmlByLang || {},
      htmlRowsAfterFilter: Number(debugCounts.subdlHtmlRowsAfterSeasonFilter || 0),
      htmlByLangAfterFilter: debugCounts.subdlHtmlByLangAfterSeasonFilter || {},
      htmlRowsAfterSeasonFilter: Number(debugCounts.subdlHtmlRowsAfterSeasonFilter || 0),
      htmlByLangAfterSeasonFilter: debugCounts.subdlHtmlByLangAfterSeasonFilter || {},
      byLangAfterMap: debugCounts.subdlByLangAfterMap || {},
      afterDedupeCount: debugCounts.subdlCountAfterDedupe,
      byLangAfterDedupe: debugCounts.subdlByLangAfterDedupe || {},
      afterSortCount: debugCounts.subdlCountAfterSort,
      byLangAfterSort: debugCounts.subdlByLangAfterSort || {},
      byTvMatchAfterSort: debugCounts.subdlByTvMatchAfterSort || {},
      subdlByProbeAfterSort: debugCounts.subdlByProbeAfterSort || {},
      subdlClassifySamples: debugCounts.subdlClassifySamples || [],
      pipelineCacheRev: SUBTITLES_PIPELINE_CACHE_REV,
      afterTvFilterCount: debugCounts.subdlCountAfterTvFilter,
      byLangAfterTvFilter: debugCounts.subdlByLangAfterTvFilter || {},
      byTvMatchAfterTvFilter: debugCounts.subdlByTvMatchAfterTvFilter || {}
    },
    normalizedPerProvider: {
      afterSubdlMerge: debugCounts.perProviderAfterSubdl || {},
      mergedBeforeDedupe: debugCounts.perProviderMergedBeforeDedupe || {},
      afterDedupe: debugCounts.perProviderAfterDedupe || {}
    },
    mergeAndDedupe: {
      combinedBeforeDedup: debugCounts.beforeDedup,
      afterDedup: debugCounts.afterDedup
    },
    byTvMatchPerProvider: {
      afterSortScored: fold(sorted).byProviderTvMatch,
      afterTvModeFilter: fold(finalList).byProviderTvMatch
    },
    afterSortScored: fold(sorted),
    afterTvModeFilter: fold(finalList),
    droppedForTvMode: sorted.length - finalList.length,
    tvEpisodeSubdlAnalysis: debugCounts.tvEpisodeSubdlAnalysis || null
  };
}

function sortSubtitles(items, ctx = {}, debugCounts = null) {
  const samples = [];
  const wantTrace = Boolean(ctx.includeClassificationTrace && debugCounts);
  const maxSamples = wantTrace ? 3 : 0;

  const scored = items.map((item) => {
    const classified = classifyTvSubtitleMatch(item, ctx);
    if (
      maxSamples > 0 &&
      samples.length < maxSamples &&
      String(item.provider || "") === "subdl"
    ) {
      const ctxS = parseOptionalEpisodeNumber(ctx.season);
      const ctxE = parseOptionalEpisodeNumber(ctx.episode);
      const seasonBrowse =
        ctx.mediaType === "tv" &&
        (ctx.tvQueryMode === "season" ||
          (ctx.tvQueryMode !== "episode" && ctxE == null));
      const subdlProbeResolved = String(item.subdlProbe || ctx.subdlWinningProbe || "").trim();
      const probeImpliesSeasonPack =
        subdlProbeResolved === "seasonFullSeasonTmdb" || subdlProbeResolved === "filmNameSeasonFull";
      const probeImpliesSeasonScoped =
        subdlProbeResolved === "seasonOnlyTmdb" || subdlProbeResolved === "filmNameSeasonOnly";
      if (!seasonBrowse && (probeImpliesSeasonPack || probeImpliesSeasonScoped)) {
        const releaseText = releaseTextBundle(item);
        const parsed = parseSeasonEpisodeFromReleaseText(releaseText);
        const metaS = parseOptionalEpisodeNumber(item.season);
        const metaE = parseOptionalEpisodeNumber(item.episode);
        const packHint = seasonPackHintsInText(releaseText, ctxS);
        const exactEpisodeEvidence =
          (parsed.episode != null && parsed.episode === ctxE) ||
          (metaE != null &&
            metaE === ctxE &&
            (parsed.episode == null || parsed.episode === metaE));
        const strongContradictionReason = subdlFallbackProbeContradictionReason(parsed, metaS, metaE, ctxS, ctxE);
        samples.push({
          provider: String(item.provider || ""),
          subdlProbe: item.subdlProbe ?? null,
          classifyBranch: classified.classifyBranch,
          tvMatchKind: classified.tvMatchKind,
          parsedSeason: parsed.season,
          parsedEpisode: parsed.episode,
          seasonMatchQuality: parsed.seasonMatchQuality ?? null,
          episodeMatchQuality: parsed.episodeMatchQuality ?? null,
          metaSeason: metaS,
          metaEpisode: metaE,
          metaSeasonRaw: item.season ?? "",
          metaEpisodeRaw: item.episode ?? "",
          ctxSubdlWinningProbe: ctx.subdlWinningProbe ?? null,
          subdlProbeResolved: subdlProbeResolved || null,
          ctxSeason: ctx.season,
          ctxEpisode: ctx.episode,
          ctxS,
          ctxE,
          tvQueryMode: ctx.tvQueryMode ?? null,
          packHint,
          exactEpisodeEvidence,
          strongContradiction: Boolean(strongContradictionReason),
          strongContradictionReason,
          releaseNameSample: String(item.releaseName || "").slice(0, 120),
          pipelineCacheRev: SUBTITLES_PIPELINE_CACHE_REV
        });
      }
    }
    return scoreWithBreakdown(item, ctx, classified);
  });
  if (wantTrace && debugCounts && samples.length) {
    debugCounts.subdlClassifySamples = samples;
  }
  return scored.sort((a, b) => {
    const ta = Number(a.tvMatchTier || 0);
    const tb = Number(b.tvMatchTier || 0);
    const tierDiff = tb - ta;
    if (tierDiff !== 0) return tierDiff;
    const scoreDiff = Number(b.score || 0) - Number(a.score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    const pa = String(a.provider || "");
    const pb = String(b.provider || "");
    if (pa !== pb) return pa.localeCompare(pb);
    const la = String(a.language || "");
    const lb = String(b.language || "");
    if (la !== lb) return la.localeCompare(lb);
    return String(a.releaseName || "").localeCompare(String(b.releaseName || ""));
  });
}

export async function aggregateSubtitles({
  tmdbId,
  mediaType,
  language,
  season,
  episode,
  year,
  provider = "all",
  fileName = "",
  tvQueryMode = null,
  includeClassificationTrace = false
}) {
  const providerFilter = normalizeProviderFilter(provider);
  const requested = providerFilter === "all" ? ["subdl", "opensubtitles"] : [providerFilter];
  const debugCounts = {
    requestedProviders: requested,
    subdlRaw: 0,
    subdlMapped: 0,
    opensubtitlesRaw: 0,
    opensubtitlesMapped: 0,
    subdlRequestEcho: null,
    subdlByLangAfterMap: {},
    subdlCountAfterDedupe: 0,
    subdlByLangAfterDedupe: {},
    subdlCountAfterSort: 0,
    subdlByLangAfterSort: {},
    subdlByTvMatchAfterSort: {},
    subdlCountAfterTvFilter: 0,
    subdlByLangAfterTvFilter: {},
    subdlByTvMatchAfterTvFilter: {},
    subdlTvAttempts: [],
    subdlSeasonBroadMergedLangs: {},
    subdlHtmlFallbackUsed: false,
    subdlHtmlFallbackTriggerReason: null,
    subdlHtmlFallbackSkipReason: null,
    subdlHtmlMoviePageUrl: null,
    subdlHtmlSeasonPageUrl: null,
    subdlHtmlCandidateUrlsTried: [],
    subdlHtmlFetchStatus: [],
    subdlHtmlAnyCandidateReturnedHtml: false,
    subdlHtmlParserStageCounts: {},
    subdlHtmlHeaderSnippets: [],
    subdlHtmlRowSnippets: [],
    subdlHtmlRowsFound: 0,
    subdlHtmlByLang: {},
    subdlHtmlRowsAfterSeasonFilter: 0,
    subdlHtmlByLangAfterSeasonFilter: {},
    subdlWinningProbe: null,
    subdlClassifySamples: [],
    opensubtitlesMovieAttempts: [],
    perProviderAfterSubdl: {},
    perProviderMergedBeforeDedupe: {},
    perProviderAfterDedupe: {},
    beforeDedup: 0,
    afterDedup: 0,
    finalSorted: 0
  };
  const providerErrors = [];
  let successCount = 0;
  const subtitles = [];

  if (requested.includes("subdl")) {
    if (!SUBDL_API_KEY) {
      providerErrors.push({ provider: "subdl", message: "SUBDL_API_KEY is not configured" });
    } else {
      try {
        const subdlLangSent = subdlLanguagesQueryParam(language);
        const subdlCommon = {
          languages: subdlLangSent,
          subs_per_page: 30,
          comment: 1,
          releases: 1,
          hi: 1
        };
        const subdlParamsMovie = () => ({
          tmdb_id: tmdbId,
          type: "movie",
          ...subdlCommon,
          year: year || undefined
        });
        const subdlParamsTvSeasonMode = () => ({
          tmdb_id: tmdbId,
          type: "tv",
          season_number: season,
          full_season: 1,
          ...subdlCommon
        });

        debugCounts.subdlRequestEcho = {
          scenario:
            mediaType === "movie"
              ? `movie${subdlLangSent ? `_lang_${subdlLangSent}` : "_lang_ALL"}`
              : tvQueryMode === "season"
                ? `tv_S${season}_seasonOnly${subdlLangSent ? `_lang_${subdlLangSent}` : "_lang_ALL"}`
                : `tv_S${season}E${episode}${subdlLangSent ? `_lang_${subdlLangSent}` : "_lang_ALL"}`,
          tmdb_id: String(tmdbId),
          type: mediaType,
          languagesParam: subdlLangSent || null,
          season_number: mediaType === "tv" ? String(season) : undefined,
          episode_number:
            mediaType === "tv" && tvQueryMode === "episode" ? String(episode || "") : undefined,
          full_season: mediaType === "tv" && tvQueryMode === "season" ? 1 : undefined,
          year_sent_for_subdl: mediaType === "movie" && year ? String(year) : null,
          tvEpisodeFallbackChain:
            mediaType === "tv" && tvQueryMode === "episode"
              ? [
                  "exactEpisodeTmdb",
                  "seasonFullSeasonTmdb",
                  "seasonOnlyTmdb",
                  "filmNameSeasonEpisode",
                  "filmNameSeasonFull",
                  "filmNameSeasonOnly"
                ]
              : false,
          tvSeasonFallbackChain:
            mediaType === "tv" && tvQueryMode === "season"
              ? [
                  "seasonModeFullSeasonTmdb",
                  "seasonModeSeasonOnlyTmdb",
                  "seasonModeFilmNameFull",
                  "seasonModeFilmNameOnly",
                  "seasonModeFilmNameBroad"
                ]
              : false
          ,
          movieFallbackChain:
            mediaType === "movie"
              ? [
                  "movieTmdbYear",
                  "movieTmdbNoYear",
                  "movieFilmNameYear",
                  "movieFilmNameNoYear"
                ]
              : false,
          tvSeasonBroadProbePages:
            mediaType === "tv" && tvQueryMode === "season" ? [1, 2, 3] : false
        };

        let rawTotal = 0;
        let mappedTotal = 0;
        const attempts = [];
        let subdlHtmlSeedSdId = "";

        const runSubdlAttempt = async (
          probe,
          params,
          { mergeHits = false, localSeasonFilterCtx = null, diagMeta = null } = {}
        ) => {
          const payload = await subdlFetch(params);
          if (!subdlHtmlSeedSdId) {
            subdlHtmlSeedSdId = extractSubdlSdIdFromResults(payload);
          }
          const raw = payload?.subtitles || payload?.data || [];
          const rawLen = Array.isArray(raw) ? raw.length : 0;
          const mapped = mapSubdl(payload, language).map((row) => ({ ...row, subdlProbe: probe }));
          const mappedLangs = countByNormalizedSubtitleLang(mapped);
          let accepted = mapped;
          let acceptedLangs = mappedLangs;
          if (localSeasonFilterCtx && mapped.length) {
            accepted = mapped.filter((row) => {
              const c = classifyTvSubtitleMatch(row, localSeasonFilterCtx);
              return c.tvMatchKind === "seasonPack" || c.tvMatchKind === "seasonScoped";
            });
            acceptedLangs = countByNormalizedSubtitleLang(accepted);
          }
          attempts.push({
            probe,
            ...(diagMeta || {}),
            rawRows: rawLen,
            mappedRows: mapped.length,
            mappedLangs,
            localSeasonFilterApplied: Boolean(localSeasonFilterCtx),
            localSeasonFilterKeptRows: accepted.length,
            localSeasonFilterDroppedRows: Math.max(0, mapped.length - accepted.length),
            localSeasonFilterKeptLangs: acceptedLangs,
            paramsEcho: echoSubdlParamsForDiag(params)
          });
          if (rawLen > 0 && mergeHits) {
            subtitles.push(...accepted);
            rawTotal += rawLen;
            mappedTotal += accepted.length;
            if (!debugCounts.subdlWinningProbe) debugCounts.subdlWinningProbe = probe;
            return true;
          }
          if (rawLen > 0) {
            subtitles.push(...accepted);
            rawTotal = rawLen;
            mappedTotal = accepted.length;
            if (!debugCounts.subdlWinningProbe) debugCounts.subdlWinningProbe = probe;
            return true;
          }
          return false;
        };
        const runSubdlAttemptSafe = async (
          probe,
          params,
          opts = {},
          extraMeta = {}
        ) => {
          try {
            return await runSubdlAttempt(probe, params, opts);
          } catch (err) {
            attempts.push({
              probe,
              ...(opts?.diagMeta || {}),
              rawRows: 0,
              mappedRows: 0,
              mappedLangs: {},
              localSeasonFilterApplied: Boolean(opts?.localSeasonFilterCtx),
              localSeasonFilterKeptRows: 0,
              localSeasonFilterDroppedRows: 0,
              localSeasonFilterKeptLangs: {},
              failed: true,
              error: String(err?.message || err),
              paramsEcho: echoSubdlParamsForDiag(params)
            });
            logError("SubDL probe failed", err, {
              probe,
              tmdbId,
              title: extraMeta.title || null,
              season,
              mediaType,
              htmlSeasonPageUrl: extraMeta.htmlSeasonPageUrl || null
            });
            return false;
          }
        };

        if (mediaType === "tv" && tvQueryMode === "episode") {
          const epStr = episode != null && String(episode).trim() !== "" ? String(episode).trim() : "";
          const exactTmdb = {
            tmdb_id: tmdbId,
            type: "tv",
            season_number: season,
            episode_number: epStr,
            ...subdlCommon
          };
          let ok = await runSubdlAttempt("exactEpisodeTmdb", exactTmdb);
          if (!ok) {
            ok = await runSubdlAttempt("seasonFullSeasonTmdb", {
              tmdb_id: tmdbId,
              type: "tv",
              season_number: season,
              full_season: 1,
              ...subdlCommon
            });
          }
          if (!ok) {
            ok = await runSubdlAttempt("seasonOnlyTmdb", {
              tmdb_id: tmdbId,
              type: "tv",
              season_number: season,
              ...subdlCommon
            });
          }
          if (!ok && epStr) {
            const showTitle = await fetchTmdbTvNameForSubdl(tmdbId);
            if (showTitle) {
              ok = await runSubdlAttempt("filmNameSeasonEpisode", {
                type: "tv",
                film_name: showTitle,
                season_number: season,
                episode_number: epStr,
                ...subdlCommon
              });
              if (!ok) {
                ok = await runSubdlAttempt("filmNameSeasonFull", {
                  type: "tv",
                  film_name: showTitle,
                  season_number: season,
                  full_season: 1,
                  ...subdlCommon
                });
              }
              if (!ok) {
                ok = await runSubdlAttempt("filmNameSeasonOnly", {
                  type: "tv",
                  film_name: showTitle,
                  season_number: season,
                  ...subdlCommon
                });
              }
            }
          }
          debugCounts.subdlTvAttempts = attempts;
        } else if (mediaType === "tv" && tvQueryMode === "season") {
          await runSubdlAttemptSafe("seasonModeFullSeasonTmdb", subdlParamsTvSeasonMode(), { mergeHits: true });
          await runSubdlAttemptSafe(
            "seasonModeSeasonOnlyTmdb",
            {
              tmdb_id: tmdbId,
              type: "tv",
              season_number: season,
              ...subdlCommon
            },
            { mergeHits: true }
          );
          const showTitleRaw = await fetchTmdbTvNameForSubdl(tmdbId);
          const showTitle = sanitizeSubdlFilmNameForQuery(showTitleRaw);
          if (showTitle) {
            await runSubdlAttemptSafe(
              "seasonModeFilmNameFull",
              {
                type: "tv",
                film_name: showTitle,
                season_number: season,
                full_season: 1,
                ...subdlCommon
              },
              { mergeHits: true },
              { title: showTitle }
            );
            await runSubdlAttemptSafe(
              "seasonModeFilmNameOnly",
              {
                type: "tv",
                film_name: showTitle,
                season_number: season,
                ...subdlCommon
              },
              { mergeHits: true },
              { title: showTitle }
            );
            await runSubdlAttemptSafe(
              "seasonModeFilmNameBroad",
              {
                type: "tv",
                film_name: showTitle,
                page: 1,
                ...subdlCommon
              },
              {
                mergeHits: true,
                localSeasonFilterCtx: {
                  mediaType: "tv",
                  tvQueryMode: "season",
                  season,
                  episode: "",
                  subdlWinningProbe: "seasonModeFilmNameBroad"
                },
                diagMeta: { page: 1 }
              },
              { title: showTitle }
            );
            await runSubdlAttemptSafe(
              "seasonModeFilmNameBroad",
              {
                type: "tv",
                film_name: showTitle,
                page: 2,
                ...subdlCommon
              },
              {
                mergeHits: true,
                localSeasonFilterCtx: {
                  mediaType: "tv",
                  tvQueryMode: "season",
                  season,
                  episode: "",
                  subdlWinningProbe: "seasonModeFilmNameBroad"
                },
                diagMeta: { page: 2 }
              },
              { title: showTitle }
            );
            await runSubdlAttemptSafe(
              "seasonModeFilmNameBroad",
              {
                type: "tv",
                film_name: showTitle,
                page: 3,
                ...subdlCommon
              },
              {
                mergeHits: true,
                localSeasonFilterCtx: {
                  mediaType: "tv",
                  tvQueryMode: "season",
                  season,
                  episode: "",
                  subdlWinningProbe: "seasonModeFilmNameBroad"
                },
                diagMeta: { page: 3 }
              },
              { title: showTitle }
            );
          }
          const requestedLangNorm = normalizeLanguageCode(language);
          const mergedApiLangs = countByNormalizedSubtitleLang(
            subtitles.filter((row) => String(row.provider || "") === "subdl")
          );
          const mergedApiSubdlCount = subtitles.filter((row) => String(row.provider || "") === "subdl").length;
          const mergedApiLangKeys = Object.keys(mergedApiLangs).filter((k) => Number(mergedApiLangs[k] || 0) > 0);
          const missingRequestedLanguage =
            Boolean(requestedLangNorm) && Number(mergedApiLangs[requestedLangNorm] || 0) === 0;
          const narrowLanguageCoverage =
            mappedTotal > 0 &&
            (mergedApiLangKeys.length <= 1 ||
              (mergedApiLangKeys.length === 2 && mergedApiLangKeys.includes("und")));
          const lowResultCount = mergedApiSubdlCount > 0 && mergedApiSubdlCount < SUBDL_SEASON_HTML_LOW_COUNT_THRESHOLD;
          let htmlTriggerReason = null;
          if (missingRequestedLanguage) htmlTriggerReason = "missing-requested-language";
          else if (narrowLanguageCoverage) htmlTriggerReason = "narrow-language-coverage";
          else if (lowResultCount) htmlTriggerReason = "low-result-count";
          debugCounts.subdlHtmlFallbackTriggerReason = htmlTriggerReason;
          if (!htmlTriggerReason) {
            debugCounts.subdlHtmlFallbackSkipReason = "skipped-api-sufficient";
          } else if (!showTitle) {
            debugCounts.subdlHtmlFallbackSkipReason = "skipped-no-show-title";
          } else {
            let htmlCandidates = [];
            try {
              htmlCandidates = buildSubdlSeasonPageCandidates({
                sdId: subdlHtmlSeedSdId,
                showTitle: showTitleRaw || showTitle,
                season
              });
            } catch (err) {
              logError("SubDL HTML candidate build failed", err, {
                tmdbId,
                title: showTitleRaw || showTitle || null,
                season
              });
            }
            debugCounts.subdlHtmlCandidateUrlsTried = htmlCandidates;
            if (!htmlCandidates.length) {
              debugCounts.subdlHtmlFallbackSkipReason = "skipped-no-html-candidates";
            } else {
              let htmlRows = [];
              let usedUrl = null;
              const fetchStatus = [];
              let anyHtml = false;
              for (const candidateUrl of htmlCandidates) {
                try {
                  const res = await fetch(candidateUrl, {
                    headers: { Accept: "text/html" }
                  });
                  if (!res.ok) {
                    fetchStatus.push({
                      url: candidateUrl,
                      ok: false,
                      status: Number(res.status || 0),
                      hasHtml: false,
                      parsedRows: 0
                    });
                    continue;
                  }
                  const html = await res.text();
                  const hasHtml = Boolean(html && html.length > 200);
                  anyHtml = anyHtml || hasHtml;
                  if (!debugCounts.subdlHtmlSeasonPageUrl && hasHtml) {
                    debugCounts.subdlHtmlSeasonPageUrl = candidateUrl;
                  }
                  const parsedOut = parseSubdlSeasonPageHtmlRows(html, requestedLangNorm || "en");
                  const parsed = (parsedOut.rows || []).map((row) => ({
                    ...row,
                    subdlProbe: "seasonModeHtmlSeasonPage"
                  }));
                  if (parsedOut.diag) {
                    debugCounts.subdlHtmlParserStageCounts = {
                      languageHeadersFound: Number(parsedOut.diag.languageHeadersFound || 0),
                      rowCardsFound: Number(parsedOut.diag.rowCardsFound || 0),
                      downloadLinksFound: Number(parsedOut.diag.downloadLinksFound || 0),
                      uploaderLinksFound: Number(parsedOut.diag.uploaderLinksFound || 0)
                    };
                    debugCounts.subdlHtmlHeaderSnippets = Array.isArray(parsedOut.diag.headerSnippets)
                      ? parsedOut.diag.headerSnippets.slice(0, 3)
                      : [];
                    debugCounts.subdlHtmlRowSnippets = Array.isArray(parsedOut.diag.rowSnippets)
                      ? parsedOut.diag.rowSnippets.slice(0, 3)
                      : [];
                  }
                  fetchStatus.push({
                    url: candidateUrl,
                    ok: true,
                    status: Number(res.status || 200),
                    hasHtml,
                    parsedRows: parsed.length
                  });
                  if (!parsed.length) continue;
                  htmlRows = parsed;
                  usedUrl = candidateUrl;
                  break;
                } catch (err) {
                  fetchStatus.push({
                    url: candidateUrl,
                    ok: false,
                    status: 0,
                    hasHtml: false,
                    parsedRows: 0
                  });
                  logError("SubDL HTML fallback fetch/parse candidate failed", err, {
                    tmdbId,
                    title: showTitleRaw || showTitle || null,
                    season,
                    htmlSeasonPageUrl: candidateUrl
                  });
                }
              }
              debugCounts.subdlHtmlFetchStatus = fetchStatus;
              debugCounts.subdlHtmlAnyCandidateReturnedHtml = anyHtml;
              if (!htmlRows.length) {
                debugCounts.subdlHtmlFallbackSkipReason = anyHtml
                  ? "skipped-html-parse-empty"
                  : "skipped-html-fetch-failed";
              } else {
                const seasonCtx = {
                  mediaType: "tv",
                  tvQueryMode: "season",
                  season,
                  episode: "",
                  subdlWinningProbe: "seasonModeHtmlSeasonPage"
                };
                const keptHtmlRows = htmlRows.filter((row) => {
                  const c = classifyTvSubtitleMatch(row, seasonCtx);
                  return c.tvMatchKind === "seasonPack" || c.tvMatchKind === "seasonScoped";
                });
                debugCounts.subdlHtmlFallbackUsed = true;
                debugCounts.subdlHtmlFallbackSkipReason = null;
                debugCounts.subdlHtmlSeasonPageUrl = usedUrl;
                debugCounts.subdlHtmlRowsFound = htmlRows.length;
                debugCounts.subdlHtmlByLang = countByNormalizedSubtitleLang(htmlRows);
                debugCounts.subdlHtmlRowsAfterSeasonFilter = keptHtmlRows.length;
                debugCounts.subdlHtmlByLangAfterSeasonFilter = countByNormalizedSubtitleLang(keptHtmlRows);
                subtitles.push(...keptHtmlRows);
                mappedTotal += keptHtmlRows.length;
              }
            }
          }
          debugCounts.subdlTvAttempts = attempts;
        } else {
          const requestedYear = String(year || "").trim();
          const movieIdentity = await fetchTmdbMovieIdentityForFallback(tmdbId);
          const filmName = sanitizeSubdlFilmNameForQuery(movieIdentity.title || "");
          const fallbackYear = requestedYear || String(movieIdentity.year || "").trim();
          const movieProbes = [
            {
              probe: "movieTmdbYear",
              params: {
                tmdb_id: tmdbId,
                type: "movie",
                ...subdlCommon,
                year: fallbackYear || undefined
              }
            },
            {
              probe: "movieTmdbNoYear",
              params: {
                tmdb_id: tmdbId,
                type: "movie",
                ...subdlCommon
              }
            },
            {
              probe: "movieFilmNameYear",
              params: filmName
                ? {
                    type: "movie",
                    film_name: filmName,
                    ...subdlCommon,
                    year: fallbackYear || undefined
                  }
                : null
            },
            {
              probe: "movieFilmNameNoYear",
              params: filmName
                ? {
                    type: "movie",
                    film_name: filmName,
                    ...subdlCommon
                  }
                : null
            }
          ];
          debugCounts.subdlRequestEcho.year_sent_for_subdl = fallbackYear || null;
          debugCounts.subdlRequestEcho.year_optional_fallback_enabled = true;
          for (const step of movieProbes) {
            if (!step?.params) continue;
            const ok = await runSubdlAttemptSafe(step.probe, step.params, {}, { title: filmName });
            if (ok) break;
          }
          const subdlMovieCountAfterApi = subtitles.filter((row) => String(row.provider || "") === "subdl").length;
          if (subdlMovieCountAfterApi === 0) {
            debugCounts.subdlHtmlFallbackTriggerReason = "movie-api-empty";
            const movieTitleRaw = String(movieIdentity.title || "").trim();
            const movieCandidates = buildSubdlMoviePageCandidates({
              sdId: subdlHtmlSeedSdId,
              movieTitle: movieTitleRaw || filmName,
              year: fallbackYear
            });
            debugCounts.subdlHtmlCandidateUrlsTried = movieCandidates;
            if (!movieCandidates.length) {
              debugCounts.subdlHtmlFallbackSkipReason = "skipped-no-movie-html-candidates";
            } else {
              let htmlRows = [];
              let usedUrl = null;
              let anyHtml = false;
              const fetchStatus = [];
              for (const candidateUrl of movieCandidates) {
                try {
                  const res = await fetch(candidateUrl, {
                    headers: { Accept: "text/html" }
                  });
                  if (!res.ok) {
                    fetchStatus.push({
                      url: candidateUrl,
                      ok: false,
                      status: Number(res.status || 0),
                      hasHtml: false,
                      parsedRows: 0
                    });
                    continue;
                  }
                  const html = await res.text();
                  const hasHtml = Boolean(html && html.length > 200);
                  anyHtml = anyHtml || hasHtml;
                  if (hasHtml && !debugCounts.subdlHtmlMoviePageUrl) {
                    debugCounts.subdlHtmlMoviePageUrl = candidateUrl;
                  }
                  const parsedOut = parseSubdlSeasonPageHtmlRows(html, normalizeLanguageCode(language) || "en");
                  const parsed = (parsedOut.rows || []).map((row) => ({
                    ...row,
                    subdlProbe: "movieModeHtmlPage"
                  }));
                  if (parsedOut.diag) {
                    debugCounts.subdlHtmlParserStageCounts = {
                      languageHeadersFound: Number(parsedOut.diag.languageHeadersFound || 0),
                      rowCardsFound: Number(parsedOut.diag.rowCardsFound || 0),
                      downloadLinksFound: Number(parsedOut.diag.downloadLinksFound || 0),
                      uploaderLinksFound: Number(parsedOut.diag.uploaderLinksFound || 0)
                    };
                    debugCounts.subdlHtmlHeaderSnippets = Array.isArray(parsedOut.diag.headerSnippets)
                      ? parsedOut.diag.headerSnippets.slice(0, 3)
                      : [];
                    debugCounts.subdlHtmlRowSnippets = Array.isArray(parsedOut.diag.rowSnippets)
                      ? parsedOut.diag.rowSnippets.slice(0, 3)
                      : [];
                  }
                  fetchStatus.push({
                    url: candidateUrl,
                    ok: true,
                    status: Number(res.status || 200),
                    hasHtml,
                    parsedRows: parsed.length
                  });
                  if (!parsed.length) continue;
                  htmlRows = parsed;
                  usedUrl = candidateUrl;
                  break;
                } catch (err) {
                  fetchStatus.push({
                    url: candidateUrl,
                    ok: false,
                    status: 0,
                    hasHtml: false,
                    parsedRows: 0
                  });
                  logError("SubDL movie HTML fallback fetch/parse failed", err, {
                    tmdbId,
                    mediaType,
                    title: movieTitleRaw || filmName || null,
                    htmlMoviePageUrl: candidateUrl
                  });
                }
              }
              debugCounts.subdlHtmlFetchStatus = fetchStatus;
              debugCounts.subdlHtmlAnyCandidateReturnedHtml = anyHtml;
              if (!htmlRows.length) {
                debugCounts.subdlHtmlFallbackSkipReason = anyHtml
                  ? "skipped-movie-html-parse-empty"
                  : "skipped-movie-html-fetch-failed";
              } else {
                debugCounts.subdlHtmlFallbackUsed = true;
                debugCounts.subdlHtmlFallbackSkipReason = null;
                debugCounts.subdlHtmlMoviePageUrl = usedUrl;
                debugCounts.subdlHtmlRowsFound = htmlRows.length;
                debugCounts.subdlHtmlByLang = countByNormalizedSubtitleLang(htmlRows);
                debugCounts.subdlHtmlRowsAfterSeasonFilter = htmlRows.length;
                debugCounts.subdlHtmlByLangAfterSeasonFilter = countByNormalizedSubtitleLang(htmlRows);
                subtitles.push(...htmlRows);
                mappedTotal += htmlRows.length;
                rawTotal += htmlRows.length;
                if (!debugCounts.subdlWinningProbe) debugCounts.subdlWinningProbe = "movieModeHtmlPage";
              }
            }
          } else {
            debugCounts.subdlHtmlFallbackSkipReason = "skipped-api-sufficient";
          }
          debugCounts.subdlTvAttempts = attempts;
        }

        debugCounts.subdlRaw = rawTotal;
        debugCounts.subdlMapped = mappedTotal;
        debugCounts.subdlByLangAfterMap = countByNormalizedSubtitleLang(subtitles);
        debugCounts.subdlSeasonBroadMergedLangs = countByNormalizedSubtitleLang(
          subtitles.filter((row) => String(row.provider || "") === "subdl" && row.subdlProbe === "seasonModeFilmNameBroad")
        );
        successCount += 1;
      } catch (err) {
        providerErrors.push({ provider: "subdl", message: err.message });
      }
    }
  }

  debugCounts.perProviderAfterSubdl = countByProvider(subtitles);

  if (requested.includes("opensubtitles")) {
    if (!OPENSUBTITLES_API_KEY) {
      providerErrors.push({
        provider: "opensubtitles",
        message: "OPENSUBTITLES_API_KEY is not configured"
      });
    } else {
      try {
        const allResults = [];
        let rawSum = 0;
        const openSubMovieAttempts = [];
        const pullOpenSubPages = async (episodeFilter) => {
          const seasonMode = mediaType === "tv" && tvQueryMode === "season";
          const resolveDownloads = !seasonMode;
          const maxResolve = seasonMode ? 0 : 12;
          const resolveTimeoutMs = seasonMode ? 0 : 3500;
          for (let i = 1; i <= 3; i += 1) {
            const pageResult = await searchOpenSubtitles({
              tmdbId,
              mediaType,
              language,
              season,
              episode: episodeFilter,
              year,
              page: i,
              resolveDownloads,
              maxResolve,
              resolveTimeoutMs
            });
            rawSum += Number(pageResult.rawCount || 0);
            allResults.push(...(pageResult.items || []));
            if ((pageResult.items || []).length < 30) break;
          }
        };
        const runOpenSubAttempt = async (
          label,
          {
            tmdbIdOverride = "",
            imdbIdOverride = "",
            queryOverride = "",
            yearOverride = year || "",
            episodeOverride = episode
          } = {}
        ) => {
          const beforeRaw = rawSum;
          const beforeMapped = allResults.length;
          const runPages = async () => {
            const seasonMode = mediaType === "tv" && tvQueryMode === "season";
            const resolveDownloads = !seasonMode;
            const maxResolve = seasonMode ? 0 : 12;
            const resolveTimeoutMs = seasonMode ? 0 : 3500;
            for (let i = 1; i <= 3; i += 1) {
              const pageResult = await searchOpenSubtitles({
                tmdbId: tmdbIdOverride || "",
                imdbId: imdbIdOverride || "",
                query: queryOverride || "",
                mediaType,
                language,
                season,
                episode: episodeOverride,
                year: yearOverride,
                page: i,
                resolveDownloads,
                maxResolve,
                resolveTimeoutMs
              });
              rawSum += Number(pageResult.rawCount || 0);
              allResults.push(...(pageResult.items || []));
              if ((pageResult.items || []).length < 30) break;
            }
          };
          try {
            await runPages();
            openSubMovieAttempts.push({
              probe: label,
              tmdb_id: tmdbIdOverride ? String(tmdbIdOverride) : null,
              imdb_id: imdbIdOverride ? String(imdbIdOverride) : null,
              query: queryOverride ? String(queryOverride).slice(0, 120) : null,
              year: yearOverride ? String(yearOverride) : null,
              rawAdded: Math.max(0, rawSum - beforeRaw),
              mappedAdded: Math.max(0, allResults.length - beforeMapped),
              failed: false
            });
          } catch (err) {
            openSubMovieAttempts.push({
              probe: label,
              tmdb_id: tmdbIdOverride ? String(tmdbIdOverride) : null,
              imdb_id: imdbIdOverride ? String(imdbIdOverride) : null,
              query: queryOverride ? String(queryOverride).slice(0, 120) : null,
              year: yearOverride ? String(yearOverride) : null,
              rawAdded: 0,
              mappedAdded: 0,
              failed: true,
              error: String(err?.message || err)
            });
            logError("OpenSubtitles movie fallback probe failed", err, {
              probe: label,
              tmdbId,
              mediaType
            });
          }
          return Math.max(0, rawSum - beforeRaw);
        };
        if (mediaType === "tv") {
          if (tvQueryMode === "season") {
            await pullOpenSubPages("");
          } else {
            await pullOpenSubPages(episode);
          }
        } else {
          const strictRaw = await runOpenSubAttempt("movieTmdbStrict", {
            tmdbIdOverride: tmdbId,
            yearOverride: year || ""
          });
          if (strictRaw === 0) {
            const movieIdentity = await fetchTmdbMovieIdentityForFallback(tmdbId);
            const titleQuery = String(movieIdentity.title || "").trim();
            const fallbackYear = String(year || "").trim() || String(movieIdentity.year || "").trim();
            const imdbId = String(movieIdentity.imdbId || "").trim();
            if (imdbId) {
              const imdbRaw = await runOpenSubAttempt("movieImdbWithYear", {
                imdbIdOverride: imdbId,
                yearOverride: fallbackYear || ""
              });
              if (imdbRaw === 0) {
                await runOpenSubAttempt("movieImdbNoYear", {
                  imdbIdOverride: imdbId,
                  yearOverride: ""
                });
              }
            }
            if (rawSum === 0 && titleQuery) {
              const titleYearRaw = await runOpenSubAttempt("movieTitleYear", {
                queryOverride: titleQuery,
                yearOverride: fallbackYear || ""
              });
              if (titleYearRaw === 0) {
                await runOpenSubAttempt("movieTitleNoYear", {
                  queryOverride: titleQuery,
                  yearOverride: ""
                });
              }
            }
          }
        }
        debugCounts.opensubtitlesMovieAttempts = openSubMovieAttempts;
        debugCounts.opensubtitlesRaw = rawSum;
        debugCounts.opensubtitlesMapped = allResults.length;
        subtitles.push(...allResults);
        successCount += 1;
      } catch (err) {
        providerErrors.push({ provider: "opensubtitles", message: err.message });
      }
    }
  }

  debugCounts.perProviderMergedBeforeDedupe = countByProvider(subtitles);
  debugCounts.beforeDedup = subtitles.length;
  const deduped = dedupeSubtitles(subtitles);
  debugCounts.perProviderAfterDedupe = countByProvider(deduped);
  debugCounts.afterDedup = deduped.length;
  const subdlDeduped = deduped.filter((s) => String(s.provider || "") === "subdl");
  debugCounts.subdlCountAfterDedupe = subdlDeduped.length;
  debugCounts.subdlByLangAfterDedupe = countByNormalizedSubtitleLang(subdlDeduped);
  const sortCtx = {
    language,
    mediaType,
    season,
    episode,
    fileName,
    tvQueryMode: mediaType === "tv" ? tvQueryMode : undefined,
    /** Episode-chain winning probe; fallback if a row ever lacks `subdlProbe` after merge */
    subdlWinningProbe:
      mediaType === "tv" && debugCounts.subdlWinningProbe
        ? String(debugCounts.subdlWinningProbe)
        : null,
    includeClassificationTrace: Boolean(includeClassificationTrace) && mediaType === "tv"
  };
  const sorted = sortSubtitles(deduped, sortCtx, debugCounts);
  const subdlSorted = sorted.filter((s) => String(s.provider || "") === "subdl");
  debugCounts.subdlCountAfterSort = subdlSorted.length;
  debugCounts.subdlByLangAfterSort = countByNormalizedSubtitleLang(subdlSorted);
  debugCounts.subdlByTvMatchAfterSort = countSubdlByTvMatch(sorted);
  debugCounts.subdlByProbeAfterSort = foldSubdlByProbeAndKind(sorted);
  let finalList = sorted;
  if (tvQueryMode === "episode") {
    finalList = sorted.filter((s) => s.tvMatchKind === "exactEpisode");
  } else if (tvQueryMode === "season") {
    finalList = sorted.filter(
      (s) => s.tvMatchKind === "seasonPack" || s.tvMatchKind === "seasonScoped"
    );
  }
  debugCounts.finalSorted = finalList.length;
  const subdlFinal = finalList.filter((s) => String(s.provider || "") === "subdl");
  debugCounts.subdlCountAfterTvFilter = subdlFinal.length;
  debugCounts.subdlByLangAfterTvFilter = countByNormalizedSubtitleLang(subdlFinal);
  debugCounts.subdlByTvMatchAfterTvFilter = countSubdlByTvMatch(finalList);

  if (tvQueryMode === "episode") {
    const subdlSeasonInSorted = sorted.filter(
      (s) =>
        String(s.provider || "") === "subdl" &&
        (s.tvMatchKind === "seasonPack" || s.tvMatchKind === "seasonScoped")
    ).length;
    const subdlExactInSorted = sorted.filter(
      (s) => String(s.provider || "") === "subdl" && s.tvMatchKind === "exactEpisode"
    ).length;
    debugCounts.tvEpisodeSubdlAnalysis = {
      subdlByKindAfterSort: countSubdlByTvMatch(sorted),
      subdlByKindAfterTvFilter: countSubdlByTvMatch(finalList),
      subdlExactAfterSort: subdlExactInSorted,
      subdlSeasonPackAfterSort: sorted.filter(
        (s) => String(s.provider || "") === "subdl" && s.tvMatchKind === "seasonPack"
      ).length,
      subdlSeasonScopedAfterSort: sorted.filter(
        (s) => String(s.provider || "") === "subdl" && s.tvMatchKind === "seasonScoped"
      ).length,
      subdlSeasonLevelCombinedAfterSort: subdlSeasonInSorted,
      contractNoteAr:
        "وضع الحلقة (episode): القائمة الرئيسية exactEpisode فقط. أي صف موسم عام/باك أو حلقة مختلفة يُزال من الاستجابة الرئيسية.",
      compareHintAr:
        "في وضع الموسم (بدون episode): الخادم يعيد كل ما يخص نفس الموسم عبر seasonPack + seasonScoped (يشمل الصفوف العامة وصفوف حلقات نفس الموسم).",
      subdlProbeNoteAr:
        "كل صف SubDL يحمل subdlProbe عند الجمع ثم يُزال من JSON. عند diagnostics=1 راجع subdlTrace.subdlClassifySamples و pipelineCacheRev (مفتاح الكاش يتغيّر مع rev — لا استجابة قديمة بعد تعديل الكود).",
      subdlByProbeAfterSort: debugCounts.subdlByProbeAfterSort || {}
    };
  } else {
    debugCounts.tvEpisodeSubdlAnalysis = null;
  }

  let alternateSubtitles = [];
  if (tvQueryMode === "episode") {
    const hasSubdlExactInFinal = finalList.some((s) => String(s.provider || "") === "subdl");
    if (!hasSubdlExactInFinal) {
      alternateSubtitles = sorted
        .filter((s) => s.tvMatchKind === "seasonPack" || s.tvMatchKind === "seasonScoped")
        .slice(0, 80);
    }
  }

  const diagnostics = summarizeSubtitlePipeline(sortCtx, sorted, finalList, debugCounts);

  return {
    provider: providerFilter,
    providerErrors,
    subtitles: stripSubdlProbeFromRows(finalList),
    alternateSubtitles: stripSubdlProbeFromRows(alternateSubtitles),
    debugCounts,
    diagnostics,
    allFailed: requested.length > 0 && successCount === 0
  };
}

export function requireSearchConfig() {
  const missing = [];
  if (!TMDB_BEARER_TOKEN) missing.push("TMDB_BEARER_TOKEN");
  return missing;
}

export function requireSubtitlesConfig() {
  const missing = [];
  if (!TMDB_BEARER_TOKEN) missing.push("TMDB_BEARER_TOKEN");
  if (!SUBDL_API_KEY && !OPENSUBTITLES_API_KEY) {
    missing.push("SUBDL_API_KEY or OPENSUBTITLES_API_KEY");
  }
  return missing;
}

