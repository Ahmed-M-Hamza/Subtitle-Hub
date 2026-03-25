const appEl = document.getElementById("app");
const globalSearchForm = document.getElementById("globalSearchForm");
const globalSearchInput = document.getElementById("globalSearchInput");

const RECENT_SEARCH_KEY = "subtitlehub.recentSearches";
const state = {
  selectedMedia: null
};

function escapeHtml(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setActiveNav(pathname) {
  for (const node of document.querySelectorAll("[data-nav]")) {
    const key = node.getAttribute("data-nav");
    const active = key === "home" ? pathname === "/" : pathname.startsWith("/search") || pathname.startsWith("/media");
    node.classList.toggle("is-active", active);
  }
}

function parseLocation() {
  const { pathname, search } = window.location;
  const params = new URLSearchParams(search);
  if (pathname === "/") return { page: "home" };
  if (pathname === "/search") {
    return {
      page: "search",
      query: params.get("query") || "",
      type: params.get("type") || "multi",
      year: params.get("year") || ""
    };
  }
  const subtitlesMatch = pathname.match(/^\/media\/(movie|tv)\/(\d+)\/subtitles$/);
  if (subtitlesMatch) {
    return {
      page: "subtitles",
      mediaType: subtitlesMatch[1],
      tmdbId: subtitlesMatch[2],
      language: params.get("language") || "ar",
      provider: params.get("provider") || "all",
      season: params.get("season") || "",
      episode: params.get("episode") || "",
      year: params.get("year") || ""
    };
  }
  const mediaMatch = pathname.match(/^\/media\/(movie|tv)\/(\d+)$/);
  if (mediaMatch) {
    return {
      page: "media",
      mediaType: mediaMatch[1],
      tmdbId: mediaMatch[2],
      year: params.get("year") || "",
      provider: params.get("provider") || "all",
      lang: params.get("lang") || "ar",
      season: params.get("season") || "",
      episode: params.get("episode") || ""
    };
  }
  return { page: "404" };
}

function toSearchUrl(search) {
  const params = new URLSearchParams();
  if (search.query) params.set("query", search.query);
  if (search.type && search.type !== "multi") params.set("type", search.type);
  if (search.year) params.set("year", search.year);
  const qs = params.toString();
  return qs ? `/search?${qs}` : "/search";
}

function toMediaUrl(media, extra = {}) {
  const params = new URLSearchParams();
  const year = extra.year || media.year || "";
  if (year) params.set("year", year);
  if (extra.lang) params.set("lang", extra.lang);
  if (extra.provider) params.set("provider", extra.provider);
  if (extra.season) params.set("season", extra.season);
  if (extra.episode) params.set("episode", extra.episode);
  const qs = params.toString();
  return `/media/${media.mediaType}/${media.tmdbId}${qs ? `?${qs}` : ""}`;
}

function toSubtitlesUrl(media, filter = {}) {
  const params = new URLSearchParams();
  if (filter.language) params.set("language", filter.language);
  if (filter.provider) params.set("provider", filter.provider);
  if (filter.season) params.set("season", filter.season);
  if (filter.episode) params.set("episode", filter.episode);
  if (filter.year || media.year) params.set("year", filter.year || media.year || "");
  return `/media/${media.mediaType}/${media.tmdbId}/subtitles?${params.toString()}`;
}

async function apiFetch(path) {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function fetchHealth() {
  return apiFetch("/.netlify/functions/health");
}

async function fetchSearchMedia(query, type, year) {
  const params = new URLSearchParams();
  params.set("query", query);
  params.set("type", type || "multi");
  if (year) params.set("year", year);
  return apiFetch(`/.netlify/functions/search-media?${params.toString()}`);
}

async function fetchSubtitles({ tmdbId, mediaType, language, provider, season, episode, year }) {
  const params = new URLSearchParams();
  params.set("tmdbId", tmdbId);
  params.set("mediaType", mediaType);
  params.set("language", language || "ar");
  params.set("provider", provider || "all");
  if (season) params.set("season", season);
  if (episode) params.set("episode", episode);
  if (year) params.set("year", year);
  return apiFetch(`/.netlify/functions/subtitles?${params.toString()}`);
}

async function fetchMediaDetails(tmdbId, mediaType) {
  const params = new URLSearchParams();
  params.set("tmdbId", String(tmdbId));
  params.set("mediaType", mediaType);
  return apiFetch(`/.netlify/functions/media-details?${params.toString()}`);
}

function getRecentSearches() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_SEARCH_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 6) : [];
  } catch {
    return [];
  }
}

function addRecentSearch(item) {
  if (!item.query) return;
  const prev = getRecentSearches().filter((s) => s.query.toLowerCase() !== item.query.toLowerCase());
  const next = [{ query: item.query, type: item.type || "multi", year: item.year || "" }, ...prev].slice(0, 6);
  localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(next));
}

function bindGlobalSearch(route) {
  if (!globalSearchForm || !globalSearchInput) return;
  globalSearchInput.value = route?.query || "";
  globalSearchForm.onsubmit = (e) => {
    e.preventDefault();
    const query = globalSearchInput.value.trim();
    if (!query) return;
    addRecentSearch({ query, type: "multi", year: "" });
    navigate(toSearchUrl({ query, type: "multi", year: "" }));
  };
}

function renderHome() {
  appEl.innerHTML = `
    <section class="hero hero-card">
      <span class="badge">منصة ترجمة عربية متكاملة</span>
      <h1 class="hero-title">اعثر على الترجمة المناسبة في ثوانٍ</h1>
      <p class="hero-subtitle">
        ابحث عن فيلم أو مسلسل، ثم استعرض ترجمات منظمة مع تصنيف الجودة والمصدر والمزوّد في واجهة واحدة سهلة.
      </p>
      <div class="stats-grid">
        <div class="stat-chip"><strong>TMDb</strong>تعريف دقيق للعمل</div>
        <div class="stat-chip"><strong>SubDL + OpenSubtitles</strong>مصادر متعددة</div>
        <div class="stat-chip"><strong>بحث دائم</strong>يمكنك البحث من أي صفحة</div>
      </div>
      <div class="row-actions">
        <a class="btn btn-primary" href="/search" data-link>ابدأ البحث الآن</a>
        <button id="quickHealthBtn" class="secondary" type="button">فحص الحالة</button>
      </div>
      <div id="healthResult" class="hint"></div>
    </section>
  `;
  document.getElementById("quickHealthBtn")?.addEventListener("click", async () => {
    const el = document.getElementById("healthResult");
    el.textContent = "جارٍ فحص الحالة...";
    try {
      const h = await fetchHealth();
      el.textContent = `TMDb: ${h.tmdbConfigured ? "جاهز" : "غير جاهز"} | SubDL: ${
        h.subdlConfigured ? "جاهز" : "غير جاهز"
      } | OpenSubtitles: ${h.opensubtitlesConfigured ? "جاهز" : "غير جاهز"}`;
    } catch (err) {
      el.textContent = `فشل الفحص: ${err.message}`;
    }
  });
}

function renderSearchShell({ query = "", type = "multi", year = "" }) {
  const recent = getRecentSearches();
  appEl.innerHTML = `
    <section class="hero hero-card">
      <span class="badge">مرحلة 1: اختيار العمل</span>
      <h1 class="hero-title">ابحث عن فيلم أو مسلسل</h1>
      <p class="hero-subtitle">نتائج مرتبة مع بطاقة واضحة لكل عمل وزر مباشر لعرض الترجمات.</p>
    </section>
    <section class="search-layout">
      <aside class="card filter-panel">
        <div class="card-inner">
          <div class="card-title-row">
            <h2 class="title-h2">فلاتر البحث</h2>
            <span class="title-meta">TMDb</span>
          </div>
          <form id="searchForm" class="form-grid">
            <div class="field">
              <label for="query">اسم الفيلم أو المسلسل</label>
              <input id="query" name="query" value="${escapeHtml(query)}" placeholder="مثال: Interstellar" required />
            </div>
            <div class="form-grid two-col">
              <div class="field">
                <label for="type">النوع</label>
                <select id="type" name="type">
                  <option value="multi" ${type === "multi" ? "selected" : ""}>الكل</option>
                  <option value="movie" ${type === "movie" ? "selected" : ""}>فيلم</option>
                  <option value="tv" ${type === "tv" ? "selected" : ""}>مسلسل</option>
                </select>
              </div>
              <div class="field">
                <label for="year">السنة</label>
                <input id="year" name="year" value="${escapeHtml(year)}" placeholder="2014" inputmode="numeric" />
              </div>
            </div>
            <div class="row-actions">
              <button type="submit">بحث</button>
              <a class="btn secondary" href="/search" data-link>مسح</a>
            </div>
          </form>
          ${
            recent.length
              ? `<div class="recent-searches">${recent
                  .map(
                    (s) => `<button class="secondary btn-sm" type="button" data-recent='${escapeHtml(
                      JSON.stringify(s)
                    )}'>${escapeHtml(s.query)}</button>`
                  )
                  .join("")}</div>`
              : ""
          }
          <p class="footer-note">نصيحة: حدّد السنة لتضييق النتائج المتشابهة.</p>
        </div>
      </aside>
      <section>
        <div class="section-header">
          <div>
            <h2 class="section-title">نتائج البحث</h2>
            <p class="section-sub" id="searchSummary">${query ? `تم البحث عن: "${escapeHtml(query)}"` : "ابدأ البحث لعرض النتائج."}</p>
          </div>
          <span class="pill" id="searchCount"></span>
        </div>
        <div id="searchStatus"></div>
        <div id="searchResults" class="media-grid"></div>
      </section>
    </section>
  `;
}

function renderMediaCards(results = []) {
  const list = document.getElementById("searchResults");
  const countEl = document.getElementById("searchCount");
  if (!results.length) {
    countEl.textContent = "";
    list.innerHTML = `<p class="empty">لا توجد نتائج مطابقة. جرّب تعديل الاسم أو النوع أو السنة.</p>`;
    return;
  }
  countEl.textContent = `عدد النتائج: ${results.length}`;
  list.innerHTML = results
    .map(
      (item) => `
      <article class="media-card">
        <a href="${toMediaUrl(item)}" data-link>
          <img class="poster" src="${item.poster || "https://placehold.co/500x750/0d132b/eef3ff?text=No+Poster"}" alt="" />
          <div class="media-body">
            <h3 class="media-title">${escapeHtml(item.title)}</h3>
            <div class="meta">
              <span class="pill">${item.mediaType === "movie" ? "فيلم" : "مسلسل"}</span>
              <span>${escapeHtml(item.year || "—")}</span>
              <span>TMDb ${escapeHtml(item.tmdbId)}</span>
            </div>
            <p class="overview">${escapeHtml(
              item.overview
                ? item.overview.length > 150
                  ? `${item.overview.slice(0, 150)}…`
                  : item.overview
                : "لا يوجد وصف."
            )}</p>
            <div class="card-cta"><span class="btn btn-sm">عرض الترجمات</span></div>
          </div>
        </a>
      </article>
    `
    )
    .join("");
}

async function renderSearch(route) {
  const query = route.query || "";
  const type = route.type || "multi";
  const year = route.year || "";
  renderSearchShell({ query, type, year });
  const form = document.getElementById("searchForm");
  const status = document.getElementById("searchStatus");
  const summary = document.getElementById("searchSummary");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const payload = {
      query: form.query.value.trim(),
      type: form.type.value,
      year: form.year.value.trim()
    };
    addRecentSearch(payload);
    navigate(toSearchUrl(payload));
  });
  for (const b of document.querySelectorAll("[data-recent]")) {
    b.addEventListener("click", () => {
      try {
        const parsed = JSON.parse(b.getAttribute("data-recent"));
        navigate(toSearchUrl(parsed));
      } catch {}
    });
  }
  if (!query) {
    renderMediaCards([]);
    return;
  }
  status.innerHTML = `<div class="alert alert-info">جارٍ البحث...</div>`;
  summary.textContent = `تم البحث عن: "${query}"`;
  try {
    const data = await fetchSearchMedia(query, type, year);
    status.innerHTML = "";
    renderMediaCards(data.results || []);
  } catch (err) {
    status.innerHTML = `<div class="alert alert-error">فشل البحث: ${escapeHtml(err.message)}</div>`;
    document.getElementById("searchResults").innerHTML = "";
  }
}

async function getMediaById(tmdbId, mediaType) {
  const data = await fetchMediaDetails(tmdbId, mediaType);
  return data.media || null;
}

function parseReleaseMetadata(sub) {
  const raw = [sub.releaseName || "", ...(Array.isArray(sub.releases) ? sub.releases : [])].join(" ").toLowerCase();
  const resolution = raw.match(/\b(2160p|1080p|720p|480p)\b/i)?.[1] || "";
  const source =
    raw.match(/\b(bluray|web-dl|webrip|hdrip|dvdrip|remux|hdtv)\b/i)?.[1] || "";
  const codec = raw.match(/\b(x265|x264|hevc|h\.?264)\b/i)?.[1] || "";
  const extras = ["remastered", "extended", "proper"].filter((t) => raw.includes(t));
  const group = raw.match(/-(\w{2,12})$/i)?.[1] || "";
  const cdCount = raw.match(/\bcd\s?(\d)\b/i)?.[1] || "";
  const fileCount = Array.isArray(sub.releases) ? sub.releases.length : 0;
  return {
    resolution: resolution.toUpperCase(),
    source: source.toUpperCase(),
    codec: codec.toUpperCase(),
    extras: extras.map((e) => e.toUpperCase()),
    group: group.toUpperCase(),
    cdCount,
    fileCount
  };
}

function scoreSubtitle(item) {
  let score = 0;
  if (item.meta.resolution === "2160P") score += 40;
  if (item.meta.resolution === "1080P") score += 30;
  if (item.meta.resolution === "720P") score += 20;
  if (item.meta.source.includes("WEB")) score += 10;
  if (item.meta.source.includes("BLURAY")) score += 12;
  if (item.provider === "subdl") score += 6;
  if (item.provider === "opensubtitles") score += 5;
  if (item.hearingImpaired) score -= 1;
  return score;
}

function applySubtitleFilters(subtitles, controls) {
  const query = controls.text.trim().toLowerCase();
  let items = subtitles.filter((s) => {
    if (controls.language !== "all" && String(s.language || "").toLowerCase() !== controls.language) return false;
    if (controls.provider !== "all" && String(s.provider || "") !== controls.provider) return false;
    if (controls.hi === "only" && !s.hearingImpaired) return false;
    if (controls.hi === "exclude" && s.hearingImpaired) return false;
    if (controls.resolution !== "all" && s.meta.resolution !== controls.resolution) return false;
    if (controls.source !== "all" && s.meta.source !== controls.source) return false;
    if (query && !`${s.releaseName} ${s.author} ${s.comment}`.toLowerCase().includes(query)) return false;
    return true;
  });

  if (controls.sort === "trusted") {
    items = items.sort((a, b) => {
      const rank = { subdl: 1, opensubtitles: 2 };
      return (rank[a.provider] || 9) - (rank[b.provider] || 9);
    });
  } else if (controls.sort === "newest") {
    items = items.sort((a, b) => b.releaseName.localeCompare(a.releaseName));
  } else if (controls.sort === "best") {
    items = items.sort((a, b) => scoreSubtitle(b) - scoreSubtitle(a));
  }
  return items;
}

function providerPillClass(provider) {
  if (provider === "subdl") return "provider-subdl";
  if (provider === "opensubtitles") return "provider-opensubtitles";
  return "";
}

function renderMediaForm(media, route) {
  appEl.innerHTML = `
    <nav class="breadcrumb" aria-label="مسار التنقل">
      <a href="/" data-link>الرئيسية</a> › <a href="/search" data-link>البحث</a> › <span>${escapeHtml(media.title)}</span>
    </nav>
    <div class="card">
      <div class="card-inner">
        <div class="detail-layout">
          <div><img class="poster" src="${media.poster || "https://placehold.co/500x750/0d132b/eef3ff?text=No+Poster"}" alt="" /></div>
          <div>
            <div class="detail-meta">
              <span class="pill">${media.mediaType === "movie" ? "فيلم" : "مسلسل"}</span>
              <span class="pill">TMDb ${escapeHtml(media.tmdbId)}</span>
              ${media.year ? `<span class="pill">${escapeHtml(media.year)}</span>` : ""}
            </div>
            <h1 class="hero-title" style="font-size:clamp(1.7rem,3vw,2.2rem)">${escapeHtml(media.title)}</h1>
            <p class="hero-subtitle" style="font-size:15px;max-width:none;margin-top:12px;">${escapeHtml(media.overview || "لا يوجد وصف.")}</p>
            <div class="section-header" style="margin-top:26px;"><h2 class="section-title">خيارات الترجمة</h2><span class="section-sub">بحث مباشر دون مغادرة الصفحة</span></div>
            <form id="subtitleForm" class="form-grid">
              <div class="form-grid two-col">
                <div class="field">
                  <label for="language">لغة الترجمة</label>
                  <select id="language" name="language">
                    ${["ar", "en", "fr", "de", "es", "tr"]
                      .map((lng) => `<option value="${lng}" ${route.lang === lng ? "selected" : ""}>${lng}</option>`)
                      .join("")}
                  </select>
                </div>
                <div class="field">
                  <label for="provider">مزوّد الترجمة</label>
                  <select id="provider" name="provider">
                    <option value="all" ${route.provider === "all" ? "selected" : ""}>الكل</option>
                    <option value="subdl" ${route.provider === "subdl" ? "selected" : ""}>SubDL</option>
                    <option value="opensubtitles" ${route.provider === "opensubtitles" ? "selected" : ""}>OpenSubtitles</option>
                  </select>
                </div>
              </div>
              ${
                media.mediaType === "tv"
                  ? `
                <div class="form-grid two-col">
                  <div class="field"><label for="season">الموسم</label><input id="season" name="season" value="${escapeHtml(route.season || "")}" /></div>
                  <div class="field"><label for="episode">الحلقة</label><input id="episode" name="episode" value="${escapeHtml(route.episode || "")}" /></div>
                </div>`
                  : ""
              }
              <div class="row-actions" style="margin-top:14px;">
                <button type="submit">عرض الترجمات</button>
                <a class="btn secondary" href="/search" data-link>عودة للبحث</a>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  `;
  document.getElementById("subtitleForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const filter = {
      language: form.language.value,
      provider: form.provider.value,
      season: form.season ? form.season.value.trim() : "",
      episode: form.episode ? form.episode.value.trim() : "",
      year: route.year || media.year || ""
    };
    navigate(toSubtitlesUrl(media, filter));
  });
}

async function renderMedia(route) {
  appEl.innerHTML = `<div class="alert alert-info">جارٍ تحميل تفاصيل العمل...</div>`;
  try {
    if (!/^\d+$/.test(String(route.tmdbId || ""))) {
      appEl.innerHTML = `<div class="alert alert-error">معرّف TMDb غير صالح.</div>`;
      return;
    }
    const media = await getMediaById(route.tmdbId, route.mediaType);
    if (!media) {
      appEl.innerHTML = `<div class="alert alert-error">تعذر العثور على العمل المطلوب.</div>`;
      return;
    }
    if (route.year) media.year = route.year;
    state.selectedMedia = media;
    renderMediaForm(media, route);
  } catch (err) {
    appEl.innerHTML = `<div class="alert alert-error">فشل تحميل تفاصيل العمل: ${escapeHtml(err.message)}</div>`;
  }
}

function renderSubtitleCards(target, subtitles) {
  if (!subtitles.length) {
    target.innerHTML = `<p class="empty">لا توجد ترجمات بهذه الإعدادات.</p>`;
    return;
  }
  target.innerHTML = subtitles
    .map((sub) => {
      const rel = Array.isArray(sub.releases) && sub.releases.length ? sub.releases.slice(0, 5).join("، ") : "—";
      const tags = [
        sub.meta.resolution && `<span class="tag-chip strong">${sub.meta.resolution}</span>`,
        sub.meta.source && `<span class="tag-chip">${sub.meta.source}</span>`,
        sub.meta.codec && `<span class="tag-chip">${sub.meta.codec}</span>`,
        sub.meta.group && `<span class="tag-chip">GRP ${escapeHtml(sub.meta.group)}</span>`,
        sub.meta.cdCount && `<span class="tag-chip">CD ${escapeHtml(sub.meta.cdCount)}</span>`,
        sub.meta.fileCount ? `<span class="tag-chip">${sub.meta.fileCount} files</span>` : "",
        ...sub.meta.extras.map((e) => `<span class="tag-chip">${escapeHtml(e)}</span>`)
      ]
        .filter(Boolean)
        .join("");
      return `
      <article class="sub-item">
        <div class="sub-head">
          <div>
            <div class="sub-title">${escapeHtml(sub.releaseName || "Subtitle")}</div>
            <div class="hint">الرافع: ${escapeHtml(sub.author || "غير معروف")}</div>
          </div>
          <span class="pill">${escapeHtml(sub.language || "")}${sub.hearingImpaired ? " • HI" : ""}</span>
        </div>
        <div class="sub-meta">
          <span class="pill ${providerPillClass(sub.provider)}">${escapeHtml(sub.provider || "unknown")}</span>
          ${tags}
        </div>
        <div class="hint">الإصدارات: ${escapeHtml(rel)}</div>
        ${sub.comment ? `<div class="hint">ملاحظة: ${escapeHtml(sub.comment)}</div>` : ""}
        <div class="row-actions"><a class="btn btn-sm" href="${escapeHtml(sub.downloadUrl)}" target="_blank" rel="noopener noreferrer">تحميل</a></div>
      </article>
      `;
    })
    .join("");
}

async function renderSubtitles(route) {
  if (!/^\d+$/.test(String(route.tmdbId || ""))) {
    appEl.innerHTML = `<div class="alert alert-error">معرّف TMDb غير صالح.</div>`;
    return;
  }
  const media =
    state.selectedMedia &&
    String(state.selectedMedia.tmdbId) === String(route.tmdbId) &&
    state.selectedMedia.mediaType === route.mediaType
      ? state.selectedMedia
      : await getMediaById(route.tmdbId, route.mediaType);
  if (media) state.selectedMedia = media;

  appEl.innerHTML = `
    <nav class="breadcrumb" aria-label="مسار التنقل">
      <a href="/" data-link>الرئيسية</a> ›
      <a href="/search" data-link>البحث</a> ›
      ${media ? `<a href="${toMediaUrl(media, { year: route.year || media.year || "", lang: route.language, provider: route.provider })}" data-link>${escapeHtml(media.title)}</a> ›` : ""}
      <span>الترجمات</span>
    </nav>
    <section class="sub-layout">
      <aside class="card sub-filters-panel">
        <div class="card-inner">
          <div class="card-title-row">
            <h2 class="title-h2">فلاتر الترجمة</h2>
            <span class="title-meta">قابلة للتطبيق فورًا</span>
          </div>
          <form id="subFilterForm" class="form-grid">
            <div class="field">
              <label>بحث داخل النتائج</label>
              <input name="text" placeholder="اسم الإصدار أو الملاحظات..." />
            </div>
            <div class="form-grid two-col">
              <div class="field">
                <label>اللغة</label>
                <select name="languageFilter">
                  <option value="all">الكل</option>
                </select>
              </div>
              <div class="field">
                <label>المزوّد</label>
                <select name="providerFilter">
                  <option value="all">الكل</option>
                  <option value="subdl">SubDL</option>
                  <option value="opensubtitles">OpenSubtitles</option>
                </select>
              </div>
            </div>
            <div class="form-grid two-col">
              <div class="field">
                <label>جودة الصورة</label>
                <select name="resolutionFilter"><option value="all">الكل</option></select>
              </div>
              <div class="field">
                <label>المصدر</label>
                <select name="sourceFilter"><option value="all">الكل</option></select>
              </div>
            </div>
            <div class="form-grid two-col">
              <div class="field">
                <label>SDH / HI</label>
                <select name="hiFilter">
                  <option value="all">الكل</option>
                  <option value="only">فقط HI</option>
                  <option value="exclude">استبعاد HI</option>
                </select>
              </div>
              <div class="field">
                <label>الترتيب</label>
                <select name="sort">
                  <option value="best">أفضل تطابق</option>
                  <option value="trusted">الموثوق أولًا</option>
                  <option value="newest">أحدث اسم إصدار</option>
                </select>
              </div>
            </div>
            <div class="row-actions">
              <button type="button" id="applySubFilters" class="btn-sm">تطبيق</button>
              <button type="button" id="resetSubFilters" class="secondary btn-sm">إعادة ضبط</button>
            </div>
          </form>
          <p class="footer-note">يمكنك البحث عن فيلم آخر مباشرة من شريط البحث بالأعلى بدون الرجوع.</p>
        </div>
      </aside>
      <section>
        <div class="card">
          <div class="card-inner">
            <div class="section-header" style="margin:0 0 8px;">
              <h1 class="section-title" style="font-size:1.4rem;">نتائج الترجمة</h1>
              <span class="pill" id="subtitleCount"></span>
            </div>
            <p class="hint">${media ? escapeHtml(media.title) : `TMDb ${escapeHtml(route.tmdbId)}`} — اللغة: ${escapeHtml(route.language)} — المزود: ${escapeHtml(route.provider)}</p>
            <div class="row-actions" style="margin-top:14px;">
              ${
                media
                  ? `<a class="btn secondary btn-sm" href="${toMediaUrl(media, {
                      year: route.year || media.year || "",
                      lang: route.language,
                      provider: route.provider,
                      season: route.season,
                      episode: route.episode
                    })}" data-link>← العودة للتفاصيل</a>`
                  : `<a class="btn secondary btn-sm" href="/search" data-link>← العودة للبحث</a>`
              }
            </div>
          </div>
        </div>
        <div id="subtitleStatus" style="margin-top:12px;"></div>
        <div id="subtitleList" class="sub-list" style="margin-top:16px;"></div>
      </section>
    </section>
  `;

  const status = document.getElementById("subtitleStatus");
  const list = document.getElementById("subtitleList");
  const count = document.getElementById("subtitleCount");
  status.innerHTML = `<div class="alert alert-info">جارٍ تحميل الترجمات...</div>`;
  try {
    const data = await fetchSubtitles({
      tmdbId: route.tmdbId,
      mediaType: route.mediaType,
      language: route.language,
      provider: route.provider,
      season: route.season,
      episode: route.episode,
      year: route.year
    });
    const base = (data.subtitles || []).map((s) => ({ ...s, meta: parseReleaseMetadata(s) }));
    const form = document.getElementById("subFilterForm");
    const langSet = [...new Set(base.map((s) => String(s.language || "").toLowerCase()).filter(Boolean))];
    const resolutionSet = [...new Set(base.map((s) => s.meta.resolution).filter(Boolean))];
    const sourceSet = [...new Set(base.map((s) => s.meta.source).filter(Boolean))];
    form.languageFilter.innerHTML = `<option value="all">الكل</option>${langSet
      .map((l) => `<option value="${l}">${l.toUpperCase()}</option>`)
      .join("")}`;
    form.resolutionFilter.innerHTML = `<option value="all">الكل</option>${resolutionSet
      .map((r) => `<option value="${r}">${r}</option>`)
      .join("")}`;
    form.sourceFilter.innerHTML = `<option value="all">الكل</option>${sourceSet
      .map((s) => `<option value="${s}">${s}</option>`)
      .join("")}`;
    if (route.provider) form.providerFilter.value = route.provider;

    const apply = () => {
      const filtered = applySubtitleFilters(base, {
        text: form.text.value || "",
        language: form.languageFilter.value,
        provider: form.providerFilter.value,
        hi: form.hiFilter.value,
        resolution: form.resolutionFilter.value,
        source: form.sourceFilter.value,
        sort: form.sort.value
      });
      count.textContent = filtered.length ? `عدد النتائج: ${filtered.length}` : "لا نتائج";
      renderSubtitleCards(list, filtered);
    };

    status.innerHTML = "";
    if (Array.isArray(data.providerErrors) && data.providerErrors.length) {
      status.innerHTML = `<div class="alert alert-info">بعض المزودين فشلوا: ${escapeHtml(
        data.providerErrors.map((e) => `${e.provider}: ${e.message}`).join(" | ")
      )}</div>`;
    }

    document.getElementById("applySubFilters").addEventListener("click", apply);
    document.getElementById("resetSubFilters").addEventListener("click", () => {
      form.reset();
      form.providerFilter.value = route.provider || "all";
      apply();
    });
    form.addEventListener("change", apply);
    form.addEventListener("input", () => {
      if ((form.text.value || "").length === 0 || (form.text.value || "").length > 2) apply();
    });
    apply();
  } catch (err) {
    count.textContent = "";
    status.innerHTML = `<div class="alert alert-error">فشل تحميل الترجمات: ${escapeHtml(err.message)}</div>`;
    list.innerHTML = "";
  }
}

function render404() {
  appEl.innerHTML = `
    <section class="hero hero-card">
      <span class="badge">404</span>
      <h1 class="hero-title">الصفحة غير موجودة</h1>
      <p class="hero-subtitle">تعذر العثور على المسار المطلوب.</p>
      <div class="row-actions">
        <a class="btn" href="/" data-link>الرئيسية</a>
        <a class="btn secondary" href="/search" data-link>البحث</a>
      </div>
    </section>
  `;
}

function bindLinkDelegation() {
  document.body.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-link]");
    if (!a) return;
    e.preventDefault();
    navigate(a.getAttribute("href"));
  });
}

function navigate(url, replace = false) {
  if (replace) history.replaceState({}, "", url);
  else history.pushState({}, "", url);
  renderRoute();
}

async function renderRoute() {
  const route = parseLocation();
  setActiveNav(window.location.pathname);
  bindGlobalSearch(route);
  if (route.page === "home") return renderHome();
  if (route.page === "search") return renderSearch(route);
  if (route.page === "media") return renderMedia(route);
  if (route.page === "subtitles") return renderSubtitles(route);
  return render404();
}

window.addEventListener("popstate", renderRoute);
bindLinkDelegation();
renderRoute();

