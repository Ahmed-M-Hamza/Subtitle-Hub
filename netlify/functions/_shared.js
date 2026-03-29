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
/** Optional second OpenSubtitles account: separate daily /download quota when primary is exhausted. */
const OPENSUBTITLES_USERNAME_FALLBACK = String(process.env.OPENSUBTITLES_USERNAME_FALLBACK || "").trim();
const OPENSUBTITLES_PASSWORD_FALLBACK = String(process.env.OPENSUBTITLES_PASSWORD_FALLBACK || "").trim();
const OPENSUBTITLES_API_KEY_FALLBACK = String(process.env.OPENSUBTITLES_API_KEY_FALLBACK || "").trim();
const OPENSUBTITLES_USER_AGENT = String(
  process.env.OPENSUBTITLES_USER_AGENT || "SubtitleHub-Netlify/1.0"
).trim();
const APP_NAME = String(process.env.APP_NAME || "Subtitle Hub").trim() || "Subtitle Hub";
const BOOTED_AT = Date.now();

/** Bump when TV classification / subtitle aggregation changes — included in subtitles cache key (see subtitles.js). */
export const SUBTITLES_PIPELINE_CACHE_REV = 23;
export const HOME_FEED_CACHE_REV = 3;
const SUBDL_SEASON_HTML_LOW_COUNT_THRESHOLD = 20;
const HOME_FEED_TIME_BUDGET_MS = 25000;
/** Min cards required to expose a discovery section (Arabic is slightly looser). */
const HOME_FEED_MIN_SECTION = 5;
const HOME_FEED_MIN_SECTION_ARABIC = 4;
/** Max items returned per section after ranking. */
const HOME_FEED_DISPLAY_LATEST_MOVIES = 8;
const HOME_FEED_DISPLAY_LATEST_TV = 8;
const HOME_FEED_DISPLAY_TRENDING = 7;
const HOME_FEED_DISPLAY_POPULAR = 7;
const HOME_FEED_DISPLAY_ARABIC = 8;
/** Max TMDb candidates to probe per section (bounded; probes run with limited concurrency). */
const HOME_FEED_MAX_PROBE_LATEST = 16;
/** Concurrent subtitle availability probes per home-feed section (SubDL + OpenSubtitles per item). */
const HOME_FEED_PROBE_CONCURRENCY = 4;
/** Parallel OpenSubtitles /download resolves per search page (was strictly sequential). */
const OPENSUB_DOWNLOAD_RESOLVE_CONCURRENCY = 6;
const HOME_FEED_MAX_PROBE_TV = 16;
const HOME_FEED_MAX_PROBE_TRENDING = 14;
const HOME_FEED_MAX_PROBE_POPULAR = 14;
const HOME_FEED_MAX_PROBE_ARABIC = 14;
/** Stop probing once this many subtitle-positive rows collected (then rank & slice). */
const HOME_FEED_RANK_COLLECT_CAP = 15;
const OPENSUB_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;

const TOKEN_TTL_MS = 50 * 60 * 1000;
const DOWNLOAD_LINK_TTL_MS = 10 * 60 * 1000;
const OPENSUBTITLES_API = "https://api.opensubtitles.com/api/v1";

const openSubPrimaryAuth = { token: "", exp: 0, loginPromise: null };
const openSubFallbackAuth = { token: "", exp: 0, loginPromise: null };
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
    opensubtitlesFallbackConfigured: Boolean(
      OPENSUBTITLES_USERNAME_FALLBACK &&
        OPENSUBTITLES_PASSWORD_FALLBACK &&
        (OPENSUBTITLES_API_KEY_FALLBACK || OPENSUBTITLES_API_KEY)
    ),
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
  const releaseOrFirstAirDate =
    mediaType === "movie"
      ? String(item?.release_date || "").trim()
      : String(item?.first_air_date || "").trim();
  return {
    tmdbId: Number(item?.id || 0),
    mediaType,
    title,
    year,
    overview: String(item?.overview || ""),
    poster: item?.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : "",
    backdrop: item?.backdrop_path ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}` : "",
    voteAverage: Number(item?.vote_average || 0),
    voteCount: Number(item?.vote_count || 0),
    popularity: Number(item?.popularity || 0),
    releaseOrFirstAirDate
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

async function subtitleAvailabilityForItem(item, { language = "", probeCache = null } = {}) {
  const tmdbId = Number(item?.tmdbId || 0);
  const mediaType = String(item?.mediaType || "").toLowerCase();
  if (!tmdbId || (mediaType !== "movie" && mediaType !== "tv")) {
    return { hasSubtitles: false, providers: [] };
  }
  const cacheKey = `${mediaType}:${tmdbId}:${normalizeLanguageCode(language) || "all"}`;
  if (probeCache && probeCache.has(cacheKey)) {
    return probeCache.get(cacheKey);
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
  const result = {
    hasSubtitles: providers.length > 0,
    providers,
    reason,
    probeSuccessCount
  };
  if (probeCache) probeCache.set(cacheKey, result);
  return result;
}

function homeFeedIsoDateMs(raw = "") {
  if (!raw || typeof raw !== "string") return null;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? t : null;
}

/**
 * Rank subtitle-ready discovery rows: dual-source availability, probe health, recency, popularity, ratings.
 * Used only while building the home feed (internal — stripped before JSON).
 */
function scoreHomeDiscoveryRow(item, { arabicSection = false } = {}) {
  const provCount = Array.isArray(item.subtitleProviders) ? item.subtitleProviders.length : 0;
  const probeOk = Number(item.probeSuccessCount || 0);

  let score = 0;
  score += provCount >= 2 ? 100 : provCount === 1 ? 34 : 0;
  score += probeOk >= 2 ? 20 : probeOk === 1 ? 7 : 0;

  const y = Number(item.year);
  const fallbackDate = Number.isFinite(y) && y > 1900 ? `${y}-06-15` : "";
  const ms = homeFeedIsoDateMs(item.releaseOrFirstAirDate) ?? homeFeedIsoDateMs(fallbackDate);
  if (ms != null) {
    const days = Math.max(0, (Date.now() - ms) / 86400000);
    score += Math.max(0, 220 - Math.min(days, 220)) * 0.14;
  }

  score += Math.min(40, Math.log1p(Math.max(0, Number(item.popularity || 0))) * 6.5);
  score += Math.min(16, Math.log1p(Math.max(0, Number(item.voteCount || 0))) * 2);
  score += Math.max(0, Math.min(10, Number(item.voteAverage || 0))) * 1.6;
  if (arabicSection) score += 12;
  if (item.poster) score += 3;
  return score;
}

function sanitizeHomeFeedRow(row) {
  if (!row || typeof row !== "object") return row;
  const { probeSuccessCount, releaseOrFirstAirDate, subtitleProviders, ...rest } = row;
  return rest;
}

async function filterBySubtitleAvailability(
  items,
  {
    language = "",
    displayLimit = 8,
    maxProbe = 20,
    rankCollectCap = HOME_FEED_RANK_COLLECT_CAP,
    deadlineAt = 0,
    sectionName = "",
    minDisplayRows = HOME_FEED_MIN_SECTION,
    probeCache = null
  } = {}
) {
  const candidates = dedupeDiscoveryItems(items).slice(0, maxProbe);
  const collected = [];
  let attempted = 0;
  let timeBudgetHit = false;
  const reasonCounts = {
    "all-provider-probes-failed": 0,
    "no-subtitles-found": 0
  };
  const arabicSection = normalizeLanguageCode(language) === "ar";

  let nextCandidate = 0;
  const claimCandidate = () => {
    const i = nextCandidate;
    nextCandidate += 1;
    return i;
  };

  const runOne = async () => {
    while (true) {
      if (deadlineAt && Date.now() >= deadlineAt) {
        timeBudgetHit = true;
        break;
      }
      if (collected.length >= rankCollectCap) break;
      const idx = claimCandidate();
      if (idx >= candidates.length) break;
      attempted += 1;
      const item = candidates[idx];
      const availability = await subtitleAvailabilityForItem(item, { language, probeCache });
      if (!availability.hasSubtitles) {
        const r = availability.reason;
        if (r && reasonCounts[r] != null) reasonCounts[r] += 1;
        continue;
      }
      collected.push({
        ...item,
        subtitleProviders: availability.providers,
        probeSuccessCount: availability.probeSuccessCount,
        subtitleCoverage: {
          any: true,
          arabic: arabicSection
        }
      });
    }
  };

  const workers = Math.min(HOME_FEED_PROBE_CONCURRENCY, Math.max(1, candidates.length));
  await Promise.all(Array.from({ length: workers }, () => runOne()));

  const scoreOpts = { arabicSection };
  collected.sort((a, b) => scoreHomeDiscoveryRow(b, scoreOpts) - scoreHomeDiscoveryRow(a, scoreOpts));
  if (collected.length > rankCollectCap) collected.splice(rankCollectCap);

  let rows = collected.slice(0, displayLimit);
  if (rows.length < minDisplayRows) {
    rows = [];
  }

  logInfo("home-feed section subtitle filtering", {
    section: sectionName || "unknown",
    language: language || "all",
    candidateCount: candidates.length,
    attempted,
    matched: collected.length,
    returned: rows.length,
    timeBudgetHit,
    droppedByReason: reasonCounts,
    minDisplayRows
  });

  return {
    rows,
    diag: {
      section: sectionName || "unknown",
      candidateCount: candidates.length,
      attempted,
      matched: collected.length,
      returned: rows.length,
      timeBudgetHit,
      droppedByReason: reasonCounts,
      minDisplayRows
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
  homeFeedBuildPromise = getOrSetCache("homefeed", key, 30 * 60 * 1000, async () => {
    const startedAt = Date.now();
    const deadlineAt = startedAt + HOME_FEED_TIME_BUDGET_MS;
    const homeFeedProbeCache = new Map();
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

    const [latestMoviesRaw, latestTvRaw, trendingRaw, popularMoviesRaw] = await Promise.all([
      fetchSourceSafe("latestMovies", "/movie/now_playing", { language: "en-US", page: 1, region: "US" }),
      fetchSourceSafe("latestTv", "/tv/on_the_air", { language: "en-US", page: 1 }),
      fetchSourceSafe("trending", "/trending/all/week", { language: "en-US", page: 1 }),
      fetchSourceSafe("popularMovies", "/movie/popular", { language: "en-US", page: 1, region: "US" })
    ]);

    const latestMoviesPool = dedupeDiscoveryItems((latestMoviesRaw?.results || []).map((row) => mapDiscoveryItem(row, "movie")).filter(Boolean));
    const latestTvPool = dedupeDiscoveryItems((latestTvRaw?.results || []).map((row) => mapDiscoveryItem(row, "tv")).filter(Boolean));
    const trendingPool = dedupeDiscoveryItems((trendingRaw?.results || []).map((row) => mapDiscoveryItem(row, "")).filter(Boolean));
    const popularMoviesPool = dedupeDiscoveryItems(
      (popularMoviesRaw?.results || []).map((row) => mapDiscoveryItem(row, "movie")).filter(Boolean)
    );
    logInfo("home-feed normalization/dedupe", {
      latestMoviesPool: latestMoviesPool.length,
      latestTvPool: latestTvPool.length,
      trendingPool: trendingPool.length,
      popularMoviesPool: popularMoviesPool.length
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
        displayLimit: HOME_FEED_DISPLAY_LATEST_MOVIES,
        maxProbe: HOME_FEED_MAX_PROBE_LATEST,
        rankCollectCap: HOME_FEED_RANK_COLLECT_CAP,
        deadlineAt,
        sectionName: "latestMoviesWithSubs",
        minDisplayRows: HOME_FEED_MIN_SECTION,
        probeCache: homeFeedProbeCache
      })
    );
    const latestTvWithSubsResult = await runSectionSafe("latestTvWithSubs", () =>
      filterBySubtitleAvailability(latestTvPool, {
        language: "",
        displayLimit: HOME_FEED_DISPLAY_LATEST_TV,
        maxProbe: HOME_FEED_MAX_PROBE_TV,
        rankCollectCap: HOME_FEED_RANK_COLLECT_CAP,
        deadlineAt,
        sectionName: "latestTvWithSubs",
        minDisplayRows: HOME_FEED_MIN_SECTION,
        probeCache: homeFeedProbeCache
      })
    );
    const trendingWithSubsResult = await runSectionSafe("trendingWithSubs", () =>
      filterBySubtitleAvailability(trendingPool, {
        language: "",
        displayLimit: HOME_FEED_DISPLAY_TRENDING,
        maxProbe: HOME_FEED_MAX_PROBE_TRENDING,
        rankCollectCap: HOME_FEED_RANK_COLLECT_CAP,
        deadlineAt,
        sectionName: "trendingWithSubs",
        minDisplayRows: HOME_FEED_MIN_SECTION,
        probeCache: homeFeedProbeCache
      })
    );
    const popularWithSubsResult = await runSectionSafe("popularWithSubs", () =>
      filterBySubtitleAvailability(popularMoviesPool, {
        language: "",
        displayLimit: HOME_FEED_DISPLAY_POPULAR,
        maxProbe: HOME_FEED_MAX_PROBE_POPULAR,
        rankCollectCap: HOME_FEED_RANK_COLLECT_CAP,
        deadlineAt,
        sectionName: "popularWithSubs",
        minDisplayRows: HOME_FEED_MIN_SECTION,
        probeCache: homeFeedProbeCache
      })
    );
    const latestArabicMoviesResult = await runSectionSafe("latestArabicMovies", () =>
      filterBySubtitleAvailability(latestMoviesPool, {
        language: "ar",
        displayLimit: HOME_FEED_DISPLAY_ARABIC,
        maxProbe: HOME_FEED_MAX_PROBE_ARABIC,
        rankCollectCap: HOME_FEED_RANK_COLLECT_CAP,
        deadlineAt,
        sectionName: "latestArabicMovies",
        minDisplayRows: HOME_FEED_MIN_SECTION_ARABIC,
        probeCache: homeFeedProbeCache
      })
    );
    const latestMoviesWithSubs = latestMoviesWithSubsResult.rows.map(sanitizeHomeFeedRow);
    const latestArabicMovies = latestArabicMoviesResult.rows.map(sanitizeHomeFeedRow);
    const latestTvWithSubs = latestTvWithSubsResult.rows.map(sanitizeHomeFeedRow);
    const trendingWithSubs = trendingWithSubsResult.rows.map(sanitizeHomeFeedRow);
    const popularWithSubs = popularWithSubsResult.rows.map(sanitizeHomeFeedRow);

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
      popularWithSubs: popularWithSubs.length,
      elapsedMs: Date.now() - startedAt
    });

    return {
      generatedAt: new Date().toISOString(),
      sections: {
        latestMoviesWithSubs,
        latestArabicMovies,
        latestTvWithSubs,
        trendingWithSubs,
        popularWithSubs
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
  const parseOrObject = (text) => {
    try {
      return JSON.parse(String(text || ""));
    } catch {
      return null;
    }
  };
  const trimBody = (text) => String(text || "").slice(0, 1000);
  let response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (err) {
    const e = new Error(`SubDL network error: ${String(err?.message || err)}`);
    e.subdl = {
      errorType: "network_error",
      httpStatus: 0,
      responseBody: "",
      providerMessage: "",
      upstreamMessage: String(err?.message || err)
    };
    throw e;
  }
  const rawText = await response.text();
  const payload = parseOrObject(rawText);
  if (!response.ok) {
    const providerMessage = String(payload?.error || payload?.message || "").trim();
    const e = new Error(providerMessage || `SubDL HTTP ${response.status}`);
    e.subdl = {
      errorType: "api_error",
      httpStatus: Number(response.status || 0),
      responseBody: trimBody(rawText),
      providerMessage,
      upstreamMessage: String(e.message || "")
    };
    throw e;
  }
  if (!payload || typeof payload !== "object") {
    const e = new Error("SubDL malformed payload (non-JSON response)");
    e.subdl = {
      errorType: "malformed_payload",
      httpStatus: Number(response.status || 200),
      responseBody: trimBody(rawText),
      providerMessage: "",
      upstreamMessage: e.message
    };
    throw e;
  }
  if (payload?.status === false) {
    const providerMessage = String(payload?.error || payload?.message || "SubDL reported status=false").trim();
    const e = new Error(providerMessage || "SubDL reported an error");
    e.subdl = {
      errorType: "api_error",
      httpStatus: Number(response.status || 200),
      responseBody: trimBody(rawText),
      providerMessage,
      upstreamMessage: String(e.message || "")
    };
    throw e;
  }
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
    const payload = await tmdbFetch(`/tv/${Number(tmdbId)}`, {
      language: "en-US",
      append_to_response: "external_ids"
    });
    const name = String(payload?.name || "").trim();
    const originalName = String(payload?.original_name || "").trim();
    const primary = String(name || originalName).trim().slice(0, 200);
    const original = String(originalName || name).trim().slice(0, 200);
    const imdbId = String(payload?.external_ids?.imdb_id || "").trim();
    return { primary, original, imdbId };
  } catch {
    return { primary: "", original: "", imdbId: "" };
  }
}

async function fetchTmdbMovieIdentityForFallback(tmdbId) {
  try {
    const payload = await tmdbFetch(`/movie/${Number(tmdbId)}`, {
      language: "en-US",
      append_to_response: "external_ids"
    });
    const title = String(payload?.title || payload?.original_title || "").trim().slice(0, 220);
    const originalTitle = String(payload?.original_title || payload?.title || "").trim().slice(0, 220);
    const imdbId = String(payload?.external_ids?.imdb_id || "").trim();
    const releaseYear = String(payload?.release_date || "").slice(0, 4);
    return {
      title,
      originalTitle,
      imdbId,
      year: releaseYear
    };
  } catch (err) {
    logError("TMDb movie identity fallback fetch failed", err, { tmdbId });
    return {
      title: "",
      originalTitle: "",
      imdbId: "",
      year: ""
    };
  }
}

async function fetchTmdbTvIdentityForFallback(tmdbId) {
  try {
    const payload = await tmdbFetch(`/tv/${Number(tmdbId)}`, {
      language: "en-US",
      append_to_response: "external_ids"
    });
    return {
      title: String(payload?.name || payload?.original_name || "").trim().slice(0, 220),
      originalTitle: String(payload?.original_name || payload?.name || "").trim().slice(0, 220),
      imdbId: String(payload?.external_ids?.imdb_id || "").trim(),
      year: String(payload?.first_air_date || "").slice(0, 4)
    };
  } catch (err) {
    logError("TMDb tv identity fallback fetch failed", err, { tmdbId });
    return { title: "", originalTitle: "", imdbId: "", year: "" };
  }
}

function isOpenSubRateLimitError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("quota") ||
    msg.includes("too many requests") ||
    msg.includes("allowed 100")
  );
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

function extractSubdlSdIdFromUrl(url = "") {
  const m = String(url || "").match(/\/subtitle\/sd(\d+)\//i);
  return m ? String(m[1]) : "";
}

function parseSubdlCanonicalLinksFromHtml(html = "") {
  return parseSubdlCanonicalSearchHits(html).map((h) => h.url);
}

function normalizeSubdlResolverTitle(input = "") {
  return String(input || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function extractSubdlShowSlugFromCanonicalUrl(url = "") {
  const m = String(url || "").match(/\/subtitle\/sd\d+\/([^/?#]+)/i);
  return m ? String(m[1] || "").trim().toLowerCase() : "";
}

function expandSubdlResolverSlugVariants(slug) {
  const s = String(slug || "").trim().toLowerCase();
  if (!s) return [];
  const bare = s.replace(/^the-/, "");
  return Array.from(new Set([s, bare].filter(Boolean)));
}

function buildSubdlResolverAcceptedSlugSet(primaryRaw, originalRaw) {
  const set = new Set();
  for (const raw of [primaryRaw, originalRaw]) {
    const t = String(raw || "").trim();
    if (!t) continue;
    const slug = slugifyForUrl(t);
    if (!slug) continue;
    for (const v of expandSubdlResolverSlugVariants(slug)) {
      set.add(v);
    }
  }
  return set;
}

function normalizeImdbIdForSubdlSnippet(id = "") {
  const s = String(id || "").trim().toLowerCase();
  if (!s) return "";
  if (s.startsWith("tt") && /^tt\d+$/.test(s)) return s;
  if (/^\d{6,}$/.test(s)) return `tt${s}`;
  return "";
}

function subdlSearchHtmlSnippetContainsImdb(html, hrefIndex, imdbNorm) {
  if (!imdbNorm || hrefIndex == null || hrefIndex < 0) return false;
  const win = 1200;
  const start = Math.max(0, hrefIndex - win);
  const slice = html.slice(start, hrefIndex + win).toLowerCase();
  return slice.includes(imdbNorm);
}

function parseSubdlCanonicalSearchHits(html = "") {
  const body = String(html || "");
  const out = [];
  const seen = new Set();
  const re = /href="(https?:\/\/subdl\.com\/(?:en\/)?subtitle\/sd\d+\/[^"]+|\/(?:en\/)?subtitle\/sd\d+\/[^"]+)"/gi;
  let m;
  while ((m = re.exec(body))) {
    const raw = String(m[1] || "").trim();
    if (!raw) continue;
    const abs = raw.startsWith("http") ? raw : `https://subdl.com${raw.startsWith("/") ? raw : `/${raw}`}`;
    const clean = abs.split("?")[0];
    if (seen.has(clean)) continue;
    seen.add(clean);
    const slug = extractSubdlShowSlugFromCanonicalUrl(clean);
    out.push({
      url: clean,
      slug,
      sdId: extractSubdlSdIdFromUrl(clean),
      hrefIndex: m.index
    });
    if (out.length >= 30) break;
  }
  return out;
}

function applySubdlHtmlResolverDiagnostics(debugCounts, resolver) {
  if (!debugCounts || !resolver) return;
  debugCounts.subdlHtmlResolverUsed = Boolean(resolver.used);
  debugCounts.subdlHtmlResolverSearchUrl = resolver.searchUrl || null;
  debugCounts.subdlHtmlResolverCandidatesFound = Number(resolver.candidatesFound || 0);
  debugCounts.subdlHtmlResolverChosenUrl = resolver.chosenUrl || null;
  debugCounts.subdlHtmlResolverFoundSdId = resolver.foundSdId || null;
  debugCounts.subdlHtmlResolverFailureReason = resolver.failureReason || null;
  debugCounts.subdlHtmlResolverRequestedTitleNormalized =
    resolver.requestedTitleNormalized || null;
  debugCounts.subdlHtmlResolverCandidateEvaluations = Array.isArray(resolver.candidateEvaluations)
    ? resolver.candidateEvaluations
    : [];
  debugCounts.subdlHtmlResolverSelectionStrategy = resolver.selectionStrategy || null;
}

function pickSubdlSearchResolverHit({ html, hits, acceptedSlugSet, imdbNorm, requestedTitleNorm }) {
  const evaluations = [];
  const acceptedArray = acceptedSlugSet instanceof Set ? acceptedSlugSet : new Set(acceptedSlugSet || []);

  for (const hit of hits) {
    const slug = hit.slug || "";
    const titleNorm = normalizeSubdlResolverTitle(slug.replace(/-/g, " "));
    let rejectReason = "";
    let accepted = false;
    let strategy = "";

    if (imdbNorm && subdlSearchHtmlSnippetContainsImdb(html, hit.hrefIndex, imdbNorm)) {
      accepted = true;
      strategy = "external-imdb-snippet";
    } else if (slug && acceptedArray.has(slug)) {
      accepted = true;
      strategy = "exact-series-slug";
    } else if (!slug) {
      rejectReason = "missing-show-slug-in-url";
    } else if (acceptedArray.size === 0) {
      rejectReason = "no-requested-title-slugs";
    } else {
      rejectReason = "title-slug-identity-mismatch";
    }

    evaluations.push({
      candidateSlug: slug,
      candidateTitleNormalized: titleNorm,
      accepted,
      rejectReason: accepted ? "" : rejectReason
    });

    if (accepted) {
      return {
        chosen: hit,
        evaluations,
        selectionStrategy: strategy,
        requestedTitleNormalized: requestedTitleNorm
      };
    }
  }

  return {
    chosen: null,
    evaluations,
    selectionStrategy: hits.length ? "none-passed-identity-gate" : "no-candidates-in-html",
    requestedTitleNormalized: requestedTitleNorm
  };
}

async function resolveSubdlTvCanonicalUrlsBySearch({
  showTitle = "",
  originalTitle = "",
  imdbId = ""
} = {}) {
  const title = String(showTitle || "").trim();
  const original = String(originalTitle || "").trim();
  const strategy = {
    used: false,
    searchUrl: "",
    candidatesFound: 0,
    chosenUrl: "",
    foundSdId: "",
    failureReason: "",
    requestedTitleNormalized: "",
    candidateEvaluations: [],
    selectionStrategy: ""
  };
  if (!title) {
    strategy.failureReason = "missing-show-title";
    return strategy;
  }
  const requestedTitleNorm = normalizeSubdlResolverTitle(title);
  strategy.requestedTitleNormalized = requestedTitleNorm;
  const acceptedSlugSet = buildSubdlResolverAcceptedSlugSet(title, original);
  const imdbNorm = normalizeImdbIdForSubdlSnippet(imdbId);

  const query = encodeURIComponent(title.slice(0, 120));
  const candidates = [
    `https://subdl.com/search/${query}`,
    `https://subdl.com/en/search/${query}`,
    `https://subdl.com/subtitle?q=${query}`,
    `https://subdl.com/en/subtitle?q=${query}`
  ];
  strategy.used = true;
  strategy.searchUrl = candidates[0];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers: { Accept: "text/html" } });
      if (!res.ok) continue;
      const html = await res.text();
      if (!html || html.length < 200) continue;
      const hits = parseSubdlCanonicalSearchHits(html);
      strategy.candidatesFound = hits.length;
      if (!hits.length) continue;

      const picked = pickSubdlSearchResolverHit({
        html,
        hits,
        acceptedSlugSet,
        imdbNorm,
        requestedTitleNorm
      });
      strategy.candidateEvaluations = picked.evaluations;
      strategy.selectionStrategy = picked.selectionStrategy || "";

      if (!picked.chosen) {
        strategy.failureReason = "no-candidate-passed-identity-gate";
        strategy.chosenUrl = "";
        strategy.foundSdId = "";
        return {
          ...strategy,
          canonicalLinks: []
        };
      }

      strategy.chosenUrl = picked.chosen.url;
      strategy.foundSdId = String(picked.chosen.sdId || "").trim() || extractSubdlSdIdFromUrl(picked.chosen.url);
      return {
        ...strategy,
        canonicalLinks: [picked.chosen.url]
      };
    } catch {
      // try next search endpoint
    }
  }
  strategy.failureReason = strategy.failureReason || "no-canonical-links-found";
  return strategy;
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
        rowSnippets: [],
        languageHeaderLabelsRaw: [],
        arabicSectionHeadersFound: 0,
        acceptedLanguageHeaders: [],
        rejectedLanguageHeaders: [],
        rowsWithoutLanguageSection: 0
      }
    };
  }
  const languageHeaders = [];
  const languageHeaderLabelsRaw = [];
  const acceptedLanguageHeaders = [];
  const rejectedLanguageHeaders = [];
  const headingRe = /<h([23])[^>]*>([\s\S]{1,220}?)<\/h\1>/gi;
  const headerSnippets = [];
  let hm;
  while ((hm = headingRe.exec(body))) {
    const rawLabel = stripHtmlTags(decodeHtmlEntities(hm[2])).replace(/\s+/g, " ").trim();
    if (languageHeaderLabelsRaw.length < 48) languageHeaderLabelsRaw.push(rawLabel);
    const low = rawLabel.toLowerCase().trim();
    if (isSubdlNonLanguageSectionHeading(low)) {
      if (rejectedLanguageHeaders.length < 40) {
        rejectedLanguageHeaders.push({ raw: rawLabel, reason: "non_language_bucket_or_source" });
      }
      continue;
    }
    const langNorm = inferLanguageFromSubdlHeadingLabel(rawLabel, low);
    if (!langNorm) {
      if (rejectedLanguageHeaders.length < 40) {
        rejectedLanguageHeaders.push({ raw: rawLabel, reason: "unrecognized_language_label" });
      }
      continue;
    }
    languageHeaders.push({ idx: hm.index, lang: langNorm });
    if (acceptedLanguageHeaders.length < 40) {
      acceptedLanguageHeaders.push({ raw: rawLabel, code: langNorm });
    }
    if (headerSnippets.length < 3) {
      headerSnippets.push(
        body
          .slice(Math.max(0, hm.index - 60), Math.min(body.length, hm.index + 140))
          .replace(/\s+/g, " ")
      );
    }
  }
  const arabicSectionHeadersFound = languageHeaders.filter((h) => h.lang === "ar").length;
  const lastLanguageHeaderBefore = (idx) => {
    let last = null;
    for (const h of languageHeaders) {
      if (h.idx <= idx) last = h;
      else break;
    }
    return last;
  };
  const inferLangAt = (idx) => {
    let picked = "";
    for (const h of languageHeaders) {
      if (h.idx <= idx) picked = h.lang;
      else break;
    }
    if (picked) return picked;
    const fb = normalizeLanguageCode(fallbackLanguage) || "";
    return fb || "und";
  };
  const rowRe =
    /<h4[^>]*>\s*([^<]{3,260})\s*<\/h4>[\s\S]{0,2200}?href="(https?:\/\/dl\.subdl\.com\/subtitle\/[^"]+)"/gi;
  const rows = [];
  const rowSnippets = [];
  let rowCardsFound = 0;
  let uploaderLinksFound = 0;
  const downloadLinksFound = (body.match(/https?:\/\/dl\.subdl\.com\/subtitle\/[^"]+/gi) || []).length;
  let rowsWithoutLanguageSection = 0;
  let m;
  while ((m = rowRe.exec(body))) {
    rowCardsFound += 1;
    const releaseName = decodeHtmlEntities(m[1]);
    const downloadUrl = normalizeSubdlDownloadUrl(m[2]);
    if (!releaseName || !downloadUrl) continue;
    if (!lastLanguageHeaderBefore(m.index)) rowsWithoutLanguageSection += 1;
    const localChunk = body.slice(Math.max(0, m.index - 300), Math.min(body.length, m.index + 2200));
    const uploaderRel = localChunk.match(/href="(\/u\/[^"]+)"/i);
    const uploaderAbs = localChunk.match(/href="(https?:\/\/subdl\.com\/u\/[^"]+)"/i);
    const uploaderUrl = String((uploaderRel && uploaderRel[1]) || (uploaderAbs && uploaderAbs[1]) || "");
    const authorRaw = decodeURIComponent((uploaderUrl.split("/u/")[1] || "").split("?")[0] || "").trim();
    const author = stripHtmlTags(authorRaw);
    if (uploaderUrl) uploaderLinksFound += 1;
    const fromRelease = inferSubtitleLangFromReleaseName(releaseName);
    const fromSection = inferLangAt(m.index);
    const mergedLang = fromRelease || fromSection || "und";
    const lang = String(mergedLang).toUpperCase();
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
      rowSnippets,
      languageHeaderLabelsRaw,
      arabicSectionHeadersFound,
      acceptedLanguageHeaders,
      rejectedLanguageHeaders,
      rowsWithoutLanguageSection
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

function openSubHeaders(token = "", apiKey = "") {
  const key = String(apiKey || "").trim() || OPENSUBTITLES_API_KEY;
  const h = {
    "Api-Key": key,
    "User-Agent": OPENSUBTITLES_USER_AGENT,
    Accept: "application/json"
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function hasOpenSubtitlesFallbackCredentials() {
  return Boolean(
    OPENSUBTITLES_USERNAME_FALLBACK &&
      OPENSUBTITLES_PASSWORD_FALLBACK &&
      (OPENSUBTITLES_API_KEY_FALLBACK || OPENSUBTITLES_API_KEY)
  );
}

function openSubtitlesApiKeyForIdentity(identity) {
  return identity === "fallback"
    ? OPENSUBTITLES_API_KEY_FALLBACK || OPENSUBTITLES_API_KEY
    : OPENSUBTITLES_API_KEY;
}

function openSubAuthSlot(identity) {
  return identity === "fallback" ? openSubFallbackAuth : openSubPrimaryAuth;
}

/** OpenSubtitles website subtitle detail URLs are not direct file downloads (often show "removed"). */
function isOpenSubtitlesSubtitleListingPageUrl(url = "") {
  const u = String(url || "").trim();
  if (!u) return false;
  let host = "";
  let pathname = "";
  try {
    const p = new URL(u);
    host = p.hostname.replace(/^www\./i, "").toLowerCase();
    pathname = p.pathname || "";
  } catch {
    return false;
  }
  if (!host.endsWith("opensubtitles.com") && !host.endsWith("opensubtitles.org")) return false;
  if (host.startsWith("dl.")) return false;
  return /\/subtitles\//i.test(pathname);
}

function sanitizeOpenSubtitlesDirectDownloadUrl(candidate = "") {
  const u = String(candidate || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) return "";
  if (isOpenSubtitlesSubtitleListingPageUrl(u)) return "";
  return u;
}

function opensubtitlesSourcePageUrlFromItem(item) {
  const sid = String(item?.id ?? "").trim();
  if (!sid) return "";
  return `https://www.opensubtitles.com/en/subtitles/${encodeURIComponent(sid)}`;
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

/**
 * Distinguish daily quota / rate limits from removed or broken subtitles (lazy-resolve UX).
 * Returns API-facing `code` for the client: quota_exhausted | rate_limited | unavailable
 */
export function classifyOpenSubtitlesResolveFailure(message = "") {
  const m = String(message || "").toLowerCase();

  if (
    (m.includes("subtitle") && (m.includes("24h") || m.includes("24 h") || m.includes("24 hours"))) ||
    (m.includes("allowed") && m.includes("subtitle")) ||
    (/\b100\b/.test(m) && m.includes("subtitle")) ||
    (/\bdaily\b/.test(m) && (m.includes("limit") || m.includes("quota") || m.includes("download"))) ||
    m.includes("quota exhausted") ||
    m.includes("exceeded your") ||
    m.includes("download quota") ||
    (m.includes("maximum") && m.includes("download") && m.includes("reached"))
  ) {
    return "quota_exhausted";
  }

  if (
    /\b429\b/.test(m) ||
    m.includes("too many requests") ||
    m.includes("rate limit") ||
    m.includes("slow down")
  ) {
    return "rate_limited";
  }

  return "unavailable";
}

async function getOpenSubTokenForIdentity(identity = "primary") {
  const isFb = identity === "fallback";
  const username = isFb ? OPENSUBTITLES_USERNAME_FALLBACK : OPENSUBTITLES_USERNAME;
  const password = isFb ? OPENSUBTITLES_PASSWORD_FALLBACK : OPENSUBTITLES_PASSWORD;
  const apiKey = openSubtitlesApiKeyForIdentity(isFb ? "fallback" : "primary");
  if (!username || !password || !apiKey) return "";

  const slot = openSubAuthSlot(identity);
  const now = Date.now();
  if (slot.token && slot.exp > now) return slot.token;
  if (slot.loginPromise) return slot.loginPromise;

  slot.loginPromise = (async () => {
    const payload = await openSubFetch("/login", {
      method: "POST",
      headers: {
        ...openSubHeaders("", apiKey),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ username, password })
    });
    const token = String(payload?.token || "").trim();
    if (!token) throw new Error("OpenSubtitles login did not return token");
    slot.token = token;
    slot.exp = Date.now() + TOKEN_TTL_MS;
    return token;
  })();

  try {
    return await slot.loginPromise;
  } finally {
    slot.loginPromise = null;
  }
}

async function getOpenSubToken() {
  return getOpenSubTokenForIdentity("primary");
}

function openSubFileId(item) {
  const files = item?.attributes?.files;
  if (!Array.isArray(files) || !files.length) return "";
  return String(files[0]?.file_id || "");
}

function openSubDownloadCacheKey(fileId, cacheSlot = "primary") {
  return `${String(fileId || "").trim()}:${cacheSlot === "fallback" ? "fallback" : "primary"}`;
}

async function openSubDownload(fileId, token, opts = {}) {
  if (!fileId) return "";
  const bypassCache = Boolean(opts.bypassCache);
  const apiKey = opts.apiKey || OPENSUBTITLES_API_KEY;
  const cacheSlot = opts.cacheSlot === "fallback" ? "fallback" : "primary";
  const ck = openSubDownloadCacheKey(fileId, cacheSlot);
  if (!bypassCache) {
    const cached = openSubDownloadCache.get(ck);
    if (cached && cached.exp > Date.now()) {
      const fromCache = sanitizeOpenSubtitlesDirectDownloadUrl(cached.link);
      if (fromCache) return fromCache;
    }
  }
  const payload = await openSubFetch("/download", {
    method: "POST",
    headers: {
      ...openSubHeaders(token, apiKey),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ file_id: Number(fileId) })
  });
  const link = String(payload?.link || "").trim();
  const sanitized = sanitizeOpenSubtitlesDirectDownloadUrl(link);
  if (sanitized) {
    openSubDownloadCache.set(ck, { link: sanitized, exp: Date.now() + DOWNLOAD_LINK_TTL_MS });
  }
  return sanitized;
}

/**
 * Try primary OpenSubtitles identity for /download; on quota/rate-limit errors retry with optional fallback account.
 */
async function openSubDownloadWithFallbackOnQuota(fileId, primaryToken, opts = {}) {
  if (!fileId) return "";
  const primaryKey = OPENSUBTITLES_API_KEY;
  try {
    return await openSubDownload(fileId, primaryToken, {
      ...opts,
      apiKey: primaryKey,
      cacheSlot: "primary"
    });
  } catch (err) {
    const code = classifyOpenSubtitlesResolveFailure(String(err?.message || ""));
    if (
      (code === "quota_exhausted" || code === "rate_limited") &&
      hasOpenSubtitlesFallbackCredentials()
    ) {
      let fbToken = "";
      try {
        fbToken = await getOpenSubTokenForIdentity("fallback");
      } catch {
        fbToken = "";
      }
      const fbKey = OPENSUBTITLES_API_KEY_FALLBACK || OPENSUBTITLES_API_KEY;
      return await openSubDownload(fileId, fbToken, {
        ...opts,
        apiKey: fbKey,
        cacheSlot: "fallback"
      });
    }
    throw err;
  }
}

/**
 * Fresh resolve for client download clicks (bypasses short-lived download link cache).
 * Returns diagnostic fields required by the UI contract.
 */
export async function resolveOpenSubtitlesDownloadClick(fileIdRaw) {
  const base = {
    ok: false,
    opensubtitlesLinkKind: "source_page_only",
    opensubtitlesSourcePageUrl: "",
    opensubtitlesResolvedDownloadUrl: "",
    opensubtitlesResolveOnClickUsed: true,
    opensubtitlesResolveFailureReason: ""
  };
  const idCheck = normalizePositiveInt(String(fileIdRaw || "").trim(), {
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
    name: "fileId"
  });
  if (!idCheck.ok || !idCheck.value) {
    return {
      ...base,
      opensubtitlesResolveFailureReason: idCheck.error || "invalid_file_id",
      code: "invalid_file_id"
    };
  }
  const fileId = idCheck.value;
  if (!OPENSUBTITLES_API_KEY) {
    return {
      ...base,
      opensubtitlesResolveFailureReason: "opensubtitles_not_configured",
      code: "not_configured"
    };
  }
  let token = "";
  try {
    token = await getOpenSubTokenForIdentity("primary");
  } catch {
    token = "";
  }
  try {
    const link = await openSubDownload(fileId, token, {
      bypassCache: true,
      apiKey: OPENSUBTITLES_API_KEY,
      cacheSlot: "primary"
    });
    if (link) {
      return {
        ok: true,
        opensubtitlesLinkKind: "direct",
        opensubtitlesSourcePageUrl: "",
        opensubtitlesResolvedDownloadUrl: link,
        opensubtitlesResolveOnClickUsed: true,
        opensubtitlesResolveFailureReason: "",
        opensubtitlesResolveUsedFallback: false,
        downloadUrl: link,
        code: "ok"
      };
    }
    return {
      ...base,
      opensubtitlesResolveFailureReason: "empty_or_non_direct_link_from_api",
      code: "unavailable"
    };
  } catch (err) {
    const reason = String(err?.message || "download_resolve_failed").slice(0, 400);
    const code = classifyOpenSubtitlesResolveFailure(reason);
    if (
      (code === "quota_exhausted" || code === "rate_limited") &&
      hasOpenSubtitlesFallbackCredentials()
    ) {
      let fbToken = "";
      try {
        fbToken = await getOpenSubTokenForIdentity("fallback");
      } catch {
        fbToken = "";
      }
      try {
        const linkFb = await openSubDownload(fileId, fbToken, {
          bypassCache: true,
          apiKey: OPENSUBTITLES_API_KEY_FALLBACK || OPENSUBTITLES_API_KEY,
          cacheSlot: "fallback"
        });
        if (linkFb) {
          return {
            ok: true,
            opensubtitlesLinkKind: "direct",
            opensubtitlesSourcePageUrl: "",
            opensubtitlesResolvedDownloadUrl: linkFb,
            opensubtitlesResolveOnClickUsed: true,
            opensubtitlesResolveFailureReason: "",
            opensubtitlesResolveUsedFallback: true,
            downloadUrl: linkFb,
            code: "ok"
          };
        }
      } catch (err2) {
        const reason2 = String(err2?.message || "download_resolve_failed").slice(0, 400);
        return {
          ...base,
          opensubtitlesResolveFailureReason: reason2,
          code: classifyOpenSubtitlesResolveFailure(reason2),
          opensubtitlesPrimaryResolveFailureReason: reason
        };
      }
      return {
        ...base,
        opensubtitlesResolveFailureReason: reason,
        code,
        opensubtitlesFallbackAttempted: true,
        opensubtitlesFallbackFailureReason: "empty_or_non_direct_link_from_api"
      };
    }
    return {
      ...base,
      opensubtitlesResolveFailureReason: reason,
      code
    };
  }
}

async function withTimeout(promise, timeoutMs, label = "operation") {
  const ms = Math.max(200, Number(timeoutMs || 0));
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
  ]);
}

function mapOpenSub(item, resolvedDirectLink, fallbackLang, meta = {}) {
  const a = item?.attributes || {};
  const releaseName = a.release || a.feature_details?.title || a.files?.[0]?.file_name || "Subtitle";
  const releases = Array.isArray(a.files) ? a.files.map((f) => f?.file_name).filter(Boolean) : [];
  const feature = a.feature_details || {};
  const fileId = openSubFileId(item);
  const sourcePageUrl = opensubtitlesSourcePageUrlFromItem(item);
  const direct = sanitizeOpenSubtitlesDirectDownloadUrl(String(resolvedDirectLink || "").trim());
  const downloadUrl = direct;
  let opensubtitlesLinkKind = "none";
  if (downloadUrl) opensubtitlesLinkKind = "direct";
  else if (sourcePageUrl) opensubtitlesLinkKind = "source_page_only";
  return {
    provider: "opensubtitles",
    id: String(item?.id || fileId || releaseName),
    language: String(a.language || fallbackLang || "").toUpperCase(),
    releaseName,
    author: a.uploader?.name || "",
    hearingImpaired: Boolean(a.hearing_impaired),
    downloads: Number(a.download_count || 0),
    downloadUrl,
    opensubtitlesFileId: fileId,
    opensubtitlesSourcePageUrl: sourcePageUrl,
    opensubtitlesLinkKind,
    opensubtitlesResolvedDownloadUrl: downloadUrl,
    opensubtitlesResolveOnClickUsed: false,
    opensubtitlesResolveFailureReason: String(meta.initialResolveFailureReason || "").slice(0, 400),
    comment: a.comments || "",
    season: feature?.season_number || "",
    episode: feature?.episode_number || "",
    releases,
    // Keep provider metadata for strict post-fetch TV identity guard.
    openSubFeatureTitle: String(feature?.title || feature?.name || feature?.movie_name || "").trim(),
    openSubFeatureOriginalTitle: String(
      feature?.original_title || feature?.original_name || feature?.parent_title || ""
    ).trim(),
    openSubFeatureParentImdbId: String(feature?.parent_imdb_id || "").trim(),
    openSubFeatureEpisodeImdbId: String(feature?.imdb_id || "").trim(),
    openSubFeatureImdbId: String(
      feature?.parent_imdb_id || feature?.imdb_id || a?.imdb_id || ""
    ).trim(),
    openSubFeatureParentTmdbId: String(feature?.parent_tmdb_id || "").trim(),
    openSubFeatureEpisodeTmdbId: String(feature?.tmdb_id || "").trim(),
    openSubFeatureTmdbId: String(
      feature?.parent_tmdb_id || feature?.tmdb_id || a?.tmdb_id || ""
    ).trim()
  };
}

function normalizeIdentityTitle(value = "") {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isEquivalentIdentityTitle(a = "", b = "") {
  const aa = normalizeIdentityTitle(a);
  const bb = normalizeIdentityTitle(b);
  if (!aa || !bb) return false;
  if (aa === bb) return true;
  const at = aa.split(" ").filter(Boolean);
  const bt = bb.split(" ").filter(Boolean);
  if (!at.length || !bt.length) return false;
  const setA = new Set(at);
  const setB = new Set(bt);
  let common = 0;
  for (const t of setA) {
    if (setB.has(t)) common += 1;
  }
  const overlap = common / Math.max(setA.size, setB.size);
  // Strict guard to avoid cross-show fuzzy leaks.
  return overlap >= 0.98;
}

/** SubDL / OpenSubtitles release strings often encode language (e.g. .WEB.NF.ar). */
function inferSubtitleLangFromReleaseName(releaseName) {
  const s = String(releaseName || "");
  if (!s.trim()) return "";
  const lower = s.toLowerCase().replace(/_/g, ".");
  if (/\barabic\b|\.ara\.|(^|[.\-_])(ara)([.\-_]|$)/i.test(lower)) return "ar";
  if (/(^|[.\-_])ar([.\-_]|$)/i.test(lower)) return "ar";
  if (/(^|[.\-_])(fa|farsi|persian)([.\-_]|$)/i.test(lower) || /\bfarsi\b|\bpersian\b/i.test(lower))
    return "fa";
  return "";
}

function isSubdlRowArabicCandidate(row) {
  if (!row) return false;
  if (normalizeLanguageCode(String(row.language || "")) === "ar") return true;
  return Boolean(inferSubtitleLangFromReleaseName(String(row.releaseName || "")));
}

/**
 * SubDL mixes real language headings (English, Arabic) with source/quality buckets (Hdtv, Other).
 * `normalizeLanguageCode("hdtv")` returns "hdtv" (truthy) — must never treat that as a language.
 */
const SUBDL_HTML_HEADING_BLOCKLIST = new Set([
  "other",
  "others",
  "misc",
  "miscellaneous",
  "hdtv",
  "tv",
  "dtv",
  "dvd",
  "bluray",
  "blu-ray",
  "blu ray",
  "webrip",
  "web-rip",
  "web-dl",
  "webdl",
  "hdrip",
  "dvdrip",
  "brrip",
  "bdrip",
  "br-rip",
  "bd-rip",
  "cam",
  "telesync",
  "telecine",
  "workprint",
  "screener",
  "dvdscr",
  "r5",
  "tc",
  "ts",
  "complete",
  "pack",
  "season",
  "episode",
  "source",
  "release",
  "releases",
  "quality",
  "video",
  "audio",
  "unknown",
  "general",
  "default",
  "all",
  "any",
  "popular",
  "featured",
  "recommended",
  "new",
  "top",
  "subtitle",
  "subtitles",
  "download",
  "downloads",
  "upload",
  "uploader",
  "x264",
  "x265",
  "hevc",
  "h264",
  "h265",
  "avc",
  "remux",
  "encode",
  "encoded",
  "2160p",
  "1080p",
  "720p",
  "480p",
  "360p",
  "1440p",
  "4k",
  "uhd",
  "fhd",
  "sd",
  "hd",
  "hq",
  "lq",
  "untouched",
  "sync",
  "fixed",
  "proper",
  "repack",
  "internal",
  "nf",
  "amzn",
  "atvp",
  "dsnp",
  "hulu",
  "hmax"
]);

function isSubdlNonLanguageSectionHeading(labelLower) {
  const s = String(labelLower || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  if (!s) return true;
  if (SUBDL_HTML_HEADING_BLOCKLIST.has(s)) return true;
  if (/^\d+p$/i.test(s)) return true;
  if (/^s\d{1,3}$/i.test(s)) return true;
  if (/^[hx]?\d{3,4}p?$/i.test(s)) return true;
  if (/\b(1080p|720p|2160p|x264|x265|h265|hevc|web-?dl|webrip|bluray)\b/i.test(s)) return true;
  return false;
}

/**
 * Map a SubDL season-page heading to ISO 639-1 only when it is clearly a language label.
 * Never returns arbitrary strings from normalizeLanguageCode (e.g. "other", "hdtv").
 */
function inferLanguageFromSubdlHeadingLabel(label, low) {
  if (/^arabic$|^ar$/.test(low) || label.includes("العربية") || label.includes("عربي")) return "ar";
  if (/^english$|^en$/.test(low) || /\benglish\b/i.test(label)) return "en";
  if (/^spanish$|^es$/.test(low) || /español|espanol/i.test(low)) return "es";
  if (/^french$|^fr$/.test(low) || /français|francais/i.test(low)) return "fr";
  if (/^german$|^de$/.test(low) || /^deutsch\b/i.test(low)) return "de";
  if (/^italian$|^it$/.test(low) || /^italiano\b/i.test(low)) return "it";
  if (/^turkish$|^tr$/.test(low) || /türkçe|turkce/i.test(low)) return "tr";
  if (/^persian$|^fa$/.test(low) || /فارسی|فارسى|farsi/i.test(label)) return "fa";
  if (/^portuguese$|^pt$/.test(low) || /português|portugues/i.test(label)) return "pt";
  if (/^russian$|^ru$/.test(low) || /русск/i.test(label)) return "ru";
  if (/^polish$|^pl$/.test(low) || /^polski\b/i.test(low)) return "pl";
  if (/^dutch$|^nl$/.test(low) || /^nederlands\b/i.test(low)) return "nl";
  if (/^swedish$|^sv$/.test(low) || /^svenska\b/i.test(low)) return "sv";
  if (/^danish$|^da$/.test(low) || /^dansk\b/i.test(low)) return "da";
  if (/^norwegian$|^no$/.test(low) || /^norsk\b/i.test(low)) return "no";
  if (/^finnish$|^fi$/.test(low) || /^suomi\b/i.test(low)) return "fi";
  if (/^greek$|^el$/.test(low) || /ελλην/i.test(label)) return "el";
  if (/^hebrew$|^he$/.test(low) || /עברית/.test(label)) return "he";
  if (/^japanese$|^ja$/.test(low) || /日本語/.test(label)) return "ja";
  if (/^korean$|^ko$/.test(low) || /한국어/.test(label)) return "ko";
  if (/^chinese$|^zh$/.test(low) || /中文|汉语|简体|繁體/.test(label)) return "zh";
  if (/^hindi$|^hi$/.test(low) || /हिन्दी/.test(label)) return "hi";
  if (/^ukrainian$|^uk$/.test(low) || /україн/i.test(label)) return "uk";
  if (/^vietnamese$|^vi$/.test(low) || /tiếng việt/i.test(label) || /vietnamese/i.test(low)) return "vi";
  if (/^indonesian$|^id$/.test(low) || /bahasa indonesia/i.test(low)) return "id";
  if (/^thai$|^th$/.test(low) || /ไทย/.test(label)) return "th";
  if (/^romanian$|^ro$/.test(low) || /română|romana/i.test(low)) return "ro";
  if (/^czech$|^cs$/.test(low) || /čeština|cestina/i.test(low)) return "cs";
  if (/^hungarian$|^hu$/.test(low) || /^magyar\b/i.test(low)) return "hu";
  if (/^bulgarian$|^bg$/.test(low) || /българ/i.test(label)) return "bg";
  if (/^serbian$|^sr$/.test(low)) return "sr";
  if (/^croatian$|^hr$/.test(low) || /^hrvatski\b/i.test(low)) return "hr";
  if (/^slovak$|^sk$/.test(low)) return "sk";
  if (/^slovenian$|^sl$/.test(low)) return "sl";
  if (/^estonian$|^et$/.test(low)) return "et";
  if (/^latvian$|^lv$/.test(low)) return "lv";
  if (/^lithuanian$|^lt$/.test(low)) return "lt";

  const norm = normalizeLanguageCode(label);
  if (norm && /^[a-z]{2}$/.test(norm)) return norm;

  if (/[\u0600-\u06FF\u0750-\u077F\ufb50-\ufdff\ufe70-\ufeff]/.test(label)) {
    if (/فارس|فارسی|فارسى/.test(label)) return "fa";
    return "ar";
  }
  return "";
}

function subtitleReleaseNameSuggestsTvShow(releaseName, tvIdentityCtx) {
  const blob = normalizeIdentityTitle(String(releaseName || "").replace(/\./g, " "));
  if (!blob || blob.length < 4) return false;
  const targets = [tvIdentityCtx.title, tvIdentityCtx.originalTitle].filter(Boolean);
  for (const t of targets) {
    const n = normalizeIdentityTitle(t);
    if (!n || n.length < 3) continue;
    if (blob.includes(n)) return true;
    const words = n.split(" ").filter((w) => w.length > 2);
    if (words.length >= 2 && words.every((w) => blob.includes(w))) return true;
  }
  return false;
}

/**
 * TV show identity for OpenSubtitles rows: IDs when they match, then alt/series titles,
 * then feature title, then release-name confirmation. Does not treat episode `title` alone as authoritative.
 */
function evaluateOpenSubtitlesTvShowIdentity(row, tvIdentityCtx) {
  const featureTitle = String(row.openSubFeatureTitle || "").trim();
  const rowAltTitle = String(row.openSubFeatureOriginalTitle || "").trim();
  const releaseName = String(row.releaseName || "").trim();
  const requestedShowTitleNormalized = normalizeIdentityTitle(
    tvIdentityCtx.title || tvIdentityCtx.originalTitle || ""
  );
  const candidateShowTitleNormalized = normalizeIdentityTitle(featureTitle);
  const candidateAltTitleNormalized = normalizeIdentityTitle(rowAltTitle);

  const ctxImdb = String(tvIdentityCtx.imdbId || "").trim().toLowerCase();
  const ctxTmdb = String(tvIdentityCtx.tmdbId || "").trim();
  const rowImdbCandidates = Array.from(
    new Set(
      [
        row.openSubFeatureParentImdbId,
        row.openSubFeatureEpisodeImdbId,
        row.openSubFeatureImdbId
      ]
        .map((x) => String(x || "").trim())
        .filter(Boolean)
    )
  );
  const rowTmdbCandidates = Array.from(
    new Set(
      [
        row.openSubFeatureParentTmdbId,
        row.openSubFeatureEpisodeTmdbId,
        row.openSubFeatureTmdbId
      ]
        .map((x) => String(x || "").trim())
        .filter(Boolean)
    )
  );

  if (ctxImdb) {
    for (const rid of rowImdbCandidates) {
      if (rid && rid.toLowerCase() === ctxImdb) {
        return {
          ok: true,
          identityFieldUsed: "imdb_id",
          requestedShowTitleNormalized,
          candidateShowTitleNormalized,
          candidateAltTitleNormalized,
          releaseNameShowEvidence: false,
          rejectReasonDetailed: null
        };
      }
    }
  }
  if (ctxTmdb) {
    for (const tid of rowTmdbCandidates) {
      if (tid && String(tid) === ctxTmdb) {
        return {
          ok: true,
          identityFieldUsed: "tmdb_id",
          requestedShowTitleNormalized,
          candidateShowTitleNormalized,
          candidateAltTitleNormalized,
          releaseNameShowEvidence: false,
          rejectReasonDetailed: null
        };
      }
    }
  }

  const ctxTitles = [tvIdentityCtx.title, tvIdentityCtx.originalTitle].filter(Boolean);
  if (rowAltTitle) {
    for (const ctxT of ctxTitles) {
      if (isEquivalentIdentityTitle(rowAltTitle, ctxT)) {
        return {
          ok: true,
          identityFieldUsed: "alt_title",
          requestedShowTitleNormalized,
          candidateShowTitleNormalized,
          candidateAltTitleNormalized,
          releaseNameShowEvidence: false,
          rejectReasonDetailed: null
        };
      }
    }
  }
  if (featureTitle) {
    for (const ctxT of ctxTitles) {
      if (isEquivalentIdentityTitle(featureTitle, ctxT)) {
        return {
          ok: true,
          identityFieldUsed: "feature_title",
          requestedShowTitleNormalized,
          candidateShowTitleNormalized,
          candidateAltTitleNormalized,
          releaseNameShowEvidence: false,
          rejectReasonDetailed: null
        };
      }
    }
  }
  if (subtitleReleaseNameSuggestsTvShow(releaseName, tvIdentityCtx)) {
    return {
      ok: true,
      identityFieldUsed: "release_name",
      requestedShowTitleNormalized,
      candidateShowTitleNormalized,
      candidateAltTitleNormalized,
      releaseNameShowEvidence: true,
      rejectReasonDetailed: null
    };
  }

  const reasons = [];
  if (ctxImdb && rowImdbCandidates.length) reasons.push("imdb_id_mismatch_or_episode_imdb");
  if (ctxTmdb && rowTmdbCandidates.length) reasons.push("tmdb_id_mismatch_or_episode_tmdb");
  if (rowAltTitle || featureTitle) reasons.push("title_alt_mismatch_vs_tmdb_identity");
  if (releaseName) reasons.push("release_name_no_show_signature");
  return {
    ok: false,
    identityFieldUsed: null,
    requestedShowTitleNormalized,
    candidateShowTitleNormalized,
    candidateAltTitleNormalized,
    releaseNameShowEvidence: false,
    rejectReasonDetailed: reasons.length ? reasons.join(";") : "no_identity_signals"
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
  const tmdbKey = String(tmdbId || "").trim();
  const imdbKey = String(imdbId || "").trim();
  const queryKey = String(query || "").trim();
  if (!tmdbKey && !imdbKey && !queryKey) {
    throw new Error("OpenSubtitles search requires tmdb_id, imdb_id, or query");
  }
  const resolveLimit = Number.isFinite(Number(maxResolve)) ? Number(maxResolve) : Infinity;
  const cacheTtl = Boolean(resolveDownloads) ? 4 * 60 * 1000 : OPENSUB_SEARCH_CACHE_TTL_MS;
  const key = cacheKey([
    "opensub-search",
    mediaType,
    tmdbKey || "-",
    imdbKey || "-",
    queryKey || "-",
    language || "-",
    season || "-",
    episode || "-",
    year || "-",
    String(page || 1),
    resolveDownloads ? `resolve_${Math.min(resolveLimit, 20)}` : "resolve_0"
  ]);
  return getOrSetCache("opensubtitles", key, cacheTtl, async () => {
    let token = "";
    try {
      token = await getOpenSubToken();
    } catch (err) {
      logError("OpenSubtitles token login failed; fallback to API-key request", err);
    }
    const url = new URL(`${OPENSUBTITLES_API}/subtitles`);
    if (tmdbKey) url.searchParams.set("tmdb_id", tmdbKey);
    else if (imdbKey) url.searchParams.set("imdb_id", imdbKey);
    else url.searchParams.set("query", queryKey);
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
    const out = new Array(list.length);
    const resolveJobs = [];
    for (let i = 0; i < list.length; i += 1) {
      const item = list[i];
      const shouldResolve = Boolean(resolveDownloads) && i < resolveLimit;
      if (!shouldResolve) {
        const skipReason = !resolveDownloads ? "resolve_disabled_for_request" : "beyond_resolve_budget";
        out[i] = mapOpenSub(item, "", language, {
          initialResolveFailureReason: skipReason
        });
        continue;
      }
      resolveJobs.push({ i, item });
    }
    const conc = OPENSUB_DOWNLOAD_RESOLVE_CONCURRENCY;
    for (let j = 0; j < resolveJobs.length; j += conc) {
      const chunk = resolveJobs.slice(j, j + conc);
      const settled = await Promise.all(
        chunk.map(async ({ i, item }) => {
          try {
            const link = await withTimeout(
              openSubDownloadWithFallbackOnQuota(openSubFileId(item), token),
              resolveTimeoutMs,
              "opensubtitles.downloadResolve"
            );
            const trimmed = String(link || "").trim();
            const direct = sanitizeOpenSubtitlesDirectDownloadUrl(trimmed);
            let failureReason = "";
            if (!direct) {
              if (trimmed && isOpenSubtitlesSubtitleListingPageUrl(trimmed)) {
                failureReason = "api_returned_subtitle_page_not_file";
              } else if (!openSubFileId(item)) {
                failureReason = "missing_file_id";
              } else {
                failureReason = "empty_or_non_direct_link_from_api";
              }
            }
            return {
              i,
              row: mapOpenSub(item, direct, language, { initialResolveFailureReason: failureReason })
            };
          } catch (err) {
            logError("OpenSubtitles item download resolve failed", err, {
              itemId: item?.id,
              usedFallbackUrl: false
            });
            return {
              i,
              row: mapOpenSub(item, "", language, {
                initialResolveFailureReason: String(err?.message || "download_resolve_failed").slice(0, 400)
              })
            };
          }
        })
      );
      for (const { i, row } of settled) {
        out[i] = row;
      }
    }
    return { items: out, rawCount: list.length };
  });
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

function stripOpenSubInternalFields(rows) {
  return rows.map((row) => {
    if (row == null) return row;
    const {
      openSubFeatureTitle: _t,
      openSubFeatureOriginalTitle: _ot,
      openSubFeatureImdbId: _imdb,
      openSubFeatureTmdbId: _tmdb,
      openSubFeatureParentImdbId: _pimdb,
      openSubFeatureEpisodeImdbId: _eimdb,
      openSubFeatureParentTmdbId: _ptmdb,
      openSubFeatureEpisodeTmdbId: _etmdb,
      ...rest
    } = row;
    return rest;
  });
}

function dedupeSubtitles(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const provider = String(item.provider || "");
    const stableId = String(item.id || "").trim();
    const osFile = String(item.opensubtitlesFileId || "").trim();
    const urlKey = String(item.downloadUrl || "")
      .slice(0, 120)
      .toLowerCase();
    const disambig =
      provider === "opensubtitles" && !urlKey && osFile ? `fid:${osFile}` : urlKey.slice(0, 48);
    const key = stableId
      ? `${provider}|${stableId}|${disambig}`
      : [
          provider,
          String(item.language || "").toLowerCase(),
          String(item.releaseName || "").toLowerCase(),
          String(item.season || ""),
          String(item.episode || ""),
          urlKey,
          osFile
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
  const seasonEpisodeWords = t.match(/\bseason\s*(\d{1,2})\s+episode\s*(\d{1,4})\b/i);
  if (seasonEpisodeWords) {
    return {
      season: Number(seasonEpisodeWords[1]),
      episode: Number(seasonEpisodeWords[2]),
      seasonMatchQuality: "strict",
      episodeMatchQuality: "strict"
    };
  }
  const combined =
    t.match(/\bS(\d{1,2})\s*[\.\-]?\s*E(\d{1,4})\b/i) ||
    t.match(/\bS(\d{1,2})[\.\-_]?\s*E(\d{1,4})\b/i) ||
    t.match(/\b(\d{1,2})\s*[xX]\s*(\d{1,4})\b/i);
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
  const looseXE = t.match(/\b(\d{1,2})\s*[xX]\s*(\d{1,4})\b/) || t.match(/\b(\d{1,2})[xX](\d{1,4})\b/);
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
export function classifyTvSubtitleMatch(item, ctx) {
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
      htmlResolverUsed: Boolean(debugCounts.subdlHtmlResolverUsed),
      htmlResolverSearchUrl: debugCounts.subdlHtmlResolverSearchUrl || null,
      htmlResolverCandidatesFound: Number(debugCounts.subdlHtmlResolverCandidatesFound || 0),
      htmlResolverChosenUrl: debugCounts.subdlHtmlResolverChosenUrl || null,
      htmlResolverFoundSdId: debugCounts.subdlHtmlResolverFoundSdId || null,
      htmlResolverFailureReason: debugCounts.subdlHtmlResolverFailureReason || null,
      htmlResolverRequestedTitleNormalized:
        debugCounts.subdlHtmlResolverRequestedTitleNormalized || null,
      htmlResolverCandidateEvaluations: debugCounts.subdlHtmlResolverCandidateEvaluations || [],
      htmlResolverSelectionStrategy: debugCounts.subdlHtmlResolverSelectionStrategy || null,
      htmlCandidateUrlsTried: debugCounts.subdlHtmlCandidateUrlsTried || [],
      htmlFetchStatus: debugCounts.subdlHtmlFetchStatus || [],
      htmlAnyCandidateReturnedHtml: Boolean(debugCounts.subdlHtmlAnyCandidateReturnedHtml),
      htmlParserStageCounts: debugCounts.subdlHtmlParserStageCounts || {},
      htmlHeaderSnippets: debugCounts.subdlHtmlHeaderSnippets || [],
      htmlRowSnippets: debugCounts.subdlHtmlRowSnippets || [],
      htmlRowsFound: Number(debugCounts.subdlHtmlRowsFound || 0),
      htmlByLang: debugCounts.subdlHtmlByLang || {},
      htmlLanguageHeaderLabels: debugCounts.subdlHtmlLanguageHeaderLabels || [],
      htmlAcceptedLanguageHeaders: debugCounts.subdlHtmlAcceptedLanguageHeaders || [],
      htmlRejectedNonLanguageHeaders: debugCounts.subdlHtmlRejectedNonLanguageHeaders || [],
      htmlRowsWithoutLanguageSection: Number(debugCounts.subdlHtmlRowsWithoutLanguageSection || 0),
      htmlArabicSectionHeadersFound: Number(debugCounts.subdlHtmlArabicSectionHeadersFound || 0),
      htmlArabicSectionsDetected: Boolean(debugCounts.subdlHtmlArabicSectionsDetected),
      htmlArabicRowsFound: Number(debugCounts.subdlHtmlArabicRowsParsed || 0),
      htmlArabicRowsKept: Number(debugCounts.subdlHtmlArabicRowsKept || 0),
      htmlAltCandidatesChecked: Number(debugCounts.subdlHtmlAltCandidatesChecked || 0),
      htmlAltCandidatesWithRows: Number(debugCounts.subdlHtmlAltCandidatesWithRows || 0),
      htmlAltCandidatesWithArabicRows: Number(debugCounts.subdlHtmlAltCandidatesWithArabicRows || 0),
      htmlArabicDiscoveryModeUsed: Boolean(debugCounts.subdlHtmlArabicDiscoveryModeUsed),
      htmlArabicDiscoveryWinningUrl: debugCounts.subdlHtmlArabicDiscoveryWinningUrl || null,
      htmlArabicDiscoveryRowsFound: Number(debugCounts.subdlHtmlArabicDiscoveryRowsFound || 0),
      htmlArabicDiscoveryRowsKept: Number(debugCounts.subdlHtmlArabicDiscoveryRowsKept || 0),
      htmlRowsAfterFilter: Number(debugCounts.subdlHtmlRowsAfterSeasonFilter || 0),
      htmlByLangAfterFilter: debugCounts.subdlHtmlByLangAfterSeasonFilter || {},
      htmlRowsAfterSeasonFilter: Number(debugCounts.subdlHtmlRowsAfterSeasonFilter || 0),
      htmlByLangAfterSeasonFilter: debugCounts.subdlHtmlByLangAfterSeasonFilter || {},
      episodeHtmlFallbackAttempted: Boolean(debugCounts.episodeHtmlFallbackAttempted),
      episodeHtmlFallbackUsed: Boolean(debugCounts.episodeHtmlFallbackUsed),
      episodeHtmlFallbackTriggerReason: debugCounts.episodeHtmlFallbackTriggerReason || null,
      episodeHtmlFallbackSkipReason: debugCounts.episodeHtmlFallbackSkipReason || null,
      episodeHtmlSeasonPageUrl: debugCounts.episodeHtmlSeasonPageUrl || null,
      episodeHtmlRowsFound: Number(debugCounts.episodeHtmlRowsFound || 0),
      episodeHtmlExactKeptRows: Number(debugCounts.episodeHtmlExactKeptRows || 0),
      episodeHtmlRejectedRows: Number(debugCounts.episodeHtmlRejectedRows || 0),
      exactEpisodeEvidenceSamples: debugCounts.exactEpisodeEvidenceSamples || [],
      episodeHtmlRecognized5x08Style: Boolean(debugCounts.episodeHtmlRecognized5x08Style),
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
    opensubtitlesTrace: {
      attempts: debugCounts.opensubtitlesMovieAttempts || [],
      rawRows: Number(debugCounts.opensubtitlesRaw || 0),
      mappedRows: Number(debugCounts.opensubtitlesMapped || 0),
      tvFetchedBeforeIdentity: Number(debugCounts.opensubtitlesTvFetchedBeforeIdentity || 0),
      tvRejectedShowMismatch: Number(debugCounts.opensubtitlesTvRejectedShowMismatch || 0),
      tvRejectedSeasonMismatch: Number(debugCounts.opensubtitlesTvRejectedSeasonMismatch || 0),
      tvRejectedEpisodeMismatch: Number(debugCounts.opensubtitlesTvRejectedEpisodeMismatch || 0),
      tvKeptAfterIdentity: Number(debugCounts.opensubtitlesTvKeptAfterIdentity || 0),
      tvRejectedSamples: debugCounts.opensubtitlesTvRejectedSamples || [],
      requestedShowTitleNormalized: debugCounts.opensubtitlesRequestedShowTitleNormalized || null,
      tvKeptAfterIdentityByField: debugCounts.opensubtitlesTvIdentityAcceptByField || {}
    },
    normalizedPerProvider: {
      afterSubdlMerge: debugCounts.perProviderAfterSubdl || {},
      mergedBeforeDedupe: debugCounts.perProviderMergedBeforeDedupe || {},
      afterDedupe: debugCounts.perProviderAfterDedupe || {}
    },
    mergeAndDedupe: {
      combinedBeforeDedup: debugCounts.beforeDedup,
      afterDedup: debugCounts.afterDedup,
      aggregateParallelized: Boolean(debugCounts.aggregateParallelized),
      aggregateDurationMs: debugCounts.aggregateDurationMs ?? null,
      subdlDurationMs: debugCounts.subdlDurationMs ?? null,
      opensubtitlesDurationMs: debugCounts.opensubtitlesDurationMs ?? null
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

function classifyProviderFailureKind(message) {
  const m = String(message || "").toLowerCase();
  if (/\b429\b/.test(m) || m.includes("rate limit") || m.includes("too many requests") || m.includes("quota exceeded")) {
    return "limit";
  }
  if (m.includes("not configured") || m.includes("api_key")) return "config";
  return "generic";
}

/**
 * Product-facing provider coverage (no raw errors). Used by the subtitles API in normal mode.
 */
export function buildProviderHealthSummary({
  providerFilter,
  requested,
  providerErrors,
  finalSubtitles,
  alternateSubtitles,
  debugCounts
}) {
  const req = Array.isArray(requested) ? requested.map((p) => String(p || "").toLowerCase()).filter(Boolean) : [];
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
  for (const s of finalSubtitles || []) {
    const p = String(s.provider || "").toLowerCase();
    if (p) inResults.add(p);
  }
  const providersWithData = [...inResults];
  const anyRateLimited = Object.values(failureKinds).some((k) => k === "limit");
  const htmlFallback =
    Boolean(debugCounts?.subdlHtmlFallbackUsed) || Boolean(debugCounts?.episodeHtmlFallbackUsed);
  const alternateRouteOffered = Array.isArray(alternateSubtitles) && alternateSubtitles.length > 0;

  const wantBoth = req.length >= 2;
  let tier = "full";

  if (providerFilter !== "all") {
    if (failed.length >= req.length) tier = "unavailable";
    else if (succeeded.length) tier = "focused";
    else tier = "unavailable";
  } else if (wantBoth) {
    if (failed.length === 0) {
      if ((finalSubtitles || []).length === 0) {
        tier = "no_matches_upstream";
      } else if (providersWithData.length >= 2) {
        if ((finalSubtitles || []).length <= 4) tier = "sparse";
        else tier = "full";
      } else {
        tier = "partial_catalog";
      }
    } else if (failed.length === 1) {
      tier = (finalSubtitles || []).length ? "partial_outage" : "partial_outage_empty";
    } else {
      tier = "unavailable";
    }
  } else if (!succeeded.length) {
    tier = "unavailable";
  } else if (!(finalSubtitles || []).length) {
    tier = "no_matches_upstream";
  }

  return {
    tier,
    requestedProviders: req,
    failedProviders: failed,
    succeededProviders: succeeded,
    providersWithData,
    failureKinds,
    anyRateLimited,
    fallbackAssisted: htmlFallback,
    alternateRouteOffered
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
    subdlHtmlResolverUsed: false,
    subdlHtmlResolverSearchUrl: null,
    subdlHtmlResolverCandidatesFound: 0,
    subdlHtmlResolverChosenUrl: null,
    subdlHtmlResolverFoundSdId: null,
    subdlHtmlResolverFailureReason: null,
    subdlHtmlResolverRequestedTitleNormalized: null,
    subdlHtmlResolverCandidateEvaluations: [],
    subdlHtmlResolverSelectionStrategy: null,
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
    subdlHtmlLanguageHeaderLabels: [],
    subdlHtmlAcceptedLanguageHeaders: [],
    subdlHtmlRejectedNonLanguageHeaders: [],
    subdlHtmlRowsWithoutLanguageSection: 0,
    subdlHtmlArabicSectionHeadersFound: 0,
    subdlHtmlArabicSectionsDetected: false,
    subdlHtmlArabicRowsParsed: 0,
    subdlHtmlArabicRowsKept: 0,
    subdlHtmlAltCandidatesChecked: 0,
    subdlHtmlAltCandidatesWithRows: 0,
    subdlHtmlAltCandidatesWithArabicRows: 0,
    subdlHtmlArabicDiscoveryModeUsed: false,
    subdlHtmlArabicDiscoveryWinningUrl: null,
    subdlHtmlArabicDiscoveryRowsFound: 0,
    subdlHtmlArabicDiscoveryRowsKept: 0,
    subdlWinningProbe: null,
    subdlClassifySamples: [],
    opensubtitlesMovieAttempts: [],
    opensubtitlesTvFetchedBeforeIdentity: 0,
    opensubtitlesTvRejectedShowMismatch: 0,
    opensubtitlesTvRejectedSeasonMismatch: 0,
    opensubtitlesTvRejectedEpisodeMismatch: 0,
    opensubtitlesTvKeptAfterIdentity: 0,
    opensubtitlesTvRejectedSamples: [],
    opensubtitlesRequestedShowTitleNormalized: null,
    opensubtitlesTvIdentityAcceptByField: {},
    perProviderAfterSubdl: {},
    perProviderMergedBeforeDedupe: {},
    perProviderAfterDedupe: {},
    beforeDedup: 0,
    afterDedup: 0,
    finalSorted: 0,
    episodeHtmlFallbackAttempted: false,
    episodeHtmlFallbackUsed: false,
    episodeHtmlFallbackTriggerReason: null,
    episodeHtmlFallbackSkipReason: null,
    episodeHtmlSeasonPageUrl: null,
    episodeHtmlRowsFound: 0,
    episodeHtmlExactKeptRows: 0,
    episodeHtmlRejectedRows: 0,
    exactEpisodeEvidenceSamples: [],
    episodeHtmlRecognized5x08Style: false,
    aggregateParallelized: false,
    subdlDurationMs: null,
    opensubtitlesDurationMs: null,
    aggregateDurationMs: null
  };
  const providerErrors = [];
  let successCount = 0;
  const subdlAcc = [];
  const openRows = [];
  const providerErrorsSubdl = [];
  const providerErrorsOpen = [];
  let subdlSuccessIncr = 0;
  let openSuccessIncr = 0;

  debugCounts.aggregateParallelized =
    requested.includes("subdl") && requested.includes("opensubtitles");

  const pSubdl = (async () => {
    const t0 = Date.now();
    const subtitles = subdlAcc;
    try {
      if (!requested.includes("subdl")) return;
      if (!SUBDL_API_KEY) {
        providerErrorsSubdl.push({ provider: "subdl", message: "SUBDL_API_KEY is not configured" });
        return;
      }
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
                  "filmNameSeasonOnly",
                  "episodeModeHtmlSeasonPage"
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
            const subdlErr = err?.subdl || {};
            const errorType = String(
              subdlErr.errorType ||
                (String(err?.message || "").toLowerCase().includes("timed out") ? "timeout_error" : "unknown_error")
            );
            const httpStatus = Number(subdlErr.httpStatus || 0);
            const providerMessage = String(subdlErr.providerMessage || "").trim();
            const responseBody = String(subdlErr.responseBody || "").slice(0, 1000);
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
              errorType,
              httpStatus,
              providerMessage,
              responseBody,
              paramsEcho: echoSubdlParamsForDiag(params)
            });
            logError("SubDL probe failed", err, {
              probe,
              tmdbId,
              title: extraMeta.title || null,
              season,
              mediaType,
              errorType,
              httpStatus,
              providerMessage: providerMessage || null,
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
          const {
            primary: showTitleRawEpisode,
            original: showTitleOriginalEpisode,
            imdbId: showImdbEpisode
          } = await fetchTmdbTvNameForSubdl(tmdbId);
          const showTitleEp = sanitizeSubdlFilmNameForQuery(showTitleRawEpisode);

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
          if (!ok && epStr && showTitleEp) {
            ok = await runSubdlAttempt("filmNameSeasonEpisode", {
              type: "tv",
              film_name: showTitleEp,
              season_number: season,
              episode_number: epStr,
              ...subdlCommon
            });
            if (!ok) {
              ok = await runSubdlAttempt("filmNameSeasonFull", {
                type: "tv",
                film_name: showTitleEp,
                season_number: season,
                full_season: 1,
                ...subdlCommon
              });
            }
            if (!ok) {
              ok = await runSubdlAttempt("filmNameSeasonOnly", {
                type: "tv",
                film_name: showTitleEp,
                season_number: season,
                ...subdlCommon
              });
            }
          }

          const requestedLangNormEp = normalizeLanguageCode(language);
          const episodeClassifyCtxBase = {
            mediaType: "tv",
            tvQueryMode: "episode",
            season,
            episode: epStr,
            subdlWinningProbe: debugCounts.subdlWinningProbe || "exactEpisodeTmdb"
          };
          const subdlRowsForEp = subtitles.filter((r) => String(r.provider || "") === "subdl");
          const subdlExactEpisodeCount = subdlRowsForEp.filter(
            (r) => classifyTvSubtitleMatch(r, episodeClassifyCtxBase).tvMatchKind === "exactEpisode"
          ).length;

          const episodeHtmlWanted =
            Boolean(epStr) && parseOptionalEpisodeNumber(season) != null && subdlExactEpisodeCount === 0;
          debugCounts.episodeHtmlFallbackAttempted = episodeHtmlWanted;

          if (episodeHtmlWanted) {
            debugCounts.episodeHtmlFallbackTriggerReason =
              subdlRowsForEp.length === 0 ? "no-subdl-rows" : "no-subdl-exact-episode";
            if (!showTitleEp) {
              debugCounts.episodeHtmlFallbackSkipReason = "skipped-no-show-title";
            } else {
              let htmlCandidates = [];
              try {
                const resolver = await resolveSubdlTvCanonicalUrlsBySearch({
                  showTitle: showTitleRawEpisode || showTitleEp,
                  originalTitle: showTitleOriginalEpisode,
                  imdbId: showImdbEpisode
                });
                applySubdlHtmlResolverDiagnostics(debugCounts, resolver);
                const resolverSdId = String(resolver.foundSdId || "").trim();
                const resolverLinks = Array.isArray(resolver.canonicalLinks) ? resolver.canonicalLinks : [];
                const seasonSlugList = seasonSlugVariants(season);
                const resolverSeasonCandidates = resolverLinks.flatMap((baseUrl) =>
                  seasonSlugList.map((ss) => `${String(baseUrl || "").replace(/\/+$/, "")}/${ss}`)
                );
                htmlCandidates = buildSubdlSeasonPageCandidates({
                  sdId: resolverSdId || subdlHtmlSeedSdId,
                  showTitle: showTitleRawEpisode || showTitleEp,
                  season
                });
                if (resolverSeasonCandidates.length) {
                  htmlCandidates = Array.from(new Set([...resolverSeasonCandidates, ...htmlCandidates])).slice(0, 22);
                }
              } catch (err) {
                logError("SubDL episode HTML candidate build failed", err, {
                  tmdbId,
                  title: showTitleRawEpisode || showTitleEp || null,
                  season
                });
              }
              if (!htmlCandidates.length) {
                debugCounts.episodeHtmlFallbackSkipReason = "skipped-no-html-candidates";
              } else {
                const existingUrls = new Set(
                  subtitles.map((r) => String(r.downloadUrl || "").trim()).filter(Boolean)
                );
                const htmlEpisodeCtx = {
                  mediaType: "tv",
                  tvQueryMode: "episode",
                  season,
                  episode: epStr,
                  subdlWinningProbe: "episodeModeHtmlSeasonPage"
                };
                const nxnLoose = /\b\d{1,2}\s*[xX]\s*\d{1,4}\b/;
                const nxnTight = /\b\d{1,2}[xX]\d{1,4}\b/;
                let anyHtmlEp = false;
                let saw5x08StyleMatch = false;
                const ctxSNum = parseOptionalEpisodeNumber(season);
                const ctxENum = parseOptionalEpisodeNumber(epStr);
                let lastHadParsedRows = false;

                for (const candidateUrl of htmlCandidates) {
                  try {
                    const res = await fetch(candidateUrl, {
                      headers: { Accept: "text/html" }
                    });
                    if (!res.ok) continue;
                    const html = await res.text();
                    const hasHtml = Boolean(html && html.length > 200);
                    anyHtmlEp = anyHtmlEp || hasHtml;
                    if (!hasHtml) continue;
                    const parsedOut = parseSubdlSeasonPageHtmlRows(html, requestedLangNormEp || "en");
                    const parsed = (parsedOut.rows || []).map((row) => ({
                      ...row,
                      subdlProbe: "episodeModeHtmlSeasonPage"
                    }));
                    if (!parsed.length) continue;
                    lastHadParsedRows = true;

                    const kept = [];
                    let rejected = 0;
                    const evidenceSamples = [];
                    for (const row of parsed) {
                      const rt = releaseTextBundle(row);
                      const pr = parseSeasonEpisodeFromReleaseText(rt);
                      if (
                        (nxnLoose.test(rt) || nxnTight.test(rt)) &&
                        pr.season === ctxSNum &&
                        pr.episode === ctxENum
                      ) {
                        saw5x08StyleMatch = true;
                      }
                      const c = classifyTvSubtitleMatch(row, htmlEpisodeCtx);
                      if (c.tvMatchKind === "exactEpisode") {
                        const u = String(row.downloadUrl || "").trim();
                        if (!u || existingUrls.has(u)) {
                          rejected += 1;
                          continue;
                        }
                        kept.push(row);
                        existingUrls.add(u);
                        if (evidenceSamples.length < 8) {
                          evidenceSamples.push({
                            releaseNameSnippet: String(row.releaseName || "").slice(0, 160),
                            parsedSeason: pr.season,
                            parsedEpisode: pr.episode,
                            classifyBranch: c.classifyBranch,
                            nxNPatternMatchedForContext:
                              (nxnLoose.test(rt) || nxnTight.test(rt)) &&
                              pr.season === ctxSNum &&
                              pr.episode === ctxENum
                          });
                        }
                      } else {
                        rejected += 1;
                      }
                    }

                    debugCounts.episodeHtmlSeasonPageUrl = candidateUrl;
                    debugCounts.episodeHtmlRowsFound = parsed.length;
                    debugCounts.episodeHtmlExactKeptRows = kept.length;
                    debugCounts.episodeHtmlRejectedRows = rejected;
                    debugCounts.exactEpisodeEvidenceSamples = kept.length ? evidenceSamples : [];
                    debugCounts.episodeHtmlRecognized5x08Style = saw5x08StyleMatch;

                    if (kept.length) {
                      subtitles.push(...kept);
                      mappedTotal += kept.length;
                      debugCounts.episodeHtmlFallbackUsed = true;
                      debugCounts.episodeHtmlFallbackSkipReason = null;
                      break;
                    }
                  } catch (err) {
                    logError("SubDL episode HTML fetch/parse failed", err, {
                      tmdbId,
                      title: showTitleRawEpisode || showTitleEp || null,
                      season,
                      episode: epStr,
                      htmlSeasonPageUrl: candidateUrl
                    });
                  }
                }

                if (!debugCounts.episodeHtmlFallbackUsed) {
                  if (lastHadParsedRows) {
                    debugCounts.episodeHtmlFallbackSkipReason = "skipped-html-no-exact-episode-rows";
                  } else {
                    debugCounts.episodeHtmlFallbackSkipReason = anyHtmlEp
                      ? "skipped-html-parse-empty"
                      : "skipped-html-fetch-failed";
                  }
                }
              }
            }
          } else if (Boolean(epStr) && parseOptionalEpisodeNumber(season) != null && subdlExactEpisodeCount > 0) {
            debugCounts.episodeHtmlFallbackSkipReason = "skipped-api-has-exact-episode";
          }

          if (debugCounts.episodeHtmlFallbackAttempted) {
            attempts.push({
              probe: "episodeModeHtmlSeasonPage",
              rawRows: Number(debugCounts.episodeHtmlRowsFound || 0),
              mappedRows: Number(debugCounts.episodeHtmlExactKeptRows || 0),
              mappedLangs: {},
              localSeasonFilterApplied: false,
              localSeasonFilterKeptRows: 0,
              localSeasonFilterDroppedRows: 0,
              localSeasonFilterKeptLangs: {},
              paramsEcho: { episodeHtmlSeasonPageUrl: debugCounts.episodeHtmlSeasonPageUrl }
            });
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
          const {
            primary: showTitleRaw,
            original: showTitleOriginal,
            imdbId: showImdbTv
          } = await fetchTmdbTvNameForSubdl(tmdbId);
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
          const seasonAttempts = attempts.filter((a) => String(a?.probe || "").startsWith("seasonMode"));
          const allSeasonProbesFailed =
            seasonAttempts.length > 0 && seasonAttempts.every((a) => Boolean(a?.failed));
          const seasonApiEmpty =
            rawTotal <= 0 || mergedApiSubdlCount <= 0 || seasonAttempts.every((a) => Number(a?.rawRows || 0) <= 0);
          const noWinningProbe = !debugCounts.subdlWinningProbe;
          const missingRequestedLanguage =
            Boolean(requestedLangNorm) && Number(mergedApiLangs[requestedLangNorm] || 0) === 0;
          const narrowLanguageCoverage =
            mappedTotal > 0 &&
            (mergedApiLangKeys.length <= 1 ||
              (mergedApiLangKeys.length === 2 && mergedApiLangKeys.includes("und")));
          const lowResultCount = mergedApiSubdlCount > 0 && mergedApiSubdlCount < SUBDL_SEASON_HTML_LOW_COUNT_THRESHOLD;
          let htmlTriggerReason = null;
          if (allSeasonProbesFailed) htmlTriggerReason = "all-season-probes-failed";
          else if (seasonApiEmpty) htmlTriggerReason = "season-api-empty";
          else if (noWinningProbe) htmlTriggerReason = "no-winning-probe";
          else if (missingRequestedLanguage) htmlTriggerReason = "missing-requested-language";
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
              const resolver = await resolveSubdlTvCanonicalUrlsBySearch({
                showTitle: showTitleRaw || showTitle,
                originalTitle: showTitleOriginal,
                imdbId: showImdbTv
              });
              applySubdlHtmlResolverDiagnostics(debugCounts, resolver);
              const resolverSdId = String(resolver.foundSdId || "").trim();
              const resolverLinks = Array.isArray(resolver.canonicalLinks) ? resolver.canonicalLinks : [];
              const seasonSlugList = seasonSlugVariants(season);
              const resolverSeasonCandidates = resolverLinks.flatMap((baseUrl) =>
                seasonSlugList.map((ss) => `${String(baseUrl || "").replace(/\/+$/, "")}/${ss}`)
              );
              if (requestedLangNorm === "ar") {
                const sdIdSet = new Set();
                const addSd = (raw) => {
                  const id = String(raw || "").trim();
                  if (id) sdIdSet.add(id);
                };
                addSd(resolverSdId);
                addSd(subdlHtmlSeedSdId);
                for (const link of resolverLinks) addSd(extractSubdlSdIdFromUrl(link));
                const built = [];
                const idsToWalk = sdIdSet.size
                  ? Array.from(sdIdSet)
                  : [resolverSdId || subdlHtmlSeedSdId].filter(Boolean);
                for (const sid of idsToWalk) {
                  built.push(
                    ...buildSubdlSeasonPageCandidates({
                      sdId: sid,
                      showTitle: showTitleRaw || showTitle,
                      season
                    })
                  );
                }
                built.push(
                  ...buildSubdlSeasonPageCandidates({
                    sdId: "",
                    showTitle: showTitleRaw || showTitle,
                    season
                  })
                );
                htmlCandidates = Array.from(new Set([...resolverSeasonCandidates, ...built])).slice(0, 40);
              } else {
                htmlCandidates = buildSubdlSeasonPageCandidates({
                  sdId: resolverSdId || subdlHtmlSeedSdId,
                  showTitle: showTitleRaw || showTitle,
                  season
                });
                if (resolverSeasonCandidates.length) {
                  htmlCandidates = Array.from(new Set([...resolverSeasonCandidates, ...htmlCandidates])).slice(
                    0,
                    22
                  );
                }
              }
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
              const attemptedHtmlUrls = new Set();
              let anyHtml = false;
              for (const candidateUrl of htmlCandidates) {
                try {
                  attemptedHtmlUrls.add(candidateUrl);
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
                    debugCounts.subdlHtmlLanguageHeaderLabels = Array.isArray(
                      parsedOut.diag.languageHeaderLabelsRaw
                    )
                      ? parsedOut.diag.languageHeaderLabelsRaw.slice(0, 48)
                      : [];
                    const arHdr = Number(parsedOut.diag.arabicSectionHeadersFound || 0);
                    debugCounts.subdlHtmlArabicSectionHeadersFound = arHdr;
                    debugCounts.subdlHtmlArabicSectionsDetected = arHdr > 0;
                    debugCounts.subdlHtmlAcceptedLanguageHeaders = Array.isArray(
                      parsedOut.diag.acceptedLanguageHeaders
                    )
                      ? parsedOut.diag.acceptedLanguageHeaders
                      : [];
                    debugCounts.subdlHtmlRejectedNonLanguageHeaders = Array.isArray(
                      parsedOut.diag.rejectedLanguageHeaders
                    )
                      ? parsedOut.diag.rejectedLanguageHeaders
                      : [];
                    debugCounts.subdlHtmlRowsWithoutLanguageSection = Number(
                      parsedOut.diag.rowsWithoutLanguageSection || 0
                    );
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
              if (
                requestedLangNorm === "ar" &&
                htmlRows.length > 0 &&
                !htmlRows.some((r) => isSubdlRowArabicCandidate(r))
              ) {
                debugCounts.subdlHtmlArabicDiscoveryModeUsed = true;
                const downloadSeen = new Set(
                  htmlRows.map((r) => String(r.downloadUrl || "").trim()).filter(Boolean)
                );
                let discoveryGross = 0;
                const mergedDiscovery = [];
                for (const candidateUrl of htmlCandidates) {
                  if (attemptedHtmlUrls.has(candidateUrl)) continue;
                  debugCounts.subdlHtmlAltCandidatesChecked += 1;
                  try {
                    attemptedHtmlUrls.add(candidateUrl);
                    const res = await fetch(candidateUrl, {
                      headers: { Accept: "text/html" }
                    });
                    if (!res.ok) {
                      fetchStatus.push({
                        url: candidateUrl,
                        ok: false,
                        status: Number(res.status || 0),
                        hasHtml: false,
                        parsedRows: 0,
                        phase: "ar-discovery"
                      });
                      continue;
                    }
                    const html = await res.text();
                    const hasHtml = Boolean(html && html.length > 200);
                    anyHtml = anyHtml || hasHtml;
                    const parsedOut = parseSubdlSeasonPageHtmlRows(html, requestedLangNorm || "en");
                    const parsed = (parsedOut.rows || []).map((row) => ({
                      ...row,
                      subdlProbe: "seasonModeHtmlArabicDiscovery"
                    }));
                    if (parsed.length) debugCounts.subdlHtmlAltCandidatesWithRows += 1;
                    const arOnly = parsed.filter((r) => isSubdlRowArabicCandidate(r));
                    if (arOnly.length) {
                      debugCounts.subdlHtmlAltCandidatesWithArabicRows += 1;
                      discoveryGross += arOnly.length;
                      if (!debugCounts.subdlHtmlArabicDiscoveryWinningUrl) {
                        debugCounts.subdlHtmlArabicDiscoveryWinningUrl = candidateUrl;
                      }
                    }
                    for (const row of arOnly) {
                      const u = String(row.downloadUrl || "").trim();
                      if (!u || downloadSeen.has(u)) continue;
                      downloadSeen.add(u);
                      mergedDiscovery.push(row);
                    }
                    fetchStatus.push({
                      url: candidateUrl,
                      ok: true,
                      status: Number(res.status || 200),
                      hasHtml,
                      parsedRows: parsed.length,
                      arabicRowsParsed: arOnly.length,
                      phase: "ar-discovery"
                    });
                  } catch (err) {
                    fetchStatus.push({
                      url: candidateUrl,
                      ok: false,
                      status: 0,
                      hasHtml: false,
                      parsedRows: 0,
                      phase: "ar-discovery"
                    });
                    logError("SubDL Arabic discovery fetch/parse failed", err, {
                      tmdbId,
                      title: showTitleRaw || showTitle || null,
                      season,
                      htmlSeasonPageUrl: candidateUrl
                    });
                  }
                }
                debugCounts.subdlHtmlArabicDiscoveryRowsFound = discoveryGross;
                htmlRows.push(...mergedDiscovery);
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
                const arParsed = htmlRows.filter((row) => isSubdlRowArabicCandidate(row)).length;
                const arKept = keptHtmlRows.filter((row) => isSubdlRowArabicCandidate(row)).length;
                debugCounts.subdlHtmlArabicRowsParsed = arParsed;
                debugCounts.subdlHtmlArabicRowsKept = arKept;
                debugCounts.subdlHtmlArabicDiscoveryRowsKept = keptHtmlRows.filter(
                  (row) => String(row.subdlProbe || "") === "seasonModeHtmlArabicDiscovery"
                ).length;
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
                    debugCounts.subdlHtmlLanguageHeaderLabels = Array.isArray(
                      parsedOut.diag.languageHeaderLabelsRaw
                    )
                      ? parsedOut.diag.languageHeaderLabelsRaw.slice(0, 48)
                      : [];
                    const arHdr = Number(parsedOut.diag.arabicSectionHeadersFound || 0);
                    debugCounts.subdlHtmlArabicSectionHeadersFound = arHdr;
                    debugCounts.subdlHtmlArabicSectionsDetected = arHdr > 0;
                    debugCounts.subdlHtmlAcceptedLanguageHeaders = Array.isArray(
                      parsedOut.diag.acceptedLanguageHeaders
                    )
                      ? parsedOut.diag.acceptedLanguageHeaders
                      : [];
                    debugCounts.subdlHtmlRejectedNonLanguageHeaders = Array.isArray(
                      parsedOut.diag.rejectedLanguageHeaders
                    )
                      ? parsedOut.diag.rejectedLanguageHeaders
                      : [];
                    debugCounts.subdlHtmlRowsWithoutLanguageSection = Number(
                      parsedOut.diag.rowsWithoutLanguageSection || 0
                    );
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
        subdlSuccessIncr = 1;
      } catch (err) {
        providerErrorsSubdl.push({ provider: "subdl", message: err.message });
      }
    } finally {
      debugCounts.subdlDurationMs = Date.now() - t0;
    }
  })();

  const pOpen = (async () => {
    const t1 = Date.now();
    try {
      if (!requested.includes("opensubtitles")) return;
      if (!OPENSUBTITLES_API_KEY) {
        providerErrorsOpen.push({
          provider: "opensubtitles",
          message: "OPENSUBTITLES_API_KEY is not configured"
        });
        return;
      }
      try {
        const allResults = [];
        let rawSum = 0;
        const openSubAttempts = [];
        let openSubRateLimited = false;
        const seasonMode = mediaType === "tv" && tvQueryMode === "season";
        const resolveDownloads = !seasonMode;
        const maxResolve = mediaType === "movie" ? 10 : seasonMode ? 0 : 8;
        const resolveTimeoutMs = seasonMode ? 0 : 3000;
        let tvIdentityCtx = null;
        const runOpenSubAttempt = async (
          label,
          {
            tmdbIdOverride = "",
            imdbIdOverride = "",
            queryOverride = "",
            yearOverride = year || "",
            seasonOverride = season || "",
            episodeOverride = episode,
            broadNoSeason = false
          } = {}
        ) => {
          if (openSubRateLimited) {
            openSubAttempts.push({
              probe: label,
              skipped: true,
              skipReason: "rate-limited-backoff"
            });
            return 0;
          }
          const beforeRaw = rawSum;
          const beforeMapped = allResults.length;
          const fetchedThisAttempt = [];
          const runPages = async () => {
            for (let i = 1; i <= 3; i += 1) {
              const pageResult = await searchOpenSubtitles({
                tmdbId: tmdbIdOverride || "",
                imdbId: imdbIdOverride || "",
                query: queryOverride || "",
                mediaType,
                language,
                season: broadNoSeason ? "" : seasonOverride,
                episode: episodeOverride,
                year: yearOverride,
                page: i,
                resolveDownloads,
                maxResolve,
                resolveTimeoutMs
              });
              rawSum += Number(pageResult.rawCount || 0);
              fetchedThisAttempt.push(...(pageResult.items || []));
              if ((pageResult.items || []).length < 30) break;
            }
          };
          try {
            await runPages();
            let acceptedThisAttempt = fetchedThisAttempt;
            if (mediaType === "tv" && tvIdentityCtx) {
              debugCounts.opensubtitlesTvFetchedBeforeIdentity += fetchedThisAttempt.length;
              const kept = [];
              for (const row of fetchedThisAttempt) {
                const rowSeason = parseOptionalEpisodeNumber(row.season);
                const rowEpisode = parseOptionalEpisodeNumber(row.episode);
                const reqSeason = parseOptionalEpisodeNumber(seasonOverride || season || "");
                const reqEpisode = parseOptionalEpisodeNumber(episodeOverride || "");
                const rowTitleForSample =
                  String(row.openSubFeatureTitle || "").trim() || String(row.releaseName || "").trim();
                const rowAltTitle = String(row.openSubFeatureOriginalTitle || "").trim();
                const idEval = evaluateOpenSubtitlesTvShowIdentity(row, tvIdentityCtx);
                if (!idEval.ok) {
                  debugCounts.opensubtitlesTvRejectedShowMismatch += 1;
                  if (debugCounts.opensubtitlesTvRejectedSamples.length < 8) {
                    debugCounts.opensubtitlesTvRejectedSamples.push({
                      reason: "show-mismatch",
                      probe: label,
                      title: String(row.openSubFeatureTitle || "").trim().slice(0, 120),
                      altTitle: rowAltTitle.slice(0, 120),
                      releaseName: String(row.releaseName || "").slice(0, 120),
                      identityFieldUsed: idEval.identityFieldUsed,
                      requestedShowTitleNormalized: idEval.requestedShowTitleNormalized,
                      candidateShowTitleNormalized: idEval.candidateShowTitleNormalized,
                      candidateAltTitleNormalized: idEval.candidateAltTitleNormalized,
                      releaseNameShowEvidence: idEval.releaseNameShowEvidence,
                      rejectReasonDetailed: idEval.rejectReasonDetailed
                    });
                  }
                  continue;
                }
                if (reqSeason != null && rowSeason != null && rowSeason !== reqSeason) {
                  debugCounts.opensubtitlesTvRejectedSeasonMismatch += 1;
                  if (debugCounts.opensubtitlesTvRejectedSamples.length < 6) {
                    debugCounts.opensubtitlesTvRejectedSamples.push({
                      reason: "season-mismatch",
                      probe: label,
                      title: rowTitleForSample.slice(0, 120),
                      season: rowSeason,
                      requestedSeason: reqSeason
                    });
                  }
                  continue;
                }
                if (tvQueryMode === "episode" && reqEpisode != null && rowEpisode != null && rowEpisode !== reqEpisode) {
                  debugCounts.opensubtitlesTvRejectedEpisodeMismatch += 1;
                  if (debugCounts.opensubtitlesTvRejectedSamples.length < 6) {
                    debugCounts.opensubtitlesTvRejectedSamples.push({
                      reason: "episode-mismatch",
                      probe: label,
                      title: rowTitleForSample.slice(0, 120),
                      episode: rowEpisode,
                      requestedEpisode: reqEpisode
                    });
                  }
                  continue;
                }
                const accField = idEval.identityFieldUsed || "unknown";
                debugCounts.opensubtitlesTvIdentityAcceptByField[accField] =
                  (debugCounts.opensubtitlesTvIdentityAcceptByField[accField] || 0) + 1;
                kept.push(row);
              }
              acceptedThisAttempt = kept;
              debugCounts.opensubtitlesTvKeptAfterIdentity += kept.length;
            }
            allResults.push(...acceptedThisAttempt);
            openSubAttempts.push({
              probe: label,
              tmdb_id: tmdbIdOverride ? String(tmdbIdOverride) : null,
              imdb_id: imdbIdOverride ? String(imdbIdOverride) : null,
              query: queryOverride ? String(queryOverride).slice(0, 120) : null,
              season: broadNoSeason ? null : seasonOverride ? String(seasonOverride) : null,
              episode: episodeOverride ? String(episodeOverride) : null,
              year: yearOverride ? String(yearOverride) : null,
              rawAdded: Math.max(0, rawSum - beforeRaw),
              mappedAdded: Math.max(0, fetchedThisAttempt.length),
              keptAfterIdentity: Math.max(0, allResults.length - beforeMapped),
              failed: false
            });
          } catch (err) {
            if (isOpenSubRateLimitError(err)) {
              openSubRateLimited = true;
            }
            openSubAttempts.push({
              probe: label,
              tmdb_id: tmdbIdOverride ? String(tmdbIdOverride) : null,
              imdb_id: imdbIdOverride ? String(imdbIdOverride) : null,
              query: queryOverride ? String(queryOverride).slice(0, 120) : null,
              season: broadNoSeason ? null : seasonOverride ? String(seasonOverride) : null,
              episode: episodeOverride ? String(episodeOverride) : null,
              year: yearOverride ? String(yearOverride) : null,
              rawAdded: 0,
              mappedAdded: 0,
              failed: true,
              error: String(err?.message || err),
              rateLimited: isOpenSubRateLimitError(err)
            });
            logError("OpenSubtitles fallback probe failed", err, {
              probe: label,
              tmdbId,
              mediaType
            });
          }
          return Math.max(0, rawSum - beforeRaw);
        };
        if (mediaType === "tv") {
          const tvIdentity = await fetchTmdbTvIdentityForFallback(tmdbId);
          tvIdentityCtx = {
            title: String(tvIdentity.title || "").trim(),
            originalTitle: String(tvIdentity.originalTitle || "").trim(),
            imdbId: String(tvIdentity.imdbId || "").trim(),
            tmdbId: String(tmdbId || "").trim()
          };
          debugCounts.opensubtitlesRequestedShowTitleNormalized = normalizeIdentityTitle(
            tvIdentityCtx.title || tvIdentityCtx.originalTitle || ""
          );
          const titlePrimary = String(tvIdentity.title || "").trim();
          const titleAlt = String(tvIdentity.originalTitle || "").trim();
          const tvYear = String(year || "").trim() || String(tvIdentity.year || "").trim();
          const imdbId = String(tvIdentity.imdbId || "").trim();
          if (tvQueryMode === "season") {
            const strictSeasonRaw = await runOpenSubAttempt("tvTmdbSeasonStrict", {
              tmdbIdOverride: tmdbId,
              seasonOverride: season,
              episodeOverride: "",
              yearOverride: tvYear
            });
            if (strictSeasonRaw === 0 && imdbId) {
              await runOpenSubAttempt("tvImdbSeason", {
                imdbIdOverride: imdbId,
                seasonOverride: season,
                episodeOverride: "",
                yearOverride: tvYear
              });
            }
            if (rawSum === 0 && titlePrimary) {
              await runOpenSubAttempt("tvTitleSeason", {
                queryOverride: titlePrimary,
                seasonOverride: season,
                episodeOverride: "",
                yearOverride: tvYear
              });
            }
            if (rawSum === 0 && titleAlt && titleAlt.toLowerCase() !== titlePrimary.toLowerCase()) {
              await runOpenSubAttempt("tvAltTitleSeason", {
                queryOverride: titleAlt,
                seasonOverride: season,
                episodeOverride: "",
                yearOverride: tvYear
              });
            }
            if (rawSum === 0 && titlePrimary) {
              await runOpenSubAttempt("tvTitleBroadNoSeason", {
                queryOverride: titlePrimary,
                seasonOverride: "",
                episodeOverride: "",
                yearOverride: tvYear,
                broadNoSeason: true
              });
            }
          } else {
            const strictEpisodeRaw = await runOpenSubAttempt("tvTmdbExactEpisode", {
              tmdbIdOverride: tmdbId,
              seasonOverride: season,
              episodeOverride: episode,
              yearOverride: tvYear
            });
            if (strictEpisodeRaw === 0) {
              await runOpenSubAttempt("tvTmdbSeasonOnly", {
                tmdbIdOverride: tmdbId,
                seasonOverride: season,
                episodeOverride: "",
                yearOverride: tvYear
              });
            }
            if (rawSum === 0 && titlePrimary) {
              await runOpenSubAttempt("tvTitleExactEpisode", {
                queryOverride: titlePrimary,
                seasonOverride: season,
                episodeOverride: episode,
                yearOverride: tvYear
              });
            }
            if (rawSum === 0 && titlePrimary) {
              await runOpenSubAttempt("tvTitleSeasonOnly", {
                queryOverride: titlePrimary,
                seasonOverride: season,
                episodeOverride: "",
                yearOverride: tvYear
              });
            }
            if (rawSum === 0 && titleAlt && titleAlt.toLowerCase() !== titlePrimary.toLowerCase()) {
              await runOpenSubAttempt("tvAltTitleBroad", {
                queryOverride: titleAlt,
                seasonOverride: "",
                episodeOverride: "",
                yearOverride: tvYear,
                broadNoSeason: true
              });
            }
          }
        } else {
          const strictRaw = await runOpenSubAttempt("movieTmdbStrict", {
            tmdbIdOverride: tmdbId,
            yearOverride: year || ""
          });
          if (strictRaw === 0) {
            const movieIdentity = await fetchTmdbMovieIdentityForFallback(tmdbId);
            const titleQuery = String(movieIdentity.title || "").trim();
            const altTitleQuery = String(movieIdentity.originalTitle || "").trim();
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
            if (
              rawSum === 0 &&
              altTitleQuery &&
              altTitleQuery.toLowerCase() !== titleQuery.toLowerCase()
            ) {
              await runOpenSubAttempt("movieAltTitleNoYear", {
                queryOverride: altTitleQuery,
                yearOverride: ""
              });
            }
          }
        }
        debugCounts.opensubtitlesMovieAttempts = openSubAttempts;
        debugCounts.opensubtitlesRaw = rawSum;
        debugCounts.opensubtitlesMapped = allResults.length;
        openRows.push(...allResults);
        openSuccessIncr = 1;
      } catch (err) {
        providerErrorsOpen.push({ provider: "opensubtitles", message: err.message });
      }
    } finally {
      debugCounts.opensubtitlesDurationMs = Date.now() - t1;
    }
  })();

  const _aggregateWallMs = Date.now();
  await Promise.all([pSubdl, pOpen]);
  debugCounts.aggregateDurationMs = Date.now() - _aggregateWallMs;

  const subtitles = [...subdlAcc, ...openRows];
  providerErrors.push(...providerErrorsSubdl, ...providerErrorsOpen);
  successCount = subdlSuccessIncr + openSuccessIncr;

  debugCounts.perProviderAfterSubdl = countByProvider(subdlAcc);

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
  const providerHealth = buildProviderHealthSummary({
    providerFilter,
    requested,
    providerErrors,
    finalSubtitles: finalList,
    alternateSubtitles,
    debugCounts
  });

  return {
    provider: providerFilter,
    providerErrors,
    subtitles: stripOpenSubInternalFields(stripSubdlProbeFromRows(finalList)),
    alternateSubtitles: stripOpenSubInternalFields(stripSubdlProbeFromRows(alternateSubtitles)),
    debugCounts,
    diagnostics,
    providerHealth,
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

