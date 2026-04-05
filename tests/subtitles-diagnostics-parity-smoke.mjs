/**
 * HTTP smoke: subtitles JSON must match with and without diagnostics=1 (only `diagnostics` may differ on 200).
 *
 * Run (requires live Netlify dev or deployed site):
 *   npm run smoke:parity
 *   BASE_URL=https://example.netlify.app npm run smoke:parity
 *
 * Env (same defaults as tests/smoke.mjs):
 *   SMOKE_MOVIE_TMDB_ID   — default 157336 (Interstellar)
 *   SMOKE_TV_TMDB_ID      — default 1396 (Breaking Bad)
 *   SMOKE_SLOW_TIMEOUT_MS — default 45000
 */
import assert from "node:assert/strict";

const BASE_URL = process.env.BASE_URL || "http://localhost:8888";
const SLOW_TIMEOUT_MS = Number(process.env.SMOKE_SLOW_TIMEOUT_MS || 45000);

const MOVIE_TMDB = String(process.env.SMOKE_MOVIE_TMDB_ID || 157336);
const TV_TMDB = String(process.env.SMOKE_TV_TMDB_ID || 1396);

function subtitlesPath(queryObj) {
  const p = new URLSearchParams(queryObj);
  return `/.netlify/functions/subtitles?${p.toString()}`;
}

async function fetchJson(path, { timeoutMs = SLOW_TIMEOUT_MS } = {}) {
  const url = `${BASE_URL}${path}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = { _parseError: true, _textSample: text.slice(0, 200) };
    }
    return { res, json, url };
  } finally {
    clearTimeout(t);
  }
}

function countBy(arr, key) {
  const out = {};
  for (const x of arr || []) {
    const k = String(x?.[key] ?? "?");
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

/** Stable per-row identity for main / alternate lists (API-facing pick ≈ index 0). */
function rowFingerprint(row) {
  if (!row || typeof row !== "object") return null;
  return {
    provider: row.provider,
    tvMatchKind: row.tvMatchKind,
    language: row.language,
    releaseName: row.releaseName,
    downloadUrl: String(row.downloadUrl || "")
  };
}

function extractParityReport(json) {
  if (!json || typeof json !== "object") return null;
  const subs = Array.isArray(json.subtitles) ? json.subtitles : [];
  const alts = Array.isArray(json.alternateSubtitles) ? json.alternateSubtitles : [];
  const ph = json.providerHealth || {};
  return {
    subtitlesCount: subs.length,
    alternateSubtitlesCount: alts.length,
    providerHealthTier: ph.tier ?? null,
    mainProviderDist: countBy(subs, "provider"),
    mainTvMatchKindDist: countBy(subs, "tvMatchKind"),
    alternateProviderDist: countBy(alts, "provider"),
    alternateTvMatchKindDist: countBy(alts, "tvMatchKind"),
    bestPickFingerprint: subs.length ? rowFingerprint(subs[0]) : null,
    mainListFingerprint: subs.map(rowFingerprint),
    alternateListFingerprint: alts.map(rowFingerprint)
  };
}

function assertReportsMatch(a, b, label) {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) {
    throw new Error(
      `${label}: parity report mismatch\nwithout diagnostics: ${sa}\nwith diagnostics:    ${sb}`
    );
  }
}

/**
 * @param {{ res: Response, json: object }} normal
 * @param {{ res: Response, json: object }} diag
 * @param {string} label
 */
function assertDiagnosticsParity(normal, diag, label) {
  if (normal.res.status !== diag.res.status) {
    throw new Error(
      `${label}: status mismatch ${normal.res.status} vs ${diag.res.status}\n  ${normal.url}\n  ${diag.url}`
    );
  }

  const ns = normal.json;
  const ds = diag.json;

  if (normal.res.status === 502) {
    if (ds?.diagnostics != null) {
      throw new Error(`${label}: 502 response must not include diagnostics`);
    }
    assertReportsMatch(extractParityReport(ns), extractParityReport(ds), label);
    try {
      assert.deepStrictEqual(ds, ns);
    } catch (e) {
      throw new Error(`${label}: 502 body mismatch\n${e?.message || e}`);
    }
    return;
  }

  if (normal.res.status !== 200) {
    throw new Error(`${label}: expected 200 or 502, got ${normal.res.status}`);
  }

  if (ns?.ok !== true || ds?.ok !== true) {
    throw new Error(`${label}: expected ok:true on 200`);
  }

  if (!("diagnostics" in ds) || ds.diagnostics == null || typeof ds.diagnostics !== "object") {
    throw new Error(`${label}: diagnostics=1 response must include a diagnostics object`);
  }
  if ("diagnostics" in ns) {
    throw new Error(`${label}: normal response must not include diagnostics key`);
  }

  const { diagnostics: _diag, ...diagRest } = ds;
  assertReportsMatch(extractParityReport(ns), extractParityReport(diagRest), label);

  try {
    assert.deepStrictEqual(diagRest, ns);
  } catch (e) {
    throw new Error(
      `${label}: JSON body differs beyond diagnostics\n${e?.message || e}\n` +
        `report(normal)=${JSON.stringify(extractParityReport(ns))}\n` +
        `report(diagRest)=${JSON.stringify(extractParityReport(diagRest))}`
    );
  }
}

const ROUTES = [
  {
    label: "movie · provider=all · all languages (no language param)",
    query: {
      tmdbId: MOVIE_TMDB,
      mediaType: "movie",
      provider: "all"
    }
  },
  {
    label: "movie · provider=all · language=ar",
    query: {
      tmdbId: MOVIE_TMDB,
      mediaType: "movie",
      provider: "all",
      language: "ar"
    }
  },
  {
    label: "tv season · provider=all · all languages",
    query: {
      tmdbId: TV_TMDB,
      mediaType: "tv",
      season: "1",
      provider: "all"
    }
  },
  {
    label: "tv season · provider=all · language=ar",
    query: {
      tmdbId: TV_TMDB,
      mediaType: "tv",
      season: "1",
      provider: "all",
      language: "ar"
    }
  },
  {
    label: "tv episode · provider=all · fileName hint",
    query: {
      tmdbId: TV_TMDB,
      mediaType: "tv",
      season: "1",
      episode: "1",
      provider: "all",
      fileName: "Breaking.Bad.S01E01.1080p.WEB-DL"
    }
  }
];

async function run() {
  console.log(`Subtitles diagnostics parity smoke — ${BASE_URL}\n`);
  for (const route of ROUTES) {
    const basePath = subtitlesPath(route.query);
    const diagPath = subtitlesPath({ ...route.query, diagnostics: "1" });
    process.stdout.write(`→ ${route.label}\n  ${basePath}\n`);

    const normal = await fetchJson(basePath, { timeoutMs: SLOW_TIMEOUT_MS });
    const withDiag = await fetchJson(diagPath, { timeoutMs: SLOW_TIMEOUT_MS });

    assertDiagnosticsParity(normal, withDiag, route.label);
    console.log(
      `  PASS (${normal.res.status}) subtitles=${normal.json?.subtitles?.length ?? "—"} alts=${normal.json?.alternateSubtitles?.length ?? "—"} tier=${normal.json?.providerHealth?.tier ?? "—"}\n`
    );
  }
  console.log("All diagnostics parity routes passed.");
}

run().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
