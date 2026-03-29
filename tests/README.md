# Regression & smoke tests

## Unit tests (fast, no network)

Exercises **provider health tier math** and **TV classification** using the same implementations as `netlify/functions/_shared.js`.

```bash
npm test
```

## HTTP smoke + subtitle regression (live API)

Requires a running site with Netlify Functions and valid API keys (e.g. `npm run dev` in another terminal).

```bash
npm run smoke
# or explicitly:
BASE_URL=http://localhost:8888 npm run smoke
```

Optional:

- `SMOKE_DIAGNOSTICS=1` — slower runs that assert `diagnostics` payload and log SubDL HTML fallback / OpenSubtitles identity reject counts.
- `SMOKE_MOVIE_TMDB_ID` / `SMOKE_TV_TMDB_ID` — override canonical TMDb ids used for the provider/language matrix.
- `SMOKE_SLOW_TIMEOUT_MS` — raise if cold starts time out.

```bash
npm run smoke:diag
```

## Full regression gate

```bash
npm run regression
```

Runs **unit tests first**, then **smoke** (fails if Netlify is not up — run smoke separately in CI with a preview URL).

## Browser / Playwright (UI)

Static site + **mocked** `/.netlify/functions/*` — no Netlify dev or provider API keys required.

```bash
npx playwright install chromium   # once per machine
npm run test:e2e
npm run test:e2e:ui                 # interactive UI mode
```

Uses `serve public` on port **4173** (started automatically unless you reuse an existing server). Override with `PLAYWRIGHT_BASE_URL` if you host static files elsewhere.

## Intentionally not covered here

- **Deep visual regression** (pixel snapshots) — avoided in favor of DOM / text assertions.
- **Full `npm run regression` + Playwright** — keep `regression` as unit + HTTP smoke; run `test:e2e` in CI as a separate job with browsers installed.
- **Deterministic “wrong show” row counts**: depends on live OpenSubtitles data; diagnostics mode only *observes* `tvRejectedShowMismatch` when present.
- **Guaranteed SubDL HTML fallback**: environment-specific; diagnostics note records `htmlFallbackUsed` when true.
