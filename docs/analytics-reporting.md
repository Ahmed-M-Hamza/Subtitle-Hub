# Subtitle Hub — analytics reporting readiness

Lightweight guide for observing product behavior after launch. Events are emitted from `public/analytics.js` (`trackProductEvent`) and mirrored to `dataLayer`, `gtag`, `plausible`, and `posthog` when present.

**Debug locally:** `localStorage.setItem("subtitlehub.analyticsDebug", "1")`, or `?analyticsDebug=1`, or localhost → console `[subtitlehub:analytics]`.

**Payload shape:** Every event includes `event` (name), `v: 1`, `app: "subtitlehub"`, `ts` (ISO), plus action-specific props. **No raw search query strings** — use `queryLength`, `searchType`, `tmdbId`, etc.

---

## 1. Event map by theme

### Search & discovery

| Event | When | Useful props |
|-------|------|----------------|
| `search_submitted` | User submits search | `searchSource` (`home_hero`, `global_nav`, `search_page`), `queryLength`, `searchType`, `hasYear` |
| `search_suggestion_selected` | Typeahead pick | `tmdbId`, `mediaType`, `autocompleteSurface` |
| `search_results_viewed` | Results painted | `resultCount`, `searchType`, `queryLength` |
| `search_result_clicked` | Card click to media | `tmdbId`, `mediaType` |
| `recent_search_clicked` | Recent chip | `searchType`, `searchSource` |
| `continue_browsing_clicked` | Home continue rail | `continueKind` |
| `home_card_clicked` | Home feed card | `tmdbId`, `mediaType` |
| `media_page_viewed` | Media detail | route context |

### Subtitle page quality

| Event | When | Useful props |
|-------|------|----------------|
| `subtitles_page_viewed` | API success, UI ready | `resultCount`, `alternateSubtitleCount`, `providerHealthTier`, `tvQueryMode`, route |
| `subtitles_load_failed` | Fetch/throw before list | route context, `actionKind` |
| `no_results_shown` | Filtered/main list empty | `filtersEmptyOnly`, `hasSeasonAlternates`, `providerHealthTier`, `tvQueryMode` |
| `no_results_recovery_clicked` | Empty-state CTA | `recoveryActionId` |
| `subtitle_filters_changed` | Each apply (panel) | `language`, `provider`, `sort`, `hi`, `resolution`, `source`, `codec`, `textFilterLength`, `tvKinds`, `resultCount`, `hasBestPick`, `tvQueryMode`, `providerHealthTier` |
| `subtitle_language_filter_changed` | Language `<select>` | `language` |
| `subtitle_provider_filter_changed` | Provider `<select>` | `provider` |
| `subtitle_best_pick_shown` | Best-pick card rendered | `provider`, `tvMatchKind`, `confidence`, `resultCount` — **fires on every apply** (impressions, not uniques) |
| `provider_health_degraded_shown` | Status banner shown | `providerHealthTier` (banner = not healthy “full/focused” without fallback story — see UI logic) |
| `filename_matching_used` | Filename form submit | `enabled`, `fileNameLength` |
| `load_more_clicked` | Pagination | `surface` (`search_results`, `subtitle_list`, `subtitle_alternates`) |

### Downloads & providers

| Event | When | Useful props |
|-------|------|----------------|
| `subtitle_download_clicked` | User initiates download | `provider`, `fromBestPick`, `via`, `actionKind`, `sourceArea` |
| `subtitle_best_pick_download_clicked` | Best-pick download | `provider` |
| `subtitle_download_resolved` | After OpenSubtitles lazy resolve | `ok`, `provider`, `resolveFailureCode`, `opensubtitlesBlobUsed` (success path), `reason` |
| `view_source_clicked` | OpenSubtitles “view source” | `provider` |

---

## 2. First dashboards (four boards)

Build each in GA4 / Plausible / PostHog using the `event` name as the primary dimension; segment by props where noted.

### Dashboard 1 — Search & discovery

- Volume: `search_submitted` by `searchSource`, `searchType`.
- Typeahead value: `search_suggestion_selected` vs `search_submitted` (typed-only proxy).
- Results quality: `search_results_viewed` — distribution of `resultCount` (0 vs low vs healthy).
- Click-through: `search_result_clicked` / `search_results_viewed` (session- or time-window join).
- Home: `home_card_clicked`, `continue_browsing_clicked`, `recent_search_clicked` counts.
- Funnel (see below): `search_submitted` → `search_results_viewed` → `search_result_clicked` → `media_page_viewed`.

### Dashboard 2 — Subtitle page quality

- Loads: `subtitles_page_viewed` count; breakdown `providerHealthTier`, `tvQueryMode`, `mediaType`.
- Hard failures: `subtitles_load_failed` rate vs `subtitles_page_viewed`.
- Empty UX: `no_results_shown` by `filtersEmptyOnly` (user filters vs true empty).
- Recovery: `no_results_recovery_clicked` after `no_results_shown` (funnel).
- Filter engagement: `subtitle_filters_changed` — breakdown `language`, `provider`, `sort`; non-default `resolution` / `source` / `textFilterLength` > 0.
- List depth: `load_more_clicked` where `surface` = `subtitle_list` or `subtitle_alternates`.

### Dashboard 3 — Downloads & providers

- Intent: `subtitle_download_clicked` by `provider`, `fromBestPick`.
- OpenSubtitles outcomes: `subtitle_download_resolved` by `ok`; failures by `resolveFailureCode` / `reason`.
- Blob vs tab: among `ok: true`, `opensubtitlesBlobUsed` true vs false (delivery UX).
- Best pick: `subtitle_best_pick_download_clicked` / `subtitle_best_pick_shown` (directional CTR; impressions repeat per filter apply).
- Source transparency: `view_source_clicked`.

### Dashboard 4 — Provider health / degraded experience

- Banners: `provider_health_degraded_shown` by `providerHealthTier`.
- Join to `subtitles_page_viewed` on same tier to see **exposure vs outcome** (e.g. sparse tier + download rate).
- Cross-check API: `providerErrors` is not a client event; use `providerHealthTier` + traces in dev (`diagnostics=1`) for deep dives.

---

## 3. Recommended KPIs (watch first)

| KPI | Definition | Primary events |
|-----|------------|----------------|
| **Search success** | % of `search_results_viewed` with `resultCount > 0` | `search_results_viewed` |
| **Search → title** | `search_result_clicked` / `search_results_viewed` | both |
| **Subtitle load reliability** | `subtitles_load_failed` / (`subtitles_page_viewed` + `subtitles_load_failed`) | both |
| **Subtitle usefulness** | `subtitles_page_viewed` with `resultCount > 0` | `subtitles_page_viewed` |
| **Empty state (real vs filters)** | `no_results_shown` split by `filtersEmptyOnly` | `no_results_shown` |
| **Download attempts / session** | Count `subtitle_download_clicked` | `subtitle_download_clicked` |
| **Download success (OS)** | `subtitle_download_resolved` where `ok: true` / same where `provider = opensubtitles` and resolve attempted | `subtitle_download_resolved` |
| **Best pick engagement** | `subtitle_best_pick_download_clicked` / `subtitle_best_pick_shown` (trend only) | both |
| **Degraded exposure** | `provider_health_degraded_shown` / `subtitles_page_viewed` | both |

---

## 4. Funnel joins (practical notes)

Exact joins depend on your tool (GA4 explorations, PostHog funnels, warehouse SQL).

1. **Search funnel (same session):**  
   `search_submitted` → `search_results_viewed` → `search_result_clicked` → `media_page_viewed` → `subtitles_page_viewed`  
   Join key: **session id** + time ordering. Props `tmdbId` / `mediaType` align later steps when available.

2. **Subtitle empty recovery:**  
   `no_results_shown` → `no_results_recovery_clicked` (same session, order preserved).

3. **Best pick (soft):**  
   `subtitle_best_pick_shown` → `subtitle_best_pick_download_clicked` — use **rates over time**, not strict user-level uniqueness, because “shown” repeats when filters re-apply.

4. **OpenSubtitles resolve:**  
   `subtitle_download_clicked` (`via: opensubtitles_lazy_resolve`) → `subtitle_download_resolved` — same session, short time window.

**Stable contract:** Event **names** are snake_case and listed in `AnalyticsEvent` in `public/analytics.js`. Prefer dashboards on `event` + a small set of props; avoid depending on adapter-specific reshaping.

---

## 5. First 1–2 weeks after launch — what to monitor

- Spikes in `subtitles_load_failed` or `subtitle_download_resolved` with `ok: false`.
- Share of `search_results_viewed` with `resultCount === 0` (TMDb/search issues or bad queries).
- `no_results_shown` with `filtersEmptyOnly: false` vs `true` (catalog vs UX).
- `provider_health_degraded_shown` volume by `providerHealthTier` (upstream pain).
- `opensubtitlesBlobUsed` false rate on successful resolves (CORS / fallback to tab).
- `load_more_clicked` on `subtitle_list` (whether 40-row default is enough).

---

## 6. What decisions these metrics inform

| Signal | Decision lever |
|--------|----------------|
| Low search → click-through | Search ranking, typeahead prominence, empty results copy |
| High `subtitles_load_failed` | API stability, Netlify function errors, caching |
| Many `no_results_shown` + `filtersEmptyOnly` | Default language/provider, home vs search entry |
| Many `filtersEmptyOnly` only | Filter UI complexity vs presets |
| High degraded tier + low downloads | Provider redundancy messaging, default provider |
| Low `opensubtitlesBlobUsed` | CDN/CORS expectations; keep tab fallback vs proxy |
| Best pick CTR flat | Ranking weights, best-pick visibility rules |
| Filename / filter dimensions used | Whether to promote filename match or simplify filters |

---

## 7. Naming note (no rename required)

- `subtitle_download_clicked` may use `actionKind: lazy_resolve_then_open` for OpenSubtitles; delivery can be blob or tab. Use **`opensubtitlesBlobUsed`** on `subtitle_download_resolved` to segment actual delivery.

This file is the single reporting reference; update it when adding or renaming events.

**Soft launch:** day-to-day checks, health/build fields, and SEO placeholders — see [launch-observation.md](./launch-observation.md).
