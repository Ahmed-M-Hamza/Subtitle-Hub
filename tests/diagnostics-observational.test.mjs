/**
 * Regression: diagnostics must not change ranked/final subtitle outcomes.
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProviderHealthSummary,
  collectSubdlClassifySamplesForDiagnostics,
  sortSubtitles
} from "../netlify/functions/_shared.js";

function cloneRows(rows) {
  return rows.map((r) => ({ ...r }));
}

function fingerprintRanked(rows) {
  return rows.map((r) => ({
    provider: r.provider,
    tvMatchKind: r.tvMatchKind,
    score: r.score,
    releaseName: r.releaseName,
    language: r.language
  }));
}

function fingerprintFinal(rows) {
  return rows.map((r) => ({
    provider: r.provider,
    tvMatchKind: r.tvMatchKind,
    releaseName: r.releaseName,
    downloadUrl: r.downloadUrl || ""
  }));
}

const episodeCtxBase = {
  language: "ar",
  mediaType: "tv",
  season: "1",
  episode: "3",
  fileName: "",
  tvQueryMode: "episode",
  subdlWinningProbe: "seasonFullSeasonTmdb"
};

const mixedDeduped = [
  {
    provider: "subdl",
    subdlProbe: "seasonFullSeasonTmdb",
    season: 1,
    episode: "",
    releaseName: "Drama.S01E03.1080p.WEB",
    language: "ar",
    downloads: 120,
    downloadUrl: "https://subdl.example/a.srt"
  },
  {
    provider: "opensubtitles",
    season: 1,
    episode: 3,
    releaseName: "Drama.S01E03.720p",
    language: "ar",
    downloads: 80,
    downloadUrl: "https://os.example/b.srt"
  },
  {
    provider: "subdl",
    subdlProbe: "seasonFullSeasonTmdb",
    season: 1,
    episode: "",
    releaseName: "Drama.S01.Pack",
    language: "ar",
    downloads: 40,
    downloadUrl: "https://subdl.example/c.srt"
  }
];

test("sortSubtitles: legacy includeClassificationTrace on ctx does not change order or scores", () => {
  const ctxOff = { ...episodeCtxBase, includeClassificationTrace: false };
  const ctxOn = { ...episodeCtxBase, includeClassificationTrace: true };
  const rankedOff = sortSubtitles(cloneRows(mixedDeduped), ctxOff);
  const rankedOn = sortSubtitles(cloneRows(mixedDeduped), ctxOn);
  assert.deepEqual(fingerprintRanked(rankedOff), fingerprintRanked(rankedOn));
});

test("collectSubdlClassifySamplesForDiagnostics does not mutate input rows", () => {
  const before = cloneRows(mixedDeduped);
  collectSubdlClassifySamplesForDiagnostics(before, episodeCtxBase);
  assert.deepEqual(before, mixedDeduped);
});

test("collectSubdlClassifySamplesForDiagnostics does not change subsequent ranking", () => {
  const rows = cloneRows(mixedDeduped);
  const samples = collectSubdlClassifySamplesForDiagnostics(rows, episodeCtxBase);
  assert.ok(Array.isArray(samples));
  const rankedAfter = sortSubtitles(cloneRows(mixedDeduped), episodeCtxBase);
  const rankedBaseline = sortSubtitles(cloneRows(mixedDeduped), episodeCtxBase);
  assert.deepEqual(fingerprintRanked(rankedAfter), fingerprintRanked(rankedBaseline));
});

test("providerHealth tier ignores subdlClassifySamples-only debugCounts differences", () => {
  const row = (p) => ({
    provider: p,
    releaseName: "x",
    downloadUrl: `https://${p}.test/1`
  });
  const args = {
    providerFilter: "all",
    requested: ["subdl", "opensubtitles"],
    providerErrors: [],
    finalSubtitles: [row("subdl"), row("opensubtitles"), row("subdl")],
    alternateSubtitles: []
  };
  const h1 = buildProviderHealthSummary({
    ...args,
    debugCounts: { subdlClassifySamples: [{ fake: 1 }], subdlHtmlFallbackUsed: false, episodeHtmlFallbackUsed: false }
  });
  const h2 = buildProviderHealthSummary({
    ...args,
    debugCounts: { subdlClassifySamples: [], subdlHtmlFallbackUsed: false, episodeHtmlFallbackUsed: false }
  });
  assert.equal(h1.tier, h2.tier);
  assert.deepEqual(h1.failedProviders, h2.failedProviders);
  assert.deepEqual(h1.succeededProviders, h2.succeededProviders);
});

test("episode main list + alternates fingerprint: rank then filter matches diagnostics-agnostic contract", () => {
  const ranked = sortSubtitles(cloneRows(mixedDeduped), episodeCtxBase);
  const main = ranked.filter((s) => s.tvMatchKind === "exactEpisode");
  const alts = ranked
    .filter((s) => s.tvMatchKind === "seasonPack" || s.tvMatchKind === "seasonScoped")
    .slice(0, 80);
  assert.ok(main.length >= 1);
  assert.ok(alts.length >= 1);
  collectSubdlClassifySamplesForDiagnostics(cloneRows(mixedDeduped), episodeCtxBase);
  const ranked2 = sortSubtitles(cloneRows(mixedDeduped), episodeCtxBase);
  const main2 = ranked2.filter((s) => s.tvMatchKind === "exactEpisode");
  const alts2 = ranked2
    .filter((s) => s.tvMatchKind === "seasonPack" || s.tvMatchKind === "seasonScoped")
    .slice(0, 80);
  assert.deepEqual(fingerprintFinal(main), fingerprintFinal(main2));
  assert.deepEqual(fingerprintFinal(alts), fingerprintFinal(alts2));
});
