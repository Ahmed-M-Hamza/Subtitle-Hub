import { test, expect } from "@playwright/test";
import {
  installApiMocks,
  mediaMovie,
  subtitleRow,
  subtitlesOkBody
} from "./fixtures/api-mocks.js";

const OS_LISTING_URL = "https://www.opensubtitles.com/en/subtitles/os-regression-123";
const OS_FILE_ID = "777001";

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
  test.beforeEach(async ({ page }) => {
    await page.route("https://example.com/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><html><head><title>mock direct download target</title></head><body>ok</body></html>"
      });
    });
  });

  test("success: primary control is a button, POSTs resolve, opens direct URL (not listing page)", async ({
    page
  }) => {
    await installApiMocks(page, {
      mediaDetails: mediaMovie,
      subtitlesResponse: subtitlesOkBody({ subtitles: [openSubtitlesLazyRow()] })
    });

    await page.goto("/media/movie/100/subtitles");

    const osCard = page.locator("#subtitleList .sub-item").filter({ has: page.locator(".provider-opensubtitles") });
    await expect(osCard).toHaveCount(1);

    const primaryDownload = osCard.getByRole("button", { name: /download subtitle/i });
    await expect(primaryDownload).toBeVisible();
    await expect(primaryDownload).toHaveAttribute("data-os-download", "1");
    await expect(primaryDownload).toHaveAttribute("data-opensubtitles-file-id", OS_FILE_ID);

    await expect(osCard.locator("a.btn-download-primary")).toHaveCount(0);
    await expect(osCard.locator("a.btn-view-source")).toHaveCount(1);

    const viewSource = osCard.getByRole("link", { name: /view source/i });
    await expect(viewSource).toHaveAttribute("href", OS_LISTING_URL);

    const [req, popup] = await Promise.all([
      page.waitForRequest(
        (r) => r.url().includes("opensubtitles-resolve-download") && r.method() === "POST"
      ),
      page.waitForEvent("popup"),
      primaryDownload.click()
    ]);

    const body = req.postDataJSON();
    expect(body.fileId).toBe(OS_FILE_ID);
    await popup.waitForLoadState("domcontentloaded");
    expect(popup.url()).toContain("example.com");
    expect(popup.url()).toContain("mock-opensubtitles-direct.zip");
    expect(popup.url()).not.toMatch(/opensubtitles\.com\/[^/]+\/subtitles\//i);

    await popup.close();
  });

  test("success: best-pick OpenSubtitles CTA uses the same lazy-resolve path", async ({ page }) => {
    await installApiMocks(page, {
      mediaDetails: mediaMovie,
      subtitlesResponse: subtitlesOkBody({ subtitles: [openSubtitlesLazyRow()] })
    });

    await page.goto("/media/movie/100/subtitles");

    const bestPickBtn = page.locator("#subtitleBestPick").getByRole("button", { name: /download subtitle/i });
    await expect(bestPickBtn).toBeVisible();
    await expect(bestPickBtn).toHaveAttribute("data-os-download", "1");

    const [, popup] = await Promise.all([
      page.waitForRequest(
        (r) => r.url().includes("opensubtitles-resolve-download") && r.method() === "POST"
      ),
      page.waitForEvent("popup"),
      bestPickBtn.click()
    ]);
    expect(popup.url()).toContain("mock-opensubtitles-direct.zip");
    await popup.close();
  });

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
</think>


<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>
Read