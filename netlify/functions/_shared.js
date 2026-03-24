import dotenv from "dotenv";

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

const TOKEN_TTL_MS = 50 * 60 * 1000;
const DOWNLOAD_LINK_TTL_MS = 10 * 60 * 1000;
const OPENSUBTITLES_API = "https://api.opensubtitles.com/api/v1";

let cachedOpenSubToken = "";
let cachedOpenSubTokenExp = 0;
let openSubLoginPromise = null;
const openSubDownloadCache = new Map();

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
  const lower = String(code).toLowerCase().trim();
  const aliases = {
    arabic: "ar",
    english: "en",
    french: "fr",
    german: "de",
    spanish: "es",
    italian: "it",
    turkish: "tr"
  };
  return aliases[lower] || lower || "ar";
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
    timestamp: new Date().toISOString()
  };
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
  const endpoint = type === "movie" ? "/search/movie" : type === "tv" ? "/search/tv" : "/search/multi";
  const payload = await tmdbFetch(endpoint, {
    query,
    language: "en-US",
    include_adult: "false",
    year: type === "movie" ? year : undefined,
    first_air_date_year: type === "tv" ? year : undefined,
    page: 1
  });
  return (payload.results || [])
    .filter((item) => {
      const mediaType = type === "multi" ? item.media_type : type;
      return mediaType === "movie" || mediaType === "tv";
    })
    .slice(0, 20)
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
        tmdbId: item.id
      };
    });
}

export async function getMediaDetailsById(mediaType, tmdbId) {
  const path = mediaType === "tv" ? `/tv/${tmdbId}` : `/movie/${tmdbId}`;
  const payload = await tmdbFetch(path, { language: "ar-SA" });
  const date =
    mediaType === "tv"
      ? payload.first_air_date || ""
      : payload.release_date || "";
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
    poster: payload.poster_path
      ? `https://image.tmdb.org/t/p/w500${payload.poster_path}`
      : ""
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

function mapSubdl(payload, defaultLang) {
  const raw = payload?.subtitles || payload?.data || [];
  return raw
    .map((sub) => ({
      provider: "subdl",
      id: String(sub.id || sub.sd_id || `${sub.url}-${sub.release_name || "sub"}`),
      language: String(sub.language || sub.lang || defaultLang).toUpperCase(),
      releaseName: sub.release_name || sub.release || sub.name || "Subtitle",
      author: sub.author || sub.uploader || "",
      hearingImpaired: Boolean(sub.hi),
      downloadUrl: normalizeSubdlDownloadUrl(sub.url || sub.download_link || sub.download_url || ""),
      comment: sub.comment || "",
      season: sub.season || "",
      episode: sub.episode || "",
      releases: sub.releases || []
    }))
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
    downloadUrl: link,
    comment: a.comments || "",
    season: a.feature_details?.season_number || "",
    episode: a.feature_details?.episode_number || "",
    releases
  };
}

async function searchOpenSubtitles({ tmdbId, mediaType, language, season, episode, year }) {
  if (!OPENSUBTITLES_API_KEY) throw new Error("OPENSUBTITLES_API_KEY is not configured");
  let token = "";
  try {
    token = await getOpenSubToken();
  } catch (err) {
    logError("OpenSubtitles token login failed; fallback to API-key request", err);
  }
  const url = new URL(`${OPENSUBTITLES_API}/subtitles`);
  url.searchParams.set("tmdb_id", String(tmdbId));
  url.searchParams.set("type", mediaType);
  if (language) url.searchParams.set("languages", language);
  if (year) url.searchParams.set("year", String(year));
  if (mediaType === "tv" && season) url.searchParams.set("season_number", String(season));
  if (mediaType === "tv" && episode) url.searchParams.set("episode_number", String(episode));
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
  const list = Array.isArray(payload?.data) ? payload.data.slice(0, 30) : [];
  const out = [];
  for (const item of list) {
    try {
      const link = await openSubDownload(openSubFileId(item), token);
      const mapped = mapOpenSub(item, link, language);
      if (mapped.downloadUrl) out.push(mapped);
    } catch (err) {
      logError("OpenSubtitles item download resolve failed", err, { itemId: item?.id });
    }
  }
  return out;
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
  provider = "all"
}) {
  const providerFilter = normalizeProviderFilter(provider);
  const requested = providerFilter === "all" ? ["subdl", "opensubtitles"] : [providerFilter];
  const providerErrors = [];
  let successCount = 0;
  const subtitles = [];

  if (requested.includes("subdl")) {
    if (!SUBDL_API_KEY) {
      providerErrors.push({ provider: "subdl", message: "SUBDL_API_KEY is not configured" });
    } else {
      try {
        const payload = await subdlFetch({
          tmdb_id: tmdbId,
          type: mediaType,
          languages: language,
          season_number: mediaType === "tv" ? season : undefined,
          episode_number: mediaType === "tv" ? episode : undefined,
          year,
          subs_per_page: 30,
          comment: 1,
          releases: 1,
          hi: 1
        });
        subtitles.push(...mapSubdl(payload, language));
        successCount += 1;
      } catch (err) {
        providerErrors.push({ provider: "subdl", message: err.message });
      }
    }
  }

  if (requested.includes("opensubtitles")) {
    if (!OPENSUBTITLES_API_KEY) {
      providerErrors.push({
        provider: "opensubtitles",
        message: "OPENSUBTITLES_API_KEY is not configured"
      });
    } else {
      try {
        const results = await searchOpenSubtitles({
          tmdbId,
          mediaType,
          language,
          season,
          episode,
          year
        });
        subtitles.push(...results);
        successCount += 1;
      } catch (err) {
        providerErrors.push({ provider: "opensubtitles", message: err.message });
      }
    }
  }

  return {
    provider: providerFilter,
    providerErrors,
    subtitles: sortSubtitles(dedupeSubtitles(subtitles)),
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

