import { SUBDL_API_KEY } from "./config.js";
import { readJsonResponse } from "./http-json.js";

export function normalizeSubdlDownloadUrl(url) {
  const u = String(url || "").trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("/")) return "https://dl.subdl.com" + u;
  return "https://dl.subdl.com/" + u;
}

export async function subdlFetch(searchParams = {}) {
  const url = new URL("https://api.subdl.com/api/v1/subtitles");
  url.searchParams.set("api_key", SUBDL_API_KEY);

  for (const [key, value] of Object.entries(searchParams)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    headers: { Accept: "application/json" }
  });

  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error((payload && payload.error) || `SubDL HTTP ${response.status}`);
  }

  if (payload && payload.status === false) {
    throw new Error(payload.error || "SubDL reported an error");
  }

  return payload;
}

export function mapSubdlSubtitles(payload, defaultLang) {
  const rawList = payload.subtitles || payload.data || [];
  return rawList
    .map((sub) => ({
      provider: "subdl",
      id: String(sub.id || sub.sd_id || `${sub.url}-${sub.release_name || "sub"}`),
      language: sub.language || sub.lang || defaultLang,
      releaseName: sub.release_name || sub.release || sub.name || "Subtitle",
      author: sub.author || sub.uploader || "",
      hearingImpaired: Boolean(sub.hi),
      downloadUrl: normalizeSubdlDownloadUrl(
        sub.url || sub.download_link || sub.download_url || ""
      ),
      comment: sub.comment || "",
      season: sub.season || "",
      episode: sub.episode || "",
      releases: sub.releases || []
    }))
    .filter((sub) => sub.downloadUrl);
}

export function buildSubdlParams({
  tmdbId,
  mediaType,
  languages,
  season,
  episode,
  year
}) {
  return {
    tmdb_id: tmdbId,
    type: mediaType,
    languages,
    season_number: mediaType === "tv" ? season : undefined,
    episode_number: mediaType === "tv" ? episode : undefined,
    year,
    subs_per_page: 30,
    comment: 1,
    releases: 1,
    hi: 1
  };
}
