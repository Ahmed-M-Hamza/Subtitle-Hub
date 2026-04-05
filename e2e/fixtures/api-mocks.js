/**
 * JSON fixtures + Playwright route wiring for UI tests (no real SubDL/OpenSubtitles).
 */

export const mediaMovie = {
  ok: true,
  media: {
    tmdbId: 100,
    mediaType: "movie",
    title: "Regression Movie",
    year: "2020",
    overview: "Synthetic title for browser tests.",
    poster: "",
    backdrop: "",
    genres: ["Sci-Fi"],
    voteAverage: 8.2,
    status: "Released",
    runtime: 120,
    releaseDate: "2020-01-01"
  }
};

export const mediaTv = {
  ok: true,
  media: {
    tmdbId: 200,
    mediaType: "tv",
    title: "Regression TV",
    year: "2021",
    overview: "Synthetic series for browser tests.",
    poster: "",
    backdrop: "",
    genres: ["Drama"],
    voteAverage: 8.4,
    status: "Ended",
    seasonCount: 2,
    episodeCount: 16,
    firstAirDate: "2021-01-01",
    seasons: [
      { seasonNumber: 1, episodeCount: 8 },
      { seasonNumber: 2, episodeCount: 8 }
    ]
  }
};

const baseBreakdown = {
  language: 12,
  episodeMatch: 12,
  tvTierBoost: 12,
  providerTrust: 10,
  downloads: 10,
  filenameSimilarity: 10,
  completeness: 10
};

export function subtitleRow(overrides = {}) {
  return {
    id: `id-${Math.random().toString(36).slice(2, 9)}`,
    provider: "subdl",
    releaseName: "Mock.Release.1080p.WEB-DL",
    author: "tester",
    language: "en",
    downloadUrl: "https://example.com/subtitle.srt",
    tvMatchKind: "exactEpisode",
    tvMatchTier: 3,
    confidence: "excellent",
    score: 78,
    scoreBreakdown: { ...baseBreakdown },
    topReasons: ["exactEpisodeMatch"],
    downloads: 2500,
    releases: ["WEB-DL"],
    hearingImpaired: false,
    comment: "",
    season: "1",
    episode: "1",
    ...overrides
  };
}

export function subtitlesOkBody(partial = {}) {
  const defaults = {
    ok: true,
    provider: "all",
    providerErrors: [],
    subtitles: [],
    alternateSubtitles: [],
    providerHealth: {
      tier: "full",
      requestedProviders: ["subdl", "opensubtitles"],
      failedProviders: [],
      succeededProviders: ["subdl", "opensubtitles"],
      providersWithData: ["subdl", "opensubtitles"],
      failureKinds: {},
      anyRateLimited: false,
      fallbackAssisted: false,
      alternateRouteOffered: false
    }
  };
  return { ...defaults, ...partial };
}

const openSubtitlesResolveSuccessJson = {
  ok: true,
  code: "ok",
  downloadUrl: "https://example.com/mock-opensubtitles-direct.zip",
  opensubtitlesLinkKind: "direct",
  opensubtitlesSourcePageUrl: "",
  opensubtitlesResolvedDownloadUrl: "https://example.com/mock-opensubtitles-direct.zip",
  opensubtitlesResolveOnClickUsed: true,
  opensubtitlesResolveFailureReason: ""
};

const openSubtitlesResolveFailureJson = {
  ok: false,
  code: "unavailable",
  opensubtitlesLinkKind: "source_page_only",
  opensubtitlesSourcePageUrl: "",
  opensubtitlesResolvedDownloadUrl: "",
  opensubtitlesResolveOnClickUsed: true,
  opensubtitlesResolveFailureReason: "OpenSubtitles HTTP 404 — removed"
};

const openSubtitlesResolveQuotaJson = {
  ok: false,
  code: "quota_exhausted",
  opensubtitlesLinkKind: "source_page_only",
  opensubtitlesSourcePageUrl: "",
  opensubtitlesResolvedDownloadUrl: "",
  opensubtitlesResolveOnClickUsed: true,
  opensubtitlesResolveFailureReason:
    "You have downloaded your allowed 100 subtitles for 24h. Try again tomorrow."
};

/**
 * Intercept Netlify function calls when using `serve public` (functions 404 otherwise).
 * `openSubtitlesResolveMode`: "failure" → unavailable-style 422; "quota" → quota_exhausted 422 (toast copy).
 * `openSubtitlesResolveSuccessOverrides`: shallow-merge into the success JSON (e.g. custom `downloadUrl` for blob e2e).
 */
export async function installApiMocks(
  page,
  {
    mediaDetails = mediaMovie,
    subtitlesResponse,
    openSubtitlesResolveMode = "success",
    openSubtitlesResolveSuccessOverrides = null
  } = {}
) {
  await page.route("**/.netlify/functions/media-details**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mediaDetails)
    });
  });

  await page.route("**/.netlify/functions/subtitles**", async (route) => {
    const url = new URL(route.request().url());
    const body =
      typeof subtitlesResponse === "function" ? subtitlesResponse(url) : subtitlesResponse;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body)
    });
  });

  await page.route("**/.netlify/functions/opensubtitles-resolve-download**", async (route) => {
    if (openSubtitlesResolveMode === "failure") {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify(openSubtitlesResolveFailureJson)
      });
      return;
    }
    if (openSubtitlesResolveMode === "quota") {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify(openSubtitlesResolveQuotaJson)
      });
      return;
    }
    const successPayload =
      openSubtitlesResolveSuccessOverrides != null
        ? { ...openSubtitlesResolveSuccessJson, ...openSubtitlesResolveSuccessOverrides }
        : openSubtitlesResolveSuccessJson;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(successPayload)
    });
  });

  await page.route("**/.netlify/functions/home-feed**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, sections: [] })
    });
  });

  await page.route("**/.netlify/functions/health**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, ready: true })
    });
  });
}
