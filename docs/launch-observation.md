# Soft launch — readiness notes & observation checklist

Companion to [analytics-reporting.md](./analytics-reporting.md) (events, dashboards, KPIs).

---

## Launch readiness (lightweight review)

| Area | Status / note |
|------|----------------|
| **API routes** | `public/_redirects` maps `/api/*` → Netlify functions; health, subtitles, search, etc. |
| **Health link** | Nav/footer use `/api/health` (works on Netlify; local `netlify dev` same). |
| **Social preview** | `og:image` / `twitter:image` point to **`/favicon.svg`** (file exists). Replace with a **1200×630 PNG** at `/og-image.png` before heavy social sharing; then update `index.html` + `app.js` `updateDocumentMeta` to use it and restore `og:image` dimensions if desired. |
| **Sitemap / robots** | `public/sitemap.xml` and `robots.txt` still use placeholder host **`subtitle-hub.example`** — set to your **canonical production URL** before SEO/marketing. |
| **Analytics** | `public/analytics.js` → adapters + `dataLayer`; debug via `subtitlehub.analyticsDebug=1` or localhost. |
| **Provider-limited UX** | `providerHealth` tiers drive banners and copy; degraded paths are instrumented (`provider_health_degraded_shown`). |
| **Error states** | Subtitle load failure, OpenSubtitles quota, empty filters, and search errors have user-facing copy + toasts; `subtitles_load_failed` for hard fetch failures. |

---

## First 1–2 weeks — daily / frequent checks

**Every day (5–10 min)**

- [ ] **`/api/health`** → `ready: true`, expected `tmdbConfigured` / provider flags match env.
- [ ] **`build` object** on health (when on Netlify): `commitRef`, `deployId`, `deployContext` help confirm which revision is live; `subtitlePipelineCacheRev` bumps when subtitle logic changes.
- [ ] **Error rate** in your analytics tool: spikes in `subtitles_load_failed`, `subtitle_download_resolved` with `ok: false`.
- [ ] **Search**: `search_results_viewed` with `resultCount === 0` — unusual share vs baseline.

**2–3× / week**

- [ ] **Funnel shape**: search → subtitle page → download (see analytics doc).
- [ ] **`no_results_shown`** split: `filtersEmptyOnly` true vs false (UX vs catalog).
- [ ] **`opensubtitlesBlobUsed`** on successful resolves (CORS / download UX).

---

## Signals that indicate real problems

| Signal | Likely meaning |
|--------|----------------|
| **`ready: false`** on health | Missing TMDB or both subtitle providers — fix env before anything else. |
| **Sustained ↑ `subtitles_load_failed`** | Functions/timeouts/upstream; check Netlify logs + provider status. |
| **Sustained ↑ failed `subtitle_download_resolved`** (OS) | Quota, API changes, or resolve endpoint issues. |
| **↑ `no_results_shown` with `filtersEmptyOnly: false`** | Catalog / TMDb / query mismatch — not just UI filters. |
| **↑ `provider_health_degraded_shown` + ↓ downloads** | One provider down or rate-limited — communicate and prioritize redundancy. |
| **Search zero-results rate jumps** | TMDb or search function regression. |

---

## Thresholds → action (starting points; tune to your traffic)

| Metric | Heuristic threshold | Action |
|--------|---------------------|--------|
| `subtitles_load_failed` / subtitle sessions | **> ~2–5%** for 24h | Inspect function logs, cache, env; reproduce with `diagnostics=1`. |
| `subtitle_download_resolved` `ok: false` (OS) | **> ~10%** of OS resolve attempts | Check OpenSubtitles status, quotas, user-agent / keys. |
| `search_results_viewed` `resultCount === 0` | **> ~15–25%** of searches (baseline-dependent) | Review search API + query normalization. |
| Health `ready: false` | **Any** production check | Treat as **P0** until fixed. |
| `opensubtitlesBlobUsed: false` among successes | **> ~50%** if you expected blob-first | CDN CORS; document tab fallback or consider proxy later. |

---

## What these metrics should inform (soft launch)

- **Stability first**: fix load failures and health before new UX.
- **Provider mix**: if one provider dominates failures, adjust defaults and messaging.
- **Search vs subtitles**: if search is healthy but subtitles empty, problem is aggregation/providers not discovery.
- **Post-launch asset**: add **`/og-image.png`** and real **sitemap/robots URLs** when you start sharing links widely.
