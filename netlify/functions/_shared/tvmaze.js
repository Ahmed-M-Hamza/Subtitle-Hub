const TVMAZE_API = "https://api.tvmaze.com";

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid TVMaze JSON (${response.status})`);
  }
}

async function tvmazeFetch(path, searchParams = {}) {
  const url = new URL(`${TVMAZE_API}${path}`);
  for (const [key, value] of Object.entries(searchParams)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (response.status === 404) return null;
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(payload?.message || `TVMaze HTTP ${response.status}`);
  }
  return payload;
}

export async function fetchTvMazeShowByImdb(imdbId) {
  const id = String(imdbId || "").trim();
  if (!id) return null;
  return tvmazeFetch("/lookup/shows", { imdb: id });
}

export async function fetchTvMazeShowByQuery(query) {
  const q = String(query || "").trim();
  if (!q) return [];
  const payload = await tvmazeFetch("/search/shows", { q });
  return Array.isArray(payload) ? payload : [];
}

export async function fetchTvMazeSeasons(showId) {
  const id = String(showId || "").trim();
  if (!id) return [];
  const payload = await tvmazeFetch(`/shows/${encodeURIComponent(id)}/seasons`);
  return Array.isArray(payload) ? payload : [];
}

export async function fetchTvMazeEpisodeByNumber(showId, season, episode) {
  const id = String(showId || "").trim();
  if (!id) return null;
  const s = String(season || "").trim();
  const e = String(episode || "").trim();
  if (!s || !e) return null;
  return tvmazeFetch(`/shows/${encodeURIComponent(id)}/episodebynumber`, {
    season: s,
    number: e
  });
}

