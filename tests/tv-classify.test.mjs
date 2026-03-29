/**
 * Unit tests: TV subtitle classification (episode vs season contract).
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { classifyTvSubtitleMatch } from "../netlify/functions/_shared.js";

const epCtx = {
  mediaType: "tv",
  tvQueryMode: "episode",
  season: "1",
  episode: "1",
  subdlWinningProbe: null
};

const seasonCtx = {
  mediaType: "tv",
  tvQueryMode: "season",
  season: "1",
  episode: "",
  subdlWinningProbe: null
};

test("episode mode: wrong episode from metadata → other (not in main episode list)", () => {
  const r = classifyTvSubtitleMatch(
    {
      provider: "opensubtitles",
      season: 1,
      episode: 2,
      releaseName: "Breaking.Bad.S01E02.1080p.WEB"
    },
    epCtx
  );
  assert.equal(r.tvMatchKind, "other");
});

test("episode mode: matching episode → exactEpisode", () => {
  const r = classifyTvSubtitleMatch(
    {
      provider: "opensubtitles",
      season: 1,
      episode: 1,
      releaseName: "Breaking.Bad.S01E01.1080p.WEB"
    },
    epCtx
  );
  assert.equal(r.tvMatchKind, "exactEpisode");
});

test("season mode: default row → seasonScoped or seasonPack (never exactEpisode as primary bucket)", () => {
  const r = classifyTvSubtitleMatch(
    {
      provider: "opensubtitles",
      season: 1,
      episode: "",
      releaseName: "Breaking.Bad.Season.1.Complete.1080p"
    },
    seasonCtx
  );
  assert.notEqual(r.tvMatchKind, "exactEpisode");
  assert.ok(r.tvMatchKind === "seasonScoped" || r.tvMatchKind === "seasonPack" || r.tvMatchKind === "other");
});

test("episode mode: season pack hints in release → seasonPack (excluded from strict episode main list upstream)", () => {
  const r = classifyTvSubtitleMatch(
    {
      provider: "opensubtitles",
      season: 1,
      episode: "",
      releaseName: "Breaking.Bad.Season.1.COMPLETE.PACK.1080p"
    },
    epCtx
  );
  assert.equal(r.tvMatchKind, "seasonPack");
});

test("non-tv context → movie bucket", () => {
  const r = classifyTvSubtitleMatch({ provider: "opensubtitles", releaseName: "Film.1080p" }, { mediaType: "movie" });
  assert.equal(r.tvMatchKind, "movie");
});
