import { test, expect } from "@playwright/test";
import {
  installApiMocks,
  mediaMovie,
  mediaTv,
  subtitleRow,
  subtitlesOkBody
} from "./fixtures/api-mocks.js";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("subtitlehub.uiLang", "en");
    localStorage.setItem("subtitlehub.uiTheme", "dark");
    localStorage.removeItem("subtitlehub.continueHistory");
    localStorage.removeItem("subtitlehub.recentSearches");
    localStorage.removeItem("subtitlehub.subtitlePrefs");
    localStorage.removeItem("subtitlehub.devDiagnostics");
  });
});

test.describe("Best automatic recommendation", () => {
  test("shows best pick when the lead subtitle is clearly ahead", async ({ page }) => {
    const strong = subtitleRow({ score: 82, confidence: "excellent", releaseName: "Lead.1080p.WEB-DL" });
    const weaker = subtitleRow({ score: 74, confidence: "excellent", releaseName: "Trail.1080p.WEB-DL" });
    await installApiMocks(page, {
      mediaDetails: mediaMovie,
      subtitlesResponse: subtitlesOkBody({ subtitles: [strong, weaker] })
    });
    await page.goto("/media/movie/100/subtitles");
    await expect(page.locator("#subtitleBestPick")).toBeVisible();
    await expect(page.locator(".subtitle-best-pick__badge")).toContainText(/best pick/i);
    await expect(page.locator(".subtitle-best-pick__title")).toContainText("Lead");
  });

  test("hides best pick when top two candidates are too close", async ({ page }) => {
    const a = subtitleRow({ score: 71, confidence: "excellent", releaseName: "A.1080p.WEB-DL" });
    const b = subtitleRow({ score: 70.5, confidence: "excellent", releaseName: "B.1080p.WEB-DL" });
    await installApiMocks(page, {
      mediaDetails: mediaMovie,
      subtitlesResponse: subtitlesOkBody({ subtitles: [a, b] })
    });
    await page.goto("/media/movie/100/subtitles");
    await expect(page.locator("#subtitleBestPick")).toBeHidden();
  });
});

test.describe("No-results recovery", () => {
  test("episode mode: empty main list shows recovery and season alternates copy", async ({ page }) => {
    const alt = subtitleRow({
      tvMatchKind: "seasonScoped",
      tvMatchTier: 1,
      releaseName: "Season.Level.1080p.WEB-DL"
    });
    await installApiMocks(page, {
      mediaDetails: mediaTv,
      subtitlesResponse: subtitlesOkBody({
        tvQueryMode: "episode",
        subtitles: [],
        alternateSubtitles: [alt],
        providerHealth: {
          tier: "partial_outage_empty",
          requestedProviders: ["subdl", "opensubtitles"],
          failedProviders: ["opensubtitles"],
          succeededProviders: ["subdl"],
          providersWithData: [],
          failureKinds: {},
          anyRateLimited: false,
          fallbackAssisted: false,
          alternateRouteOffered: true
        }
      })
    });
    await page.goto("/media/tv/200/subtitles?season=1&episode=1");
    await expect(page.locator(".subtitle-empty-state__title")).toContainText(/no subtitles matched this episode/i);
    await expect(page.locator(".subtitle-empty-state__actions")).toContainText(/jump to season options/i);
    await expect(page.locator(".subtitle-empty-state__actions")).toContainText(/browse subtitles for the whole season/i);
  });

  test("season mode: empty list shows season-oriented recovery", async ({ page }) => {
    await installApiMocks(page, {
      mediaDetails: mediaTv,
      subtitlesResponse: subtitlesOkBody({
        tvQueryMode: "season",
        subtitles: [],
        alternateSubtitles: [],
        providerHealth: { ...subtitlesOkBody().providerHealth, tier: "no_matches_upstream" }
      })
    });
    await page.goto("/media/tv/200/subtitles?season=1");
    await expect(page.locator(".subtitle-empty-state__title")).toContainText(/no subtitles for this season/i);
    await expect(page.locator(".subtitle-empty-state__actions")).toContainText(/try english/i);
  });

  test("movie: empty list shows movie recovery actions", async ({ page }) => {
    await installApiMocks(page, {
      mediaDetails: mediaMovie,
      subtitlesResponse: subtitlesOkBody({
        subtitles: [],
        providerHealth: { ...subtitlesOkBody().providerHealth, tier: "no_matches_upstream" }
      })
    });
    await page.goto("/media/movie/100/subtitles");
    await expect(page.locator(".subtitle-empty-state__title")).toContainText(/no subtitles for this title/i);
    await expect(page.locator(".subtitle-empty-state__actions")).toContainText(/search for a different title/i);
  });
});

test.describe("Language grouping", () => {
  test("renders language sections in ar → en → other order", async ({ page }) => {
    const rows = [
      subtitleRow({ language: "en", releaseName: "English.1080p.WEB-DL" }),
      subtitleRow({ language: "ar", releaseName: "Arabic.1080p.WEB-DL" }),
      subtitleRow({ language: "fr", releaseName: "French.1080p.WEB-DL" })
    ];
    await installApiMocks(page, {
      mediaDetails: mediaMovie,
      subtitlesResponse: subtitlesOkBody({ subtitles: rows })
    });
    await page.goto("/media/movie/100/subtitles");
    const groups = page.locator(".subtitle-group--by-lang");
    await expect(groups).toHaveCount(3);
    await expect(groups.nth(0)).toHaveAttribute("data-lang-group", "ar");
    await expect(groups.nth(1)).toHaveAttribute("data-lang-group", "en");
    await expect(groups.nth(2)).toHaveAttribute("data-lang-group", "fr");
    await expect(groups.first().locator(".sub-item")).toHaveCount(1);
    await expect(groups.first().locator(".sub-title")).toBeVisible();
  });
});

test.describe("Provider health banner", () => {
  test("shows calm product copy for partial outage + fallback (no raw errors in status)", async ({ page }) => {
    await installApiMocks(page, {
      mediaDetails: mediaMovie,
      subtitlesResponse: subtitlesOkBody({
        subtitles: [
          subtitleRow({
            releaseName: "Only.OpenSub.1080p.WEB-DL",
            provider: "opensubtitles",
            opensubtitlesFileId: "900001",
            opensubtitlesSourcePageUrl: "https://www.opensubtitles.com/en/subtitles/mock-id",
            opensubtitlesLinkKind: "source_page_only",
            downloadUrl: ""
          })
        ],
        providerErrors: [{ provider: "subdl", message: "HTTP 503 upstream" }],
        providerHealth: {
          tier: "partial_outage",
          requestedProviders: ["subdl", "opensubtitles"],
          failedProviders: ["subdl"],
          succeededProviders: ["opensubtitles"],
          providersWithData: ["opensubtitles"],
          failureKinds: { subdl: "generic" },
          anyRateLimited: false,
          fallbackAssisted: true,
          alternateRouteOffered: false
        }
      })
    });
    await page.goto("/media/movie/100/subtitles");
    const status = page.locator("#subtitleStatus");
    await expect(status.locator(".provider-health-banner")).toBeVisible();
    await expect(status).toContainText(/sources that responded/i);
    await expect(status).toContainText(/extra retrieval path/i);
    await expect(status).not.toContainText("HTTP 503");
    await expect(status).not.toContainText("subdl:");
  });
});

test.describe("Continue browsing", () => {
  test("dedupes repeated subtitle visits and shows a single continue card", async ({ page }) => {
    await installApiMocks(page, {
      mediaDetails: mediaMovie,
      subtitlesResponse: subtitlesOkBody({
        subtitles: [subtitleRow({ score: 80, confidence: "excellent", releaseName: "Once.1080p.WEB-DL" })]
      })
    });
    await page.goto("/media/movie/100/subtitles");
    await expect(page.locator("#subtitleList .sub-item")).toHaveCount(1);
    await page.goto("/media/movie/100/subtitles");
    await expect(page.locator("#subtitleList .sub-item")).toHaveCount(1);
    await page.goto("/");
    const cards = page.locator('.continue-card[data-continue-kind="subtitles"]');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText("Regression Movie");
  });

  test("home rail shows at most eight continue items", async ({ page }) => {
    await page.addInitScript(() => {
      const entries = Array.from({ length: 12 }, (_, i) => ({
        kind: "media",
        tmdbId: String(500 + i),
        mediaType: "movie",
        title: `Title ${i}`,
        year: "2020",
        poster: "",
        at: new Date(Date.UTC(2024, 0, i + 1)).toISOString()
      }));
      localStorage.setItem("subtitlehub.continueHistory", JSON.stringify(entries));
    });
    await installApiMocks(page, {
      subtitlesResponse: subtitlesOkBody({ subtitles: [] })
    });
    await page.goto("/");
    await expect(page.locator(".continue-browsing-card")).toBeVisible();
    await expect(page.locator("[data-continue-item]")).toHaveCount(8);
  });
});

test.describe("Subtitle results UX", () => {
  test("renders result cards and count after load", async ({ page }) => {
    const rows = [
      subtitleRow({ score: 81, releaseName: "One.1080p.WEB-DL" }),
      subtitleRow({ score: 79, releaseName: "Two.1080p.WEB-DL" })
    ];
    await installApiMocks(page, {
      mediaDetails: mediaMovie,
      subtitlesResponse: subtitlesOkBody({ subtitles: rows })
    });
    await page.goto("/media/movie/100/subtitles");
    await expect(page.locator("#subtitleList .sub-item")).toHaveCount(2);
    await expect(page.locator("#subtitleList .btn-download-primary")).toHaveCount(2);
    await expect(page.locator("#subtitleCount")).toContainText(/2/);
  });

  test("load more reveals additional cards (desktop project)", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "chromium-mobile", "exercise paging on desktop project only");
    const rows = Array.from({ length: 48 }, (_, i) =>
      subtitleRow({
        score: 90 - i * 0.3,
        confidence: "excellent",
        releaseName: `Batch.${i}.1080p.WEB-DL`,
        id: `batch-${i}`
      })
    );
    await installApiMocks(page, {
      mediaDetails: mediaMovie,
      subtitlesResponse: subtitlesOkBody({ subtitles: rows })
    });
    await page.goto("/media/movie/100/subtitles");
    const list = page.locator("#subtitleList");
    await expect(list.locator(".sub-item")).toHaveCount(40);
    await page.getByRole("button", { name: /load more results/i }).click();
    await expect(list.locator(".sub-item")).toHaveCount(47);
  });

  test("mobile viewport: subtitle cards and primary download stay visible", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-mobile", "mobile layout check");
    await installApiMocks(page, {
      mediaDetails: mediaMovie,
      subtitlesResponse: subtitlesOkBody({
        subtitles: [subtitleRow({ score: 80, confidence: "excellent", releaseName: "Mobile.1080p.WEB-DL" })]
      })
    });
    await page.goto("/media/movie/100/subtitles");
    const card = page.locator("#subtitleList .sub-item").first();
    await expect(card).toBeVisible();
    await expect(card.locator(".btn-download-primary")).toBeVisible();
    const noHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 2
    );
    expect(noHorizontalOverflow).toBeTruthy();
  });
});

test.describe("TV contracts (UI-visible)", () => {
  test("season mode list never shows exactEpisode rows in main list", async ({ page }) => {
    const rows = [
      subtitleRow({
        tvMatchKind: "seasonPack",
        tvMatchTier: 2,
        releaseName: "Complete.Season.1.PACK.1080p"
      }),
      subtitleRow({
        tvMatchKind: "seasonScoped",
        tvMatchTier: 1,
        releaseName: "Season.1.Generic.1080p"
      })
    ];
    await installApiMocks(page, {
      mediaDetails: mediaTv,
      subtitlesResponse: subtitlesOkBody({ tvQueryMode: "season", subtitles: rows })
    });
    await page.goto("/media/tv/200/subtitles?season=1");
    await expect(page.locator("#subtitleList .sub-item")).toHaveCount(2);
    await expect(page.locator('#subtitleList [data-match-type="exactEpisode"]')).toHaveCount(0);
  });

  test("episode mode main list is exactEpisode only", async ({ page }) => {
    const rows = [
      subtitleRow({
        tvMatchKind: "exactEpisode",
        tvMatchTier: 3,
        season: "1",
        episode: "2",
        releaseName: "Show.S01E02.1080p.WEB-DL"
      })
    ];
    await installApiMocks(page, {
      mediaDetails: mediaTv,
      subtitlesResponse: subtitlesOkBody({ tvQueryMode: "episode", subtitles: rows, alternateSubtitles: [] })
    });
    await page.goto("/media/tv/200/subtitles?season=1&episode=2");
    await expect(page.locator('#subtitleList [data-match-type="exactEpisode"]')).toHaveCount(1);
  });
});
