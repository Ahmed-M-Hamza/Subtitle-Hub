import {
  OPENSUBTITLES_API_KEY,
  OPENSUBTITLES_PASSWORD,
  OPENSUBTITLES_USER_AGENT,
  OPENSUBTITLES_USERNAME
} from "./config.js";
import { readJsonResponse } from "./http-json.js";

const API_BASE = "https://api.opensubtitles.com/api/v1";
const TOKEN_TTL_MS = 50 * 60 * 1000;
const DOWNLOAD_LINK_TTL_MS = 10 * 60 * 1000;

let cachedToken = "";
let tokenExpiryMs = 0;
let loginPromise = null;
const downloadLinkCache = new Map();

function authHeaders(token = "") {
  const headers = {
    "Api-Key": OPENSUBTITLES_API_KEY,
    "User-Agent": OPENSUBTITLES_USER_AGENT,
    Accept: "application/json"
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function opensubFetch(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    const message =
      payload?.message ||
      payload?.errors?.[0]?.detail ||
      payload?.errors?.[0]?.title ||
      `OpenSubtitles HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

export async function getOpenSubtitlesToken(logger) {
  const now = Date.now();
  if (cachedToken && tokenExpiryMs > now) return cachedToken;
  if (!OPENSUBTITLES_USERNAME || !OPENSUBTITLES_PASSWORD) return "";
  if (loginPromise) return loginPromise;

  loginPromise = (async () => {
    const payload = await opensubFetch("/login", {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username: OPENSUBTITLES_USERNAME,
        password: OPENSUBTITLES_PASSWORD
      })
    });
    const token = String(payload?.token || "").trim();
    if (!token) throw new Error("OpenSubtitles login succeeded without token");
    cachedToken = token;
    tokenExpiryMs = Date.now() + TOKEN_TTL_MS;
    if (logger) logger("OpenSubtitles token cached", { hasToken: true });
    return token;
  })();

  try {
    return await loginPromise;
  } finally {
    loginPromise = null;
  }
}

function getFileId(item) {
  const files = item?.attributes?.files;
  if (!Array.isArray(files) || !files.length) return "";
  const id = files[0]?.file_id;
  return id ? String(id) : "";
}

async function resolveDownloadLink(fileId, token) {
  if (!fileId) return "";
  const cached = downloadLinkCache.get(fileId);
  if (cached && cached.expiresAt > Date.now()) return cached.link;

  const payload = await opensubFetch("/download", {
    method: "POST",
    headers: {
      ...authHeaders(token),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ file_id: Number(fileId) })
  });

  const raw = String(payload?.link || "").trim();
  const link = sanitizeOpenSubtitlesDirectDownloadUrl(raw);
  if (link) {
    downloadLinkCache.set(fileId, {
      link,
      expiresAt: Date.now() + DOWNLOAD_LINK_TTL_MS
    });
  }
  return link;
}

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

export function mapOpenSubtitlesItem(item, downloadUrl, fallbackLang) {
  const attr = item?.attributes || {};
  const releaseName =
    attr.release || attr.feature_details?.title || attr.files?.[0]?.file_name || "Subtitle";
  const uploader = attr.uploader?.name || "";
  const language = attr.language || fallbackLang || "";
  const releases = Array.isArray(attr.moviehash_match)
    ? attr.moviehash_match
    : Array.isArray(attr.files)
      ? attr.files.map((f) => f?.file_name).filter(Boolean)
      : [];
  const fileId = getFileId(item);
  const direct = sanitizeOpenSubtitlesDirectDownloadUrl(String(downloadUrl || "").trim());
  const sourcePageUrl = opensubtitlesSourcePageUrlFromItem(item);
  let opensubtitlesLinkKind = "none";
  if (direct) opensubtitlesLinkKind = "direct";
  else if (sourcePageUrl) opensubtitlesLinkKind = "source_page_only";
  return {
    provider: "opensubtitles",
    id: String(item?.id || fileId || releaseName),
    language: String(language).toUpperCase(),
    releaseName,
    author: uploader,
    hearingImpaired: Boolean(attr.hearing_impaired),
    downloadUrl: direct,
    opensubtitlesFileId: fileId,
    opensubtitlesSourcePageUrl: sourcePageUrl,
    opensubtitlesLinkKind,
    opensubtitlesResolvedDownloadUrl: direct,
    opensubtitlesResolveOnClickUsed: false,
    opensubtitlesResolveFailureReason: "",
    comment: attr.comments || "",
    season: attr.feature_details?.season_number || "",
    episode: attr.feature_details?.episode_number || "",
    releases
  };
}

export async function searchOpenSubtitles(params, logger) {
  const {
    tmdbId,
    mediaType,
    language,
    season,
    episode,
    year
  } = params;
  if (!OPENSUBTITLES_API_KEY) throw new Error("OpenSubtitles API key not configured");

  let token = "";
  try {
    token = await getOpenSubtitlesToken(logger);
  } catch (error) {
    if (logger) logger("OpenSubtitles login failed; continuing with API key only", {
      error: error.message
    });
  }

  const url = new URL(`${API_BASE}/subtitles`);
  url.searchParams.set("tmdb_id", String(tmdbId));
  url.searchParams.set("type", mediaType);
  if (language) url.searchParams.set("languages", String(language));
  if (year) url.searchParams.set("year", String(year));
  if (mediaType === "tv" && season) url.searchParams.set("season_number", String(season));
  if (mediaType === "tv" && episode) url.searchParams.set("episode_number", String(episode));
  url.searchParams.set("order_by", "download_count");
  url.searchParams.set("order_direction", "desc");

  const response = await fetch(url, {
    headers: authHeaders(token)
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    const message =
      payload?.message ||
      payload?.errors?.[0]?.detail ||
      payload?.errors?.[0]?.title ||
      `OpenSubtitles HTTP ${response.status}`;
    throw new Error(message);
  }

  const items = Array.isArray(payload?.data) ? payload.data.slice(0, 30) : [];
  const results = [];
  for (const item of items) {
    try {
      const fileId = getFileId(item);
      const link = await resolveDownloadLink(fileId, token);
      const mapped = mapOpenSubtitlesItem(item, link, language);
      if (mapped.downloadUrl) results.push(mapped);
    } catch (error) {
      if (logger) {
        logger("OpenSubtitles item download link failed", {
          itemId: item?.id,
          error: error.message
        });
      }
    }
  }
  return results;
}
