/**
 * HTTP smoke + subtitle regression pack (requires live Netlify dev or deployed site).
 *
 * Run:
 *   npm run smoke
 *   BASE_URL=https://your-site.netlify.app npm run smoke
 *   npm run smoke:local
 *
 * Optional:
 *   SMOKE_DIAGNOSTICS=1     — append diagnostics=1 to subtitle requests (slower); assert pipeline shapes.
 *   SMOKE_TV_TMDB_ID=1396   — override TV show TMDb id (default: Breaking Bad).
 *   SMOKE_MOVIE_TMDB_ID=157336 — override movie id for provider/language matrix (default: Interstellar).
 *
 * Unit tests (no network): npm test
 */
const BASE_URL = process.env.BASE_URL || "http://localhost:8888";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 20000);
const SLOW_TIMEOUT_MS = Number(process.env.SMOKE_SLOW_TIMEOUT_MS || 45000);
const VERY_SLOW_MS = Number(process.env.SMOKE_VERY_SLOW_TIMEOUT_MS || 90000);
const WANT_DIAG = String(process.env.SMOKE_DIAGNOSTICS || "").trim() === "1";

const MOVIE_MATRIX_TMDB = Number(process.env.SMOKE_MOVIE_TMDB_ID || 157336);
const TV_FIXED_TMDB = Number(process.env.SMOKE_TV_TMDB_ID || 1396);

const ALLOWED_PROVIDER_HEALTH_TIERS = new Set([
  "full",
  "focused",
  "partial_outage",
  "partial_outage_empty",
  "partial_catalog",
  "sparse",
  "no_matches_upstream",
  "unavailable"
]);

let lastRequestUrl = "";

function isAbortError(err) {
  return (
    err?.name === "AbortError" ||
    (typeof err?.message === "string" && /aborted/i.test(err.message))
  );
}

async function request(path, { timeoutMs = TIMEOUT_MS } = {}) {
  const url = `${BASE_URL}${path}`;
  lastRequestUrl = url;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json,text/html" },
      signal: ctrl.signal
    });
    const text = await res.text();
    const elapsed = Date.now() - started;
    if (elapsed > 8000) {
      console.log(`  (slow response: ${elapsed}ms for ${path.split("?")[0]})`);
    }
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { res, text, json, elapsedMs: elapsed };
  } catch (err) {
    const elapsed = Date.now() - started;
    if (isAbortError(err)) {
      const e = new Error(`TIMEOUT after ${timeoutMs}ms (waited ${elapsed}ms) — ${url}`);
      e.code = "TIMEOUT";
      e.url = url;
      e.timeoutMs = timeoutMs;
      throw e;
    }
    const e = new Error(`${err?.message || err} — ${url}`);
    e.code = "FETCH_ERROR";
    e.url = url;
    e.cause = err;
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function subtitlesQuery(baseParams) {
  const p = new URLSearchParams(baseParams);
  return `/.netlify/functions/subtitles?${p.toString()}`;
}

/** Every successful subtitles JSON should carry a stable providerHealth contract. */
function assertProviderHealthContract(json) {
  assert(json?.ok === true, "expected ok:true");
  const ph = json.providerHealth;
  assert(ph && typeof ph === "object", "providerHealth object missing on subtitles 200");
  assert(typeof ph.tier === "string" && ALLOWED_PROVIDER_HEALTH_TIERS.has(ph.tier), `invalid providerHealth.tier: ${ph.tier}`);
  assert(Array.isArray(ph.requestedProviders), "providerHealth.requestedProviders missing");
  assert(Array.isArray(ph.failedProviders), "providerHealth.failedProviders missing");
  assert(Array.isArray(ph.succeededProviders), "providerHealth.succeededProviders missing");
  assert(Array.isArray(ph.providersWithData), "providerHealth.providersWithData missing");
}

function assertEpisodeMainListExactOnly(json) {
  if (!json?.ok || json.tvQueryMode !== "episode") return;
  const list = json.subtitles;
  if (!Array.isArray(list) || !list.length) return;
  for (const s of list) {
    assert(
      s.tvMatchKind === "exactEpisode",
      `episode mode main list must be exactEpisode only, got ${s.tvMatchKind}`
    );
  }
}

function assertSeasonMainListKinds(json) {
  if (!json?.ok || json.tvQueryMode !== "season") return;
  const list = json.subtitles;
  if (!Array.isArray(list) || !list.length) return;
  for (const s of list) {
    assert(
      s.tvMatchKind === "seasonPack" || s.tvMatchKind === "seasonScoped",
      `season mode unexpected tvMatchKind ${s.tvMatchKind}`
    );
    assert(s.tvMatchKind !== "exactEpisode", "season mode must not return exactEpisode in main list");
  }
}

function passDetail(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value.results)) return `results=${value.results.length}`;
  if (Array.isArray(value.subtitles)) return `subtitles=${value.subtitles.length}`;
  if (value.tmdbId != null && value.mediaType != null) return `tmdbId=${value.tmdbId}`;
  return "";
}

async function run() {
  const out = [];

  const step = async (name, fn) => {
    console.log(`→ ${name}`);
    lastRequestUrl = "";
    try {
      const value = await fn();
      const detail = passDetail(value);
      const suffix = detail ? ` - ${detail}` : "";
      out.push(`PASS ${name}${suffix}`);
      return value;
    } catch (error) {
      console.error(`FAIL ${name}`);
      if (lastRequestUrl) console.error(`  Request URL: ${lastRequestUrl}`);
      if (error.code === "TIMEOUT") {
        console.error(`  Reason: timeout (limit ${error.timeoutMs}ms)`);
      } else if (error.code === "FETCH_ERROR") {
        console.error(`  Reason: network/fetch error (not timeout)`);
      } else {
        console.error(`  Reason: ${error.message}`);
      }
      out.push(`FAIL ${name} - ${error.message}`);
      throw error;
    }
  };

  const note = async (name, fn) => {
    console.log(`→ ${name} (informational)`);
    try {
      const v = await fn();
      out.push(`NOTE ${name}: ${v}`);
      return v;
    } catch (e) {
      out.push(`NOTE ${name}: ${e.message}`);
      return null;
    }
  };

  await step("homepage loads", async () => {
    const { res, text } = await request("/");
    assert(res.ok, `status ${res.status}`);
    assert(/Subtitle Hub/i.test(text), "missing app title");
    return "HTML rendered";
  });

  await step("health endpoint works", async () => {
    const { res, json } = await request("/.netlify/functions/health");
    assert(res.ok, `status ${res.status}`);
    assert(json?.ok === true, "health not ok");
    return "ok=true";
  });

  await step("suggestions work (may be slower: TMDb)", async () => {
    const { res, json } = await request(
      "/.netlify/functions/suggestions?query=doctor&type=multi&limit=5",
      { timeoutMs: SLOW_TIMEOUT_MS }
    );
    assert(res.ok, `status ${res.status}`);
    assert(Array.isArray(json?.items), "items missing");
    return `count=${json.items.length}`;
  });

  const searchData = await step("search works (may be slower: multi-page TMDb)", async () => {
    const { res, json } = await request(
      "/.netlify/functions/search-media?query=interstellar&type=multi",
      { timeoutMs: SLOW_TIMEOUT_MS }
    );
    assert(res.ok, `status ${res.status}`);
    assert(Array.isArray(json?.results), "results missing");
    assert(json.results.length > 0, "empty results");
    return json;
  });

  const media = searchData.results.find((i) => i?.tmdbId && i?.mediaType) || searchData.results[0];
  assert(media, "no media from search");

  await step("media details page works", async () => {
    const { res, json } = await request(
      `/.netlify/functions/media-details?tmdbId=${encodeURIComponent(media.tmdbId)}&mediaType=${encodeURIComponent(media.mediaType)}`,
      { timeoutMs: SLOW_TIMEOUT_MS }
    );
    assert(res.ok, `status ${res.status}`);
    assert(json?.ok === true && json?.media?.tmdbId, "media payload missing");
    return `tmdbId=${json.media.tmdbId}`;
  });

  await step("subtitle: movie with results (search-derived media, provider=all)", async () => {
    const { res, json } = await request(
      subtitlesQuery({
        tmdbId: String(media.tmdbId),
        mediaType: "movie",
        provider: "all"
      }),
      { timeoutMs: SLOW_TIMEOUT_MS }
    );
    assert([200, 502].includes(res.status), `unexpected status ${res.status}`);
    if (res.status === 200) {
      assertProviderHealthContract(json);
      assert(Array.isArray(json.subtitles), "subtitles missing");
      assert(json.subtitles.length > 0, "expected subtitles for search-derived movie");
      assert(json.tvQueryMode == null || json.tvQueryMode === undefined, "movie must not set tvQueryMode");
    } else {
      assert(json?.error, "expected provider failure message");
    }
    return json;
  });

  await step("subtitle: movie Interstellar matrix — provider=all + providerHealth", async () => {
    const { res, json } = await request(
      subtitlesQuery({ tmdbId: String(MOVIE_MATRIX_TMDB), mediaType: "movie", provider: "all" }),
      { timeoutMs: SLOW_TIMEOUT_MS }
    );
    assert([200, 502].includes(res.status), `status ${res.status}`);
    if (res.status !== 200) return json;
    assertProviderHealthContract(json);
    assert(Array.isArray(json.subtitles), "subtitles missing");
    assert(json.subtitles.length > 0, `expected movie ${MOVIE_MATRIX_TMDB} to have subtitle rows`);
    return json;
  });

  await step("subtitle: movie Interstellar — provider=subdl", async () => {
    const { res, json } = await request(
      subtitlesQuery({ tmdbId: String(MOVIE_MATRIX_TMDB), mediaType: "movie", provider: "subdl" }),
      { timeoutMs: SLOW_TIMEOUT_MS }
    );
    assert([200, 502].includes(res.status), `status ${res.status}`);
    if (res.status !== 200) return json;
    assertProviderHealthContract(json);
    assert(json.providerHealth.tier === "focused", `expected focused tier, got ${json.providerHealth.tier}`);
    assert(
      JSON.stringify(json.providerHealth.requestedProviders) === JSON.stringify(["subdl"]),
      "requestedProviders should be [subdl]"
    );
    for (const s of json.subtitles) {
      assert(String(s.provider || "").toLowerCase() === "subdl", "subdl filter leaked other provider");
    }
    return json;
  });

  await step("subtitle: movie Interstellar — provider=opensubtitles", async () => {
    const { res, json } = await request(
      subtitlesQuery({ tmdbId: String(MOVIE_MATRIX_TMDB), mediaType: "movie", provider: "opensubtitles" }),
      { timeoutMs: SLOW_TIMEOUT_MS }
    );
    assert([200, 502].includes(res.status), `status ${res.status}`);
    if (res.status !== 200) return json;
    assertProviderHealthContract(json);
    assert(json.providerHealth.tier === "focused", `expected focused tier, got ${json.providerHealth.tier}`);
    assert(
      JSON.stringify(json.providerHealth.requestedProviders) === JSON.stringify(["opensubtitles"]),
      "requestedProviders should be [opensubtitles]"
    );
    for (const s of json.subtitles) {
      assert(String(s.provider || "").toLowerCase() === "opensubtitles", "opensubtitles filter leaked other provider");
    }
    return json;
  });

  await step("subtitle: movie — Arabic-only language=ar", async () => {
    const { res, json } = await request(
      subtitlesQuery({ tmdbId: String(MOVIE_MATRIX_TMDB), mediaType: "movie", provider: "all", language: "ar" }),
      { timeoutMs: SLOW_TIMEOUT_MS }
    );
    assert([200, 502].includes(res.status), `status ${res.status}`);
    if (res.status !== 200) return json;
    assertProviderHealthContract(json);
    assert(Array.isArray(json.subtitles), "subtitles missing");
    return json;
  });

  await step("subtitle: movie — all languages (no language param)", async () => {
    const { res, json } = await request(
      subtitlesQuery({ tmdbId: String(MOVIE_MATRIX_TMDB), mediaType: "movie", provider: "all" }),
      { timeoutMs: SLOW_TIMEOUT_MS }
    );
    assert([200, 502].includes(res.status), `status ${res.status}`);
    if (res.status !== 200) return json;
    assertProviderHealthContract(json);
    return json;
  });

  await step("subtitle: movie sparse or empty — providerHealth tier consistency", async () => {
    const { res, json } = await request(
      subtitlesQuery({ tmdbId: "945729", mediaType: "movie", provider: "all" }),
      { timeoutMs: SLOW_TIMEOUT_MS }
    );
    assert([200, 502].includes(res.status), `status ${res.status}`);
    if (res.status !== 200) return json;
    assertProviderHealthContract(json);
    const n = json.subtitles.length;
    if (n === 0) {
      assert(
        json.providerHealth.tier === "no_matches_upstream" || json.providerHealth.tier === "partial_catalog",
        `expected no_matches_upstream or partial_catalog when zero rows, got ${json.providerHealth.tier}`
      );
    } else if (n <= 4 && json.providerHealth.providersWithData.length >= 2) {
      assert(json.providerHealth.tier === "sparse", "short list with both providers should be sparse tier");
    }
    return `n=${n} tier=${json.providerHealth.tier}`;
  });

  const tvSearch = await step("tv search works", async () => {
    const { res, json } = await request(
      "/.netlify/functions/search-media?query=breaking%20bad&type=tv",
      { timeoutMs: SLOW_TIMEOUT_MS }
    );
    assert(res.ok, `status ${res.status}`);
    const first = (json?.results || []).find((r) => r.mediaType === "tv");
    assert(first?.tmdbId, "no tv match");
    return first;
  });

  const tvTmdbId = String(tvSearch.tmdbId || TV_FIXED_TMDB);

  await step("tv subtitles require season (no misleading search without season)", async () => {
    const { res, json } = await request(`/.netlify/functions/subtitles?tmdbId=${encodeURIComponent(tvTmdbId)}&mediaType=tv&provider=all`);
    assert(res.status === 400, `status ${res.status}`);
    const needsSeason =
      json?.code === "tv_needs_season" || (Array.isArray(json?.missing) && json.missing.includes("season"));
    assert(needsSeason, "tv_needs_season not reported");
    return "guard validated";
  });

  const tvSeasonJson = await step("tv: season mode — tvQueryMode + seasonPack/seasonScoped only in main list", async () => {
    const { res, json } = await request(
      subtitlesQuery({ tmdbId: tvTmdbId, mediaType: "tv", season: "1", provider: "all" }),
      { timeoutMs: SLOW_TIMEOUT_MS }
    );
    assert([200, 502].includes(res.status), `status ${res.status}`);
    if (res.status === 200) {
      assertProviderHealthContract(json);
      assert(json.tvQueryMode === "season", "expected tvQueryMode season");
      assertSeasonMainListKinds(json);
    }
    return json;
  });

  const tvEpJson = await step("tv: episode mode — exactEpisode-only main list + alternates array shape", async () => {
    const { res, json } = await request(
      subtitlesQuery({
        tmdbId: tvTmdbId,
        mediaType: "tv",
        season: "1",
        episode: "1",
        provider: "all",
        fileName: "Breaking.Bad.S01E01.1080p.WEB-DL"
      }),
      { timeoutMs: SLOW_TIMEOUT_MS }
    );
    assert([200, 502].includes(res.status), `status ${res.status}`);
    if (res.status === 200) {
      assertProviderHealthContract(json);
      assert(json.tvQueryMode === "episode", "expected tvQueryMode episode");
      assertEpisodeMainListExactOnly(json);
      assert(Array.isArray(json.alternateSubtitles), "alternateSubtitles must be an array");
    }
    return json;
  });

  await step("tv: fixed TMDb id season mode (SMOKE_TV_TMDB_ID)", async () => {
    const { res, json } = await request(
      subtitlesQuery({ tmdbId: String(TV_FIXED_TMDB), mediaType: "tv", season: "1", provider: "all" }),
      { timeoutMs: SLOW_TIMEOUT_MS }
    );
    assert([200, 502].includes(res.status), `status ${res.status}`);
    if (res.status === 200) {
      assertProviderHealthContract(json);
      assert(json.tvQueryMode === "season", "expected tvQueryMode season (fixed id)");
      assertSeasonMainListKinds(json);
    }
    return json;
  });

  await step("partial provider outage: tier + usable results", async () => {
    const j = tvEpJson?.ok ? tvEpJson : tvSeasonJson;
    if (!j?.ok) return "skipped (no prior tv success json)";
    const errs = j.providerErrors || [];
    const subs = j.subtitles || [];
    if (errs.length === 1 && subs.length > 0) {
      assert(j.providerHealth.tier === "partial_outage", "one error + rows => partial_outage");
    }
    if (errs.length === 0 && subs.length > 0) {
      assert(
        j.providerHealth.tier === "full" || j.providerHealth.tier === "partial_catalog" || j.providerHealth.tier === "sparse",
        `unexpected tier ${j.providerHealth.tier} when both providers up`
      );
    }
    return `errors=${errs.length} subs=${subs.length} tier=${j.providerHealth?.tier}`;
  });

  await step("download URL present when subtitles exist", async () => {
    const j = tvEpJson?.ok && Array.isArray(tvEpJson.subtitles) && tvEpJson.subtitles.length ? tvEpJson : null;
    if (!j) return "skipped (no episode subtitles)";
    const first = j.subtitles.find((s) => String(s.downloadUrl || "").startsWith("http"));
    assert(Boolean(first), "no valid downloadUrl");
    return "downloadUrl present";
  });

  if (WANT_DIAG) {
    await step("diagnostics: episode mode includes pipeline traces", async () => {
      const { res, json } = await request(
        `/.netlify/functions/subtitles?tmdbId=${encodeURIComponent(tvTmdbId)}&mediaType=tv&season=1&episode=1&provider=all&diagnostics=1`,
        { timeoutMs: VERY_SLOW_MS }
      );
      assert(res.status === 200, `status ${res.status}`);
      assert(json?.diagnostics && typeof json.diagnostics === "object", "diagnostics object missing");
      assert(json.diagnostics.subdlTrace || json.diagnostics.opensubtitlesTrace, "expected provider traces");
      assertProviderHealthContract(json);
      return "diagnostics ok";
    });

    await note("diagnostics: SubDL HTML fallback flag (observed when API path is thin)", async () => {
      const { res, json } = await request(
        `/.netlify/functions/subtitles?tmdbId=${encodeURIComponent(tvTmdbId)}&mediaType=tv&season=1&provider=all&language=ar&diagnostics=1`,
        { timeoutMs: VERY_SLOW_MS }
      );
      if (res.status !== 200) return `skip status ${res.status}`;
      const used = Boolean(json?.diagnostics?.subdlTrace?.htmlFallbackUsed);
      return used
        ? "htmlFallbackUsed=true"
        : "htmlFallbackUsed=false (still valid — depends on catalog)";
    });

    await note("diagnostics: OpenSubtitles TV identity rejects (wrong-show protection)", async () => {
      const { res, json } = await request(
        `/.netlify/functions/subtitles?tmdbId=${encodeURIComponent(tvTmdbId)}&mediaType=tv&season=1&episode=1&provider=all&diagnostics=1`,
        { timeoutMs: VERY_SLOW_MS }
      );
      if (res.status !== 200) return `skip status ${res.status}`;
      const n = Number(json?.diagnostics?.opensubtitlesTrace?.tvRejectedShowMismatch || 0);
      return n > 0 ? `tvRejectedShowMismatch=${n} (filter active)` : "no show-mismatch rejects this run";
    });
  }

  console.log("");
  for (const line of out) console.log(line);
}

run().catch((error) => {
  if (!error.code) console.error(error.message);
  process.exit(1);
});
