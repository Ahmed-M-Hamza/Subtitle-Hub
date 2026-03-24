import { TMDB_BEARER_TOKEN } from "./config.js";
import { readJsonResponse } from "./http-json.js";

function tmdbErrorMessage(payload, httpStatus) {
  if (!payload || typeof payload !== "object") {
    return `TMDb request failed (${httpStatus})`;
  }
  if (typeof payload.status_message === "string" && payload.status_message) {
    return payload.status_message;
  }
  const err = payload.errors;
  if (typeof err === "string") return err;
  if (Array.isArray(err) && err.length) return String(err[0]);
  if (err && typeof err === "object") {
    const firstKey = Object.keys(err)[0];
    if (firstKey && Array.isArray(err[firstKey]) && err[firstKey][0]) {
      return String(err[firstKey][0]);
    }
  }
  return `TMDb request failed (${httpStatus})`;
}

export async function tmdbFetch(path, searchParams = {}) {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  for (const [key, value] of Object.entries(searchParams)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TMDB_BEARER_TOKEN}`,
      Accept: "application/json"
    }
  });

  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(tmdbErrorMessage(payload, response.status));
  }

  return payload;
}

function mapSearchItem(filterType, item) {
  const mediaType = filterType === "multi" ? item.media_type : filterType;
  const title =
    mediaType === "movie"
      ? item.title || item.name || "—"
      : item.name || item.title || "—";
  const date = mediaType === "movie" ? item.release_date : item.first_air_date;
  const posterPath = item.poster_path
    ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
    : "";

  return {
    id: item.id,
    mediaType,
    title,
    year: date ? String(date).slice(0, 4) : "",
    overview: item.overview || "",
    poster: posterPath,
    tmdbId: item.id
  };
}

export async function searchTmdb(query, typeRaw, year) {
  const allowedTypes = new Set(["multi", "movie", "tv"]);
  const type = allowedTypes.has(typeRaw) ? typeRaw : "multi";

  let endpoint = "/search/multi";
  if (type === "movie") endpoint = "/search/movie";
  if (type === "tv") endpoint = "/search/tv";

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
    .map((item) => mapSearchItem(type, item));
}

export async function getMediaDetails(mediaType, tmdbId) {
  const id = String(tmdbId);
  if (mediaType === "movie") {
    const m = await tmdbFetch(`/movie/${id}`, { language: "ar-SA" });
    const date = m.release_date || "";
    return {
      mediaType: "movie",
      tmdbId: m.id,
      title: m.title || "—",
      year: date ? String(date).slice(0, 4) : "",
      overview: m.overview || "",
      poster: m.poster_path
        ? `https://image.tmdb.org/t/p/w500${m.poster_path}`
        : ""
    };
  }

  const t = await tmdbFetch(`/tv/${id}`, { language: "ar-SA" });
  const date = t.first_air_date || "";
  return {
    mediaType: "tv",
    tmdbId: t.id,
    title: t.name || "—",
    year: date ? String(date).slice(0, 4) : "",
    overview: t.overview || "",
    poster: t.poster_path
      ? `https://image.tmdb.org/t/p/w500${t.poster_path}`
      : ""
  };
}
