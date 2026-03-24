# Subtitle Hub (Netlify-Ready)

Static frontend + Netlify Functions subtitle application.

## Architecture

- `public/` static site (RTL Arabic UI)
- `netlify/functions/health.js` health endpoint
- `netlify/functions/search-media.js` TMDb search endpoint
- `netlify/functions/subtitles.js` SubDL/OpenSubtitles aggregated endpoint
- `netlify.toml` Netlify publish/functions config
- `public/_redirects` SPA fallback + legacy `/api/*` compatibility

## Local development

```bash
npm install
npm run dev
```

## Netlify deployment

1. Push repository to GitHub/GitLab/Bitbucket.
2. Create a new Netlify site from the repo.
3. Build settings (auto-read from `netlify.toml`):
   - Publish directory: `public`
   - Functions directory: `netlify/functions`
4. Add environment variables in Netlify UI (Site settings > Environment variables):
   - `TMDB_BEARER_TOKEN`
   - `SUBDL_API_KEY` (optional if OpenSubtitles is configured)
   - `OPENSUBTITLES_API_KEY` (optional if SubDL is configured)
   - `OPENSUBTITLES_USERNAME` (optional, improves OpenSubtitles auth/token usage)
   - `OPENSUBTITLES_PASSWORD` (optional)
   - `OPENSUBTITLES_USER_AGENT` (recommended, e.g. `SubtitleHub-Netlify/1.0`)
   - `APP_NAME` (optional)
5. Trigger deploy.

## API endpoints

- `/.netlify/functions/health`
- `/.netlify/functions/search-media?query=...&type=movie|tv|multi&year=...`
- `/.netlify/functions/subtitles?tmdbId=...&mediaType=movie|tv&language=ar&provider=all|subdl|opensubtitles`

Legacy compatibility routes also work via redirects:

- `/api/health`
- `/api/search-media`
- `/api/subtitles`
