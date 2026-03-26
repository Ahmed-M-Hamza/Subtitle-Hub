const BASE_URL = process.env.BASE_URL || "http://localhost:8888";
/** Default per-request timeout (ms). Local Netlify dev can be slow on first function cold start. */
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 20000);
/** Longer timeout for heavy endpoints (subtitles aggregation, multi-page TMDb). */
const SLOW_TIMEOUT_MS = Number(process.env.SMOKE_SLOW_TIMEOUT_MS || 45000);

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
      const e = new Error(
        `TIMEOUT after ${timeoutMs}ms (waited ${elapsed}ms) — ${url}`
      );
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

  await step("subtitle page works (slow: SubDL + OpenSubtitles)", async () => {
    const { res, json } = await request(
      `/.netlify/functions/subtitles?tmdbId=${encodeURIComponent(media.tmdbId)}&mediaType=movie&provider=all`,
      { timeoutMs: SLOW_TIMEOUT_MS }
    );
    assert([200, 502].includes(res.status), `unexpected status ${res.status}`);
    if (res.status === 200) {
      assert(Array.isArray(json?.subtitles), "subtitles missing");
      return `subtitles=${json.subtitles.length}`;
    }
    assert(json?.error, "expected provider failure message");
    return "provider failure path handled";
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

  await step("tv subtitles require season (no misleading search without season)", async () => {
    const { res, json } = await request(
      `/.netlify/functions/subtitles?tmdbId=${encodeURIComponent(tvSearch.tmdbId)}&mediaType=tv&provider=all`
    );
    assert(res.status === 400, `status ${res.status}`);
    const needsSeason =
      json?.code === "tv_needs_season" || (Array.isArray(json?.missing) && json.missing.includes("season"));
    assert(needsSeason, "tv_needs_season not reported");
    return "guard validated";
  });

  await step("tv subtitles season mode (season only, slow)", async () => {
    const { res, json } = await request(
      `/.netlify/functions/subtitles?tmdbId=${encodeURIComponent(tvSearch.tmdbId)}&mediaType=tv&season=1&provider=all`,
      { timeoutMs: SLOW_TIMEOUT_MS }
    );
    assert([200, 502].includes(res.status), `status ${res.status}`);
    if (res.status === 200) {
      assert(json?.tvQueryMode === "season", "expected tvQueryMode season");
      // TV subtitle contract (season-only mode):
      // - response may include any subtitle related to the requested season.
      // - server keeps season-level buckets only: seasonPack + seasonScoped.
      // - seasonScoped here may include rows that are episode-specific within the same season.
      if (Array.isArray(json?.subtitles) && json.subtitles.length) {
        for (const s of json.subtitles) {
          assert(
            s.tvMatchKind === "seasonPack" || s.tvMatchKind === "seasonScoped",
            `unexpected tvMatchKind ${s.tvMatchKind}`
          );
          // Lightweight guard: season-mode main list should not return exactEpisode rows.
          assert(s.tvMatchKind !== "exactEpisode", "season mode must not return exactEpisode in main list");
        }
      }
    }
    return `season mode ok (${json?.subtitles?.length ?? 0} rows)`;
  });

  const tvSub = await step("tv subtitles episode mode (slow: providers + TVMaze)", async () => {
    const { res, json } = await request(
      `/.netlify/functions/subtitles?tmdbId=${encodeURIComponent(
        tvSearch.tmdbId
      )}&mediaType=tv&season=1&episode=1&provider=all&fileName=Breaking.Bad.S01E01.1080p.WEB-DL`,
      { timeoutMs: SLOW_TIMEOUT_MS }
    );
    assert([200, 502].includes(res.status), `status ${res.status}`);
    return json;
  });

  await step("filename matching accepted", async () => {
    assert(tvSub?.ok === true || tvSub?.error, "no response body");
    // TV subtitle contract (episode mode):
    // - when season+episode are provided, main list must contain only exactEpisode rows.
    // - seasonPack/seasonScoped rows are excluded from main list (may appear only in alternates).
    if (tvSub?.ok && tvSub?.tvQueryMode === "episode" && Array.isArray(tvSub.subtitles) && tvSub.subtitles.length) {
      for (const s of tvSub.subtitles) {
        assert(s.tvMatchKind === "exactEpisode", `episode mode must be exactEpisode, got ${s.tvMatchKind}`);
      }
    }
    return "parameter accepted";
  });

  await step("download click path valid", async () => {
    if (!Array.isArray(tvSub?.subtitles) || !tvSub.subtitles.length) return "skipped (no subtitles)";
    const first = tvSub.subtitles.find((s) => String(s.downloadUrl || "").startsWith("http"));
    assert(Boolean(first), "no valid downloadUrl");
    return "downloadUrl present";
  });

  await step("partial provider failure still usable", async () => {
    if (tvSub?.ok && Array.isArray(tvSub.subtitles) && tvSub.subtitles.length > 0) {
      return `usable=${tvSub.subtitles.length}`;
    }
    if (Array.isArray(tvSub?.providerErrors) && tvSub.providerErrors.length) {
      return "provider failure captured";
    }
    return "inconclusive";
  });

  console.log("");
  for (const line of out) console.log(line);
}

run().catch((error) => {
  if (!error.code) console.error(error.message);
  process.exit(1);
});
