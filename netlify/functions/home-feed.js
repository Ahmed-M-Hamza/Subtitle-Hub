import { buildHomeFeed, json, logError, logInfo, requireSubtitlesConfig } from "./_shared.js";

export async function handler() {
  try {
    logInfo("home-feed called");
    const missing = requireSubtitlesConfig();
    if (missing.length) {
      return json(503, {
        ok: false,
        error: "Missing environment variables",
        missing
      });
    }
    const feed = await buildHomeFeed();
    logInfo("home-feed success", {
      generatedAt: feed.generatedAt,
      latestMoviesWithSubs: feed.sections?.latestMoviesWithSubs?.length || 0,
      latestArabicMovies: feed.sections?.latestArabicMovies?.length || 0,
      latestTvWithSubs: feed.sections?.latestTvWithSubs?.length || 0,
      trendingWithSubs: feed.sections?.trendingWithSubs?.length || 0
    });
    return json(200, {
      ok: true,
      ...feed
    });
  } catch (error) {
    logError("home-feed failed", error);
    return json(200, {
      ok: true,
      degraded: true,
      generatedAt: new Date().toISOString(),
      sections: {
        latestMoviesWithSubs: [],
        latestArabicMovies: [],
        latestTvWithSubs: [],
        trendingWithSubs: []
      },
      providerErrors: [
        {
          provider: "home-feed",
          message: error.message || "Internal server error"
        }
      ]
    });
  }
}
