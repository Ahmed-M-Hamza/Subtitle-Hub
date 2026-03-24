import express from "express";
import expressLayouts from "express-ejs-layouts";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  APP_NAME,
  MAX_PORT_BIND_ATTEMPTS,
  OPENSUBTITLES_READY,
  PREFERRED_PORT,
  SUBDL_READY,
  TMDB_READY
} from "./lib/config.js";
import { normalizeLanguageCode } from "./lib/lang.js";
import { getMediaDetails, searchTmdb } from "./lib/tmdb.js";
import {
  aggregateSubtitles,
  normalizeProviderFilter
} from "./lib/subtitle-aggregator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let pkgVersion = "1.0.0";
try {
  pkgVersion =
    JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8")).version ||
    pkgVersion;
} catch {
  /* ignore */
}

const app = express();

let listenPort = PREFERRED_PORT;

app.set("views", join(__dirname, "views"));
app.set("view engine", "ejs");
app.use(expressLayouts);
app.set("layout", "layouts/main");

app.use(express.json());
app.use(express.static(join(__dirname, "public")));

app.use((req, res, next) => {
  res.locals.appName = APP_NAME;
  res.locals.currentPath = req.path;
  next();
});

function logInfo(message, meta = {}) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      message,
      ...meta
    })
  );
}

function logError(message, err, meta = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level: "error",
    message,
    ...meta
  };
  if (err && err.message) payload.error = err.message;
  if (err && err.stack && process.env.NODE_ENV !== "production") {
    payload.stack = err.stack;
  }
  console.error(JSON.stringify(payload));
}

function registerProcessDiagnostics() {
  process.on("beforeExit", (code) => {
    logInfo("[diag] process.beforeExit", { exitCode: code });
  });
  process.on("exit", (code) => {
    try {
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "debug",
          message: "[diag] process.exit",
          code
        })
      );
    } catch {
      /* ignore */
    }
  });
  process.on("uncaughtException", (err, origin) => {
    logError("[diag] process.uncaughtException", err, {
      origin: String(origin)
    });
  });
  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logError("[diag] process.unhandledRejection", err, {});
  });
}

registerProcessDiagnostics();

function requireEnvJson(res) {
  const missing = [];
  if (!TMDB_READY) missing.push("TMDB_BEARER_TOKEN");
  if (!SUBDL_READY && !OPENSUBTITLES_READY) {
    missing.push("SUBDL_API_KEY or OPENSUBTITLES_API_KEY");
  }
  if (missing.length) {
    logError("API blocked: missing environment variables", null, {
      missing,
      tmdbConfigured: TMDB_READY,
      subdlConfigured: SUBDL_READY,
      opensubtitlesConfigured: OPENSUBTITLES_READY
    });
    res.status(503).json({
      ok: false,
      error: "Missing environment variables",
      missing,
      hint: "Create a .env file with TMDB_BEARER_TOKEN and at least one subtitle provider key."
    });
    return false;
  }
  return true;
}

function sendRouteError(res, status, publicMessage, err, context = {}) {
  logError(publicMessage, err, context);
  res.status(status).json({
    ok: false,
    error: publicMessage
  });
}

function parseSearchType(raw) {
  const typeRaw = String(raw || "multi").trim().toLowerCase();
  const allowed = new Set(["multi", "movie", "tv"]);
  return allowed.has(typeRaw) ? typeRaw : "multi";
}

function parseMediaTypeParam(raw) {
  const t = String(raw || "").trim().toLowerCase();
  return t === "tv" ? "tv" : "movie";
}

function isValidMediaTypeSegment(raw) {
  const t = String(raw || "").trim().toLowerCase();
  return t === "movie" || t === "tv";
}

function isNumericId(id) {
  return /^\d+$/.test(String(id || ""));
}

/* ——— API ——— */

app.get("/api/health", (_req, res) => {
  const tmdbConfigured = TMDB_READY;
  const subdlConfigured = SUBDL_READY;
  const opensubtitlesConfigured = OPENSUBTITLES_READY;
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ok: true,
    app: APP_NAME,
    version: pkgVersion,
    timestamp: new Date().toISOString(),
    port: listenPort,
    preferredPort: PREFERRED_PORT,
    ready: tmdbConfigured && (subdlConfigured || opensubtitlesConfigured),
    tmdbConfigured,
    subdlConfigured,
    opensubtitlesConfigured
  });
});

app.get("/api/search-media", async (req, res, next) => {
  if (!requireEnvJson(res)) return;
  try {
    const query = String(req.query.query || "").trim();
    const type = parseSearchType(req.query.type);
    const year = String(req.query.year || "").trim();
    if (!query) {
      return res.status(400).json({ ok: false, error: "query is required" });
    }
    const results = await searchTmdb(query, type, year);
    res.json({ ok: true, results });
  } catch (error) {
    next(error);
  }
});

app.get("/api/subtitles", async (req, res, next) => {
  if (!requireEnvJson(res)) return;
  try {
    const tmdbId = String(req.query.tmdbId || "").trim();
    const mediaType = parseMediaTypeParam(req.query.mediaType);
    const languages = normalizeLanguageCode(req.query.language || "ar");
    const season = String(req.query.season || "").trim();
    const episode = String(req.query.episode || "").trim();
    const year = String(req.query.year || "").trim();
    const provider = normalizeProviderFilter(req.query.provider);
    if (!tmdbId) {
      return res.status(400).json({ ok: false, error: "tmdbId is required" });
    }
    const agg = await aggregateSubtitles(
      {
        tmdbId,
        mediaType,
        language: languages,
        season,
        episode,
        year,
        provider
      },
      {
        log: (message, meta) => logError(message, null, meta)
      }
    );
    if (agg.allFailed) {
      return res.status(502).json({
        ok: false,
        error: "All subtitle providers failed",
        providerErrors: agg.providerErrors
      });
    }
    res.json({
      ok: true,
      provider: agg.providerFilter,
      providerErrors: agg.providerErrors,
      subtitles: agg.subtitles
    });
  } catch (error) {
    next(error);
  }
});

/* ——— Pages ——— */

app.get("/", (_req, res) => {
  res.render("home", { title: "الرئيسية" });
});

app.get("/search", async (req, res, next) => {
  const query = String(req.query.query || "").trim();
  const searchType = parseSearchType(req.query.type);
  const year = String(req.query.year || "").trim();
  let results = [];
  let searchError = null;
  let configHint = null;

  if (!TMDB_READY) {
    configHint =
      "مفتاح TMDb غير مضبوط (TMDB_BEARER_TOKEN). أضفه إلى ملف .env لتفعيل البحث.";
  } else if (query) {
    try {
      results = await searchTmdb(query, searchType, year);
    } catch (e) {
      searchError = e.message || "فشل البحث";
      logError("Page search failed", e, { query, searchType });
    }
  }

  res.render("search", {
    title: "البحث",
    query,
    searchType,
    year,
    results,
    searchError,
    configHint
  });
});

app.get("/media/:type/:tmdbId/subtitles", async (req, res, next) => {
  if (!isValidMediaTypeSegment(req.params.type)) {
    return res.status(404).render("404", { title: "غير موجود" });
  }
  const mediaType = parseMediaTypeParam(req.params.type);
  const tmdbId = String(req.params.tmdbId || "").trim();
  if (!isNumericId(tmdbId)) {
    return res.status(404).render("404", { title: "غير موجود" });
  }
  if (!TMDB_READY || (!SUBDL_READY && !OPENSUBTITLES_READY)) {
    return res.status(503).render("config-missing", {
      title: "إعداد ناقص",
      message:
        "يلزم TMDB_BEARER_TOKEN ومعه SUBDL_API_KEY أو OPENSUBTITLES_API_KEY في ملف .env لجلب الترجمات."
    });
  }

  const language = normalizeLanguageCode(req.query.language || "ar");
  const provider = normalizeProviderFilter(req.query.provider);
  const season = String(req.query.season || "").trim();
  const episode = String(req.query.episode || "").trim();
  const year = String(req.query.year || "").trim();

  let media = null;
  let subtitles = [];
  let subtitlesError = null;

  try {
    media = await getMediaDetails(mediaType, tmdbId);
  } catch (e) {
    logError("TMDb details for subtitle page", e, { mediaType, tmdbId });
  }

  let providerErrors = [];
  try {
    const agg = await aggregateSubtitles(
      {
        tmdbId,
        mediaType,
        language,
        season,
        episode,
        year,
        provider
      },
      {
        log: (message, meta) => logError(message, null, meta)
      }
    );
    subtitles = agg.subtitles;
    providerErrors = agg.providerErrors;
    if (agg.allFailed) {
      subtitlesError = "تعذّر تحميل الترجمة من جميع المزودين.";
    }
  } catch (e) {
    subtitlesError = e.message || "فشل جلب الترجمات";
    logError("Subtitle page aggregate failed", e, { tmdbId, mediaType });
  }

  res.render("subtitles", {
    title: "الترجمات",
    media,
    mediaType,
    tmdbId,
    language,
    season,
    episode,
    year,
    provider,
    subtitles,
    providerErrors,
    subtitlesError
  });
});

app.get("/media/:type/:tmdbId", async (req, res, next) => {
  if (!isValidMediaTypeSegment(req.params.type)) {
    return res.status(404).render("404", { title: "غير موجود" });
  }
  const mediaType = parseMediaTypeParam(req.params.type);
  const tmdbId = String(req.params.tmdbId || "").trim();
  if (!isNumericId(tmdbId)) {
    return res.status(404).render("404", { title: "غير موجود" });
  }
  if (!TMDB_READY) {
    return res.status(503).render("config-missing", {
      title: "إعداد ناقص",
      message: "يلزم TMDB_BEARER_TOKEN في ملف .env لعرض تفاصيل العمل."
    });
  }

  const yearQ = String(req.query.year || "").trim();
  const subtitleLanguage = normalizeLanguageCode(req.query.lang || "ar");
  const subtitleProvider = normalizeProviderFilter(req.query.provider);
  const season = String(req.query.season || "").trim();
  const episode = String(req.query.episode || "").trim();

  try {
    const media = await getMediaDetails(mediaType, tmdbId);
    if (yearQ) media.year = yearQ;
    res.render("media-detail", {
      title: media.title,
      media,
      subtitleLanguage,
      subtitleProvider,
      season,
      episode
    });
  } catch (error) {
    next(error);
  }
});

app.use((req, res) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ ok: false, error: "Not Found" });
  }
  res
    .status(404)
    .render("404", { title: "غير موجود" });
});

app.use((err, req, res, _next) => {
  const route = req.originalUrl || req.url || "";
  if (res.headersSent) {
    logError("Handler error after response started", err, {
      route,
      method: req.method
    });
    return;
  }
  if (req.path.startsWith("/api")) {
    return sendRouteError(
      res,
      500,
      err.message || "Internal server error",
      err,
      { route, method: req.method }
    );
  }
  logError("Page error", err, { route, method: req.method });
  res.status(500).render("error", {
    title: "خطأ",
    message: err.message || "حدث خطأ غير متوقع."
  });
});

let bindAttempt = 0;

function bindListen(port) {
  bindAttempt += 1;
  const server = app.listen(port);

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && bindAttempt < MAX_PORT_BIND_ATTEMPTS) {
      logInfo("[diag] EADDRINUSE, trying next port", {
        busyPort: port,
        nextPort: port + 1,
        attempt: bindAttempt,
        maxAttempts: MAX_PORT_BIND_ATTEMPTS
      });
      server.close(() => bindListen(port + 1));
      return;
    }

    logError("[diag] server.error (listen/socket)", err, { port, code: err.code });

    if (err.code === "EADDRINUSE") {
      const lastTried = PREFERRED_PORT + MAX_PORT_BIND_ATTEMPTS - 1;
      console.error(
        [
          "",
          "تعذّر التشغيل: المنافذ " +
            PREFERRED_PORT +
            "–" +
            lastTried +
            " كلها مستخدمة (EADDRINUSE).",
          "Cannot start: ports " + PREFERRED_PORT + "–" + lastTried + " are all in use.",
          "",
          "  • أوقف العملية على أحد المنافذ:   lsof -i :" + PREFERRED_PORT,
          "  • أو حدّد منفذًا بعيدًا في .env:   PORT=4000",
          "  • أو زِد عدد المحاولات:   PORT_BIND_ATTEMPTS=20",
          ""
        ].join("\n")
      );
    }

    process.exitCode = 1;
  });

  server.on("close", () => {
    logInfo("[diag] server.close", { port, listening: server.listening });
  });

  server.once("listening", () => {
    const addr = server.address();
    if (addr && typeof addr === "object" && "port" in addr) {
      listenPort = addr.port;
    } else {
      listenPort = port;
    }

    if (listenPort !== PREFERRED_PORT) {
      logInfo("Server using alternate port", {
        preferredPort: PREFERRED_PORT,
        listenPort
      });
      console.log(
        "\nالمنفذ " +
          PREFERRED_PORT +
          " مشغول — الخادم يعمل على http://localhost:" +
          listenPort +
          "\nPort " +
          PREFERRED_PORT +
          " was busy — open http://localhost:" +
          listenPort +
          "\n"
      );
    }

    logInfo("Server listening", {
      url: "http://localhost:" + listenPort,
      app: APP_NAME,
      ready: TMDB_READY && (SUBDL_READY || OPENSUBTITLES_READY),
      tmdbConfigured: TMDB_READY,
      subdlConfigured: SUBDL_READY,
      opensubtitlesConfigured: OPENSUBTITLES_READY,
      preferredPort: PREFERRED_PORT,
      listenPort,
      listening: server.listening,
      address: server.address()
    });
  });
}

bindListen(PREFERRED_PORT);
