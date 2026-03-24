const appEl = document.getElementById("app");

const state = {
  search: {
    query: "",
    type: "multi",
    year: ""
  },
  selectedMedia: null,
  subtitlesFilter: {
    language: "ar",
    provider: "all",
    season: "",
    episode: "",
    year: ""
  }
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

function renderHome() {
  appEl.innerHTML = `
    <section class="hero hero-card">
      <span class="badge">منصة ترجمة عربية متكاملة</span>
      <h1 class="hero-title">اعثر على الترجمة المناسبة في ثوانٍ</h1>
      <p class="hero-subtitle">
        تجربة سلسة للبحث عن الأفلام والمسلسلات عبر TMDb، ثم استعراض النتائج من أكثر من مزود ترجمة
        في واجهة واحدة واضحة وسريعة ومناسبة للجوال.
      </p>
      <div class="stats-grid">
        <div class="stat-chip">
          <strong>TMDb</strong>
          تعريف دقيق للعمل
        </div>
        <div class="stat-chip">
          <strong>SubDL + OpenSubtitles</strong>
          نتائج ترجمة متعددة
        </div>
        <div class="stat-chip">
          <strong>RTL عربي كامل</strong>
          تصميم مريح وواضح
        </div>
      </div>
      <div class="row-actions">
        <a class="btn btn-primary" href="/search" data-link>ابدأ البحث الآن</a>
        <button id="quickHealthBtn" class="secondary" type="button">فحص حالة الخدمة</button>
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
      el.textContent = `فشل فحص الحالة: ${err.message}`;
    }
  });
}

function renderSearchShell({ query = "", type = "multi", year = "" }) {
  appEl.innerHTML = `
    <section class="hero hero-card">
      <span class="badge">مرحلة 1: اختيار العمل</span>
      <h1 class="hero-title">ابحث عن فيلم أو مسلسل</h1>
      <p class="hero-subtitle">نتائج البحث تُعرض كبطاقات واضحة، ثم تنتقل مباشرة إلى صفحة تفاصيل العمل والخيارات المتقدمة للترجمة.</p>
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
          <p class="footer-note">إذا كان العمل مسلسلًا، ستُتاح لاحقًا حقول الموسم والحلقة في صفحة التفاصيل.</p>
        </div>
      </aside>

      <section>
        <div class="section-header">
          <div>
            <h2 class="section-title">نتائج البحث</h2>
            <p class="section-sub" id="searchSummary">${query ? `تم البحث عن: "${escapeHtml(query)}"` : "ابدأ البحث لعرض النتائج هنا."}</p>
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
          <img class="poster" src="${
            item.poster || "https://placehold.co/500x750/0d132b/eef3ff?text=No+Poster"
          }" alt="" />
          <div class="media-body">
            <h3 class="media-title">${escapeHtml(item.title)}</h3>
            <div class="meta">
              <span class="pill">${item.mediaType === "movie" ? "فيلم" : "مسلسل"}</span>
              <span>${escapeHtml(item.year || "—")}</span>
              <span>TMDb ${escapeHtml(item.tmdbId)}</span>
            </div>
            <p class="overview">${escapeHtml(
              item.overview
                ? item.overview.length > 160
                  ? `${item.overview.slice(0, 160)}…`
                  : item.overview
                : "لا يوجد وصف."
            )}</p>
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
    navigate(toSearchUrl(payload));
  });

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

function renderMediaForm(media, route) {
  appEl.innerHTML = `
    <nav class="breadcrumb" aria-label="مسار التنقل">
      <a href="/" data-link>الرئيسية</a> ›
      <a href="/search" data-link>البحث</a> ›
      <span>${escapeHtml(media.title)}</span>
    </nav>
    <div class="card">
      <div class="card-inner">
        <div class="detail-layout">
          <div>
            <img class="poster" src="${
              media.poster || "https://placehold.co/500x750/0d132b/eef3ff?text=No+Poster"
            }" alt="" />
          </div>
          <div>
            <div class="detail-meta">
              <span class="pill">${media.mediaType === "movie" ? "فيلم" : "مسلسل"}</span>
              <span class="pill">TMDb ${escapeHtml(media.tmdbId)}</span>
              ${media.year ? `<span class="pill">${escapeHtml(media.year)}</span>` : ""}
            </div>
            <h1 class="hero-title" style="font-size:clamp(1.7rem,3vw,2.2rem)">${escapeHtml(media.title)}</h1>
            <p class="hero-subtitle" style="font-size:15px;max-width:none;margin-top:12px;">${escapeHtml(
              media.overview || "لا يوجد وصف."
            )}</p>

            <div class="section-header" style="margin-top:26px;">
              <h2 class="section-title">خيارات الترجمة</h2>
              <span class="section-sub">SubDL + OpenSubtitles</span>
            </div>
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
                    <option value="opensubtitles" ${
                      route.provider === "opensubtitles" ? "selected" : ""
                    }>OpenSubtitles</option>
                  </select>
                </div>
              </div>
              ${
                media.mediaType === "tv"
                  ? `
                <div class="form-grid two-col">
                  <div class="field">
                    <label for="season">الموسم</label>
                    <input id="season" name="season" value="${escapeHtml(route.season || "")}" />
                  </div>
                  <div class="field">
                    <label for="episode">الحلقة</label>
                    <input id="episode" name="episode" value="${escapeHtml(route.episode || "")}" />
                  </div>
                </div>
              `
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

  const form = document.getElementById("subtitleForm");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
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

function providerPillClass(provider) {
  if (provider === "subdl") return "provider-subdl";
  if (provider === "opensubtitles") return "provider-opensubtitles";
  return "";
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
      ${
        media
          ? `<a href="${toMediaUrl(media, {
              year: route.year || media.year || "",
              lang: route.language,
              provider: route.provider
            })}" data-link>${escapeHtml(media.title)}</a> ›`
          : ""
      }
      <span>الترجمات</span>
    </nav>
    <div class="card">
      <div class="card-inner">
        <div class="section-header" style="margin:0 0 8px;">
          <h1 class="section-title" style="font-size:1.5rem;">نتائج الترجمة</h1>
          <span class="pill" id="subtitleCount"></span>
        </div>
        <p class="hint">${media ? escapeHtml(media.title) : `TMDb ${escapeHtml(route.tmdbId)}`} — اللغة: ${escapeHtml(
    route.language
  )} — المزود: ${escapeHtml(route.provider)}</p>
        <div class="row-actions" style="margin-top:14px;">
          ${
            media
              ? `<a class="btn secondary" href="${toMediaUrl(media, {
                  year: route.year || media.year || "",
                  lang: route.language,
                  provider: route.provider,
                  season: route.season,
                  episode: route.episode
                })}" data-link>← العودة للتفاصيل</a>`
              : `<a class="btn secondary" href="/search" data-link>← العودة للبحث</a>`
          }
        </div>
      </div>
    </div>
    <div id="subtitleStatus" style="margin-top:12px;"></div>
    <div id="subtitleList" class="sub-list" style="margin-top:16px;"></div>
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
    const subtitles = data.subtitles || [];
    count.textContent = subtitles.length ? `عدد النتائج: ${subtitles.length}` : "لا نتائج";
    status.innerHTML = "";
    if (Array.isArray(data.providerErrors) && data.providerErrors.length) {
      status.innerHTML = `<div class="alert alert-info">بعض المزودين فشلوا: ${escapeHtml(
        data.providerErrors.map((e) => `${e.provider}: ${e.message}`).join(" | ")
      )}</div>`;
    }
    if (!subtitles.length) {
      list.innerHTML = `<p class="empty">لا توجد ترجمات بهذه الإعدادات.</p>`;
      return;
    }
    list.innerHTML = subtitles
      .map((sub) => {
        const releases =
          Array.isArray(sub.releases) && sub.releases.length ? sub.releases.slice(0, 5).join("، ") : "—";
        return `
          <article class="sub-item">
            <div class="sub-head">
              <div>
                <div class="sub-title">${escapeHtml(sub.releaseName || "Subtitle")}</div>
                <div class="hint">الرافع: ${escapeHtml(sub.author || "غير معروف")}</div>
              </div>
              <span class="pill">${escapeHtml(sub.language || "")}${sub.hearingImpaired ? " • HI" : ""}</span>
            </div>
            <div><span class="pill ${providerPillClass(sub.provider)}">${escapeHtml(sub.provider || "unknown")}</span></div>
            <div class="hint">الإصدارات: ${escapeHtml(releases)}</div>
            ${sub.comment ? `<div class="hint">ملاحظة: ${escapeHtml(sub.comment)}</div>` : ""}
            <div class="row-actions"><a class="btn" href="${escapeHtml(
              sub.downloadUrl
            )}" target="_blank" rel="noopener noreferrer">تحميل</a></div>
          </article>
        `;
      })
      .join("");
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
    const href = a.getAttribute("href");
    navigate(href);
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
  if (route.page === "home") return renderHome();
  if (route.page === "search") return renderSearch(route);
  if (route.page === "media") return renderMedia(route);
  if (route.page === "subtitles") return renderSubtitles(route);
  return render404();
}

window.addEventListener("popstate", renderRoute);
bindLinkDelegation();
renderRoute();

