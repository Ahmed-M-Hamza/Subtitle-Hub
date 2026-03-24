import dotenv from "dotenv";

dotenv.config({ quiet: true });

export const APP_NAME =
  String(process.env.APP_NAME || "Subtitle Hub").trim() || "Subtitle Hub";
export const TMDB_BEARER_TOKEN = String(process.env.TMDB_BEARER_TOKEN || "").trim();
export const SUBDL_API_KEY = String(process.env.SUBDL_API_KEY || "").trim();
export const OPENSUBTITLES_API_KEY = String(
  process.env.OPENSUBTITLES_API_KEY || ""
).trim();
export const OPENSUBTITLES_USERNAME = String(
  process.env.OPENSUBTITLES_USERNAME || ""
).trim();
export const OPENSUBTITLES_PASSWORD = String(
  process.env.OPENSUBTITLES_PASSWORD || ""
).trim();
export const OPENSUBTITLES_USER_AGENT = String(
  process.env.OPENSUBTITLES_USER_AGENT || "SubtitleHub v1.0"
).trim();

export const PREFERRED_PORT = Number.parseInt(process.env.PORT || "3000", 10) || 3000;
export const MAX_PORT_BIND_ATTEMPTS =
  Number.parseInt(process.env.PORT_BIND_ATTEMPTS || "10", 10) || 10;

export const TMDB_READY = Boolean(TMDB_BEARER_TOKEN);
export const SUBDL_READY = Boolean(SUBDL_API_KEY);
export const OPENSUBTITLES_READY = Boolean(OPENSUBTITLES_API_KEY);
