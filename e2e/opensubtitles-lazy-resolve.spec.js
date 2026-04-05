import { test, expect } from "@playwright/test";
import {
  installApiMocks,
  mediaMovie,
  subtitleRow,
  subtitlesOkBody
} from "./fixtures/api-mocks.js";

const OS_LISTING_URL = "https://www.opensubtitles.com/en/subtitles/os-regression-123";
const OS_FILE_ID = "777001";

/** Resolve → direct URL used when testing blob path (CORS-friendly mock). */
const BLOB_DIRECT_URL = "https://example.com/e2e/os-blob.srt";
/** Resolve → URL that receives Content-Disposition in the mock. */
const BLOB_CD_URL = "https://example.com/e2e/os-with-cd.srt";
/** Resolve → URL used when blob fetch fails (no CORS) → window.open fallback. */
const FALLBACK_DIRECT_URL = "https://example.com/mock-opensubtitles-direct.zip";

const SUBTITLE_BODY = "1\n00:00:00,000 --> 00:00:01,000\nregression-line\n";

function openSubtitlesLazyRow(overrides = {}) {
  return subtitleRow({
    provider: "opensubtitles",
    opensubtitlesFileId: OS_FILE_ID,
    opensubtitlesSourcePageUrl: OS_LISTING_URL,
    opensubtitlesLinkKind: "source_page_only",
    downloadUrl: "",
    releaseName: "OS.LazyResolve.1080p.WEB-DL",
    score: 82,
    confidence: "excellent",
    ...overrides
  });
}

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

test.describe("OpenSubtitles lazy-resolve download", () => {
  test.describe("blob path (CORS-friendly direct URL)", () => {
    test.beforeEach(async ({ page }) => {
      await page.route("https://example.com/**", async (route) => {
        const req = route.request();
        if (req.method() === "OPTIONS") {
          await route.fulfill({
            status: 204,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET, OPTIONS",
              "Access-Control-Allow-Headers": "*"
            }
          });
          return;
        }
        const url = req.url();
        const headers = {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "text/plain; charset=utf-8"
        };
        if (url.includes("os-with-cd")) {
          headers["Content-Disposition"] = 'attachment; filename="Explicit-CD-Subtitle.srt"';
        }
        await route.fulfill({
          status: 200,
          headers,
          body: SUBTITLE_BODY
        });
      });
    });

    test("success: blob download — no popup, browser download event", async ({ page, context }) => {
      await installApiMocks(page, {
        mediaDetails: mediaMovie,
        subtitlesResponse: subtitlesOkBody({ subtitles: [openSubtitlesLazyRow()] }),
        openSubtitlesResolveSuccessOverrides: {
          downloadUrl: BLOB_DIRECT_URL,
          opensubtitlesResolvedDownloadUrl: BLOB_DIRECT_URL
        }
      });

      await page.goto("/media/movie/100/subtitles");

      const osCard = page.locator("#subtitleList .sub-item").filter({ has: page.locator(".provider-opensubtitles") });
      const primaryDownload = osCard.getByRole("button", { name: /download subtitle/i });

      const tabCountBefore = context.pages().length;

      const [download, post, directGet] = await Promise.all([
        page.waitForEvent("download"),
        page.waitForRequest(
          (r) => r.url().includes("opensubtitles-resolve-download") && r.method() === "POST"
        ),
        page.waitForRequest(
          (r) =>
            r.url().startsWith("https://example.com/") && r.method() === "GET" && r.url().includes("os-blob")
        ),
        primaryDownload.click()
      ]);

      expect(post.postDataJSON().fileId).toBe(OS_FILE_ID);
      expect(directGet.url()).toContain("os-blob");
      expect(context.pages().length).toBe(tabCountBefore);

      const name = download.suggestedFilename();
      expect(name).toMatch(/\.srt$/i);
      expect(name).toMatch(/lazyresolve|opensubtitles/i);
    });

    test("success: filename prefers Content-Disposition when present", async ({ page, context }) => {
      await installApiMocks(page, {
        mediaDetails: mediaMovie,
        subtitlesResponse: subtitlesOkBody({ subtitles: [openSubtitlesLazyRow()] }),
        openSubtitlesResolveSuccessOverrides: {
          downloadUrl: BLOB_CD_URL,
          opensubtitlesResolvedDownloadUrl: BLOB_CD_URL
        }
      });

      await page.goto("/media/movie/100/subtitles");

      const osCard = page.locator("#subtitleList .sub-item").filter({ has: page.locator(".provider-opensubtitles") });
      const primaryDownload = osCard.getByRole("button", { name: /download subtitle/i });

      const [download] = await Promise.all([page.waitForEvent("download"), primaryDownload.click()]);

      expect(context.pages().length).toBe(1);
      expect(download.suggestedFilename()).toMatch(/Explicit-CD-Subtitle\.srt$/i);
    });

    test("success: best-pick uses blob path (no popup)", async ({ page, context }) => {
      await installApiMocks(page, {
        mediaDetails: mediaMovie,
        subtitlesResponse: subtitlesOkBody({ subtitles: [openSubtitlesLazyRow()] }),
        openSubtitlesResolveSuccessOverrides: {
          downloadUrl: BLOB_DIRECT_URL,
          opensubtitlesResolvedDownloadUrl: BLOB_DIRECT_URL
        }
      });

      await page.goto("/media/movie/100/subtitles");

      const bestPickBtn = page.locator("#subtitleBestPick").getByRole("button", { name: /download subtitle/i });
      await expect(bestPickBtn).toHaveAttribute("data-os-download", "1");

      const tabsBefore = context.pages().length;

      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.waitForRequest(
          (r) => r.url().includes("opensubtitles-resolve-download") && r.method() === "POST"
        ),
        bestPickBtn.click()
      ]);

      expect(context.pages().length).toBe(tabsBefore);
      expect(download.suggestedFilename()).toMatch(/\.srt$/i);
    });
  });

  test.describe("popup fallback (direct URL without CORS)", () => {
    test.beforeEach(async ({ page }) => {
      await page.route("https://example.com/**", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<!doctype html><html><head><title>mock direct download target</title></head><body>ok</body></html>"
        });
      });
    });

    test("success: falls back to new tab when blob fetch is blocked", async ({ page, context }) => {
      await installApiMocks(page, {
        mediaDetails: mediaMovie,
        subtitlesResponse: subtitlesOkBody({ subtitles: [openSubtitlesLazyRow()] }),
        openSubtitlesResolveSuccessOverrides: {
          downloadUrl: FALLBACK_DIRECT_URL,
          opensubtitlesResolvedDownloadUrl: FALLBACK_DIRECT_URL
        }
      });

      await page.goto("/media/movie/100/subtitles");

      const osCard = page.locator("#subtitleList .sub-item").filter({ has: page.locator(".provider-opensubtitles") });
      const primaryDownload = osCard.getByRole("button", { name: /download subtitle/i });

      await expect(osCard.locator("a.btn-view-source")).toHaveCount(1);
      const viewSource = osCard.getByRole("link", { name: /view source/i });
      await expect(viewSource).toHaveAttribute("href", OS_LISTING_URL);

      const tabsBefore = context.pages().length;

      const [req, popup] = await Promise.all([
        page.waitForRequest(
          (r) => r.url().includes("opensubtitles-resolve-download") && r.method() === "POST"
        ),
        page.waitForEvent("popup"),
        primaryDownload.click()
      ]);

      expect(req.postDataJSON().fileId).toBe(OS_FILE_ID);
      expect(context.pages().length).toBeGreaterThan(tabsBefore);

      await popup.waitForLoadState("domcontentloaded");
      expect(popup.url()).toContain("example.com");
      expect(popup.url()).toContain("mock-opensubtitles-direct.zip");
      expect(popup.url()).not.toMatch(/opensubtitles\.com\/[^/]+\/subtitles\//i);

      await popup.close();
    });

    test("success: best-pick OpenSubtitles CTA uses popup fallback when CORS blocks blob", async ({ page, context }) => {
      await installApiMocks(page, {
        mediaDetails: mediaMovie,
        subtitlesResponse: subtitlesOkBody({ subtitles: [openSubtitlesLazyRow()] }),
        openSubtitlesResolveSuccessOverrides: {
          downloadUrl: FALLBACK_DIRECT_URL,
          opensubtitlesResolvedDownloadUrl: FALLBACK_DIRECT_URL
        }
      });

      await page.goto("/media/movie/100/subtitles");

      const bestPickBtn = page.locator("#subtitleBestPick").getByRole("button", { name: /download subtitle/i });
      await expect(bestPickBtn).toBeVisible();
      await expect(bestPickBtn).toHaveAttribute("data-os-download", "1");

      const tabsBefore = context.pages().length;

      const [, popup] = await Promise.all([
        page.waitForRequest(
          (r) => r.url().includes("opensubtitles-resolve-download") && r.method() === "POST"
        ),
        page.waitForEvent("popup"),
        bestPickBtn.click()
      ]);

      expect(context.pages().length).toBeGreaterThan(tabsBefore);
      expect(popup.url()).toContain("mock-opensubtitles-direct.zip");
      await popup.close();
    });
  });

  test.describe("resolve failures and view source", () => {
    test("failure: no new window, stay on app URL, toast shows unavailable copy", async ({ page }) => {
      await installApiMocks(page, {
        mediaDetails: mediaMovie,
        subtitlesResponse: subtitlesOkBody({ subtitles: [openSubtitlesLazyRow()] }),
        openSubtitlesResolveMode: "failure"
      });

      await page.goto("/media/movie/100/subtitles");

      const expectedPath = /\/media\/movie\/100\/subtitles/;
      await expect(page).toHaveURL(expectedPath);

      const pagesBefore = page.context().pages().length;

      const osCard = page.locator("#subtitleList .sub-item").filter({ has: page.locator(".provider-opensubtitles") });
      const primaryDownload = osCard.getByRole("button", { name: /download subtitle/i });

      const [failedResolve] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes("opensubtitles-resolve-download") && r.request().method() === "POST"
        ),
        primaryDownload.click()
      ]);
      expect(failedResolve.status()).toBe(422);

      const toast = page.locator("#appToast .app-toast__msg");
      await expect(toast).toBeVisible();
      await expect(toast).toContainText(/no longer available from this source/i);
      await expect(toast).toContainText(/try another result from the list/i);

      await expect(page).toHaveURL(expectedPath);
      expect(page.context().pages().length).toBe(pagesBefore);
    });

    test("quota / rate-limit style failure shows quota toast, not removed-subtitle copy", async ({ page }) => {
      await installApiMocks(page, {
        mediaDetails: mediaMovie,
        subtitlesResponse: subtitlesOkBody({ subtitles: [openSubtitlesLazyRow()] }),
        openSubtitlesResolveMode: "quota"
      });

      await page.goto("/media/movie/100/subtitles");

      const osCard = page.locator("#subtitleList .sub-item").filter({ has: page.locator(".provider-opensubtitles") });
      await osCard.getByRole("button", { name: /download subtitle/i }).click();

      const toast = page.locator("#appToast .app-toast__msg");
      await expect(toast).toBeVisible();
      await expect(toast).toContainText(/OpenSubtitles download quota has been reached for now/i);
      await expect(toast).toContainText(/try another source or try again later/i);
      await expect(toast).not.toContainText(/no longer available from this source/i);
    });

    test("view source opens listing in a separate tab from download", async ({ page }) => {
      await page.route("https://www.opensubtitles.com/en/subtitles/**", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<!doctype html><html><head><title>mock OpenSubtitles listing</title></head><body>mock</body></html>"
        });
      });

      await installApiMocks(page, {
        mediaDetails: mediaMovie,
        subtitlesResponse: subtitlesOkBody({ subtitles: [openSubtitlesLazyRow()] })
      });

      await page.goto("/media/movie/100/subtitles");

      const osCard = page.locator("#subtitleList .sub-item").filter({ has: page.locator(".provider-opensubtitles") });
      const viewSource = osCard.getByRole("link", { name: /view source/i });
      await expect(viewSource).toHaveClass(/btn-view-source/);

      const [popup] = await Promise.all([page.waitForEvent("popup"), viewSource.click()]);

      expect(popup.url()).toMatch(/opensubtitles\.com/i);
      expect(popup.url()).toContain("/subtitles/");
      expect(popup.url()).not.toContain("mock-opensubtitles-direct.zip");

      await popup.close();
    });
  });
});
