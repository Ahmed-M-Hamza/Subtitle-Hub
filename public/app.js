const appEl = document.getElementById("app");
const globalSearchForm = document.getElementById("globalSearchForm");
const globalSearchInput = document.getElementById("globalSearchInput");
const langSwitcherEl = document.getElementById("langSwitcher");
const themeToggleBtn = document.getElementById("themeToggleBtn");

const RECENT_SEARCH_KEY = "subtitlehub.recentSearches";
const CONTINUE_HISTORY_KEY = "subtitlehub.continueHistory";
const CONTINUE_SEEDED_KEY = "subtitlehub.continueSeededFromRecent";
const MAX_CONTINUE_ITEMS = 10;
const MAX_RECENT_SEARCHES = 8;
const SUBTITLE_PREFS_KEY = "subtitlehub.subtitlePrefs";
const APP_LANG_KEY = "subtitlehub.uiLang";
const APP_THEME_KEY = "subtitlehub.uiTheme";
/** Developer-only: `localStorage.setItem("subtitlehub.devDiagnostics", "1")` or `?diagnostics=1`. */
const SUBTITLE_DEV_DIAGNOSTICS_LS = "subtitlehub.devDiagnostics";
const state = {
  selectedMedia: null,
  searchAutocompleteCleanup: null,
  homeAutocompleteCleanup: null,
  globalAutocompleteCleanup: null,
  requestCache: new Map()
};

/** Latest snapshot for dev diagnostics copy actions (subtitle page only). */
let subtitleDevDiagnosticsCopySnapshot = null;
let uiLang = "ar";
let uiTheme = "dark";

const UI_TEXT = {
  ar: {
    navHome: "الرئيسية",
    navSearch: "البحث",
    navHealth: "الحالة",
    searchPlaceholder: "ابحث عن فيلم أو مسلسل...",
    searchBtn: "بحث",
    themeLight: "Light",
    themeDark: "Dark",
    heroBadge: "منصة ترجمة عربية احترافية",
    heroTitle: "ابحث عن الترجمة المناسبة خلال ثوانٍ",
    heroSubtitle:
      "Subtitle Hub يجمع مصادر ترجمة متعددة في تجربة واحدة مرتبة وسريعة مع مسار واضح للموسم والحلقة.",
    heroCta: "ابدأ البحث الآن",
    heroSearchPlaceholder: "اكتب اسم فيلم أو مسلسل...",
    heroSearchHint: "نتائج فورية مع ترتيب ذكي حسب المصدر والجودة.",
    heroHealth: "فحص الحالة",
    homeDiscoverTitle: "اكتشف الآن ترجمات جاهزة",
    homeDiscoverSub: "عناوين مفلترة تلقائيًا حسب توفر الترجمة حتى تبدأ المشاهدة فورًا.",
    homeFeedLoading: "جارٍ تحميل اكتشافات اليوم...",
    homeFeedFailed: "تعذر تحميل أقسام الاكتشاف حاليًا.",
    homeSectionLatestMovies: "أحدث الأفلام مع ترجمات متاحة",
    homeSectionLatestArabic: "أحدث الأفلام مع ترجمة عربية",
    homeSectionLatestTv: "أحدث المسلسلات مع ترجمات متاحة",
    homeSectionTrending: "اختيارات رائجة مع ترجمات",
    homeSectionPopular: "الأكثر شعبية مع ترجمات",
    homeSectionEmpty: "لا توجد عناوين متاحة حاليًا في هذا القسم.",
    featuredNow: "اختيار اليوم",
    featuredCta: "استكشف الآن",
    recentSearchesTitle: "عمليات البحث الأخيرة",
    recentSearchesEmpty: "لا توجد عمليات بحث محفوظة بعد.",
    searchRecentSearchesSub: "آخر عمليات البحث من هذا الجهاز",
    continueBrowsingTitle: "متابعة التصفح",
    continueBrowsingSub: "عناوين وبحث اخترتهم مؤخرًا",
    continueBadgeSubtitles: "ترجمات",
    viewMoreSection: "عرض المزيد",
    homeBadgeArabic: "ترجمة عربية",
    homeBadgeCoverage: "متوفر ترجمات",
    homeStat1Title: "نتائج سريعة",
    homeStat1Desc: "اكتشف العناوين المناسبة خلال لحظات.",
    homeStat2Title: "أفلام ومسلسلات",
    homeStat2Desc: "مكتبة متنوعة بين السينما والتلفزيون.",
    homeStat3Title: "موسم وحلقة",
    homeStat3Desc: "انتقال واضح إلى الترجمة الأنسب لكل مشاهدة.",
    quickActionMovieHint: "اكتشاف سريع",
    quickActionTvHint: "عناوين جديدة",
    quickActionSeasonHint: "موسم وحلقة",
    healthStatusGood: "النظام يعمل بكفاءة",
    healthStatusLimited: "بعض الخدمات محدودة",
    healthLoading: "جارٍ فحص الحالة...",
    healthReady: "جاهز",
    healthNotReady: "غير جاهز",
    healthFailed: "فشل الفحص",
    featureTitle: "مزايا قوية في مكان واحد",
    feature1Title: "بحث ذكي سريع",
    feature1Desc: "نتائج مرتبة بسرعة مع وصول مباشر لما تحتاجه.",
    feature2Title: "أفلام ومسلسلات",
    feature2Desc: "دعم كامل لسيناريوهات الفيلم والمسلسل مع إدارة دقيقة للموسم والحلقة.",
    feature3Title: "تدفق موسم/حلقة واضح",
    feature3Desc: "بدون حلقة: كل ما يخص الموسم. مع الحلقة: مطابقة دقيقة للحلقة فقط.",
    feature4Title: "ترتيب وفلاتر ذكية",
    feature4Desc: "تصنيف حسب الجودة والثقة واللغة والمزوّد مع فلاتر عملية وسريعة.",
    howTitle: "كيف يعمل Subtitle Hub؟",
    how1: "ابحث عن عنوان الفيلم أو المسلسل",
    how2: "اختر الموسم والحلقة عند الحاجة",
    how3: "فلتر النتائج حسب اللغة والجودة",
    how4: "نزّل الترجمة المناسبة فورًا",
    actionsTitle: "اختصارات سريعة",
    actionMovie: "ابحث عن فيلم",
    actionTv: "ابحث عن مسلسل",
    actionSeason: "تصفح بالموسم",
    actionTyping: "ابدأ بكتابة عنوان",
    footerDesc: "تجربة اكتشاف ترجمات حديثة بتصميم واضح وسريع للاستخدام اليومي.",
    footerLinkHealth: "حالة النظام",
    footerLinkSearch: "فتح صفحة البحث",
    searchStageBadge: "مرحلة 1: اختيار العمل",
    searchHeroTitle: "ابحث عن فيلم أو مسلسل",
    searchHeroSubtitle: "نتائج مرتبة مع بطاقة واضحة لكل عمل وزر مباشر لعرض الترجمات.",
    searchFiltersTitle: "فلاتر البحث",
    showFilters: "إظهار الفلاتر",
    hideFilters: "إخفاء الفلاتر",
    searchLabelQuery: "اسم الفيلم أو المسلسل",
    searchLabelType: "النوع",
    searchTypeAll: "الكل",
    searchTypeMovie: "فيلم",
    searchTypeTv: "مسلسل",
    searchLabelYear: "السنة",
    clear: "مسح",
    searchTipYear: "نصيحة: حدّد السنة لتضييق النتائج المتشابهة.",
    searchResultsTitle: "نتائج البحث",
    searchSummaryPrefix: "تم البحث عن",
    searchSummaryIdle: "ابدأ البحث لعرض النتائج.",
    emptySearchResults: "لا توجد نتائج مطابقة. جرّب تعديل الاسم أو النوع أو السنة.",
    resultsCount: "عدد النتائج",
    topResults: "أفضل النتائج",
    movies: "أفلام",
    tvShows: "مسلسلات",
    noDescription: "لا يوجد وصف.",
    viewSubtitles: "عرض الترجمات",
    loadMore: "عرض المزيد",
    searching: "جارٍ البحث...",
    searchFailed: "فشل البحث",
    breadcrumb: "مسار التنقل",
    subtitleTypeMovie: "فيلم",
    subtitleTypeTv: "مسلسل",
    noWorkDescription: "لا يوجد وصف متاح لهذا العمل.",
    backToDetails: "العودة لتفاصيل العمل",
    subtitleOptions: "خيارات الترجمة",
    subtitleOptionsSub: "بحث مباشر دون مغادرة الصفحة",
    chooseSeasonCta: "اختر الموسم",
    browseSubtitlesCta: "تصفح الترجمات",
    subtitleLanguage: "لغة الترجمة",
    subtitleProvider: "مزوّد الترجمة",
    subtitleSeason: "الموسم",
    subtitleEpisodeOptional: "الحلقة (اختياري)",
    subtitleEpisodeSeasonHint: "فارغ = ترجمات الموسم",
    fileMatchLabel: "مطابقة اسم ملف الفيديو (اختياري)",
    showSubtitlesBtn: "عرض الترجمات",
    backToSearch: "عودة للبحث",
    loadingMedia: "جارٍ تحميل تفاصيل العمل...",
    invalidTmdbId: "معرّف TMDb غير صالح.",
    workNotFound: "تعذر العثور على العمل المطلوب.",
    mediaLoadFailed: "فشل تحميل تفاصيل العمل",
    subtitleFiltersTitle: "فلاتر الترجمة",
    applyInstant: "قابلة للتطبيق فورًا",
    searchInResults: "بحث داخل النتائج",
    imageQuality: "جودة الصورة",
    source: "المصدر",
    codec: "الترميز",
    sorting: "الترتيب",
    sortBest: "أفضل تطابق (موصى به)",
    sortDownloads: "الأكثر تحميلًا",
    sortTrusted: "الموثوق أولًا",
    sortNewest: "أحدث اسم إصدار",
    sortAlpha: "أبجديًا",
    help: "مساعدة",
    apply: "تطبيق",
    reset: "إعادة ضبط",
    subtitleResultsTitle: "نتائج الترجمة",
    noResults: "لا نتائج",
    loadingSubtitles: "جارٍ تحميل الترجمات...",
    subtitlesLoadFailed: "فشل تحميل الترجمات",
    limitedResultsNotice: "بعض النتائج قد تكون محدودة الآن. نعرض أفضل المصادر المتاحة.",
    pageNotFound: "الصفحة غير موجودة",
    pageNotFoundDesc: "تعذر العثور على المسار المطلوب.",
    uploader: "الرافع",
    unknown: "غير معروف",
    confidence: "ثقة",
    releasesLabel: "الإصدارات",
    downloadsCount: "عدد التحميلات",
    note: "ملاحظة",
    whyHighRank: "لماذا هذا في ترتيب مرتفع؟",
    overallScore: "النتيجة العامة",
    download: "تحميل",
    bestMatches: "أفضل التطابقات",
    quickFilenameCompare: "مقارنة سريعة مع اسم الملف",
    otherSubtitles: "ترجمات أخرى",
    qualityPrefix: "جودة",
    seasonAlternatives: "بدائل من نفس الموسم",
    seasonOnlyHint: "النتائج مفلترة من الخادم لكل ما يرتبط بهذا الموسم: باك الموسم + الترجمات العامة + ترجمات حلقات من نفس الموسم. اختر نوعًا أو أكثر؛ أو اترك الكل لعرض كل ما أعاده الخادم.",
    episodeOnlyHint: "النتائج مفلترة من الخادم لتطابق هذه الحلقة فقط. يمكنك تصفية النتائج أكثر أدناه.",
    updateResults: "تحديث النتائج",
    fileMatchTitle: "مطابقة اسم ملف الفيديو",
    sharperRanking: "ترتيب أدق للنتائج",
    pasteFilenameHint: "الصق اسم ملف الفيديو لديك (مثل اسم النسخة والجودة) لتحسين ترتيب أفضل التطابقات.",
    improveRanking: "تحسين الترتيب",
    removeMatch: "إزالة المطابقة",
    languageAll: "الكل",
    trusted: "موثوق",
    tvModeEpisodeStrict: "وضع الحلقة (مطابقة دقيقة للحلقة فقط)",
    tvModeSeasonBroad: "وضع الموسم (كل ما يخص نفس الموسم)",
    bestPickBadge: "أفضل اختيار",
    bestPickFootnote: "القائمة الكاملة متاحة أدناه كالمعتاد.",
    bestPickAria: "أفضل ترشيح للتحميل",
    bestPickRankSummary: "لماذا هذا الترشيح؟",
    subtitleEmptyTitleAlternates: "لا توجد ترجمات مطابقة لهذه الحلقة",
    subtitleEmptyBodyAlternates:
      "قد تجد خيارات مفيدة على مستوى الموسم أدناه. يمكنك أيضًا توسيع اللغة أو العودة لتفاصيل العمل.",
    subtitleEmptyShortHintAlternates: "ترجمات على مستوى الموسم متاحة أدناه — راجع قسم البدائل.",
    subtitleEmptyTitleFilters: "لا توجد نتائج تطابق الفلاتر الحالية",
    subtitleEmptyBodyFilters:
      "البيانات وصلت من الخادم لكن الفلاتر الحالية أخفت كل النتائج. جرّب توسيع الاختيارات أو إعادة ضبط الفلاتر.",
    subtitleEmptyTitleEpisode: "لا توجد ترجمات لهذه الحلقة",
    subtitleEmptyBodyEpisode:
      "جرّب تصفّح الموسم بالكامل، أو توسيع اللغة، أو العودة لتفاصيل العمل للتأكد من الموسم والحلقة.",
    subtitleEmptyTitleSeason: "لا توجد ترجمات لهذا الموسم",
    subtitleEmptyBodySeason:
      "جرّب توسيع اللغة أو اختيار حلقة محددة، أو العودة لتفاصيل العمل لضبط الموسم.",
    subtitleEmptyTitleMovie: "لا توجد ترجمات لهذا العنوان",
    subtitleEmptyBodyMovie:
      "جرّب توسيع اللغة أو البحث عن عنوان مشابه، أو العودة لتفاصيل العمل.",
    subtitleEmptyActionsHeading: "خطوات مقترحة",
    recoveryJumpToSeasonOptions: "عرض خيارات الموسم أدناه",
    recoveryBrowseWholeSeason: "تصفح ترجمات الموسم بالكامل",
    recoveryLoosenFilters: "توسيع البحث (كل اللغات وكل المصادر)",
    recoveryTryAllLanguages: "عرض كل اللغات المتاحة",
    recoveryTryEnglish: "تجربة الإنجليزية",
    recoveryUseAllSources: "البحث في كل المصادر المتاحة",
    recoveryWithoutFilename: "إيقاف مطابقة اسم الملف مؤقتًا",
    recoveryAllMatchTypes: "إظهار كل أنواع التطابق للمسلسل",
    recoveryBackToTitleDetails: "العودة لتفاصيل العمل",
    recoveryTryAnotherTitle: "البحث عن عنوان آخر",
    recoveryResetPanelFilters: "إعادة ضبط فلاتر النتائج",
    subtitleEmptyFilteredOut: "لا توجد عناصر بهذه الفلاتر في هذه القائمة.",
    languageGroupArabic: "العربية",
    languageGroupEnglish: "الإنجليزية",
    languageGroupUndetermined: "لغات أخرى / غير محددة"
  },
  en: {
    navHome: "Home",
    navSearch: "Search",
    navHealth: "Health",
    searchPlaceholder: "Search for a movie or TV show...",
    searchBtn: "Search",
    themeLight: "Light",
    themeDark: "Dark",
    heroBadge: "Professional subtitle platform",
    heroTitle: "Find the right subtitles in seconds",
    heroSubtitle:
      "Subtitle Hub unifies multiple subtitle sources into one modern workflow with clear season/episode handling.",
    heroCta: "Start Searching",
    heroSearchPlaceholder: "Type a movie or TV show title...",
    heroSearchHint: "Fast results with smart source and quality ranking.",
    heroHealth: "Check Health",
    homeDiscoverTitle: "Discover subtitle-ready titles now",
    homeDiscoverSub: "Curated cards are filtered by subtitle availability, so you can jump in instantly.",
    homeFeedLoading: "Loading discovery feed...",
    homeFeedFailed: "Could not load discovery sections right now.",
    homeSectionLatestMovies: "Latest movies with subtitles",
    homeSectionLatestArabic: "Latest movies with Arabic subtitles",
    homeSectionLatestTv: "Latest TV shows with subtitles",
    homeSectionTrending: "Trending picks with subtitles",
    homeSectionPopular: "Popular picks with subtitles",
    homeSectionEmpty: "No subtitle-ready titles in this section yet.",
    featuredNow: "Spotlight",
    featuredCta: "Explore now",
    recentSearchesTitle: "Recent searches",
    recentSearchesEmpty: "No saved searches yet.",
    searchRecentSearchesSub: "Recent searches on this device",
    continueBrowsingTitle: "Continue browsing",
    continueBrowsingSub: "Titles and searches you opened recently",
    continueBadgeSubtitles: "Subs",
    viewMoreSection: "View more",
    homeBadgeArabic: "Arabic subtitles",
    homeBadgeCoverage: "Subtitles available",
    homeStat1Title: "Fast Results",
    homeStat1Desc: "Discover the right titles in moments.",
    homeStat2Title: "Movies & TV",
    homeStat2Desc: "A rich mix of cinema and series.",
    homeStat3Title: "Season & Episode",
    homeStat3Desc: "Clear flow to the best subtitle path.",
    quickActionMovieHint: "Quick discovery",
    quickActionTvHint: "Fresh picks",
    quickActionSeasonHint: "Season flow",
    healthStatusGood: "System is healthy",
    healthStatusLimited: "Some services are limited",
    healthLoading: "Checking system health...",
    healthReady: "ready",
    healthNotReady: "not ready",
    healthFailed: "Health check failed",
    featureTitle: "Everything you need in one place",
    feature1Title: "Fast smart search",
    feature1Desc: "Clean ranked results with direct subtitle actions.",
    feature2Title: "Movies + TV",
    feature2Desc: "Built for both movie and TV workflows with season/episode-aware behavior.",
    feature3Title: "Clear season/episode flow",
    feature3Desc: "No episode: season-level set. With episode: exact-episode only.",
    feature4Title: "Smart ranking and filters",
    feature4Desc: "Rank by confidence and quality, then refine by language, provider, and metadata.",
    howTitle: "How Subtitle Hub works",
    how1: "Search for the movie or TV title",
    how2: "Select season/episode when needed",
    how3: "Filter by language and quality",
    how4: "Download the best matching subtitle",
    actionsTitle: "Quick actions",
    actionMovie: "Search Movies",
    actionTv: "Search TV Shows",
    actionSeason: "Browse by Season",
    actionTyping: "Start typing a title",
    footerDesc: "A modern subtitle discovery experience with clear, fast product flow.",
    footerLinkHealth: "System status",
    footerLinkSearch: "Open Search",
    searchStageBadge: "Step 1: Choose title",
    searchHeroTitle: "Search movies and TV shows",
    searchHeroSubtitle: "Ranked results with clear cards and direct subtitle actions.",
    searchFiltersTitle: "Search filters",
    showFilters: "Show filters",
    hideFilters: "Hide filters",
    searchLabelQuery: "Movie or TV title",
    searchLabelType: "Type",
    searchTypeAll: "All",
    searchTypeMovie: "Movie",
    searchTypeTv: "TV",
    searchLabelYear: "Year",
    clear: "Clear",
    searchTipYear: "Tip: set year to narrow down similar titles.",
    searchResultsTitle: "Search results",
    searchSummaryPrefix: "Searched for",
    searchSummaryIdle: "Start a search to see results.",
    emptySearchResults: "No matching results. Try adjusting name, type, or year.",
    resultsCount: "Results",
    topResults: "Top results",
    movies: "Movies",
    tvShows: "TV shows",
    noDescription: "No description.",
    viewSubtitles: "View subtitles",
    loadMore: "Load more",
    searching: "Searching...",
    searchFailed: "Search failed",
    breadcrumb: "Breadcrumb",
    subtitleTypeMovie: "Movie",
    subtitleTypeTv: "TV show",
    noWorkDescription: "No overview available for this title.",
    backToDetails: "Back to details",
    subtitleOptions: "Subtitle options",
    subtitleOptionsSub: "Direct flow without leaving this page",
    chooseSeasonCta: "Choose season",
    browseSubtitlesCta: "Browse subtitles",
    subtitleLanguage: "Subtitle language",
    subtitleProvider: "Provider",
    subtitleSeason: "Season",
    subtitleEpisodeOptional: "Episode (optional)",
    subtitleEpisodeSeasonHint: "empty = season subtitles",
    fileMatchLabel: "Video filename matching (optional)",
    showSubtitlesBtn: "Show subtitles",
    backToSearch: "Back to search",
    loadingMedia: "Loading media details...",
    invalidTmdbId: "Invalid TMDb ID.",
    workNotFound: "Requested title was not found.",
    mediaLoadFailed: "Failed to load media details",
    subtitleFiltersTitle: "Subtitle filters",
    applyInstant: "Applied instantly",
    searchInResults: "Search in results",
    imageQuality: "Resolution",
    source: "Source",
    codec: "Codec",
    sorting: "Sorting",
    sortBest: "Best match (recommended)",
    sortDownloads: "Most downloaded",
    sortTrusted: "Trusted first",
    sortNewest: "Newest release name",
    sortAlpha: "Alphabetical",
    help: "Help",
    apply: "Apply",
    reset: "Reset",
    subtitleResultsTitle: "Subtitle results",
    noResults: "No results",
    loadingSubtitles: "Loading subtitles...",
    subtitlesLoadFailed: "Failed to load subtitles",
    limitedResultsNotice: "Some results may be limited right now. Showing the best available sources.",
    pageNotFound: "Page not found",
    pageNotFoundDesc: "The requested route could not be found.",
    uploader: "Uploader",
    unknown: "Unknown",
    confidence: "Confidence",
    releasesLabel: "Releases",
    downloadsCount: "Downloads",
    note: "Note",
    whyHighRank: "Why is this ranked high?",
    overallScore: "Overall score",
    download: "Download",
    bestMatches: "Best matches",
    quickFilenameCompare: "Quick filename comparison",
    otherSubtitles: "Other subtitles",
    qualityPrefix: "Quality",
    seasonAlternatives: "Season alternatives",
    seasonOnlyHint: "Server-filtered to everything related to this season: season packs + generic season rows + same-season episode rows.",
    episodeOnlyHint: "Server-filtered to exact episode only. You can further refine below.",
    updateResults: "Update results",
    fileMatchTitle: "Video filename matching",
    sharperRanking: "Sharper ranking",
    pasteFilenameHint: "Paste your video filename (release + quality) to improve top match ordering.",
    improveRanking: "Improve ranking",
    removeMatch: "Remove match",
    languageAll: "All",
    trusted: "Trusted",
    tvModeEpisodeStrict: "Episode mode (exact episode only)",
    tvModeSeasonBroad: "Season mode (everything for same season)",
    bestPickBadge: "Best pick",
    bestPickFootnote: "The full list remains below.",
    bestPickAria: "Recommended subtitle to download",
    bestPickRankSummary: "Why this pick?",
    subtitleEmptyTitleAlternates: "No subtitles matched this episode",
    subtitleEmptyBodyAlternates:
      "Season-level options below may still help. You can also broaden language or return to the title page.",
    subtitleEmptyShortHintAlternates: "Season-level subtitles are available below — check that section.",
    subtitleEmptyTitleFilters: "Nothing matches your current filters",
    subtitleEmptyBodyFilters:
      "Results arrived from the server, but your filters hid everything. Try broadening choices or reset filters.",
    subtitleEmptyTitleEpisode: "No subtitles for this episode",
    subtitleEmptyBodyEpisode:
      "Try browsing the whole season, broadening language, or return to the title page to verify season and episode.",
    subtitleEmptyTitleSeason: "No subtitles for this season",
    subtitleEmptyBodySeason:
      "Try broadening language, pick a specific episode, or return to the title page to adjust the season.",
    subtitleEmptyTitleMovie: "No subtitles for this title",
    subtitleEmptyBodyMovie:
      "Try broadening language, search for a similar title, or return to the title page.",
    subtitleEmptyActionsHeading: "Suggested next steps",
    recoveryJumpToSeasonOptions: "Jump to season options below",
    recoveryBrowseWholeSeason: "Browse subtitles for the whole season",
    recoveryLoosenFilters: "Broaden search (all languages & all sources)",
    recoveryTryAllLanguages: "Show all available languages",
    recoveryTryEnglish: "Try English subtitles",
    recoveryUseAllSources: "Search all available sources",
    recoveryWithoutFilename: "Turn off filename matching for now",
    recoveryAllMatchTypes: "Show all TV match types",
    recoveryBackToTitleDetails: "Back to title details",
    recoveryTryAnotherTitle: "Search for a different title",
    recoveryResetPanelFilters: "Reset result filters",
    subtitleEmptyFilteredOut: "Nothing in this list matches your filters.",
    languageGroupArabic: "Arabic",
    languageGroupEnglish: "English",
    languageGroupUndetermined: "Other languages"
  }
};

function t(key) {
  return UI_TEXT[uiLang]?.[key] ?? UI_TEXT.ar[key] ?? key;
}

function getSystemTheme() {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(theme) {
  uiTheme = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", uiTheme);
  document.body.setAttribute("data-theme", uiTheme);
  if (themeToggleBtn) themeToggleBtn.textContent = uiTheme === "dark" ? t("themeLight") : t("themeDark");
}

function applyLanguage(lang) {
  uiLang = lang === "en" ? "en" : "ar";
  const isAr = uiLang === "ar";
  document.documentElement.lang = isAr ? "ar" : "en";
  document.documentElement.dir = isAr ? "rtl" : "ltr";
  document.body.setAttribute("dir", isAr ? "rtl" : "ltr");
  document.body.classList.toggle("lang-en", !isAr);
  if (globalSearchInput) globalSearchInput.placeholder = t("searchPlaceholder");
  const gsBtn = globalSearchForm?.querySelector("button[type='submit']");
  if (gsBtn) gsBtn.textContent = t("searchBtn");
  const navHome = document.querySelector('[data-nav="home"]');
  const navSearch = document.querySelector('[data-nav="search"]');
  const navHealth = document.querySelector('.nav-links a[href="/api/health"]');
  if (navHome) navHome.textContent = t("navHome");
  if (navSearch) navSearch.textContent = t("navSearch");
  if (navHealth) navHealth.textContent = t("navHealth");
  if (themeToggleBtn) themeToggleBtn.textContent = uiTheme === "dark" ? t("themeLight") : t("themeDark");
  langSwitcherEl?.querySelectorAll("[data-lang]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.getAttribute("data-lang") === uiLang);
  });
}

function initAppearance() {
  let savedLang = "ar";
  let savedTheme = "";
  try {
    savedLang = localStorage.getItem(APP_LANG_KEY) || "ar";
    savedTheme = localStorage.getItem(APP_THEME_KEY) || "";
  } catch {}
  applyLanguage(savedLang);
  applyTheme(savedTheme || getSystemTheme());
  langSwitcherEl?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-lang]");
    if (!btn) return;
    const next = btn.getAttribute("data-lang") === "en" ? "en" : "ar";
    try {
      localStorage.setItem(APP_LANG_KEY, next);
    } catch {}
    applyLanguage(next);
    renderRoute();
  });
  themeToggleBtn?.addEventListener("click", () => {
    const next = uiTheme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(APP_THEME_KEY, next);
    } catch {}
    applyTheme(next);
  });
}

function getTvQuickFilterKinds() {
  return [
    { kind: "exactEpisode", label: uiLang === "ar" ? "مطابقة الحلقة" : "Exact episode" },
    { kind: "seasonPack", label: uiLang === "ar" ? "باك الموسم" : "Season pack" },
    { kind: "seasonScoped", label: uiLang === "ar" ? "ترجمة عامة للموسم" : "Season-scoped" }
  ];
}

const ALLOWED_TV_KINDS = new Set(["exactEpisode", "seasonPack", "seasonScoped"]);

function parseTvKindsParam(raw) {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter((k) => ALLOWED_TV_KINDS.has(k));
}

function canonicalTvKindsFromSet(selectionSet) {
  const order = getTvQuickFilterKinds().map((x) => x.kind);
  return [...selectionSet].filter((k) => ALLOWED_TV_KINDS.has(k)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

/** TV subtitles only: update ?tvKinds= without navigation/refetch (push/replace history). */
function syncSubtitlesUrlTvKinds(media, selectionSet, { replace = false } = {}) {
  if (!media || media.mediaType !== "tv") return;
  const params = new URLSearchParams(window.location.search);
  const list = canonicalTvKindsFromSet(selectionSet);
  if (list.length) params.set("tvKinds", list.join(","));
  else params.delete("tvKinds");
  const qs = params.toString();
  const path = window.location.pathname;
  const url = qs ? `${path}?${qs}` : path;
  if (replace) history.replaceState({}, "", url);
  else history.pushState({}, "", url);
}

function escapeHtml(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isSubtitleDevDiagnosticsEnabled() {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("diagnostics") === "1") return true;
    return localStorage.getItem(SUBTITLE_DEV_DIAGNOSTICS_LS) === "1";
  } catch {
    return false;
  }
}

function devDiagCountBy(items, pick) {
  const m = Object.create(null);
  for (const x of items) {
    const k = String(pick(x) ?? "?");
    m[k] = (m[k] ?? 0) + 1;
  }
  return m;
}

function devDiagFormatCounts(obj) {
  if (!obj || typeof obj !== "object") return "—";
  const keys = Object.keys(obj).sort();
  if (!keys.length) return "—";
  return keys.map((k) => `${k}: ${obj[k]}`).join(" · ");
}

function devDiagNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Compact SubDL vs OpenSubtitles pipeline comparison (dev diagnostics only).
 */
function buildProviderComparisonSection(pipelineDiagnostics) {
  if (!pipelineDiagnostics || typeof pipelineDiagnostics !== "object") return "";
  const raw = pipelineDiagnostics.rawFetched || {};
  const ded = pipelineDiagnostics.normalizedPerProvider?.afterDedupe || {};
  const sortBp = pipelineDiagnostics.afterSortScored?.byProvider || {};
  const tvBp = pipelineDiagnostics.afterTvModeFilter?.byProvider || {};

  const makeRow = (id, rawKeyA, rawKeyB) => {
    const mapped = devDiagNum(raw[rawKeyB]);
    const tv = devDiagNum(tvBp[id]);
    return {
      id,
      label: id === "subdl" ? "SubDL" : "OpenSubtitles",
      raw: devDiagNum(raw[rawKeyA]),
      mapped,
      afterDedupe: devDiagNum(ded[id]),
      afterSort: devDiagNum(sortBp[id]),
      afterTvFilter: tv,
      retentionPct: mapped > 0 ? Math.round((tv / mapped) * 100) : null
    };
  };

  const subdl = makeRow("subdl", "subdlRawItems", "subdlRowsAfterMap");
  const os = makeRow("opensubtitles", "opensubtitlesRawItems", "opensubtitlesRowsAfterMap");

  const rs = subdl.mapped > 0 ? subdl.afterTvFilter / subdl.mapped : null;
  const ro = os.mapped > 0 ? os.afterTvFilter / os.mapped : null;

  let skewed = null;
  let skewNote = "";
  if (subdl.mapped >= 4 && os.mapped >= 4 && rs != null && ro != null) {
    if (rs < 0.32 && ro > 0.58) {
      skewed = "subdl";
      skewNote =
        "خسارة نسبية أشد لـ SubDL بين «بعد التخطيط» و«بعد فلتر TV» مقارنةً بـ OpenSubtitles — راجع التصنيف أو فلتر الحلقة/الموسم.";
    } else if (ro < 0.32 && rs > 0.58) {
      skewed = "opensubtitles";
      skewNote =
        "خسارة نسبية أشد لـ OpenSubtitles بين «بعد التخطيط» و«بعد فلتر TV» مقارنةً بـ SubDL — راجع التصنيف أو فلتر الحلقة/الموسم.";
    }
  } else if (subdl.mapped >= 6 && rs != null && rs < 0.22) {
    skewed = "subdl";
    skewNote = "بقاء منخفض جدًا لصفوف SubDL بعد فلتر TV (مقابل عدد الصفوف بعد التخطيط).";
  } else if (os.mapped >= 6 && ro != null && ro < 0.22) {
    skewed = "opensubtitles";
    skewNote = "بقاء منخفض جدًا لصفوف OpenSubtitles بعد فلتر TV (مقابل عدد الصفوف بعد التخطيط).";
  }

  const stageLine = (kAr, val) =>
    `<li class="dev-diagnostics__prov-st-li"><span class="dev-diagnostics__prov-st-k">${kAr}</span><strong class="dev-diagnostics__prov-st-v" dir="ltr">${escapeHtml(String(val))}</strong></li>`;

  const colHtml = (r) => {
    const isSkew = skewed === r.id;
    const retStr = r.retentionPct != null ? `${r.retentionPct}%` : "—";
    return `
      <div class="dev-diagnostics__prov-col dev-diagnostics__prov-col--${escapeHtml(r.id)}${
        isSkew ? " dev-diagnostics__prov-col--skewed" : ""
      }">
        <div class="dev-diagnostics__prov-col__head">
          <span class="dev-diagnostics__prov-col__title">${escapeHtml(r.label)}</span>
          ${isSkew ? `<span class="dev-diagnostics__prov-col__flag">خسارة حادة</span>` : ""}
        </div>
        <ul class="dev-diagnostics__prov-stages">
          ${stageLine("خام", r.raw)}
          ${stageLine("بعد التخطيط", r.mapped)}
          ${stageLine("بعد إزالة التكرار", r.afterDedupe)}
          ${stageLine("بعد الترتيب", r.afterSort)}
          ${stageLine("بعد فلتر TV", r.afterTvFilter)}
        </ul>
        <p class="dev-diagnostics__prov-retention">
          البقاء حتى فلتر TV: <span dir="ltr" class="dev-diagnostics__prov-retention-num">${escapeHtml(retStr)}</span>
          <span class="dev-diagnostics__muted dev-diagnostics__prov-retention-hint"> من mapped</span>
        </p>
      </div>`;
  };

  const alertHtml = skewNote
    ? `<div class="dev-diagnostics__prov-compare-alert" role="status">${escapeHtml(skewNote)}</div>`
    : "";

  return `
    <section class="dev-diagnostics__prov-compare" dir="rtl" aria-labelledby="dev-prov-compare-title">
      <h4 id="dev-prov-compare-title" class="dev-diagnostics__prov-compare-title">مقارنة المزودين</h4>
      <p class="dev-diagnostics__prov-compare-sub">مسار الخادم فقط — مراحل متتالية</p>
      ${alertHtml}
      <div class="dev-diagnostics__prov-compare-cols">
        ${colHtml(subdl)}
        ${colHtml(os)}
      </div>
    </section>`;
}

/** Arabic labels for SubDL probe keys (dev diagnostics only). */
function subdlProbeLabelAr(probe) {
  const key = String(probe || "").trim();
  const map = {
    exactEpisodeTmdb: "طلب الحلقة المباشر",
    seasonFullSeasonTmdb: "باك الموسم عبر TMDb",
    seasonOnlyTmdb: "طلب الموسم فقط عبر TMDb",
    filmNameSeasonEpisode: "طلب باسم المسلسل + الحلقة",
    filmNameSeasonFull: "طلب باسم المسلسل + باك الموسم",
    filmNameSeasonOnly: "طلب باسم المسلسل + الموسم فقط",
    tvSeasonMode: "وضع تصفية الموسم (طلب واحد)",
    movie: "فيلم (طلب واحد)"
  };
  return map[key] || (key ? `مسار: ${key}` : "—");
}

function buildSubtitleDiagnosticsSummaryText(snapshot) {
  if (!snapshot) {
    return [
      "Subtitle Hub · diagnostics summary",
      "(No snapshot yet — wait for subtitles to load, then try again.)",
      `Time: ${new Date().toISOString()}`
    ].join("\n");
  }
  const {
    route,
    tvQueryModeFromApi,
    pipelineDiagnostics,
    baseLength,
    filtered,
    visibleLength,
    formControls,
    providerErrors
  } = snapshot;
  const lines = [];
  lines.push("Subtitle Hub · diagnostics summary");
  lines.push(`Time: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Request mode");
  lines.push(`- mediaType: ${route.mediaType} · tmdbId: ${route.tmdbId}`);
  if (route.year) lines.push(`- year (route): ${route.year}`);
  if (route.mediaType === "tv") {
    if (route.season) lines.push(`- season: ${route.season}`);
    if (route.episode) lines.push(`- episode: ${route.episode}`);
  }
  lines.push(`- API language=all: ${!route.language || route.language === "all"} (param: ${route.language || "all"})`);
  lines.push(`- API provider=all: ${!route.provider || route.provider === "all"} (param: ${route.provider || "all"})`);
  if (route.mediaType === "tv") {
    lines.push(`- TV server mode: ${tvQueryModeFromApi || "—"}`);
  }
  const tva = pipelineDiagnostics?.tvEpisodeSubdlAnalysis;
  if (tva && typeof tva === "object") {
    lines.push("");
    lines.push("## SubDL TV episode-mode analysis (server)");
    lines.push(`- subdlByKindAfterSort: ${devDiagFormatCounts(tva.subdlByKindAfterSort)}`);
    lines.push(`- subdlByKindAfterTvFilter: ${devDiagFormatCounts(tva.subdlByKindAfterTvFilter)}`);
    lines.push(`- exactAfterSort: ${tva.subdlExactAfterSort ?? "—"} · seasonPack: ${tva.subdlSeasonPackAfterSort ?? "—"} · seasonScoped: ${tva.subdlSeasonScopedAfterSort ?? "—"}`);
    lines.push(`- seasonLevelCombinedAfterSort: ${tva.subdlSeasonLevelCombinedAfterSort ?? "—"}`);
    if (tva.contractNoteAr) lines.push(`- note: ${tva.contractNoteAr}`);
    if (tva.compareHintAr) lines.push(`- compare: ${tva.compareHintAr}`);
  }
  if (route.fileName) {
    lines.push(`- fileName param: set (${String(route.fileName).length} chars, value omitted)`);
  }
  const pe = Array.isArray(providerErrors) ? providerErrors : [];
  if (pe.length) lines.push(`- provider error count: ${pe.length} (messages omitted)`);

  const subdlTr = pipelineDiagnostics?.subdlTrace;
  if (subdlTr?.attempts?.length > 0) {
    lines.push("");
    lines.push("## SubDL attempts (server)");
    lines.push(`- winningProbe: ${subdlTr.winningProbe ?? "none"}`);
    for (const a of subdlTr.attempts) {
      lines.push(`- ${a.probe}: rawRows=${a.rawRows} mappedRows=${a.mappedRows}`);
    }
  }
  const probeFold = subdlTr?.subdlByProbeAfterSort;
  if (probeFold && typeof probeFold === "object" && Object.keys(probeFold).length) {
    lines.push("");
    lines.push("## SubDL classification by subdlProbe (after sort)");
    for (const pk of Object.keys(probeFold).sort()) {
      lines.push(`- ${pk}: ${devDiagFormatCounts(probeFold[pk])}`);
    }
  }
  if (subdlTr?.pipelineCacheRev != null) {
    lines.push("");
    lines.push(`## Subtitle pipeline cache rev (server): ${subdlTr.pipelineCacheRev}`);
  }
  const samples = subdlTr?.subdlClassifySamples;
  if (Array.isArray(samples) && samples.length) {
    lines.push("");
    lines.push("## SubDL classify samples (first rows, diagnostics=1)");
    for (const s of samples) {
      lines.push(
        `- branch=${s.classifyBranch} kind=${s.tvMatchKind} probe=${s.subdlProbeResolved ?? s.subdlProbe} winning=${s.ctxSubdlWinningProbe} enteredProbe=${s.enteredProbeBranch} seasonBrowse=${s.seasonBrowse} parsedS=${s.parsedSeason} parsedE=${s.parsedEpisode}`
      );
    }
  }

  const apiFinal = pipelineDiagnostics?.afterTvModeFilter;
  const scored = pipelineDiagnostics?.afterSortScored;
  lines.push("");
  lines.push("## Server counts (after TV filter = API payload rows)");
  lines.push(`- total: ${apiFinal?.total ?? "—"}`);
  lines.push(`- byProvider: ${devDiagFormatCounts(apiFinal?.byProvider)}`);
  lines.push(`- tvMatchKind: ${devDiagFormatCounts(apiFinal?.byTvMatch)}`);
  lines.push(`- droppedForTvMode: ${pipelineDiagnostics?.droppedForTvMode ?? "—"}`);
  lines.push("");
  lines.push("## Server counts (after sort / before TV filter)");
  lines.push(`- total: ${scored?.total ?? "—"}`);
  lines.push(`- byProvider: ${devDiagFormatCounts(scored?.byProvider)}`);
  lines.push(`- tvMatchKind: ${devDiagFormatCounts(scored?.byTvMatch)}`);

  const fc = formControls || {};
  const filtParts = [
    `language: ${fc.language}`,
    `provider: ${fc.provider}`,
    `HI: ${fc.hi}`,
    `resolution: ${fc.resolution}`,
    `source: ${fc.source}`,
    `codec: ${fc.codec}`,
    `sort: ${fc.sort}`
  ];
  if (fc.text) filtParts.push(`text search: (${String(fc.text).length} chars, value omitted)`);
  if (Array.isArray(fc.tvKinds) && fc.tvKinds.length) filtParts.push(`tvKinds: ${fc.tvKinds.join(", ")}`);

  lines.push("");
  lines.push("## Client");
  lines.push(`- base rows (from API): ${baseLength}`);
  if (snapshot.alternateBaseLength != null) {
    lines.push(`- alternate base rows (API): ${snapshot.alternateBaseLength}`);
  }
  lines.push(`- after UI filters: ${filtered.length}`);
  if (snapshot.filteredAlternateLength != null) {
    lines.push(`- alternate after UI filters: ${snapshot.filteredAlternateLength}`);
  }
  lines.push(`- visible in list (pagination cap): ${visibleLength}`);
  lines.push(`- byProvider (after UI): ${devDiagFormatCounts(devDiagCountBy(filtered, (s) => s.provider))}`);
  lines.push(`- tvMatchKind (after UI): ${devDiagFormatCounts(devDiagCountBy(filtered, (s) => s.tvMatchKind || "—"))}`);
  lines.push("");
  lines.push("## Active UI filter state");
  for (const p of filtParts) lines.push(`- ${p}`);
  return lines.join("\n");
}

async function copyTextToClipboard(text) {
  const t = String(text ?? "");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(t);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = t;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  try {
    const ok = document.execCommand("copy");
    if (!ok) throw new Error("execCommand copy failed");
  } finally {
    document.body.removeChild(ta);
  }
}

function showSubtitleDevCopyFeedback(message, isError = false) {
  const el = document.querySelector("#subtitleDevDiagnostics .dev-diagnostics__copy-feedback");
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  el.classList.toggle("dev-diagnostics__copy-feedback--error", Boolean(isError));
  el.classList.toggle("dev-diagnostics__copy-feedback--ok", !isError);
  window.clearTimeout(el._devCopyT);
  el._devCopyT = window.setTimeout(() => {
    el.hidden = true;
    el.textContent = "";
    el.classList.remove("dev-diagnostics__copy-feedback--error", "dev-diagnostics__copy-feedback--ok");
  }, 3200);
}

function bindSubtitleDevDiagnosticsCopy(root) {
  if (!root || root.dataset.devCopyBound === "1") return;
  root.dataset.devCopyBound = "1";
  root.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-dev-copy]");
    if (!btn || btn.disabled) return;
    e.preventDefault();
    const kind = btn.getAttribute("data-dev-copy");
    try {
      if (kind === "summary") {
        const text = buildSubtitleDiagnosticsSummaryText(subtitleDevDiagnosticsCopySnapshot);
        await copyTextToClipboard(text);
        showSubtitleDevCopyFeedback("تم نسخ الملخص إلى الحافظة.");
      } else if (kind === "json") {
        const d = subtitleDevDiagnosticsCopySnapshot?.pipelineDiagnostics;
        if (!d || typeof d !== "object") {
          showSubtitleDevCopyFeedback("لا يوجد JSON من الخادم. أعد التحميل أو فعّل diagnostics.", true);
          return;
        }
        await copyTextToClipboard(JSON.stringify(d, null, 2));
        showSubtitleDevCopyFeedback("تم نسخ JSON التشخيص.");
      }
    } catch (err) {
      showSubtitleDevCopyFeedback(`تعذّر النسخ: ${err?.message || err}`, true);
    }
  });
}

function buildSubtitleDevDiagnosticsHtml({
  pipelineDiagnostics,
  providerErrors,
  route,
  tvQueryModeFromApi,
  baseLength,
  filtered,
  visibleLength,
  formControls,
  alternateBaseLength = 0,
  filteredAlternateLength = 0
}) {
  const hasDiag = pipelineDiagnostics && typeof pipelineDiagnostics === "object";
  const tva = hasDiag ? pipelineDiagnostics.tvEpisodeSubdlAnalysis : null;
  const tvEpisodeSubdlBlock =
    tva && typeof tva === "object"
      ? `
    <section class="dev-diagnostics__tv-episode-subdl" dir="rtl" aria-labelledby="dev-tv-ep-subdl-title">
      <h4 id="dev-tv-ep-subdl-title" class="dev-diagnostics__h4">SubDL — مقارنة وضع الحلقة والموسم</h4>
      <p class="dev-diagnostics__note">${escapeHtml(tva.contractNoteAr || "")}</p>
      <p class="dev-diagnostics__note dev-diagnostics__muted">${escapeHtml(tva.compareHintAr || "")}</p>
      <dl class="dev-diagnostics__dl dev-diagnostics__dl--compact">
        <dt>SubDL بعد الترتيب (حسب النوع)</dt><dd>${escapeHtml(devDiagFormatCounts(tva.subdlByKindAfterSort))}</dd>
        <dt>SubDL بعد فلتر وضع الحلقة</dt><dd>${escapeHtml(devDiagFormatCounts(tva.subdlByKindAfterTvFilter))}</dd>
        <dt>عدد exactEpisode بعد الترتيب</dt><dd dir="ltr">${escapeHtml(String(tva.subdlExactAfterSort ?? "—"))}</dd>
        <dt>عدد seasonPack بعد الترتيب</dt><dd dir="ltr">${escapeHtml(String(tva.subdlSeasonPackAfterSort ?? "—"))}</dd>
        <dt>عدد seasonScoped بعد الترتيب</dt><dd dir="ltr">${escapeHtml(String(tva.subdlSeasonScopedAfterSort ?? "—"))}</dd>
        <dt>مجموع الصفوف الموسمية (SubDL)</dt><dd dir="ltr">${escapeHtml(String(tva.subdlSeasonLevelCombinedAfterSort ?? "—"))}</dd>
      </dl>
    </section>`
      : "";
  const raw = hasDiag ? pipelineDiagnostics.rawFetched : null;
  const norm = hasDiag ? pipelineDiagnostics.normalizedPerProvider : null;
  const merged = hasDiag ? pipelineDiagnostics.mergeAndDedupe : null;
  const scored = hasDiag ? pipelineDiagnostics.afterSortScored : null;
  const apiFinal = hasDiag ? pipelineDiagnostics.afterTvModeFilter : null;
  const dropped = hasDiag ? pipelineDiagnostics.droppedForTvMode : null;
  const tvByProv = hasDiag ? pipelineDiagnostics.byTvMatchPerProvider?.afterTvModeFilter : null;

  const rawLines =
    raw &&
    `SubDL: raw ${raw.subdlRawItems ?? "—"} → mapped ${raw.subdlRowsAfterMap ?? "—"}<br>OpenSubtitles: raw ${raw.opensubtitlesRawItems ?? "—"} → mapped ${raw.opensubtitlesRowsAfterMap ?? "—"}`;

  const clientProv = devDiagFormatCounts(devDiagCountBy(filtered, (s) => s.provider));
  const clientTv = devDiagFormatCounts(devDiagCountBy(filtered, (s) => s.tvMatchKind || "—"));

  const apiRouteLangAll = !route.language || route.language === "all";
  const apiRouteProvAll = !route.provider || route.provider === "all";

  const tvModeAr =
    route.mediaType !== "tv"
      ? "فيلم — لا وضع مسلسل"
      : tvQueryModeFromApi === "episode"
        ? "حلقة (episode): الخادم يُبقي exactEpisode فقط"
        : tvQueryModeFromApi === "season"
          ? "موسم (season): الخادم يُبقي كل صف مرتبط بالموسم (seasonPack + seasonScoped)"
          : "—";

  const filtLines = [
    formControls.text ? `بحث نصي: «${formControls.text}»` : null,
    `لغة (واجهة): ${formControls.language} · مزوّد (واجهة): ${formControls.provider}`,
    `SDH/HI: ${formControls.hi} · دقة: ${formControls.resolution} · مصدر: ${formControls.source} · ترميز: ${formControls.codec}`,
    `ترتيب: ${formControls.sort}`,
    formControls.tvKinds?.length ? `شرائح TV: ${formControls.tvKinds.join(", ")}` : null
  ].filter(Boolean);

  const pe = Array.isArray(providerErrors) ? providerErrors : [];
  const peShort = pe.length ? `${pe.length} مزوّد` : "لا";

  const tvPerProvRows =
    tvByProv && typeof tvByProv === "object"
      ? Object.keys(tvByProv)
          .sort()
          .map((p) => {
            const inner = devDiagFormatCounts(tvByProv[p]);
            return `<dt>${escapeHtml(p)}</dt><dd>${escapeHtml(inner)}</dd>`;
          })
          .join("")
      : "";

  const jsonBlock = hasDiag ? escapeHtml(JSON.stringify(pipelineDiagnostics, null, 2)) : "";

  const trace = hasDiag ? pipelineDiagnostics.subdlTrace : null;
  const subdlReq = trace?.request && typeof trace.request === "object" ? trace.request : null;
  const subdlLangParam = subdlReq?.languagesParam != null ? String(subdlReq.languagesParam) : "ALL";
  const subdlScenario = subdlReq?.scenario != null ? String(subdlReq.scenario) : "—";
  const subdlFullSeason =
    subdlReq?.full_season != null && subdlReq.full_season !== "" && subdlReq.full_season !== 0
      ? "نعم"
      : "لا";
  const subdlEpSent =
    subdlReq?.episode_number != null && String(subdlReq.episode_number).trim() !== ""
      ? String(subdlReq.episode_number).trim()
      : "—";

  const subdlAttempts = Array.isArray(trace?.attempts) ? trace.attempts : [];
  const subdlWinning = trace?.winningProbe != null ? String(trace.winningProbe).trim() : "";
  const subdlWinBanner =
    subdlAttempts.length > 0
      ? subdlWinning
        ? `
        <div class="dev-diagnostics__subdl-win-banner" role="status" dir="rtl" aria-label="المسار الفائز لطلبات SubDL">
          <div class="dev-diagnostics__subdl-win-banner__inner">
            <span class="dev-diagnostics__subdl-win-banner__kicker">المسار الفائز — صفوف من SubDL</span>
            <span class="dev-diagnostics__subdl-win-banner__ar">${escapeHtml(subdlProbeLabelAr(subdlWinning))}</span>
            <div class="dev-diagnostics__subdl-win-banner__meta" dir="ltr">
              <code class="dev-diagnostics__subdl-win-banner__key">${escapeHtml(subdlWinning)}</code>
              <span class="dev-diagnostics__subdl-win-banner__counts">raw <strong>${escapeHtml(String(trace?.rawRows ?? "—"))}</strong> · mapped <strong>${escapeHtml(String(trace?.mappedRows ?? "—"))}</strong></span>
            </div>
          </div>
        </div>`
        : `
        <div class="dev-diagnostics__subdl-win-banner dev-diagnostics__subdl-win-banner--none" dir="rtl" role="status">
          <div class="dev-diagnostics__subdl-win-banner__inner">
            <span class="dev-diagnostics__subdl-win-banner__kicker">SubDL — المسار الفائز</span>
            <span class="dev-diagnostics__subdl-win-banner__ar dev-diagnostics__subdl-win-banner__ar--muted">لا مسار فائز — جميع المحاولات أعطت raw = 0</span>
          </div>
        </div>`
      : "";
  const subdlAttemptsBlock =
    subdlAttempts.length > 0
      ? `
      <div class="dev-diagnostics__subdl-fallback" dir="rtl">
        ${subdlWinBanner}
        <p class="dev-diagnostics__subdl-fallback-head">
          <span>سجل المحاولات</span>
          <span class="dev-diagnostics__subdl-fallback-hint">المفتاح الإنجليزي للمطورين أسفل كل صف</span>
        </p>
        <ul class="dev-diagnostics__subdl-attempts">
          ${subdlAttempts
            .map((a) => {
              const pk = String(a.probe ?? "?");
              const isWin = Boolean(subdlWinning && pk === subdlWinning);
              return `
            <li class="dev-diagnostics__subdl-attempt${isWin ? " dev-diagnostics__subdl-attempt--winning" : ""}" data-subdl-probe="${escapeHtml(pk)}">
              <div class="dev-diagnostics__subdl-attempt__main">
                <span class="dev-diagnostics__subdl-attempt__ar">${escapeHtml(subdlProbeLabelAr(pk))}</span>
                ${isWin ? `<span class="dev-diagnostics__subdl-attempt__badge">فائز</span>` : ""}
              </div>
              <div class="dev-diagnostics__subdl-attempt__row2">
                <code class="dev-diagnostics__subdl-attempt__key" dir="ltr" title="مفتاح المسار (probe)">${escapeHtml(pk)}</code>
                <span class="dev-diagnostics__attempt-counts" dir="ltr">raw <strong>${escapeHtml(String(a.rawRows ?? "—"))}</strong> · map <strong>${escapeHtml(String(a.mappedRows ?? "—"))}</strong></span>
              </div>
            </li>`;
            })
            .join("")}
        </ul>
      </div>`
      : "";

  const subdlCompactSection =
    trace && typeof trace === "object"
      ? `
    <section class="dev-diagnostics__subdl" aria-labelledby="dev-subdl-summary-title" dir="rtl">
      <div class="dev-diagnostics__subdl-head">
        <h4 id="dev-subdl-summary-title" class="dev-diagnostics__subdl-title">SubDL — ملخص سريع</h4>
        <span class="dev-diagnostics__subdl-hint">طلب · دمج · ترتيب · فلتر TV</span>
      </div>
      <div class="dev-diagnostics__subdl-rows">
        <div class="dev-diagnostics__subdl-row dev-diagnostics__subdl-row--request">
          <span class="dev-diagnostics__pill dev-diagnostics__pill--subdl"><span class="dev-diagnostics__pill-k">languagesParam</span> <code class="dev-diagnostics__pill-code" dir="ltr">${escapeHtml(subdlLangParam)}</code></span>
          <span class="dev-diagnostics__pill dev-diagnostics__pill--subdl dev-diagnostics__pill--block"><span class="dev-diagnostics__pill-k">scenario</span> <code class="dev-diagnostics__pill-code dev-diagnostics__pill-code--scenario" dir="ltr">${escapeHtml(subdlScenario)}</code></span>
          <span class="dev-diagnostics__pill dev-diagnostics__pill--subdl"><span class="dev-diagnostics__pill-k">full_season</span> <span class="dev-diagnostics__pill-v">${escapeHtml(subdlFullSeason)}</span></span>
          <span class="dev-diagnostics__pill dev-diagnostics__pill--subdl"><span class="dev-diagnostics__pill-k">episode_number</span> <code class="dev-diagnostics__pill-code" dir="ltr">${escapeHtml(subdlEpSent)}</code></span>
        </div>
        ${subdlAttemptsBlock}
        <div class="dev-diagnostics__subdl-row dev-diagnostics__subdl-row--counts" dir="rtl">
          <span class="dev-diagnostics__metric"><span class="dev-diagnostics__metric-k">rawRows</span> <strong dir="ltr">${escapeHtml(String(trace.rawRows ?? "—"))}</strong></span>
          <span class="dev-diagnostics__metric"><span class="dev-diagnostics__metric-k">mappedRows</span> <strong dir="ltr">${escapeHtml(String(trace.mappedRows ?? "—"))}</strong></span>
          <span class="dev-diagnostics__metric"><span class="dev-diagnostics__metric-k">afterDedupe</span> <strong dir="ltr">${escapeHtml(String(trace.afterDedupeCount ?? "—"))}</strong></span>
          <span class="dev-diagnostics__metric"><span class="dev-diagnostics__metric-k">afterSort</span> <strong dir="ltr">${escapeHtml(String(trace.afterSortCount ?? "—"))}</strong></span>
          <span class="dev-diagnostics__metric"><span class="dev-diagnostics__metric-k">afterTvFilter</span> <strong dir="ltr">${escapeHtml(String(trace.afterTvFilterCount ?? "—"))}</strong></span>
          <span class="dev-diagnostics__metric"><span class="dev-diagnostics__metric-k">pipelineCacheRev</span> <strong dir="ltr">${escapeHtml(String(trace.pipelineCacheRev ?? "—"))}</strong></span>
        </div>
        ${
          Array.isArray(trace.subdlClassifySamples) && trace.subdlClassifySamples.length
            ? `<div class="dev-diagnostics__subdl-samples" dir="rtl">
          <p class="dev-diagnostics__subdl-probe__title">عيّنة تصنيف SubDL التشخيصية (أول ${trace.subdlClassifySamples.length} صفوف — مع <code class="dev-diagnostics__code">classifyBranch</code>)</p>
          <pre class="dev-diagnostics__pre dev-diagnostics__pre--compact" tabindex="0" dir="ltr">${escapeHtml(JSON.stringify(trace.subdlClassifySamples, null, 2))}</pre>
        </div>`
            : ""
        }
        ${
          trace.subdlByProbeAfterSort && typeof trace.subdlByProbeAfterSort === "object"
            ? `<div class="dev-diagnostics__subdl-probe" dir="rtl">
          <p class="dev-diagnostics__subdl-probe__title">تصنيف SubDL حسب <code class="dev-diagnostics__code">subdlProbe</code> (بعد الترتيب)</p>
          <ul class="dev-diagnostics__subdl-probe__list">
            ${Object.keys(trace.subdlByProbeAfterSort)
              .sort()
              .map((probe) => {
                const inner = trace.subdlByProbeAfterSort[probe];
                return `<li dir="rtl"><code class="dev-diagnostics__pill-code" dir="ltr">${escapeHtml(probe)}</code> <span dir="ltr">${escapeHtml(devDiagFormatCounts(inner))}</span></li>`;
              })
              .join("")}
          </ul>
        </div>`
            : ""
        }
      </div>
    </section>`
      : hasDiag
        ? `<p class="dev-diagnostics__subdl-missing dev-diagnostics__muted">لا يوجد <code class="dev-diagnostics__code">subdlTrace</code> في حمولة التشخيص (خادم أقدم؟).</p>`
        : "";

  return `
    <header class="dev-diagnostics__head">
      <span class="dev-diagnostics__badge" aria-hidden="true">DEV</span>
      <div class="dev-diagnostics__head-text">
        <h3 class="dev-diagnostics__title">تشخيص الترجمات</h3>
        <p class="dev-diagnostics__sub">وضع المطور — معلومات غير سرية فقط. × لإخفاء الدائم احذف مفتاح <code class="dev-diagnostics__code">localStorage</code>.</p>
      </div>
      <div class="dev-diagnostics__actions" role="group" aria-label="نسخ بيانات التشخيص">
        <button type="button" class="btn-sm dev-diagnostics__copy-btn" data-dev-copy="summary">نسخ الملخص</button>
        <button type="button" class="btn-sm dev-diagnostics__copy-btn secondary" data-dev-copy="json"${
          !hasDiag ? " disabled" : ""
        }>نسخ JSON</button>
      </div>
    </header>
    <p class="dev-diagnostics__copy-feedback" role="status" aria-live="polite" hidden></p>
    ${subdlCompactSection}
    ${tvEpisodeSubdlBlock}
    ${
      route.mediaType === "tv" && String(route.episode || "").trim()
        ? `<div class="dev-diagnostics__block dev-diagnostics__block--alternate" dir="rtl">
        <h4 class="dev-diagnostics__h4">بدائل الموسم (واجهة)</h4>
        <dl class="dev-diagnostics__dl">
          <dt>صفوف من API (alternateSubtitles)</dt><dd dir="ltr">${escapeHtml(String(alternateBaseLength))}</dd>
          <dt>بعد فلاتر الواجهة</dt><dd dir="ltr">${escapeHtml(String(filteredAlternateLength))}</dd>
        </dl>
      </div>`
        : ""
    }
    ${hasDiag ? buildProviderComparisonSection(pipelineDiagnostics) : ""}
    <div class="dev-diagnostics__grid">
      <div class="dev-diagnostics__block">
        <h4 class="dev-diagnostics__h4">الطلب الفعّال</h4>
        <dl class="dev-diagnostics__dl">
          <dt>API: language = all</dt><dd>${apiRouteLangAll ? "نعم" : "لا"} <span class="dev-diagnostics__muted">(${escapeHtml(String(route.language || ""))})</span></dd>
          <dt>API: provider = all</dt><dd>${apiRouteProvAll ? "نعم" : "لا"} <span class="dev-diagnostics__muted">(${escapeHtml(String(route.provider || ""))})</span></dd>
          <dt>وضع TV (خادم)</dt><dd>${escapeHtml(tvModeAr)}</dd>
          <dt>تنبيهات مزوّد</dt><dd>${escapeHtml(peShort)}</dd>
        </dl>
      </div>
      <div class="dev-diagnostics__block">
        <h4 class="dev-diagnostics__h4">خادم: خام → مدمَج</h4>
        <dl class="dev-diagnostics__dl">
          <dt>Raw / mapped</dt><dd ${rawLines ? 'class="dev-diagnostics__raw-metrics" dir="ltr"' : ""}>${
            rawLines ? rawLines : '<span class="dev-diagnostics__muted">—</span>'
          }</dd>
          <dt>بعد دمج SubDL</dt><dd>${escapeHtml(devDiagFormatCounts(norm?.afterSubdlMerge))}</dd>
          <dt>قبل إزالة التكرار</dt><dd>${escapeHtml(devDiagFormatCounts(norm?.mergedBeforeDedupe))}</dd>
          <dt>بعد إزالة التكرار</dt><dd>${escapeHtml(devDiagFormatCounts(norm?.afterDedupe))}</dd>
          <dt>دمج / تعادل</dt><dd>${escapeHtml(merged ? `قبل ${merged.combinedBeforeDedup ?? "—"} · بعد ${merged.afterDedup ?? "—"}` : "—")}</dd>
        </dl>
      </div>
      <div class="dev-diagnostics__block">
        <h4 class="dev-diagnostics__h4">خادم: بعد الترتيب والفلترة</h4>
        <dl class="dev-diagnostics__dl">
          <dt>مرتّبة + مُفَسّرة</dt><dd>${escapeHtml(scored ? `إجمالي ${scored.total ?? "—"} · ${devDiagFormatCounts(scored.byProvider)}` : "—")}</dd>
          <dt>tvMatchKind (بعد ترتيب الخادم)</dt><dd>${escapeHtml(devDiagFormatCounts(scored?.byTvMatch))}</dd>
          <dt>نهائي من API <span class="dev-diagnostics__muted">(بعد فلتر TV)</span></dt><dd>${escapeHtml(apiFinal ? `إجمالي ${apiFinal.total ?? "—"} · ${devDiagFormatCounts(apiFinal.byProvider)}` : "—")}</dd>
          <dt>tvMatchKind (نهائي API)</dt><dd>${escapeHtml(devDiagFormatCounts(apiFinal?.byTvMatch))}</dd>
          <dt>حُذف بفلتر TV</dt><dd>${escapeHtml(String(dropped ?? "—"))}</dd>
        </dl>
        ${
          tvPerProvRows
            ? `<p class="dev-diagnostics__mini-title">tvMatchKind حسب المزوّد (نهائي API)</p><dl class="dev-diagnostics__dl dev-diagnostics__dl--compact">${tvPerProvRows}</dl>`
            : ""
        }
      </div>
      <div class="dev-diagnostics__block">
        <h4 class="dev-diagnostics__h4">واجهة: فلاتر حالية ونتيجة</h4>
        <dl class="dev-diagnostics__dl">
          <dt>صفّي الخادم في الذاكرة</dt><dd>${escapeHtml(String(baseLength))} صف</dd>
          <dt>بعد فلاتر النموذج</dt><dd><strong>${escapeHtml(String(filtered.length))}</strong> صف</dd>
          <dt>معروض في القائمة</dt><dd>${escapeHtml(String(visibleLength))} <span class="dev-diagnostics__muted">(حد التحميل التدريجي)</span></dd>
          <dt>حسب المزوّد (بعد فلاتر الواجهة)</dt><dd>${escapeHtml(clientProv)}</dd>
          <dt>حسب tvMatchKind (بعد فلاتر الواجهة)</dt><dd>${escapeHtml(clientTv)}</dd>
        </dl>
        <ul class="dev-diagnostics__ul">
          ${filtLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
        </ul>
      </div>
    </div>
    ${
      hasDiag
        ? `<details class="dev-diagnostics__details"><summary class="dev-diagnostics__summary">JSON خام من الخادم</summary><pre class="dev-diagnostics__pre" tabindex="0">${jsonBlock}</pre></details>`
        : `<p class="dev-diagnostics__warn">لا توجد حمولة تشخيص من الخادم. أعد التحميل مع طلب يتضمن <code class="dev-diagnostics__code">diagnostics=1</code> (يُضاف تلقائيًا عند تفعيل الوضع).</p>`
    }
    <p class="dev-diagnostics__foot"><kbd class="dev-diagnostics__kbd">localStorage</kbd> <code class="dev-diagnostics__code">${escapeHtml(
      SUBTITLE_DEV_DIAGNOSTICS_LS
    )}=1</code> · أو <code class="dev-diagnostics__code">?diagnostics=1</code></p>
  `;
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
    const mediaType = subtitlesMatch[1];
    return {
      page: "subtitles",
      mediaType,
      tmdbId: subtitlesMatch[2],
      language: params.get("language") || "all",
      provider: params.get("provider") || "all",
      season: params.get("season") || "",
      episode: params.get("episode") || "",
      year: params.get("year") || "",
      fileName: params.get("fileName") || "",
      tvKinds: mediaType === "tv" ? parseTvKindsParam(params.get("tvKinds")) : []
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
      lang: params.get("lang") || "all",
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
  if (filter.fileName) params.set("fileName", filter.fileName);
  if (filter.year || media.year) params.set("year", filter.year || media.year || "");
  if (media.mediaType === "tv" && Array.isArray(filter.tvKinds) && filter.tvKinds.length) {
    params.set("tvKinds", canonicalTvKindsFromSet(new Set(filter.tvKinds)).join(","));
  }
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

async function fetchHomeFeed() {
  return apiFetchCached("/.netlify/functions/home-feed", 5 * 60 * 1000);
}

function setMetaTag(selector, attr, value) {
  if (!value) return;
  const el = document.querySelector(selector);
  if (!el) return;
  el.setAttribute(attr, value);
}

function updateDocumentMeta(route) {
  const baseTitle = "Subtitle Hub";
  let title = baseTitle;
  let desc = uiLang === "ar" ? "اكتشف الترجمات بسرعة بتجربة حديثة ومرتبة." : "Discover subtitles fast with a modern curated experience.";
  let canonicalPath = location.pathname + location.search;
  if (route.page === "home") {
    title = uiLang === "ar" ? "Subtitle Hub | اكتشف ترجمات الأفلام والمسلسلات" : "Subtitle Hub | Discover movie and TV subtitles";
  } else if (route.page === "search") {
    title = uiLang === "ar" ? "Subtitle Hub | بحث العناوين" : "Subtitle Hub | Search titles";
    if (route.query) {
      title = `${route.query} | ${baseTitle}`;
      desc =
        uiLang === "ar"
          ? `نتائج بحث مرتبة لعنوان ${route.query} مع وصول سريع للترجمات.`
          : `Ranked search results for ${route.query} with fast subtitle access.`;
    }
  } else if (route.page === "media") {
    title = uiLang === "ar" ? `تفاصيل العمل | ${baseTitle}` : `Title details | ${baseTitle}`;
    canonicalPath = location.pathname;
  } else if (route.page === "subtitles") {
    title = uiLang === "ar" ? `نتائج الترجمة | ${baseTitle}` : `Subtitle results | ${baseTitle}`;
  }
  document.title = title;
  setMetaTag('meta[name="description"]', "content", desc);
  setMetaTag('meta[property="og:title"]', "content", title);
  setMetaTag('meta[property="og:description"]', "content", desc);
  const canonicalHref = `${location.origin}${canonicalPath}`;
  let canonicalEl = document.querySelector('link[rel="canonical"]');
  if (!canonicalEl) {
    canonicalEl = document.createElement("link");
    canonicalEl.setAttribute("rel", "canonical");
    document.head.appendChild(canonicalEl);
  }
  canonicalEl.setAttribute("href", canonicalHref);
}

async function fetchSearchMedia(query, type, year) {
  const params = new URLSearchParams();
  params.set("query", query);
  params.set("type", type || "multi");
  if (year) params.set("year", year);
  return apiFetchCached(`/.netlify/functions/search-media?${params.toString()}`, 2 * 60 * 1000);
}

async function fetchSuggestions(query, type, year, limit = 8) {
  const params = new URLSearchParams();
  params.set("query", query);
  params.set("type", type || "multi");
  if (year) params.set("year", year);
  params.set("limit", String(limit));
  return apiFetchCached(`/.netlify/functions/suggestions?${params.toString()}`, 60 * 1000);
}

async function fetchSubtitles({ tmdbId, mediaType, language, provider, season, episode, year, fileName }) {
  const params = new URLSearchParams();
  params.set("tmdbId", tmdbId);
  params.set("mediaType", mediaType);
  if (language && language !== "all") params.set("language", language);
  params.set("provider", provider || "all");
  if (season) params.set("season", season);
  if (episode) params.set("episode", episode);
  if (fileName) params.set("fileName", fileName);
  if (year) params.set("year", year);
  if (typeof window !== "undefined" && isSubtitleDevDiagnosticsEnabled()) {
    params.set("diagnostics", "1");
  }
  return apiFetchCached(`/.netlify/functions/subtitles?${params.toString()}`, 60 * 1000);
}

async function fetchMediaDetails(tmdbId, mediaType) {
  const params = new URLSearchParams();
  params.set("tmdbId", String(tmdbId));
  params.set("mediaType", mediaType);
  return apiFetchCached(`/.netlify/functions/media-details?${params.toString()}`, 10 * 60 * 1000);
}

function getRecentSearches() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_SEARCH_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT_SEARCHES) : [];
  } catch {
    return [];
  }
}

function continueHistoryDedupeKey(entry) {
  if (!entry || !entry.kind) return "";
  if (entry.kind === "search") {
    return `search|${String(entry.query || "").toLowerCase().trim()}|${entry.type || "multi"}|${entry.year || ""}`;
  }
  if (entry.kind === "media") {
    return `media|${entry.mediaType}|${entry.tmdbId}`;
  }
  if (entry.kind === "subtitles") {
    return `subtitles|${entry.mediaType}|${entry.tmdbId}|${entry.season || ""}|${entry.episode || ""}`;
  }
  return "";
}

function isValidContinueEntry(e) {
  if (!e || !e.kind) return false;
  if (e.kind === "search") return Boolean(String(e.query || "").trim());
  if (e.kind === "media" || e.kind === "subtitles") {
    const id = String(e.tmdbId || "").trim();
    const mt = String(e.mediaType || "").toLowerCase();
    return /^\d+$/.test(id) && (mt === "movie" || mt === "tv");
  }
  return false;
}

/** One-time seed so existing users keep seeing past searches in Continue browsing. */
function seedContinueFromLegacyRecentOnce() {
  try {
    if (localStorage.getItem(CONTINUE_SEEDED_KEY)) return;
    const cur = JSON.parse(localStorage.getItem(CONTINUE_HISTORY_KEY) || "[]");
    if (Array.isArray(cur) && cur.length) {
      localStorage.setItem(CONTINUE_SEEDED_KEY, "1");
      return;
    }
    const recent = JSON.parse(localStorage.getItem(RECENT_SEARCH_KEY) || "[]");
    if (!Array.isArray(recent) || !recent.length) {
      localStorage.setItem(CONTINUE_SEEDED_KEY, "1");
      return;
    }
    const seeded = recent.slice(0, MAX_CONTINUE_ITEMS).map((s, i) => ({
      kind: "search",
      query: s.query,
      type: s.type || "multi",
      year: s.year || "",
      at: new Date(Date.now() - i * 60000).toISOString()
    }));
    localStorage.setItem(CONTINUE_HISTORY_KEY, JSON.stringify(seeded));
    localStorage.setItem(CONTINUE_SEEDED_KEY, "1");
  } catch {
    try {
      localStorage.setItem(CONTINUE_SEEDED_KEY, "1");
    } catch {}
  }
}

function addContinueHistoryEntry(entry) {
  try {
    const at = entry.at || new Date().toISOString();
    const normalized = { ...entry, at };
    const key = continueHistoryDedupeKey(normalized);
    if (!key || !isValidContinueEntry(normalized)) return;
    const raw = JSON.parse(localStorage.getItem(CONTINUE_HISTORY_KEY) || "[]");
    const prev = Array.isArray(raw) ? raw : [];
    const filtered = prev.filter((x) => continueHistoryDedupeKey(x) !== key);
    const next = [normalized, ...filtered].slice(0, MAX_CONTINUE_ITEMS);
    localStorage.setItem(CONTINUE_HISTORY_KEY, JSON.stringify(next));
  } catch {}
}

function getContinueHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(CONTINUE_HISTORY_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(isValidContinueEntry)
      .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
      .slice(0, MAX_CONTINUE_ITEMS);
  } catch {
    return [];
  }
}

function recordRecentMediaPage(media, route = {}) {
  if (!media?.tmdbId) return;
  addContinueHistoryEntry({
    kind: "media",
    tmdbId: media.tmdbId,
    mediaType: media.mediaType,
    title: media.title || "",
    year: String(route.year || media.year || ""),
    poster: media.poster || ""
  });
}

function recordRecentSubtitlesPage(media, route) {
  if (!media?.tmdbId) return;
  if (route.mediaType === "tv" && !String(route.season || "").trim()) return;
  addContinueHistoryEntry({
    kind: "subtitles",
    tmdbId: media.tmdbId,
    mediaType: media.mediaType,
    title: media.title || "",
    year: String(route.year || media.year || ""),
    poster: media.poster || "",
    season: route.season || "",
    episode: route.episode || "",
    language: route.language || "all",
    provider: route.provider || "all"
  });
}

function continueEntryHref(entry) {
  if (entry.kind === "search") {
    return toSearchUrl({
      query: entry.query || "",
      type: entry.type || "multi",
      year: entry.year || ""
    });
  }
  if (entry.kind === "media") {
    const mediaStub = {
      tmdbId: entry.tmdbId,
      mediaType: entry.mediaType,
      year: entry.year,
      title: entry.title,
      poster: entry.poster
    };
    return toMediaUrl(mediaStub, { year: entry.year || "" });
  }
  if (entry.kind === "subtitles") {
    const mediaStub = {
      tmdbId: entry.tmdbId,
      mediaType: entry.mediaType,
      year: entry.year,
      title: entry.title,
      poster: entry.poster
    };
    const filter = {
      language: entry.language || "all",
      provider: entry.provider || "all",
      year: entry.year || "",
      fileName: ""
    };
    if (entry.mediaType === "tv" && entry.season) filter.season = entry.season;
    if (entry.episode) filter.episode = entry.episode;
    return toSubtitlesUrl(mediaStub, filter);
  }
  return "/";
}

function continueTvMetaLine(entry) {
  if (entry.kind !== "subtitles" || entry.mediaType !== "tv") return "";
  const s = entry.season ? (uiLang === "ar" ? `م${entry.season}` : `S${entry.season}`) : "";
  const ep = entry.episode ? (uiLang === "ar" ? `ح${entry.episode}` : `E${entry.episode}`) : "";
  if (s && ep) return `${s} · ${ep}`;
  return s || ep || "";
}

function renderContinueBrowsingHomeSectionHtml() {
  seedContinueFromLegacyRecentOnce();
  const items = getContinueHistory().slice(0, 8);
  if (!items.length) return "";
  const cards = items
    .map((entry) => {
      const href = continueEntryHref(entry);
      if (entry.kind === "search") {
        const label = String(entry.query || "").trim() || t("searchPlaceholder");
        return `<a class="continue-chip continue-chip--search" href="${escapeHtml(href)}" data-link data-continue-item="1" data-continue-kind="search"><span class="continue-chip__glyph" aria-hidden="true">⌕</span><span class="continue-chip__label">${escapeHtml(label)}</span></a>`;
      }
      const mediaStub = {
        tmdbId: entry.tmdbId,
        mediaType: entry.mediaType,
        title: entry.title,
        year: entry.year,
        poster: entry.poster
      };
      const typeLabel = entry.mediaType === "movie" ? t("searchTypeMovie") : t("searchTypeTv");
      const subHtml =
        entry.kind === "subtitles"
          ? `<span class="continue-card__meta">${escapeHtml(
              entry.mediaType === "tv"
                ? continueTvMetaLine(entry) || t("continueBadgeSubtitles")
                : t("continueBadgeSubtitles")
            )}</span>`
          : entry.year
            ? `<span class="continue-card__meta continue-card__meta--muted">${escapeHtml(entry.year)}</span>`
            : "";
      return `<a class="continue-card" href="${escapeHtml(href)}" data-link data-continue-item="1" data-continue-kind="${escapeHtml(
        entry.kind
      )}">
        <div class="continue-card__thumb">${posterOrFallbackHtml(mediaStub)}</div>
        <div class="continue-card__body">
          <span class="continue-card__type">${escapeHtml(typeLabel)}</span>
          <span class="continue-card__title">${escapeHtml(entry.title || "—")}</span>
          ${subHtml}
        </div>
      </a>`;
    })
    .join("");
  return `
    <section class="card continue-browsing-card" aria-label="${escapeHtml(t("continueBrowsingTitle"))}">
      <div class="card-inner">
        <div class="card-title-row">
          <h2 class="title-h2">${escapeHtml(t("continueBrowsingTitle"))}</h2>
          <span class="title-meta">${escapeHtml(t("continueBrowsingSub"))}</span>
        </div>
        <div class="home-rail-wrap continue-browsing-wrap">
          <div class="continue-browsing-rail">${cards}</div>
        </div>
      </div>
    </section>
  `;
}

function addRecentSearch(item) {
  if (!item.query) return;
  const prev = getRecentSearches().filter((s) => s.query.toLowerCase() !== item.query.toLowerCase());
  const next = [{ query: item.query, type: item.type || "multi", year: item.year || "" }, ...prev].slice(0, MAX_RECENT_SEARCHES);
  localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(next));
  addContinueHistoryEntry({
    kind: "search",
    query: item.query,
    type: item.type || "multi",
    year: item.year || ""
  });
}

function getSubtitlePreferences() {
  try {
    const raw = JSON.parse(localStorage.getItem(SUBTITLE_PREFS_KEY) || "{}");
    return {
      language: String(raw.language || "all"),
      provider: String(raw.provider || "all"),
      sort: String(raw.sort || "best"),
      hi: String(raw.hi || "all"),
      fileName: String(raw.fileName || "")
    };
  } catch {
    return { language: "all", provider: "all", sort: "best", hi: "all", fileName: "" };
  }
}

function saveSubtitlePreferences(next = {}) {
  const merged = { ...getSubtitlePreferences(), ...next };
  localStorage.setItem(SUBTITLE_PREFS_KEY, JSON.stringify(merged));
}

const analyticsAdapters = [];

function registerAnalyticsAdapter(adapter) {
  if (typeof adapter === "function") analyticsAdapters.push(adapter);
}

registerAnalyticsAdapter((event) => {
  if (typeof window.gtag === "function") {
    window.gtag("event", event.event, {
      event_category: "subtitlehub",
      ...event
    });
  }
});

registerAnalyticsAdapter((event) => {
  if (typeof window.plausible === "function") {
    window.plausible(event.event, { props: event });
  }
});

registerAnalyticsAdapter((event) => {
  if (window.posthog && typeof window.posthog.capture === "function") {
    window.posthog.capture(event.event, event);
  }
});

function trackEvent(name, payload = {}) {
  const event = {
    event: name,
    ts: new Date().toISOString(),
    ...payload
  };
  for (const adapter of analyticsAdapters) {
    try {
      adapter(event);
    } catch {}
  }
  if (Array.isArray(window.dataLayer)) window.dataLayer.push(event);
  window.dispatchEvent(new CustomEvent("subtitlehub:track", { detail: event }));
  console.info("[analytics]", event);
}

async function apiFetchCached(path, ttlMs = 60000) {
  const key = String(path || "").trim();
  const cached = state.requestCache.get(key);
  const now = Date.now();
  if (cached && cached.exp > now) return cached.data;
  const data = await apiFetch(path);
  state.requestCache.set(key, { data, exp: now + ttlMs });
  return data;
}

function debounce(fn, wait = 300) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightMatch(text = "", query = "") {
  const q = String(query || "").trim();
  if (!q) return escapeHtml(text);
  const pattern = new RegExp(`(${escapeRegExp(q)})`, "ig");
  return escapeHtml(text).replace(pattern, "<mark>$1</mark>");
}

function setupSearchAutocomplete({
  containerEl,
  inputEl,
  getType = () => "multi",
  getYear = () => "",
  onSelect,
  minChars = 2,
  debugLabel = ""
}) {
  if (!containerEl || !inputEl) return () => {};
  const input = inputEl;

  const wrapper = document.createElement("div");
  wrapper.className = "typeahead-dropdown";
  wrapper.hidden = true;
  wrapper.setAttribute("role", "listbox");
  containerEl.appendChild(wrapper);
  if (debugLabel) {
    console.debug("[autocomplete-attach]", {
      debugLabel,
      hasInput: Boolean(inputEl),
      hasContainer: Boolean(containerEl),
      containerClass: containerEl.className || "",
      inputId: input.id || ""
    });
  }

  let suggestions = [];
  let activeIndex = -1;
  let requestSeq = 0;
  let latestAppliedSeq = 0;

  const close = () => {
    suggestions = [];
    activeIndex = -1;
    wrapper.hidden = true;
    wrapper.innerHTML = "";
    input.setAttribute("aria-expanded", "false");
  };

  const render = (query) => {
    if (!suggestions.length) {
      wrapper.hidden = false;
      wrapper.innerHTML = `<div class="typeahead-empty">لا توجد اقتراحات</div>`;
      input.setAttribute("aria-expanded", "true");
      if (debugLabel) {
        console.debug("[autocomplete-render]", { debugLabel, query, suggestionCount: 0, emptyState: true });
      }
      return;
    }
    wrapper.hidden = false;
    input.setAttribute("aria-expanded", "true");
    wrapper.innerHTML = suggestions
      .map((item, idx) => {
        const title = item.title || "—";
        const poster = item.poster || "https://placehold.co/80x120/0d132b/eef3ff?text=No";
        const active = idx === activeIndex ? "is-active" : "";
        return `
          <button type="button" class="typeahead-item ${active}" data-suggestion-index="${idx}" role="option" aria-selected="${
            idx === activeIndex ? "true" : "false"
          }">
            <img class="typeahead-thumb" src="${poster}" alt="" />
            <span class="typeahead-content">
              <span class="typeahead-title">${highlightMatch(title, query)}</span>
              <span class="typeahead-meta">
                <span class="pill">${item.mediaType === "tv" ? escapeHtml(t("searchTypeTv")) : escapeHtml(t("searchTypeMovie"))}</span>
                <span>${escapeHtml(item.year || "—")}</span>
              </span>
            </span>
          </button>
        `;
      })
      .join("");
    if (debugLabel) {
      console.debug("[autocomplete-render]", {
        debugLabel,
        query,
        suggestionCount: suggestions.length,
        dropdownVisible: !wrapper.hidden
      });
    }
  };

  const pick = (index) => {
    const item = suggestions[index];
    if (!item) return;
    close();
    trackEvent("suggestion_selected", {
      tmdbId: item.tmdbId,
      mediaType: item.mediaType
    });
    onSelect(item);
  };

  // Must not shadow `fetchSuggestions` (the API helper above); the debounced fn returns void, not JSON.
  const debouncedLoadSuggestions = debounce(async () => {
    const query = input.value.trim();
    if (query.length < minChars) {
      close();
      return;
    }
    const seq = ++requestSeq;
    wrapper.hidden = false;
    wrapper.innerHTML = `<div class="typeahead-loading">جارٍ جلب الاقتراحات...</div>`;
    input.setAttribute("aria-expanded", "true");
    try {
      const data = await fetchSuggestions(query, getType(), getYear(), 8);
      if (seq < latestAppliedSeq) return;
      latestAppliedSeq = seq;
      suggestions = data.items || [];
      if (debugLabel) {
        console.debug("[autocomplete-fetch]", {
          debugLabel,
          query,
          suggestionCount: suggestions.length
        });
      }
      activeIndex = suggestions.length ? 0 : -1;
      render(query);
    } catch (err) {
      if (seq < latestAppliedSeq) return;
      latestAppliedSeq = seq;
      console.warn("[suggestions]", err?.message || err);
      close();
    }
  }, 300);

  input.setAttribute("autocomplete", "off");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-haspopup", "listbox");

  const onInput = () => debouncedLoadSuggestions();
  const onTypeOrYearChange = () => {
    if ((input.value || "").trim().length >= minChars) debouncedLoadSuggestions();
  };
  const onKeyDown = (e) => {
    if (wrapper.hidden || !suggestions.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = activeIndex < suggestions.length - 1 ? activeIndex + 1 : 0;
      render(input.value.trim());
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = activeIndex > 0 ? activeIndex - 1 : suggestions.length - 1;
      render(input.value.trim());
      return;
    }
    if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      pick(activeIndex);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  const onClickSuggestion = (e) => {
    const btn = e.target.closest("[data-suggestion-index]");
    if (!btn) return;
    const idx = Number(btn.getAttribute("data-suggestion-index"));
    if (Number.isNaN(idx)) return;
    pick(idx);
  };

  const onDocumentClick = (e) => {
    if (containerEl.contains(e.target)) return;
    close();
  };

  input.addEventListener("input", onInput);
  containerEl.addEventListener("change", onTypeOrYearChange);
  input.addEventListener("keydown", onKeyDown);
  wrapper.addEventListener("click", onClickSuggestion);
  document.addEventListener("click", onDocumentClick);

  return () => {
    input.removeEventListener("input", onInput);
    containerEl.removeEventListener("change", onTypeOrYearChange);
    input.removeEventListener("keydown", onKeyDown);
    wrapper.removeEventListener("click", onClickSuggestion);
    document.removeEventListener("click", onDocumentClick);
    wrapper.remove();
  };
}

function bindGlobalSearch(route) {
  if (!globalSearchForm || !globalSearchInput) return;
  if (typeof state.globalAutocompleteCleanup === "function") {
    state.globalAutocompleteCleanup();
    state.globalAutocompleteCleanup = null;
  }
  globalSearchInput.value = route?.query || "";
  state.globalAutocompleteCleanup = setupSearchAutocomplete({
    containerEl: globalSearchForm,
    inputEl: globalSearchInput,
    getType: () => "multi",
    getYear: () => "",
    minChars: 2,
    debugLabel: "navbar-global",
    onSelect: (item) => navigate(toMediaUrl(item, { year: item.year || "" }))
  });
  globalSearchForm.onsubmit = (e) => {
    e.preventDefault();
    const query = globalSearchInput.value.trim();
    if (!query) return;
    trackEvent("search_submitted", { source: "global", queryLength: query.length });
    addRecentSearch({ query, type: "multi", year: "" });
    navigate(toSearchUrl({ query, type: "multi", year: "" }));
  };
}

function searchRelevanceScore(item, query) {
  const q = String(query || "").trim().toLowerCase();
  const title = String(item.title || "").toLowerCase();
  let score = 0;
  if (q && title === q) score += 80;
  if (q && title.startsWith(q)) score += 50;
  if (q && title.includes(q)) score += 30;
  score += Math.min(Number(item.popularity || 0), 40) * 0.5;
  score += Math.min(Number(item.voteAverage || 0), 10) * 2;
  if (item.year) score += 4;
  if (item.poster) score += 4;
  return score;
}

function homeCardHref(item) {
  if (String(item?.mediaType || "").toLowerCase() === "movie") {
    return toSubtitlesUrl(item, { year: item?.year || "" });
  }
  return toMediaUrl(item, { year: item?.year || "" });
}

function renderHomeFeedCard(item) {
  const mediaLabel = item.mediaType === "movie" ? t("searchTypeMovie") : t("searchTypeTv");
  const coverageBadge = `<span class="pill">${escapeHtml(t("homeBadgeCoverage"))}</span>`;
  const arabicBadge = item?.subtitleCoverage?.arabic
    ? `<span class="pill pill--arabic">${escapeHtml(t("homeBadgeArabic"))}</span>`
    : "";
  const englishBadge = item?.subtitleCoverage?.any ? `<span class="pill pill--subtle">EN</span>` : "";
  const isNew = Number(item?.year || 0) >= new Date().getFullYear() - 1;
  const newBadge = isNew ? `<span class="pill pill--subtle">${escapeHtml(uiLang === "ar" ? "جديد" : "New")}</span>` : "";
  const trustedBadge =
    Number(item?.voteAverage || 0) >= 7.5 ? `<span class="pill pill--subtle">${escapeHtml(t("trusted"))}</span>` : "";
  return `
    <article class="media-card home-media-card">
      <a href="${homeCardHref(item)}" data-link data-home-card="1" data-media-type="${escapeHtml(item.mediaType || "")}" data-tmdb-id="${escapeHtml(
        String(item.tmdbId || "")
      )}">
        ${posterOrFallbackHtml(item)}
        <div class="media-body">
          <h3 class="media-title">${escapeHtml(item.title)}</h3>
          <div class="meta">
            <span class="pill">${escapeHtml(mediaLabel)}</span>
            <span><strong>${escapeHtml(item.year || "—")}</strong></span>
          </div>
          <div class="home-card-badges">${coverageBadge}${arabicBadge}${englishBadge}${trustedBadge}${newBadge}</div>
          <div class="card-cta"><span class="btn btn-sm">${escapeHtml(t("viewSubtitles"))}</span></div>
        </div>
      </a>
    </article>
  `;
}

function renderHomeFeedSection(title, items = [], { viewMoreHref = "/search" } = {}) {
  const count = Array.isArray(items) ? items.length : 0;
  if (!count) return "";
  const cards = items.map((item) => renderHomeFeedCard(item)).join("");
  const railClass = count <= 3 ? "home-feed-grid home-feed-rail home-feed-rail--sparse" : "home-feed-grid home-feed-rail";
  return `
    <section class="card home-feed-section">
      <div class="card-inner">
        <div class="section-header section-header--elevated">
          <h2 class="section-title">${escapeHtml(title)}</h2>
          <div class="row-actions">
            <span class="pill home-section-count">${escapeHtml(t("resultsCount"))}: ${count}</span>
            <a class="btn secondary btn-sm" href="${escapeHtml(viewMoreHref)}" data-link>${escapeHtml(t("viewMoreSection"))}</a>
          </div>
        </div>
        <div class="home-rail-wrap"><div class="${railClass}">${cards}</div></div>
      </div>
    </section>
  `;
}

function renderHomeFeed(feed) {
  const root = document.getElementById("homeFeedRoot");
  if (!root) return;
  const sections = feed?.sections || {};
  /** Aligned with server `HOME_FEED_MIN_SECTION` / Arabic — show only substantive rails. */
  const minItemsToRender = 5;
  const minItemsArabic = 4;
  const sectionDefs = [
    { title: t("homeSectionLatestMovies"), items: sections.latestMoviesWithSubs || [], href: "/search?type=movie", min: minItemsToRender },
    { title: t("homeSectionLatestArabic"), items: sections.latestArabicMovies || [], href: "/search?type=movie", min: minItemsArabic },
    { title: t("homeSectionLatestTv"), items: sections.latestTvWithSubs || [], href: "/search?type=tv", min: minItemsToRender },
    { title: t("homeSectionTrending"), items: sections.trendingWithSubs || [], href: "/search?type=multi", min: minItemsToRender },
    { title: t("homeSectionPopular"), items: sections.popularWithSubs || [], href: "/search?type=movie", min: minItemsToRender }
  ];
  const curated = sectionDefs.filter((s) => Array.isArray(s.items) && s.items.length >= (s.min ?? minItemsToRender));
  if (!curated.length) {
    root.innerHTML = "";
    return;
  }
  const spotlight =
    (sections.trendingWithSubs || [])[0] ||
    (sections.popularWithSubs || [])[0] ||
    (sections.latestMoviesWithSubs || [])[0] ||
    null;
  const spotlightHtml = spotlight
    ? `<section class="card spotlight-card">
      <div class="card-inner spotlight-inner">
        <span class="badge">${escapeHtml(t("featuredNow"))}</span>
        <h3 class="section-title">${escapeHtml(spotlight.title || "")}</h3>
        <p class="hint">${escapeHtml(spotlight.overview || t("noDescription"))}</p>
        <div class="row-actions">
          <a class="btn btn-sm" href="${homeCardHref(spotlight)}" data-link>${escapeHtml(t("featuredCta"))}</a>
        </div>
      </div>
    </section>`
    : "";
  root.innerHTML = [
    `<section class="home-discovery-head"><h2>${escapeHtml(t("homeDiscoverTitle"))}</h2><p>${escapeHtml(t("homeDiscoverSub"))}</p></section>`,
    spotlightHtml,
    ...curated.map((s) => renderHomeFeedSection(s.title, s.items, { viewMoreHref: s.href }))
  ].join("");
}

function renderHome() {
  if (typeof state.homeAutocompleteCleanup === "function") {
    state.homeAutocompleteCleanup();
    state.homeAutocompleteCleanup = null;
  }
  appEl.innerHTML = `
    <section class="landing-hero hero-card">
      <span class="badge">${escapeHtml(t("heroBadge"))}</span>
      <h1 class="hero-title">${escapeHtml(t("heroTitle"))}</h1>
      <p class="hero-subtitle">${escapeHtml(t("heroSubtitle"))}</p>
      <form id="homeHeroSearchForm" class="landing-hero-search" role="search">
        <input id="homeHeroSearchInput" type="search" placeholder="${escapeHtml(t("heroSearchPlaceholder"))}" autocomplete="off" />
        <button class="btn btn-primary" type="submit">${escapeHtml(t("heroCta"))}</button>
      </form>
      <p class="hint landing-hero-search-hint">${escapeHtml(t("heroSearchHint"))}</p>
      <div class="hero-search-row">
        <a class="btn secondary" href="/search" data-link>${escapeHtml(t("navSearch"))}</a>
        <button id="quickHealthBtn" class="secondary" type="button">${escapeHtml(t("heroHealth"))}</button>
      </div>
      <div class="stats-grid">
        <div class="stat-chip"><strong>${escapeHtml(t("homeStat1Title"))}</strong>${escapeHtml(t("homeStat1Desc"))}</div>
        <div class="stat-chip"><strong>${escapeHtml(t("homeStat2Title"))}</strong>${escapeHtml(t("homeStat2Desc"))}</div>
        <div class="stat-chip"><strong>${escapeHtml(t("homeStat3Title"))}</strong>${escapeHtml(t("homeStat3Desc"))}</div>
      </div>
      <div id="healthResult" class="hint"></div>
    </section>
    ${renderContinueBrowsingHomeSectionHtml()}
    <section id="homeFeedRoot" class="home-feed-root">
      <section class="home-discovery-head"><h2>${escapeHtml(t("homeDiscoverTitle"))}</h2><p>${escapeHtml(t("homeDiscoverSub"))}</p></section>
      <div class="skeleton-grid">${Array.from({ length: 8 })
        .map(() => `<div class="skeleton-card skeleton-card--media"></div>`)
        .join("")}</div>
      <p class="hint">${escapeHtml(t("homeFeedLoading"))}</p>
    </section>
    <section class="landing-grid">
      <article class="card"><div class="card-inner"><h2 class="title-h2">${escapeHtml(t("featureTitle"))}</h2>
        <div class="landing-feature-grid">
          <div class="landing-feature-card"><h3>${escapeHtml(t("feature1Title"))}</h3><p>${escapeHtml(t("feature1Desc"))}</p></div>
          <div class="landing-feature-card"><h3>${escapeHtml(t("feature2Title"))}</h3><p>${escapeHtml(t("feature2Desc"))}</p></div>
          <div class="landing-feature-card"><h3>${escapeHtml(t("feature3Title"))}</h3><p>${escapeHtml(t("feature3Desc"))}</p></div>
          <div class="landing-feature-card"><h3>${escapeHtml(t("feature4Title"))}</h3><p>${escapeHtml(t("feature4Desc"))}</p></div>
        </div></div></article>
      <article class="card"><div class="card-inner">
        <h2 class="title-h2">${escapeHtml(t("howTitle"))}</h2>
        <ol class="how-list">
          <li>${escapeHtml(t("how1"))}</li>
          <li>${escapeHtml(t("how2"))}</li>
          <li>${escapeHtml(t("how3"))}</li>
          <li>${escapeHtml(t("how4"))}</li>
        </ol>
      </div></article>
    </section>
    <section class="card"><div class="card-inner">
      <div class="card-title-row"><h2 class="title-h2">${escapeHtml(t("actionsTitle"))}</h2></div>
      <div class="quick-actions-grid">
        <a class="quick-action-card" href="/search?type=movie" data-link><strong>${escapeHtml(t("actionMovie"))}</strong><span>${escapeHtml(t("quickActionMovieHint"))}</span></a>
        <a class="quick-action-card" href="/search?type=tv" data-link><strong>${escapeHtml(t("actionTv"))}</strong><span>${escapeHtml(t("quickActionTvHint"))}</span></a>
        <a class="quick-action-card" href="/search?type=tv" data-link><strong>${escapeHtml(t("actionSeason"))}</strong><span>${escapeHtml(t("quickActionSeasonHint"))}</span></a>
        <a class="quick-action-card" href="/search" data-link><strong>${escapeHtml(t("actionTyping"))}</strong><span>${escapeHtml(t("searchPlaceholder"))}</span></a>
      </div>
    </div></section>
    <footer class="landing-footer">
      <div><strong>Subtitle Hub</strong><p>${escapeHtml(t("footerDesc"))}</p></div>
      <div class="landing-footer-links">
        <a href="/search" data-link>${escapeHtml(t("footerLinkSearch"))}</a>
        <a href="/api/health" target="_blank" rel="noopener">${escapeHtml(t("footerLinkHealth"))}</a>
      </div>
    </footer>
  `;
  document.getElementById("quickHealthBtn")?.addEventListener("click", async () => {
    const el = document.getElementById("healthResult");
    el.textContent = t("healthLoading");
    try {
      const h = await fetchHealth();
      el.textContent = h.ready ? t("healthStatusGood") : t("healthStatusLimited");
    } catch (err) {
      el.textContent = `${t("healthFailed")}: ${err.message}`;
    }
  });
  document.getElementById("homeHeroSearchForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = String(document.getElementById("homeHeroSearchInput")?.value || "").trim();
    if (q) {
      addRecentSearch({ query: q, type: "multi", year: "" });
      trackEvent("search_submitted", { source: "home_hero", queryLength: q.length });
    }
    navigate(q ? `/search?query=${encodeURIComponent(q)}` : "/search");
  });
  document.querySelector(".continue-browsing-rail")?.addEventListener("click", (e) => {
    const link = e.target.closest("[data-continue-item]");
    if (!link) return;
    trackEvent("continue_browsing_clicked", { kind: link.getAttribute("data-continue-kind") || "" });
  });
  const homeHeroForm = document.getElementById("homeHeroSearchForm");
  const homeHeroInput = document.getElementById("homeHeroSearchInput");
  console.debug("[home-hero-autocomplete-init]", {
    hasForm: Boolean(homeHeroForm),
    hasInput: Boolean(homeHeroInput)
  });
  state.homeAutocompleteCleanup = setupSearchAutocomplete({
    containerEl: homeHeroForm,
    inputEl: homeHeroInput,
    getType: () => "multi",
    getYear: () => "",
    minChars: 2,
    debugLabel: "home-hero",
    onSelect: (item) => navigate(toMediaUrl(item, { year: item.year || "" }))
  });
  fetchHomeFeed()
    .then((feed) => {
      renderHomeFeed(feed);
      document.getElementById("homeFeedRoot")?.addEventListener("click", (e) => {
        const card = e.target.closest("[data-home-card]");
        if (!card) return;
        trackEvent("home_card_clicked", {
          tmdbId: card.getAttribute("data-tmdb-id") || "",
          mediaType: card.getAttribute("data-media-type") || ""
        });
      });
    })
    .catch((err) => {
      const root = document.getElementById("homeFeedRoot");
      if (!root) return;
      root.innerHTML = `<div class="alert alert-error">${escapeHtml(t("homeFeedFailed"))}: ${escapeHtml(err?.message || "")}</div>`;
    });
}

function renderSearchShell({ query = "", type = "multi", year = "" }) {
  const recent = getRecentSearches();
  appEl.innerHTML = `
    <section class="hero hero-card">
      <span class="badge">${escapeHtml(t("searchStageBadge"))}</span>
      <h1 class="hero-title">${escapeHtml(t("searchHeroTitle"))}</h1>
      <p class="hero-subtitle">${escapeHtml(t("searchHeroSubtitle"))}</p>
    </section>
    <section class="search-layout">
      <button type="button" id="searchFilterToggle" class="btn secondary search-filter-toggle" aria-expanded="false" aria-controls="searchFilterPanel">${escapeHtml(
        t("showFilters")
      )}</button>
      <aside class="card filter-panel" id="searchFilterPanel">
        <div class="card-inner">
          <div class="card-title-row">
            <h2 class="title-h2">${escapeHtml(t("searchFiltersTitle"))}</h2>
            <span class="title-meta">${escapeHtml(uiLang === "ar" ? "فلاتر ذكية" : "Smart filters")}</span>
          </div>
          <form id="searchForm" class="form-grid">
            <div class="field">
              <label for="query">${escapeHtml(t("searchLabelQuery"))}</label>
              <input id="query" name="query" value="${escapeHtml(query)}" placeholder="${escapeHtml(uiLang === "ar" ? "مثال: Interstellar" : "Example: Interstellar")}" required />
            </div>
            <div class="form-grid two-col">
              <div class="field">
                <label for="type">${escapeHtml(t("searchLabelType"))}</label>
                <select id="type" name="type">
                  <option value="multi" ${type === "multi" ? "selected" : ""}>${escapeHtml(t("searchTypeAll"))}</option>
                  <option value="movie" ${type === "movie" ? "selected" : ""}>${escapeHtml(t("searchTypeMovie"))}</option>
                  <option value="tv" ${type === "tv" ? "selected" : ""}>${escapeHtml(t("searchTypeTv"))}</option>
                </select>
              </div>
              <div class="field">
                <label for="year">${escapeHtml(t("searchLabelYear"))}</label>
                <input id="year" name="year" value="${escapeHtml(year)}" placeholder="2014" inputmode="numeric" />
              </div>
            </div>
            <div class="row-actions">
              <button type="submit">بحث</button>
              <a class="btn secondary" href="/search" data-link>${escapeHtml(t("clear"))}</a>
            </div>
          </form>
          ${
            recent.length
              ? `<p class="hint search-recent-hint">${escapeHtml(t("searchRecentSearchesSub"))}</p><div class="recent-searches">${recent
                  .map(
                    (s) => `<button class="secondary btn-sm" type="button" data-recent='${escapeHtml(
                      JSON.stringify(s)
                    )}'>${escapeHtml(s.query)}</button>`
                  )
                  .join("")}</div>`
              : ""
          }
          <p class="footer-note">${escapeHtml(t("searchTipYear"))}</p>
        </div>
      </aside>
      <section>
        <div class="section-header section-header--elevated">
          <div>
            <h2 class="section-title">${escapeHtml(t("searchResultsTitle"))}</h2>
            <p class="section-sub" id="searchSummary">${query ? `${escapeHtml(t("searchSummaryPrefix"))}: "${escapeHtml(query)}"` : escapeHtml(t("searchSummaryIdle"))}</p>
          </div>
          <span class="pill" id="searchCount"></span>
        </div>
        <div id="searchStatus"></div>
        <div id="searchResults" class="media-grid"></div>
      </section>
    </section>
  `;
}

function dedupeSearchResults(rows = []) {
  const byTmdb = new Set();
  const byFallback = new Set();
  const out = [];
  const canonical = (s) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\b(the|a|an)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  for (const item of rows) {
    const tmdbId = String(item?.tmdbId ?? item?.id ?? "").trim();
    const mediaType = String(item?.mediaType || "").trim().toLowerCase();
    const title = String(item?.title || "").trim().toLowerCase();
    const year = String(item?.year || "").trim();
    if (tmdbId && mediaType) {
      const k = `${mediaType}:${tmdbId}`;
      if (byTmdb.has(k)) continue;
      byTmdb.add(k);
      out.push(item);
      continue;
    }
    const fk = `${mediaType}|${canonical(title)}|${year}`;
    if (!mediaType || !title) {
      out.push(item);
      continue;
    }
    if (byFallback.has(fk)) continue;
    byFallback.add(fk);
    out.push(item);
  }
  // Extra near-duplicate pass: if same canonical title + year + mediaType appears again,
  // keep only the first visual card even when source IDs differ.
  const seenVisual = new Set();
  return out.filter((item) => {
    const k = `${String(item?.mediaType || "").toLowerCase()}|${canonical(item?.title || "")}|${String(item?.year || "").trim()}`;
    if (!k || k === "||") return true;
    if (seenVisual.has(k)) return false;
    seenVisual.add(k);
    return true;
  });
}

function posterOrFallbackHtml(item, { featured = false } = {}) {
  const poster = String(item?.poster || "").trim();
  if (poster) {
    return `<img class="${featured ? "featured-poster" : "poster"}" src="${escapeHtml(poster)}" loading="${featured ? "eager" : "lazy"}" alt="${escapeHtml(
      item?.title || ""
    )}" />`;
  }
  const title = String(item?.title || "Subtitle Hub").trim();
  const initial = title ? title.charAt(0).toUpperCase() : "S";
  return `<div class="${featured ? "featured-poster-fallback" : "poster-fallback"}" aria-label="${escapeHtml(
    title
  )}">
    <span class="${featured ? "featured-poster-fallback__glyph" : "poster-fallback__glyph"}">${escapeHtml(initial)}</span>
    <span class="${featured ? "featured-poster-fallback__title" : "poster-fallback__title"}">${escapeHtml(title)}</span>
  </div>`;
}

function renderMediaCards(results = [], visibleCount = 24, query = "") {
  const list = document.getElementById("searchResults");
  const countEl = document.getElementById("searchCount");
  if (!results.length) {
    countEl.textContent = "";
    list.innerHTML = `<p class="empty">${escapeHtml(t("emptySearchResults"))}</p>`;
    return;
  }
  countEl.textContent = `${t("resultsCount")}: ${results.length}`;
  const sorted = [...results].sort((a, b) => searchRelevanceScore(b, query) - searchRelevanceScore(a, query));
  const visible = sorted.slice(0, visibleCount);
  list.innerHTML = visible
    .map(
      (item) => `
    <article class="media-card media-card--fixed">
      <a href="${toMediaUrl(item)}" data-link data-search-card="1" data-media-type="${escapeHtml(item.mediaType || "")}" data-tmdb-id="${escapeHtml(
        String(item.tmdbId || "")
      )}">
        <div class="media-poster-wrap">
          ${posterOrFallbackHtml(item)}
        </div>
        <div class="media-body">
          <h3 class="media-title">${escapeHtml(item.title)}</h3>
          <p class="overview">${escapeHtml(
            item.overview
              ? item.overview.length > 160
                ? `${item.overview.slice(0, 160)}…`
                : item.overview
              : t("noDescription")
          )}</p>
          <div class="meta">
            <span class="pill">${item.mediaType === "movie" ? escapeHtml(t("searchTypeMovie")) : escapeHtml(t("searchTypeTv"))}</span>
            <span><strong>${escapeHtml(item.year || "—")}</strong></span>
            <span>#${escapeHtml(item.tmdbId)}</span>
          </div>
          <div class="card-cta"><span class="btn btn-sm">${escapeHtml(t("viewSubtitles"))}</span></div>
        </div>
      </a>
    </article>
  `
    )
    .join("");
  // TEMP DEBUG: verify rendered counts after dedupe/grouping.
  console.debug("[search-render-counts]", {
    renderedVisible: visible.length,
    renderedUniqueTotal: visible.length
  });
  if (results.length > visible.length) {
    list.insertAdjacentHTML(
      "beforeend",
      `<div class="row-actions"><button type="button" class="secondary" id="loadMoreSearchBtn">${escapeHtml(t("loadMore"))} (${results.length - visible.length})</button></div>`
    );
  }
}

async function renderSearch(route) {
  if (typeof state.searchAutocompleteCleanup === "function") {
    state.searchAutocompleteCleanup();
    state.searchAutocompleteCleanup = null;
  }
  const query = route.query || "";
  const type = route.type || "multi";
  const year = route.year || "";
  renderSearchShell({ query, type, year });
  const form = document.getElementById("searchForm");
  const status = document.getElementById("searchStatus");
  const summary = document.getElementById("searchSummary");
  const filterPanel = document.getElementById("searchFilterPanel");
  const filterToggle = document.getElementById("searchFilterToggle");
  const applyFilterPanelState = (expanded) => {
    if (!filterPanel || !filterToggle) return;
    filterPanel.classList.toggle("is-collapsed", !expanded);
    filterToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    filterToggle.textContent = expanded ? t("hideFilters") : t("showFilters");
  };
  if (filterPanel && filterToggle) {
    const shouldCollapseInitially = window.innerWidth <= 980;
    applyFilterPanelState(!shouldCollapseInitially);
    filterToggle.addEventListener("click", () => {
      const expanded = filterToggle.getAttribute("aria-expanded") === "true";
      applyFilterPanelState(!expanded);
    });
  }
  state.searchAutocompleteCleanup = setupSearchAutocomplete({
    containerEl: form,
    inputEl: form.query,
    getType: () => form.type.value || "multi",
    getYear: () => form.year.value.trim(),
    onSelect: (item) => navigate(toMediaUrl(item, { year: item.year || "" }))
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const payload = {
      query: form.query.value.trim(),
      type: form.type.value,
      year: form.year.value.trim()
    };
    addRecentSearch(payload);
    trackEvent("search_submitted", {
      source: "search_page",
      queryLength: payload.query.length,
      type: payload.type,
      hasYear: Boolean(payload.year)
    });
    navigate(toSearchUrl(payload));
  });
  for (const b of document.querySelectorAll("[data-recent]")) {
    b.addEventListener("click", () => {
      try {
        const parsed = JSON.parse(b.getAttribute("data-recent"));
        trackEvent("recent_search_clicked", { source: "search_page", type: parsed?.type || "multi" });
        navigate(toSearchUrl(parsed));
      } catch {}
    });
  }
  if (!query) {
    renderMediaCards([]);
    return;
  }
  status.innerHTML = `<div class="alert alert-info">${escapeHtml(t("searching"))}</div>`;
  document.getElementById("searchResults").innerHTML = `<div class="skeleton-grid">${Array.from({ length: 6 })
    .map(() => `<div class="skeleton-card skeleton-card--media"></div>`)
    .join("")}</div>`;
  summary.textContent = `${t("searchSummaryPrefix")}: "${query}"`;
  try {
    const data = await fetchSearchMedia(query, type, year);
    status.innerHTML = "";
    const rawResults = data.results || [];
    const allResults = dedupeSearchResults(rawResults);
    // TEMP DEBUG: verify pre-render dedupe effectiveness.
    console.debug("[search-dedupe-counts]", {
      rawResults: rawResults.length,
      dedupedResults: allResults.length,
      dedupePrimaryKey: "mediaType:tmdbId",
      dedupeFallbackKey: "mediaType|normalizedTitle|year"
    });
    let visibleCount = 24;
    trackEvent("search_results_viewed", {
      queryLength: query.length,
      type,
      dedupedCount: allResults.length
    });
    const paint = () => {
      renderMediaCards(allResults, visibleCount, query);
      const loadMoreBtn = document.getElementById("loadMoreSearchBtn");
      if (loadMoreBtn) {
        loadMoreBtn.addEventListener("click", () => {
          visibleCount += 24;
          paint();
        });
      }
    };
    paint();
  } catch (err) {
    status.innerHTML = `<div class="alert alert-error">${escapeHtml(t("searchFailed"))}: ${escapeHtml(err.message)}</div>`;
    document.getElementById("searchResults").innerHTML = "";
  }
}

async function getMediaById(tmdbId, mediaType) {
  const data = await fetchMediaDetails(tmdbId, mediaType);
  return data.media || null;
}

const PRESET_SUBTITLE_RESOLUTIONS = ["2160P", "1080P", "720P", "480P"];
const PRESET_SUBTITLE_SOURCES = ["BLURAY", "WEB-DL", "WEBRIP", "HDRIP", "DVD", "DVD-RIP", "REMUX", "HDTV"];
const PRESET_SUBTITLE_CODECS = ["X265", "X264", "HEVC", "H.264"];

function uniqSortedStr(values) {
  return [...new Set(values.map((x) => String(x || "").trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
}

function normalizeSubtitleLangForFilter(code = "") {
  const lower = String(code || "").toLowerCase().trim().replace(/_/g, "-");
  if (!lower || lower === "all" || lower === "und") return "";
  const base = lower.split("-")[0];
  const aliases = {
    arabic: "ar",
    ara: "ar",
    english: "en",
    eng: "en",
    french: "fr",
    fre: "fr",
    german: "de",
    spanish: "es",
    italian: "it",
    turkish: "tr"
  };
  const key = aliases[base] || aliases[lower] || (base.length >= 2 ? base.slice(0, 2) : base);
  return key;
}

function parseReleaseMetadata(sub) {
  const raw = [sub.releaseName || "", ...(Array.isArray(sub.releases) ? sub.releases : [])].join(" ").toLowerCase();
  const resolution = raw.match(/\b(2160p|1080p|720p|480p)\b/i)?.[1] || "";
  const source =
    raw.match(/\b(bluray|web-dl|webrip|hdrip|dvdrip|remux|hdtv)\b/i)?.[1] || "";
  const codec = raw.match(/\b(x265|x264|hevc|h\.?264)\b/i)?.[1] || "";
  const extras = ["remastered", "extended", "proper", "repack"].filter((t) => raw.includes(t));
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

/**
 * Intro copy for TV episode alternates (seasonPack / seasonScoped). RTL-oriented, concise.
 * @param {Array<{ tvMatchKind?: string }>} filteredAlt
 * @param {boolean} mainHasExact - main list has at least one row (exact-episode results)
 */
function buildTvAlternateSectionIntroHtml(filteredAlt, mainHasExact) {
  const hasPack = filteredAlt.some((s) => String(s.tvMatchKind || "") === "seasonPack");
  const hasScoped = filteredAlt.some((s) => String(s.tvMatchKind || "") === "seasonScoped");
  const lead = mainHasExact
    ? uiLang === "ar"
      ? "يوجد أيضاً بدائل على مستوى الموسم أدناه — ليست مطابقة حلقة دقيقة."
      : "Season-level alternatives are also available below (not exact episode matches)."
    : uiLang === "ar"
      ? "لم نجد ترجمة مطابقة للحلقة، لكن وجدنا بدائل من نفس الموسم."
      : "No exact episode subtitle found, but season alternatives are available.";
  const hintParts = [];
  if (hasPack) hintParts.push(uiLang === "ar" ? "باك الموسم قد يشمل حلقات متعددة." : "Season packs may include multiple episodes.");
  if (hasScoped) hintParts.push(uiLang === "ar" ? "الترجمات على مستوى الموسم قد تفيد حتى من دون مطابقة الحلقة." : "Season-scoped subtitles can still be useful without exact episode matching.");
  const hint = hintParts.join(" ");
  return `<p class="subtitle-alternate-lead">${lead}</p>${hint ? `<p class="hint subtitle-alternate-hint">${hint}</p>` : ""}`;
}

function applySubtitleFilters(subtitles, controls) {
  const query = controls.text.trim().toLowerCase();
  const tvKindSet =
    controls.mediaType === "tv" && Array.isArray(controls.tvKindFilter) && controls.tvKindFilter.length
      ? new Set(controls.tvKindFilter.map(String))
      : null;

  let items = subtitles.filter((s) => {
    if (tvKindSet && !tvKindSet.has(String(s.tvMatchKind || ""))) return false;
    if (controls.language !== "all") {
      const want = normalizeSubtitleLangForFilter(controls.language);
      const got = normalizeSubtitleLangForFilter(s.language);
      if (!want || got !== want) return false;
    }
    if (controls.provider !== "all" && String(s.provider || "") !== controls.provider) return false;
    if (controls.hi === "only" && !s.hearingImpaired) return false;
    if (controls.hi === "exclude" && s.hearingImpaired) return false;
    if (controls.resolution !== "all" && s.meta.resolution !== controls.resolution) return false;
    if (controls.source !== "all" && s.meta.source !== controls.source) return false;
    if (controls.codec !== "all" && s.meta.codec !== controls.codec) return false;
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
  } else if (controls.sort === "downloads") {
    items = items.sort((a, b) => Number(b.downloads || 0) - Number(a.downloads || 0));
  } else if (controls.sort === "alphabetical") {
    items = items.sort((a, b) => String(a.releaseName || "").localeCompare(String(b.releaseName || "")));
  } else if (controls.sort === "best") {
    items = items.sort((a, b) => {
      const tierDiff = Number(b.tvMatchTier || 0) - Number(a.tvMatchTier || 0);
      if (tierDiff !== 0) return tierDiff;
      return Number(b.score || 0) - Number(a.score || 0);
    });
  }
  return items;
}

function subtitleStableKey(s) {
  const id = s?.id ?? s?.subtitleId ?? s?.subtitle_id ?? "";
  return `${String(s?.provider || "")}|${String(id)}|${String(s?.downloadUrl || "").slice(0, 96)}`;
}

function subtitleRankingComparator(a, b) {
  const tierDiff = Number(b.tvMatchTier || 0) - Number(a.tvMatchTier || 0);
  if (tierDiff !== 0) return tierDiff;
  return Number(b.score || 0) - Number(a.score || 0);
}

function providerPillClass(provider) {
  if (provider === "subdl") return "provider-subdl";
  if (provider === "opensubtitles") return "provider-opensubtitles";
  return "";
}

function providerLabel(provider) {
  if (provider === "opensubtitles") return "OpenSubtitles";
  if (provider === "subdl") return "SubDL";
  return provider || "unknown";
}

function reasonLabelAr(key) {
  const map =
    uiLang === "ar"
      ? {
          exactEpisodeMatch: "مطابقة الحلقة",
          seasonPackMatch: "باك الموسم",
          seasonGenericMatch: "ترجمة عامة للموسم",
          exactLanguageMatch: "تطابق اللغة",
          trustedProvider: "مصدر موثوق",
          highDownloads: "تنزيلات عالية",
          strongFilenameMatch: "تطابق قوي مع اسم الملف",
          completeMetadata: "بيانات إصدار مكتملة"
        }
      : {
          exactEpisodeMatch: "Exact episode match",
          seasonPackMatch: "Season pack match",
          seasonGenericMatch: "Season-level match",
          exactLanguageMatch: "Exact language match",
          trustedProvider: "Trusted provider",
          highDownloads: "High downloads",
          strongFilenameMatch: "Strong filename match",
          completeMetadata: "Complete metadata"
        };
  return map[key] || key;
}

/**
 * 1–3 short bullets for the best-pick card; prefers backend `topReasons`, then filename/trusted/Arabic hints.
 */
function buildBestPickReasonBullets(sub) {
  const out = [];
  const seen = new Set();
  const push = (label) => {
    const k = String(label || "").trim();
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(k);
  };
  const tr = Array.isArray(sub.topReasons) ? sub.topReasons : [];
  for (const key of tr) {
    push(reasonLabelAr(key));
    if (out.length >= 3) return out;
  }
  const langNorm = normalizeSubtitleLangForFilter(sub.language);
  if (out.length < 3 && langNorm === "ar" && !tr.includes("exactLanguageMatch")) {
    push(uiLang === "ar" ? "عربي متاح" : "Arabic subtitles available");
  }
  const breakdown = sub.scoreBreakdown || {};
  if (out.length < 3 && Number(breakdown.filenameSimilarity || 0) >= 12 && !tr.includes("strongFilenameMatch")) {
    push(reasonLabelAr("strongFilenameMatch"));
  }
  const isTrusted =
    (sub.provider === "opensubtitles" && Number(sub.downloads || 0) >= 1500) ||
    (sub.provider === "subdl" && Number(sub.downloads || 0) >= 700);
  if (out.length < 3 && isTrusted && !tr.includes("trustedProvider")) {
    push(reasonLabelAr("trustedProvider"));
  }
  if (!out.length) {
    push(
      sub.confidence === "excellent"
        ? uiLang === "ar"
          ? "ثقة ممتازة في ترتيب النظام"
          : "Excellent confidence from ranking"
        : uiLang === "ar"
          ? "تطابق قوي ضمن النتائج الحالية"
          : "Strong match among current results"
    );
  }
  return out.slice(0, 3);
}

/**
 * Picks the top candidate by the same ordering as sort "best" (tvMatchTier, then score).
 * Returns null when the lead is not clearly strong or the race is ambiguous.
 */
function selectBestSubtitleRecommendation(filtered, ctx) {
  if (!Array.isArray(filtered) || !filtered.length) return null;
  const sorted = [...filtered].sort(subtitleRankingComparator);
  const top = sorted[0];
  const second = sorted[1];
  const score = Number(top.score || 0);
  const conf = top.confidence;
  const tier = Number(top.tvMatchTier || 0);

  if (conf === "medium") return null;
  if (conf === "strong" && score < 52) return null;

  if (second) {
    const s2 = Number(second.score || 0);
    const t2 = Number(second.tvMatchTier || 0);
    if (t2 === tier && Math.abs(score - s2) < 3.5) return null;
    if (Math.abs(score - s2) < 2) return null;
  }

  const episodeMode = ctx.mediaType === "tv" && String(ctx.episode || "").trim();
  if (episodeMode && tier < 3) {
    if (!(conf === "excellent" || score >= 64)) return null;
  }

  return { sub: top, reasons: buildBestPickReasonBullets(top) };
}

function renderSubtitleBestPick(container, pick) {
  if (!container) return;
  if (!pick) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }
  const { sub, reasons } = pick;
  const isTv = Boolean(sub.tvMatchKind && sub.tvMatchKind !== "movie");
  const tvKind = isTv ? String(sub.tvMatchKind || "") : "";
  const tvTierBadge =
    tvKind === "exactEpisode"
      ? `<span class="tag-chip tag-exact">${escapeHtml(uiLang === "ar" ? "مطابقة الحلقة" : "Exact episode")}</span>`
      : tvKind === "seasonPack"
        ? `<span class="tag-chip tag-season-pack">${escapeHtml(uiLang === "ar" ? "باك الموسم" : "Season pack")}</span>`
        : tvKind === "seasonScoped"
          ? `<span class="tag-chip tag-season-generic">${escapeHtml(uiLang === "ar" ? "ترجمة عامة للموسم" : "Season-level")}</span>`
          : "";
  const isTrusted =
    (sub.provider === "opensubtitles" && Number(sub.downloads || 0) >= 1500) ||
    (sub.provider === "subdl" && Number(sub.downloads || 0) >= 700);
  const meter = confidenceBadgeFromBackend(sub.confidence);
  const tags = [
    sub.meta?.resolution && `<span class="tag-chip strong">${escapeHtml(sub.meta.resolution)}</span>`,
    sub.meta?.source && `<span class="tag-chip">${escapeHtml(sub.meta.source)}</span>`,
    sub.meta?.codec && `<span class="tag-chip">${escapeHtml(sub.meta.codec)}</span>`,
    tvTierBadge,
    isTrusted ? `<span class="tag-chip tag-trusted">${escapeHtml(t("trusted"))}</span>` : ""
  ]
    .filter(Boolean)
    .join("");
  const reasonsHtml = reasons
    .map((r) => `<li><span class="subtitle-best-pick__reason-dot" aria-hidden="true"></span>${escapeHtml(r)}</li>`)
    .join("");

  container.hidden = false;
  container.innerHTML = `
    <section class="subtitle-best-pick" aria-label="${escapeHtml(t("bestPickAria"))}">
      <div class="subtitle-best-pick__glow" aria-hidden="true"></div>
      <div class="subtitle-best-pick__inner">
        <div class="subtitle-best-pick__head">
          <span class="subtitle-best-pick__badge">${escapeHtml(t("bestPickBadge"))}</span>
          <span class="subtitle-best-pick__score pill ${meter.cls}">${escapeHtml(t("overallScore"))}: ${escapeHtml(
            String(Number(sub.score || 0).toFixed(1))
          )}</span>
        </div>
        <h3 class="subtitle-best-pick__title">${escapeHtml(sub.releaseName || "Subtitle")}</h3>
        <p class="hint subtitle-best-pick__uploader">${escapeHtml(t("uploader"))}: ${escapeHtml(sub.author || t("unknown"))}</p>
        <div class="sub-meta subtitle-best-pick__pills">
          <span class="pill ${providerPillClass(sub.provider)}">${escapeHtml(providerLabel(sub.provider))}</span>
          <span class="pill">${escapeHtml(sub.language || "")}${sub.hearingImpaired ? " • HI" : ""}</span>
          <span class="pill ${meter.cls}">${escapeHtml(t("confidence"))}: ${escapeHtml(meter.label)}</span>
        </div>
        ${tags ? `<div class="sub-meta subtitle-best-pick__tags">${tags}</div>` : ""}
        <p class="subtitle-best-pick__why-label">${escapeHtml(t("bestPickRankSummary"))}</p>
        <ul class="subtitle-best-pick__reasons">${reasonsHtml}</ul>
        <div class="subtitle-best-pick__actions row-actions">
          <a class="btn subtitle-best-pick__cta" data-download="1" data-best-pick="1" data-provider="${escapeHtml(
            sub.provider || ""
          )}" href="${escapeHtml(sub.downloadUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t("download"))}</a>
        </div>
        <p class="hint subtitle-best-pick__footnote">${escapeHtml(t("bestPickFootnote"))}</p>
      </div>
    </section>
  `;
}

function confidenceBadgeFromBackend(confidence) {
  if (confidence === "excellent") return { label: uiLang === "ar" ? "ممتاز" : "Excellent", cls: "confidence-high" };
  if (confidence === "strong") return { label: uiLang === "ar" ? "قوي" : "Strong", cls: "confidence-mid" };
  return { label: uiLang === "ar" ? "متوسط" : "Medium", cls: "confidence-low" };
}

function formatReadableDate(value = "") {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("ar", { year: "numeric", month: "long", day: "numeric" });
}

function renderSubtitleMediaHero(media, route) {
  if (!media) return "";
  const chips = [
    media.mediaType === "tv" ? t("subtitleTypeTv") : t("subtitleTypeMovie"),
    media.year || "",
    media.voteAverage ? `⭐ ${Number(media.voteAverage).toFixed(1)}` : "",
    media.status || ""
  ].filter(Boolean);
  const genres =
    Array.isArray(media.genres) && media.genres.length
      ? media.genres.map((g) => `<span class="tag-chip">${escapeHtml(g)}</span>`).join("")
      : `<span class="hint">لا تتوفر تصنيفات لهذا العمل.</span>`;
  const stats =
    media.mediaType === "movie"
      ? [
          media.runtime ? `${media.runtime} دقيقة` : "",
          media.releaseDate ? formatReadableDate(media.releaseDate) : ""
        ]
      : [
          media.seasonCount ? `${media.seasonCount} مواسم` : "",
          media.episodeCount ? `${media.episodeCount} حلقة` : "",
          media.firstAirDate ? formatReadableDate(media.firstAirDate) : ""
        ];

  return `
    <section class="card subtitle-hero">
      ${media.backdrop ? `<div class="subtitle-hero-backdrop"><img src="${escapeHtml(media.backdrop)}" loading="lazy" alt="" /></div>` : ""}
      <div class="card-inner">
        <div class="subtitle-hero-layout">
          <img class="subtitle-hero-poster" src="${escapeHtml(
            media.poster || "https://placehold.co/500x750/0d132b/eef3ff?text=No+Poster"
          )}" loading="lazy" alt="" />
          <div class="subtitle-hero-content">
            <h1 class="subtitle-hero-title">${escapeHtml(media.title)}</h1>
            <div class="sub-meta">${chips.map((c) => `<span class="pill">${escapeHtml(c)}</span>`).join("")}</div>
            <p class="hero-subtitle">${escapeHtml(media.overview || t("noWorkDescription"))}</p>
            <div class="sub-meta">${genres}</div>
            <div class="subtitle-hero-stats">
              ${stats
                .filter(Boolean)
                .map((s) => `<div class="subtitle-stat"><strong>${escapeHtml(s)}</strong></div>`)
                .join("")}
              <div class="subtitle-stat"><strong>#${escapeHtml(media.tmdbId)}</strong></div>
            </div>
            <div class="row-actions">
              <a class="btn secondary btn-sm" href="${toMediaUrl(media, {
                year: route.year || media.year || "",
                lang: route.language,
                provider: route.provider,
                season: route.season,
                episode: route.episode
              })}" data-link>العودة لتفاصيل العمل</a>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function seasonOptionLabel(n) {
  const num = Number(n || 0);
  if (!Number.isFinite(num) || num < 1) return "";
  return uiLang === "ar" ? `الموسم ${num}` : `Season ${num}`;
}

function episodeOptionLabel(n) {
  const num = Number(n || 0);
  if (!Number.isFinite(num) || num < 1) return "";
  return uiLang === "ar" ? `الحلقة ${num}` : `Episode ${num}`;
}

function getSeasonCountForUi(media, route = {}) {
  const seasons = Array.isArray(media?.seasons) ? media.seasons.filter((s) => Number(s?.seasonNumber || 0) > 0) : [];
  if (seasons.length) {
    return Math.max(...seasons.map((s) => Number(s.seasonNumber || 0)));
  }
  const fromMedia = Number(media?.seasonCount || 0);
  const fromRoute = Number(route?.season || 0);
  if (fromMedia > 0) return Math.max(1, fromMedia);
  if (fromRoute > 0) return Math.max(1, fromRoute);
  return 10;
}

function getEpisodeCountForUi(media, seasonValue = "", route = {}) {
  const seasonNum = Number(seasonValue || 0);
  if (!Number.isFinite(seasonNum) || seasonNum < 1) return 0;
  const seasons = Array.isArray(media?.seasons) ? media.seasons : [];
  const matchedSeason = seasons.find((s) => Number(s?.seasonNumber || 0) === seasonNum);
  const matchedCount = Number(matchedSeason?.episodeCount || 0);
  if (matchedCount > 0) return matchedCount;
  const routeEpisode = Number(route?.episode || 0);
  const totalEpisodes = Number(media?.episodeCount || 0);
  const seasonCount = Number(media?.seasonCount || 0);
  if (totalEpisodes > 0 && seasonCount > 0) {
    const avg = Math.ceil(totalEpisodes / seasonCount);
    return Math.max(avg, routeEpisode || 0, 1);
  }
  return Math.max(routeEpisode || 0, 20);
}

function buildSeasonOptionsHtml(media, route = {}) {
  const seasons = Array.isArray(media?.seasons) ? media.seasons.filter((s) => Number(s?.seasonNumber || 0) > 0) : [];
  const selected = String(route?.season || "").trim();
  if (seasons.length) {
    const head = [`<option value="" ${selected ? "" : "selected"} disabled>${escapeHtml(
      uiLang === "ar" ? "اختر الموسم" : "Select season"
    )}</option>`];
    const body = seasons.map((s) => {
      const n = String(Number(s.seasonNumber || 0));
      return `<option value="${n}" ${selected === n ? "selected" : ""}>${escapeHtml(seasonOptionLabel(n))}</option>`;
    });
    return [...head, ...body].join("");
  }
  const count = getSeasonCountForUi(media, route);
  const options = [`<option value="" ${selected ? "" : "selected"} disabled>${escapeHtml(
    uiLang === "ar" ? "اختر الموسم" : "Select season"
  )}</option>`];
  for (let idx = 0; idx < count; idx += 1) {
    const n = String(idx + 1);
    options.push(`<option value="${n}" ${selected === n ? "selected" : ""}>${escapeHtml(seasonOptionLabel(n))}</option>`);
  }
  return options.join("");
}

function buildEpisodeOptionsHtml(media, seasonValue = "", route = {}) {
  const seasonNum = String(seasonValue || "").trim();
  const selectedEpisode = String(route?.episode || "").trim();
  if (!seasonNum) {
    return `<option value="" selected>${escapeHtml(uiLang === "ar" ? "اختر الموسم أولًا" : "Select season first")}</option>`;
  }
  const episodeCount = getEpisodeCountForUi(media, seasonNum, route);
  const options = [`<option value="" ${!selectedEpisode ? "selected" : ""}>${escapeHtml(t("subtitleEpisodeSeasonHint"))}</option>`];
  for (let i = 1; i <= episodeCount; i += 1) {
    const val = String(i);
    options.push(`<option value="${val}" ${selectedEpisode === val ? "selected" : ""}>${escapeHtml(episodeOptionLabel(val))}</option>`);
  }
  return options.join("");
}

function bindTvSeasonEpisodeSelects({ form, media, seasonSelector = "season", episodeSelector = "episode", route = {} }) {
  const seasonEl = form?.elements?.[seasonSelector];
  const episodeEl = form?.elements?.[episodeSelector];
  if (!seasonEl || !episodeEl) return;
  const syncEpisodeState = () => {
    const seasonVal = String(seasonEl.value || "").trim();
    const currentEpisode = String(episodeEl.value || "").trim();
    episodeEl.disabled = !seasonVal;
    episodeEl.innerHTML = buildEpisodeOptionsHtml(media, seasonVal, {
      ...route,
      episode: currentEpisode || route?.episode || ""
    });
    const availableValues = new Set(Array.from(episodeEl.options || []).map((opt) => String(opt.value)));
    if (!availableValues.has(currentEpisode)) {
      episodeEl.value = "";
    }
  };
  seasonEl.addEventListener("change", syncEpisodeState);
  syncEpisodeState();
}

function renderMediaForm(media, route) {
  const prefs = getSubtitlePreferences();
  const selectedLang = route.lang && route.lang !== "all" ? route.lang : prefs.language || "all";
  const selectedProvider = route.provider && route.provider !== "all" ? route.provider : prefs.provider || "all";
  const selectedFileName = route.fileName || prefs.fileName || "";
  appEl.innerHTML = `
    <nav class="breadcrumb" aria-label="${escapeHtml(t("breadcrumb"))}">
      <a href="/" data-link>${escapeHtml(t("navHome"))}</a> › <a href="/search" data-link>${escapeHtml(t("navSearch"))}</a> › <span>${escapeHtml(media.title)}</span>
    </nav>
    <div class="card media-detail-hero">
      ${
        media.backdrop
          ? `<div class="media-backdrop"><img src="${escapeHtml(media.backdrop)}" loading="lazy" alt="" /></div>`
          : ""
      }
      <div class="card-inner">
        <div class="detail-layout">
          <div><img class="poster" src="${media.poster || "https://placehold.co/500x750/0d132b/eef3ff?text=No+Poster"}" loading="lazy" alt="" /></div>
          <div>
            <div class="detail-meta">
              <span class="pill">${media.mediaType === "movie" ? escapeHtml(t("subtitleTypeMovie")) : escapeHtml(t("subtitleTypeTv"))}</span>
              <span class="pill">#${escapeHtml(media.tmdbId)}</span>
              ${media.year ? `<span class="pill">${escapeHtml(media.year)}</span>` : ""}
              ${media.voteAverage ? `<span class="pill">⭐ ${escapeHtml(Number(media.voteAverage).toFixed(1))}</span>` : ""}
              ${
                media.mediaType === "tv" && media.seasonCount
                  ? `<span class="pill">المواسم: ${escapeHtml(media.seasonCount)}</span>`
                  : ""
              }
            </div>
            <h1 class="hero-title" style="font-size:clamp(1.7rem,3vw,2.2rem)">${escapeHtml(media.title)}</h1>
            ${
              Array.isArray(media.genres) && media.genres.length
                ? `<div class="sub-meta" style="margin:10px 0 4px;">${media.genres
                    .map((g) => `<span class="tag-chip">${escapeHtml(g)}</span>`)
                    .join("")}</div>`
                : ""
            }
            <p class="hero-subtitle" style="font-size:15px;max-width:none;margin-top:12px;">${escapeHtml(media.overview || t("noDescription"))}</p>
            ${
              media.mediaType === "tv" && Array.isArray(media.seasons) && media.seasons.length
                ? `<div class="sub-meta" style="margin-top:8px;">
                    ${media.seasons
                      .slice(0, 8)
                      .map(
                        (s) =>
                          `<span class="tag-chip">${escapeHtml(
                            uiLang === "ar"
                              ? `الموسم ${s.seasonNumber} • ${s.episodeCount || "—"} حلقات`
                              : `Season ${s.seasonNumber} • ${s.episodeCount || "—"} eps`
                          )}</span>`
                      )
                      .join("")}
                  </div>`
                : ""
            }
            <div class="section-header" style="margin-top:26px;"><h2 class="section-title">${escapeHtml(t("subtitleOptions"))}</h2><span class="section-sub">${escapeHtml(t("subtitleOptionsSub"))}</span></div>
            <form id="subtitleForm" class="form-grid">
              <div class="form-grid two-col">
                <div class="field">
                  <label for="language">${escapeHtml(t("subtitleLanguage"))}</label>
                  <select id="language" name="language">
                    ${["all", "ar", "en", "fr", "de", "es", "tr"]
                      .map((lng) => `<option value="${lng}" ${selectedLang === lng ? "selected" : ""}>${lng}</option>`)
                      .join("")}
                  </select>
                </div>
                <div class="field">
                  <label for="provider">${escapeHtml(t("subtitleProvider"))}</label>
                  <select id="provider" name="provider">
                    <option value="all" ${selectedProvider === "all" ? "selected" : ""}>${escapeHtml(t("searchTypeAll"))}</option>
                    <option value="subdl" ${selectedProvider === "subdl" ? "selected" : ""}>SubDL</option>
                    <option value="opensubtitles" ${selectedProvider === "opensubtitles" ? "selected" : ""}>OpenSubtitles</option>
                  </select>
                </div>
              </div>
              ${
                media.mediaType === "tv"
                  ? `
                <div class="form-grid two-col">
                  <div class="field"><label for="season">${escapeHtml(t("subtitleSeason"))}</label><select id="season" name="season" required>${buildSeasonOptionsHtml(
                    media,
                    route
                  )}</select></div>
                  <div class="field"><label for="episode">${escapeHtml(t("subtitleEpisodeOptional"))}</label><select id="episode" name="episode">${buildEpisodeOptionsHtml(
                    media,
                    route.season || "",
                    route
                  )}</select></div>
                </div>`
                  : ""
              }
              <div class="field">
                <label for="fileName">${escapeHtml(t("fileMatchLabel"))}</label>
                <input id="fileName" name="fileName" value="${escapeHtml(selectedFileName)}" placeholder="Example.Show.S01E02.1080p.WEB-DL.x264" />
              </div>
              <div class="row-actions" style="margin-top:14px;">
                <button type="submit">${escapeHtml(media.mediaType === "tv" ? t("browseSubtitlesCta") : t("viewSubtitles"))}</button>
                <a class="btn secondary" href="/search" data-link>${escapeHtml(t("backToSearch"))}</a>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  `;
  const subtitleFormEl = document.getElementById("subtitleForm");
  if (media.mediaType === "tv") {
    bindTvSeasonEpisodeSelects({
      form: subtitleFormEl,
      media,
      seasonSelector: "season",
      episodeSelector: "episode",
      route
    });
  }
  subtitleFormEl.addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const filter = {
      language: form.language.value,
      provider: form.provider.value,
      season: form.season ? form.season.value.trim() : "",
      ...(form.episode && form.episode.value.trim() ? { episode: form.episode.value.trim() } : {}),
      fileName: form.fileName ? form.fileName.value.trim() : "",
      year: route.year || media.year || ""
    };
    saveSubtitlePreferences({
      language: filter.language,
      provider: filter.provider,
      fileName: filter.fileName
    });
    navigate(toSubtitlesUrl(media, filter));
  });
}

async function renderMedia(route) {
  appEl.innerHTML = `<div class="alert alert-info">${escapeHtml(t("loadingMedia"))}</div>`;
  try {
    if (!/^\d+$/.test(String(route.tmdbId || ""))) {
      appEl.innerHTML = `<div class="alert alert-error">${escapeHtml(t("invalidTmdbId"))}</div>`;
      return;
    }
    const media = await getMediaById(route.tmdbId, route.mediaType);
    if (!media) {
      appEl.innerHTML = `<div class="alert alert-error">${escapeHtml(t("workNotFound"))}</div>`;
      return;
    }
    if (route.year) media.year = route.year;
    state.selectedMedia = media;
    trackEvent("media_selected", {
      tmdbId: media.tmdbId,
      mediaType: media.mediaType
    });
    recordRecentMediaPage(media, route);
    renderMediaForm(media, route);
  } catch (err) {
    appEl.innerHTML = `<div class="alert alert-error">${escapeHtml(t("mediaLoadFailed"))}: ${escapeHtml(err.message)}</div>`;
  }
}

function getSubtitleEmptyCopy(ctx) {
  const { hasSeasonAlternates, filtersEmptyOnly, tvQueryModeFromApi, mediaType } = ctx;
  if (hasSeasonAlternates) {
    return { title: t("subtitleEmptyTitleAlternates"), body: t("subtitleEmptyBodyAlternates") };
  }
  if (filtersEmptyOnly) {
    return { title: t("subtitleEmptyTitleFilters"), body: t("subtitleEmptyBodyFilters") };
  }
  if (mediaType === "tv" && tvQueryModeFromApi === "episode") {
    return { title: t("subtitleEmptyTitleEpisode"), body: t("subtitleEmptyBodyEpisode") };
  }
  if (mediaType === "tv") {
    return { title: t("subtitleEmptyTitleSeason"), body: t("subtitleEmptyBodySeason") };
  }
  return { title: t("subtitleEmptyTitleMovie"), body: t("subtitleEmptyBodyMovie") };
}

/**
 * Contextual recovery links for subtitle empty states (user-facing copy only).
 */
function buildSubtitleRecoveryActions(ctx) {
  const { media, route, effectiveFileName, baseLength, hasSeasonAlternates, tvQueryModeFromApi } = ctx;
  if (!media) return [];
  const year = route.year || media.year || "";
  const prov = route.provider || "all";
  const lang = route.language || "all";
  const langNorm = lang !== "all" ? normalizeSubtitleLangForFilter(lang) : "";
  const tvKinds =
    media.mediaType === "tv" && Array.isArray(route.tvKinds) && route.tvKinds.length ? route.tvKinds : null;

  const seen = new Set();
  const actions = [];
  const add = (id, href, labelKey, opts = {}) => {
    if (!href || seen.has(href)) return;
    seen.add(href);
    actions.push({ id, href, labelKey, ...opts });
  };

  if (hasSeasonAlternates) {
    add("seasonAlternates", "#subtitleAlternateSection", "recoveryJumpToSeasonOptions", {
      anchor: true,
      primary: true
    });
  }

  if (media.mediaType === "tv" && route.season && String(route.episode || "").trim() && tvQueryModeFromApi === "episode") {
    add(
      "browseSeason",
      toSubtitlesUrl(media, {
        language: lang,
        provider: prov,
        season: route.season,
        year,
        fileName: effectiveFileName || "",
        ...(tvKinds ? { tvKinds } : {})
      }),
      "recoveryBrowseWholeSeason",
      { primary: !hasSeasonAlternates }
    );
  }

  if (baseLength > 0) {
    add(
      "widenAll",
      toSubtitlesUrl(media, {
        language: "all",
        provider: "all",
        season: route.season,
        episode: route.episode,
        year,
        fileName: "",
        tvKinds: []
      }),
      "recoveryLoosenFilters",
      { primary: !hasSeasonAlternates && baseLength > 0 }
    );
  }

  if (lang !== "all") {
    add(
      "langAll",
      toSubtitlesUrl(media, {
        language: "all",
        provider: prov,
        season: route.season,
        episode: route.episode,
        year,
        fileName: effectiveFileName || "",
        ...(tvKinds ? { tvKinds } : {})
      }),
      "recoveryTryAllLanguages"
    );
  }

  if (langNorm === "ar") {
    add(
      "langEn",
      toSubtitlesUrl(media, {
        language: "en",
        provider: prov,
        season: route.season,
        episode: route.episode,
        year,
        fileName: effectiveFileName || "",
        ...(tvKinds ? { tvKinds } : {})
      }),
      "recoveryTryEnglish"
    );
  }

  if (prov !== "all") {
    add(
      "provAll",
      toSubtitlesUrl(media, {
        language: lang,
        provider: "all",
        season: route.season,
        episode: route.episode,
        year,
        fileName: effectiveFileName || "",
        ...(tvKinds ? { tvKinds } : {})
      }),
      "recoveryUseAllSources"
    );
  }

  if (effectiveFileName) {
    add(
      "noFile",
      toSubtitlesUrl(media, {
        language: lang,
        provider: prov,
        season: route.season,
        episode: route.episode,
        year,
        fileName: "",
        ...(tvKinds ? { tvKinds } : {})
      }),
      "recoveryWithoutFilename"
    );
  }

  if (media.mediaType === "tv" && tvKinds && tvKinds.length) {
    add(
      "clearTvKinds",
      toSubtitlesUrl(media, {
        language: lang,
        provider: prov,
        season: route.season,
        episode: route.episode,
        year,
        fileName: effectiveFileName || ""
      }),
      "recoveryAllMatchTypes"
    );
  }

  add(
    "mediaPage",
    toMediaUrl(media, {
      year,
      ...(lang !== "all" ? { lang } : {}),
      ...(prov !== "all" ? { provider: prov } : {}),
      ...(route.season ? { season: route.season } : {}),
      ...(route.episode ? { episode: route.episode } : {})
    }),
    "recoveryBackToTitleDetails"
  );
  add("search", "/search", "recoveryTryAnotherTitle");

  let primarySet = false;
  for (const a of actions) {
    if (a.primary) {
      if (primarySet) a.primary = false;
      else primarySet = true;
    }
  }
  if (!primarySet && actions.length) actions[0].primary = true;

  return actions;
}

function renderSubtitleEmptyState(target, ctx) {
  const { title, body } = getSubtitleEmptyCopy(ctx);
  const actions = buildSubtitleRecoveryActions(ctx);
  const showResetFilters = Boolean(ctx.filtersEmptyOnly);

  const actionHtml = actions
    .map((a) => {
      const cls = a.primary ? "btn subtitle-empty-state__action" : "btn secondary subtitle-empty-state__action";
      if (a.anchor) {
        return `<a class="${cls}" href="${escapeHtml(a.href)}">${escapeHtml(t(a.labelKey))}</a>`;
      }
      return `<a class="${cls}" href="${escapeHtml(a.href)}" data-link>${escapeHtml(t(a.labelKey))}</a>`;
    })
    .join("");

  const resetBtn = showResetFilters
    ? `<button type="button" class="btn secondary subtitle-empty-state__action" id="subtitleEmptyResetFiltersBtn">${escapeHtml(
        t("recoveryResetPanelFilters")
      )}</button>`
    : "";

  target.innerHTML = `
    <div class="subtitle-empty-state" role="status">
      <div class="subtitle-empty-state__glow" aria-hidden="true"></div>
      <div class="subtitle-empty-state__inner">
        <h3 class="subtitle-empty-state__title">${escapeHtml(title)}</h3>
        <p class="subtitle-empty-state__body">${escapeHtml(body)}</p>
        <p class="subtitle-empty-state__actions-label">${escapeHtml(t("subtitleEmptyActionsHeading"))}</p>
        <div class="subtitle-empty-state__actions">
          ${actionHtml}
          ${resetBtn}
        </div>
      </div>
    </div>
  `;
}

function subtitleLanguageGroupKey(sub) {
  const n = normalizeSubtitleLangForFilter(sub.language);
  if (n) return n;
  const raw = String(sub.language || "").trim().toLowerCase().replace(/_/g, "-");
  const base = raw.split("-")[0] || "";
  if (/^[a-z]{2,8}$/.test(base)) return base;
  return raw || "und";
}

function collectLanguageGroupsForSubtitles(subtitles) {
  const buckets = new Map();
  for (const sub of subtitles) {
    const key = subtitleLanguageGroupKey(sub);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(sub);
  }
  const orderedKeys = [];
  if (buckets.has("ar")) orderedKeys.push("ar");
  if (buckets.has("en")) orderedKeys.push("en");
  const rest = [...buckets.keys()].filter((k) => k !== "ar" && k !== "en").sort((a, b) => a.localeCompare(b));
  orderedKeys.push(...rest);
  return orderedKeys.map((k) => ({ key: k, items: buckets.get(k) }));
}

function shouldUseSubtitleLanguageGrouping(subtitles) {
  if (!Array.isArray(subtitles) || subtitles.length < 2) return false;
  return new Set(subtitles.map(subtitleLanguageGroupKey)).size >= 2;
}

function subtitleLanguageGroupTitle(langKey) {
  if (langKey === "ar") return t("languageGroupArabic");
  if (langKey === "en") return t("languageGroupEnglish");
  if (langKey === "und" || !langKey) return t("languageGroupUndetermined");
  return langKey.toUpperCase();
}

function makeSubtitleGlobalIndexLookup(subtitles) {
  const m = new Map();
  subtitles.forEach((sub, i) => {
    const k = subtitleStableKey(sub);
    if (!m.has(k)) m.set(k, i);
  });
  return (sub) => m.get(subtitleStableKey(sub)) ?? 9999;
}

function renderSubtitleCards(target, subtitles) {
  if (!subtitles.length) {
    target.innerHTML = `<p class="empty">${escapeHtml(t("subtitleEmptyFilteredOut"))}</p>`;
    return;
  }
  const context = target.dataset.context ? JSON.parse(target.dataset.context) : {};
  const isTv = context.mediaType === "tv";
  const globalIdxOf = makeSubtitleGlobalIndexLookup(subtitles);
  const fileTokens = String(context.fileName || "")
    .toLowerCase()
    .replace(/[\W_]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 1);

  const renderCard = (sub) => {
    const rank = globalIdxOf(sub);
    const highlightBest = rank < 6;
    const rel = Array.isArray(sub.releases) && sub.releases.length ? sub.releases.slice(0, 5).join("، ") : "—";
    const tvKind = isTv ? sub.tvMatchKind || "" : "";
    const tvTierBadge =
      tvKind === "exactEpisode"
        ? `<span class="tag-chip tag-exact">مطابقة الحلقة</span>`
        : tvKind === "seasonPack"
          ? `<span class="tag-chip tag-season-pack">باك الموسم</span>`
          : tvKind === "seasonScoped"
            ? `<span class="tag-chip tag-season-generic">ترجمة عامة للموسم</span>`
            : "";
    const isTrusted =
      (sub.provider === "opensubtitles" && Number(sub.downloads || 0) >= 1500) ||
      (sub.provider === "subdl" && Number(sub.downloads || 0) >= 700);
    const breakdown = sub.scoreBreakdown || {};
    const meter = confidenceBadgeFromBackend(sub.confidence);
    const filenameScore = fileTokens.length ? Math.round((Number(breakdown.filenameSimilarity || 0) / 40) * 100) : 0;
    const reasons = [
      ...(Array.isArray(sub.topReasons) ? sub.topReasons.map((key) => reasonLabelAr(key)) : []),
      Number(sub.score || 0) ? `${t("overallScore")}: ${Number(sub.score).toFixed(1)}` : ""
    ].filter(Boolean);
    const tags = [
      sub.meta.resolution && `<span class="tag-chip strong">${sub.meta.resolution}</span>`,
      sub.meta.source && `<span class="tag-chip">${sub.meta.source}</span>`,
      sub.meta.codec && `<span class="tag-chip">${sub.meta.codec}</span>`,
      sub.meta.group && `<span class="tag-chip">GRP ${escapeHtml(sub.meta.group)}</span>`,
      sub.meta.cdCount && `<span class="tag-chip">CD ${escapeHtml(sub.meta.cdCount)}</span>`,
      sub.meta.fileCount ? `<span class="tag-chip">${sub.meta.fileCount} files</span>` : "",
      sub.hearingImpaired ? `<span class="tag-chip tag-hi">HI / SDH</span>` : "",
      tvTierBadge,
      isTrusted ? `<span class="tag-chip tag-trusted">${escapeHtml(t("trusted"))}</span>` : "",
      ...sub.meta.extras.map((e) => `<span class="tag-chip">${escapeHtml(e)}</span>`)
    ]
      .filter(Boolean)
      .join("");
    return `
      <article class="sub-item ${highlightBest ? "sub-item-best" : ""} ${rank < 3 ? "sub-item-priority" : "sub-item-secondary"}" data-sub-lang="${escapeHtml(subtitleLanguageGroupKey(sub))}">
        <div class="sub-head">
          <div>
            <div class="sub-title">${escapeHtml(sub.releaseName || "Subtitle")}</div>
            <div class="hint">${escapeHtml(t("uploader"))}: ${escapeHtml(sub.author || t("unknown"))}</div>
          </div>
          <div class="sub-meta">
            <span class="pill ${providerPillClass(sub.provider)}">${escapeHtml(providerLabel(sub.provider))}</span>
            <span class="pill">${escapeHtml(sub.language || "")}${sub.hearingImpaired ? " • HI" : ""}</span>
            <span class="pill ${meter.cls}">${escapeHtml(t("confidence"))}: ${meter.label}</span>
          </div>
        </div>
        <div class="sub-meta">${tags}</div>
        ${
          Array.isArray(sub.topReasons) && sub.topReasons.length
            ? `<div class="sub-meta">${sub.topReasons
                .map((key) => `<span class="tag-chip">${escapeHtml(reasonLabelAr(key))}</span>`)
                .join("")}</div>`
            : ""
        }
        <div class="hint">${escapeHtml(t("releasesLabel"))}: ${escapeHtml(rel)}</div>
        ${sub.downloads ? `<div class="hint">${escapeHtml(t("downloadsCount"))}: ${escapeHtml(sub.downloads)}</div>` : ""}
        ${sub.comment ? `<div class="hint">${escapeHtml(t("note"))}: ${escapeHtml(sub.comment)}</div>` : ""}
        ${
          reasons.length
            ? `<details class="why-rank"><summary>${escapeHtml(t("whyHighRank"))}</summary><ul>${reasons
                .map((r) => `<li>${escapeHtml(r)}</li>`)
                .join("")}</ul>
                <div class="rank-breakdown">
                  <span>اللغة ${Number(breakdown.language || 0).toFixed(1)}</span>
                  <span>الحلقة ${Number(breakdown.episodeMatch || 0).toFixed(1)}</span>
                  <span>تصنيف TV ${Number(breakdown.tvTierBoost || 0).toFixed(1)}</span>
                  <span>المزوّد ${Number(breakdown.providerTrust || 0).toFixed(1)}</span>
                  <span>${escapeHtml(t("downloadsCount"))} ${Number(breakdown.downloads || 0).toFixed(1)}</span>
                  <span>اسم الملف ${Number(breakdown.filenameSimilarity || 0).toFixed(1)}</span>
                  <span>الاكتمال ${Number(breakdown.completeness || 0).toFixed(1)}</span>
                </div>
              </details>`
            : ""
        }
        <div class="sub-actions">
          <p class="hint">${escapeHtml(uiLang === "ar" ? "مصدر مباشر" : "Direct source")}: ${escapeHtml(providerLabel(sub.provider))}</p>
          <div class="row-actions"><a class="btn btn-sm" data-download="1" data-provider="${escapeHtml(
            sub.provider || ""
          )}" href="${escapeHtml(sub.downloadUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t("download"))}</a></div>
        </div>
      </article>
    `;
  };

  const compareMiniBlock =
    fileTokens.length && subtitles.length
      ? `<div class="compare-mini">
          <h4 class="result-group-title">${escapeHtml(t("quickFilenameCompare"))}</h4>
          ${subtitles
            .slice(0, 3)
            .map((sub) => {
              const releaseText = `${sub.releaseName || ""} ${(sub.releases || []).join(" ")}`.toLowerCase();
              const tokenHits = fileTokens.filter((tok) => releaseText.includes(tok)).length;
              const score = Math.round((tokenHits / Math.max(fileTokens.length, 1)) * 100);
              return `<div class="compare-row"><span>${escapeHtml(sub.releaseName || "Subtitle")}</span><span class="pill">${score}%</span></div>`;
            })
            .join("")}
        </div>`
      : "";

  if (shouldUseSubtitleLanguageGrouping(subtitles)) {
    const langGroups = collectLanguageGroupsForSubtitles(subtitles);
    const langSections = langGroups
      .map(
        ({ key, items }) => `
      <section class="subtitle-group subtitle-group--by-lang" data-lang-group="${escapeHtml(key)}">
        <div class="subtitle-lang-head">
          <h3 class="subtitle-lang-head__title">${escapeHtml(subtitleLanguageGroupTitle(key))}</h3>
          <span class="pill pill--subtle" aria-hidden="true">${items.length}</span>
        </div>
        <div class="sub-list">${items.map((sub) => renderCard(sub)).join("")}</div>
      </section>`
      )
      .join("");
    target.innerHTML = langSections + (compareMiniBlock ? `<section class="subtitle-group subtitle-group--compare">${compareMiniBlock}</section>` : "");
    return;
  }

  const bestMatches = subtitles.slice(0, Math.min(6, subtitles.length));
  const remaining = subtitles.slice(bestMatches.length);
  const groups = new Map();
  for (const sub of remaining) {
    const key = sub.meta.resolution || "OTHER";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sub);
  }
  const preferredOrder = ["2160P", "1080P", "720P", "480P", "OTHER"];
  const orderedKeys = [...new Set([...preferredOrder, ...groups.keys()])].filter((k) => groups.get(k)?.length);
  const bestSection = `
    <section class="subtitle-group">
      <h3 class="result-group-title">${escapeHtml(t("bestMatches"))}</h3>
      <div class="sub-list">
        ${bestMatches.map((sub) => renderCard(sub)).join("")}
      </div>
      ${compareMiniBlock && bestMatches.length ? compareMiniBlock : ""}
    </section>
  `;
  const groupedSections = orderedKeys
    .map((key) => {
      const items = groups.get(key) || [];
      const sectionTitle = key === "OTHER" ? t("otherSubtitles") : `${t("qualityPrefix")} ${key}`;
      const cards = items.map((sub) => renderCard(sub)).join("");
      return `<section class="subtitle-group"><h3 class="result-group-title">${sectionTitle}</h3><div class="sub-list">${cards}</div></section>`;
    })
    .join("");
  target.innerHTML = bestSection + groupedSections;
}

function readTvKindsFromAddressBar() {
  const r = parseLocation();
  if (r.page !== "subtitles" || r.mediaType !== "tv") return [];
  return r.tvKinds || [];
}

async function renderSubtitles(route) {
  if (!/^\d+$/.test(String(route.tmdbId || ""))) {
    appEl.innerHTML = `<div class="alert alert-error">${escapeHtml(t("invalidTmdbId"))}</div>`;
    return;
  }
  const media =
    state.selectedMedia &&
    String(state.selectedMedia.tmdbId) === String(route.tmdbId) &&
    state.selectedMedia.mediaType === route.mediaType
      ? state.selectedMedia
      : await getMediaById(route.tmdbId, route.mediaType);
  if (media) state.selectedMedia = media;
  const effectiveFileName = route.fileName || getSubtitlePreferences().fileName || "";

  if (route.mediaType === "tv" && !route.season) {
    appEl.innerHTML = `
      <nav class="breadcrumb" aria-label="${escapeHtml(t("breadcrumb"))}">
        <a href="/" data-link>${escapeHtml(t("navHome"))}</a> ›
        <a href="/search" data-link>${escapeHtml(t("navSearch"))}</a> ›
        ${media ? `<a href="${toMediaUrl(media, { year: route.year || media.year || "", lang: route.language, provider: route.provider })}" data-link>${escapeHtml(media.title)}</a> ›` : ""}
        <span>${escapeHtml(t("subtitleResultsTitle"))}</span>
      </nav>
      <section class="card">
        <div class="card-inner">
          <div class="alert alert-info">
            يجب اختيار <strong>رقم الموسم</strong> أولًا قبل البحث عن ترجمات المسلسل. لا نُشغّل بحثًا عامًا بدون موسم حتى لا تظهر نتائج مضللة.
          </div>
          <p class="hint">اذهب إلى صفحة تفاصيل العمل، أدخل الموسم (والحلقة لاحقًا إن أردت ترجمات حلقة محددة)، ثم افتح صفحة الترجمات من هناك.</p>
          <div class="row-actions">
            ${
              media
                ? `<a class="btn" href="${toMediaUrl(media, {
                    year: route.year || media.year || "",
                    lang: route.language,
                    provider: route.provider
                  })}" data-link>${escapeHtml(uiLang === "ar" ? "العودة لتحديد الموسم" : "Back to season selection")}</a>`
                : `<a class="btn" href="/search" data-link>${escapeHtml(t("backToSearch"))}</a>`
            }
          </div>
        </div>
      </section>
    `;
    return;
  }

  const tvQuickChipDefs =
    route.mediaType === "tv"
      ? route.episode
        ? getTvQuickFilterKinds().filter((x) => x.kind === "exactEpisode")
        : getTvQuickFilterKinds().filter((x) => x.kind === "seasonPack" || x.kind === "seasonScoped")
      : [];
  const tvChipBarHint = route.episode
    ? t("episodeOnlyHint")
    : t("seasonOnlyHint");

  appEl.innerHTML = `
    <nav class="breadcrumb" aria-label="${escapeHtml(t("breadcrumb"))}">
      <a href="/" data-link>${escapeHtml(t("navHome"))}</a> ›
      <a href="/search" data-link>${escapeHtml(t("navSearch"))}</a> ›
      ${media ? `<a href="${toMediaUrl(media, { year: route.year || media.year || "", lang: route.language, provider: route.provider })}" data-link>${escapeHtml(media.title)}</a> ›` : ""}
      <span>${escapeHtml(t("subtitleResultsTitle"))}</span>
    </nav>
    ${media ? renderSubtitleMediaHero(media, route) : ""}
    ${
      media && media.mediaType === "tv"
        ? `
      <section class="card tv-episode-panel">
        <div class="card-inner">
          <div class="section-header" style="margin:0 0 10px;">
            <h2 class="section-title">${escapeHtml(uiLang === "ar" ? "اختيار الموسم والحلقة" : "Season & episode selection")}</h2>
            <span class="section-sub">${escapeHtml(
              uiLang === "ar"
                ? "الموسم مطلوب — الحلقة اختيارية (بدون حلقة: كل ترجمات الموسم، بما فيها ترجمات الحلقات من نفس الموسم)"
                : "Season is required, episode is optional (no episode = season-level subtitles, including same-season episodes)."
            )}</span>
          </div>
          <form id="tvJumpForm" class="form-grid two-col">
            <div class="field">
              <label for="tvSeason">${escapeHtml(t("subtitleSeason"))}</label>
              <select id="tvSeason" name="season" required>${buildSeasonOptionsHtml(media, {
                ...route,
                season: route.season || "1"
              })}</select>
            </div>
            <div class="field">
              <label for="tvEpisode">${escapeHtml(t("subtitleEpisodeOptional"))}</label>
              <select id="tvEpisode" name="episode">${buildEpisodeOptionsHtml(media, route.season || "1", route)}</select>
            </div>
            <div class="row-actions">
              <button type="submit" class="btn-sm">${escapeHtml(t("updateResults"))}</button>
            </div>
          </form>
        </div>
      </section>
    `
        : ""
    }
    <section class="card subtitle-filename-panel">
      <div class="card-inner">
        <div class="section-header" style="margin:0 0 8px;">
          <h2 class="section-title">${escapeHtml(t("fileMatchTitle"))}</h2>
          <span class="section-sub">${escapeHtml(t("sharperRanking"))}</span>
        </div>
        <p class="hint">${escapeHtml(t("pasteFilenameHint"))}</p>
        <form id="fileMatchForm" class="form-grid">
          <div class="field">
            <label for="fileMatchInput">اسم ملف الفيديو (اختياري)</label>
            <input id="fileMatchInput" name="fileName" value="${escapeHtml(effectiveFileName)}" placeholder="Movie.2024.1080p.WEB-DL.x264-GROUP.mkv" />
          </div>
          <div class="row-actions">
            <button type="submit" class="btn-sm">${escapeHtml(t("improveRanking"))}</button>
            ${
              effectiveFileName
                ? `<button type="button" class="secondary btn-sm" id="clearFileMatchBtn">${escapeHtml(t("removeMatch"))}</button>`
                : ""
            }
          </div>
        </form>
      </div>
    </section>
    <button type="button" id="subFilterToggle" class="btn secondary sub-filter-toggle" aria-expanded="false" aria-controls="subFiltersPanel">${escapeHtml(
      t("showFilters")
    )}</button>
    <section class="sub-layout">
      <aside class="card sub-filters-panel" id="subFiltersPanel">
        <div class="card-inner">
          <div class="card-title-row">
            <h2 class="title-h2">${escapeHtml(t("subtitleFiltersTitle"))}</h2>
            <span class="title-meta">${escapeHtml(t("applyInstant"))}</span>
          </div>
          <form id="subFilterForm" class="form-grid">
            <div class="field">
              <label>بحث داخل النتائج</label>
              <input name="text" placeholder="${escapeHtml(uiLang === "ar" ? "اسم الإصدار أو الملاحظات..." : "Release name or notes...")}" />
            </div>
            <div class="form-grid two-col">
              <div class="field">
                <label>اللغة</label>
                <select name="languageFilter">
                  <option value="all">${escapeHtml(t("languageAll"))}</option>
                </select>
              </div>
              <div class="field">
                <label>المزوّد</label>
                <select name="providerFilter">
                  <option value="all">${escapeHtml(t("languageAll"))}</option>
                  <option value="subdl">SubDL</option>
                  <option value="opensubtitles">OpenSubtitles</option>
                </select>
              </div>
            </div>
            <div class="form-grid two-col">
              <div class="field">
                <label>جودة الصورة</label>
                <select name="resolutionFilter"><option value="all">${escapeHtml(t("languageAll"))}</option></select>
              </div>
              <div class="field">
                <label>المصدر</label>
                <select name="sourceFilter"><option value="all">${escapeHtml(t("languageAll"))}</option></select>
              </div>
            </div>
            <div class="form-grid two-col">
              <div class="field">
                <label>الترميز</label>
                <select name="codecFilter"><option value="all">${escapeHtml(t("languageAll"))}</option></select>
              </div>
              <div class="field">
                <label>الترتيب</label>
                <select name="sort">
                  <option value="best">أفضل تطابق (موصى به)</option>
                  <option value="downloads">${escapeHtml(t("sortDownloads"))}</option>
                  <option value="trusted">الموثوق أولًا</option>
                  <option value="newest">أحدث اسم إصدار</option>
                  <option value="alphabetical">أبجديًا</option>
                </select>
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
              <div class="field"><label>${escapeHtml(t("help"))}</label><div class="hint">${escapeHtml(uiLang === "ar" ? "يمكنك التصفية حسب الجودة والمصدر والترميز مباشرة." : "You can filter directly by resolution, source, and codec.")}</div></div>
            </div>
            <div class="row-actions">
              <button type="button" id="applySubFilters" class="btn-sm">تطبيق</button>
              <button type="button" id="resetSubFilters" class="secondary btn-sm">إعادة ضبط</button>
            </div>
            <div class="preset-chips" id="presetChips">
              <button type="button" class="secondary btn-sm" data-preset="best">Best Match</button>
              <button type="button" class="secondary btn-sm" data-preset="1080p">1080p</button>
              <button type="button" class="secondary btn-sm" data-preset="webdl">WEB-DL</button>
              <button type="button" class="secondary btn-sm" data-preset="bluray">BluRay</button>
              <button type="button" class="secondary btn-sm" data-preset="nonhi">Non-HI</button>
              <button type="button" class="secondary btn-sm" data-preset="ar">Arabic</button>
              <button type="button" class="secondary btn-sm" data-preset="en">English</button>
              <button type="button" class="secondary btn-sm" data-preset="opensubtitles">OpenSubtitles</button>
              <button type="button" class="secondary btn-sm" data-preset="subdl">SubDL</button>
              <button type="button" class="secondary btn-sm" data-preset="clear">Clear</button>
            </div>
            <div id="activeFilterChips" class="recent-searches"></div>
          </form>
          <p class="footer-note">يمكنك البحث عن فيلم آخر مباشرة من شريط البحث بالأعلى بدون الرجوع.</p>
        </div>
      </aside>
      <section>
        <div class="card">
          <div class="card-inner">
            <div class="section-header section-header--elevated" style="margin:0 0 8px;">
              <h1 class="section-title" style="font-size:1.4rem;">${escapeHtml(t("subtitleResultsTitle"))}</h1>
              <span class="pill" id="subtitleCount"></span>
            </div>
            <p class="hint">${media ? escapeHtml(media.title) : `TMDb ${escapeHtml(route.tmdbId)}`} — اللغة: ${escapeHtml(route.language)} — المزود: ${escapeHtml(route.provider)}</p>
            <div class="row-actions" style="margin-top:14px;">${media ? "" : `<a class="btn secondary btn-sm" href="/search" data-link>← العودة للبحث</a>`}</div>
          </div>
        </div>
        <div id="subtitleInsights" class="card" style="margin-top:10px;"><div class="card-inner hint">—</div></div>
        ${isSubtitleDevDiagnosticsEnabled() ? `<div id="subtitleDevDiagnostics" class="card dev-diagnostics" dir="rtl" data-dev-panel="subtitles"><div class="card-inner dev-diagnostics__inner"></div></div>` : ""}
        ${
          route.mediaType === "tv" && tvQuickChipDefs.length
            ? `<div id="tvMatchChipBar" class="tv-match-chip-bar" dir="${uiLang === "ar" ? "rtl" : "ltr"}" role="toolbar" aria-label="${escapeHtml(uiLang === "ar" ? "تصفية نوع تطابق ترجمة المسلسل" : "Filter TV subtitle match type")}">
          <div class="tv-match-chip-bar__head">
            <span class="tv-match-chip-bar__title">تصفية سريعة حسب نوع التطابق</span>
            <button type="button" class="tv-match-chip-bar__clear secondary btn-sm" id="tvMatchShowAllBtn" hidden>إظهار الكل</button>
          </div>
          <p class="tv-match-chip-bar__hint">${escapeHtml(tvChipBarHint)}</p>
          <div class="tv-match-chip-bar__scroll">
            ${tvQuickChipDefs
              .map(
                ({ kind, label }) => `
            <button type="button" class="tv-match-filter-chip" data-tv-match-filter="${kind}" aria-pressed="false">
              <span class="tv-match-filter-chip__label">${label}</span>
              <span class="tv-match-filter-chip__count" data-count-for="${kind}"></span>
            </button>`
              )
              .join("")}
          </div>
        </div>`
            : ""
        }
        <div id="subtitleStatus" style="margin-top:12px;"></div>
        <div id="subtitleBestPick" class="subtitle-best-pick-host" hidden></div>
        <div id="subtitleList" class="sub-list" style="margin-top:16px;"></div>
        <div id="subtitleAlternateSection" class="subtitle-alternate-section" hidden></div>
      </section>
    </section>
    <div class="mobile-filter-bar">
      <button type="button" id="mobileApplyFilters" class="btn-sm">${escapeHtml(t("apply"))}</button>
      <button type="button" id="mobileResetFilters" class="secondary btn-sm">${escapeHtml(t("reset"))}</button>
    </div>
  `;

  if (isSubtitleDevDiagnosticsEnabled()) {
    bindSubtitleDevDiagnosticsCopy(document.getElementById("subtitleDevDiagnostics"));
  }

  const status = document.getElementById("subtitleStatus");
  const bestPickHost = document.getElementById("subtitleBestPick");
  const list = document.getElementById("subtitleList");
  const alternateSection = document.getElementById("subtitleAlternateSection");
  const count = document.getElementById("subtitleCount");
  const insights = document.getElementById("subtitleInsights");
  list.dataset.context = JSON.stringify({
    mediaType: route.mediaType,
    season: route.season,
    episode: route.episode,
    language: route.language,
    fileName: effectiveFileName
  });
  const tvJumpForm = document.getElementById("tvJumpForm");
  const subFilterPanel = document.getElementById("subFiltersPanel");
  const subFilterToggle = document.getElementById("subFilterToggle");
  const applySubFilterPanelState = (expanded) => {
    if (!subFilterPanel || !subFilterToggle) return;
    subFilterPanel.classList.toggle("is-collapsed", !expanded);
    subFilterToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    subFilterToggle.textContent = expanded ? t("hideFilters") : t("showFilters");
  };
  if (subFilterPanel && subFilterToggle) {
    const shouldCollapseInitially = window.innerWidth <= 980;
    applySubFilterPanelState(!shouldCollapseInitially);
    subFilterToggle.addEventListener("click", () => {
      applySubFilterPanelState(subFilterToggle.getAttribute("aria-expanded") !== "true");
    });
  }
  if (tvJumpForm && media) {
    bindTvSeasonEpisodeSelects({
      form: tvJumpForm,
      media,
      seasonSelector: "season",
      episodeSelector: "episode",
      route
    });
    tvJumpForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const season = tvJumpForm.season.value.trim();
      const episode = tvJumpForm.episode.value.trim();
      const next = toSubtitlesUrl(media, {
        language: route.language,
        provider: route.provider,
        season,
        ...(episode ? { episode } : {}),
        fileName: effectiveFileName,
        year: route.year || media.year || "",
        tvKinds: readTvKindsFromAddressBar()
      });
      navigate(next);
    });
  }
  const fileMatchForm = document.getElementById("fileMatchForm");
  if (fileMatchForm && media) {
    fileMatchForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const fileName = fileMatchForm.fileName.value.trim();
      saveSubtitlePreferences({ fileName });
      trackEvent("filename_matching_used", {
        enabled: Boolean(fileName),
        fileNameLength: fileName.length
      });
      const next = toSubtitlesUrl(media, {
        language: route.language,
        provider: route.provider,
        season: route.season,
        episode: route.episode,
        fileName,
        year: route.year || media.year || "",
        tvKinds: readTvKindsFromAddressBar()
      });
      navigate(next);
    });
  }
  document.getElementById("clearFileMatchBtn")?.addEventListener("click", () => {
    if (!media) return;
    saveSubtitlePreferences({ fileName: "" });
    const next = toSubtitlesUrl(media, {
      language: route.language,
      provider: route.provider,
      season: route.season,
      episode: route.episode,
      year: route.year || media.year || "",
      tvKinds: readTvKindsFromAddressBar()
    });
    navigate(next);
  });
  status.innerHTML = `<div class="alert alert-info">${escapeHtml(t("loadingSubtitles"))}</div>`;
  list.innerHTML = `<div class="skeleton-grid">${Array.from({ length: 5 })
    .map(() => `<div class="skeleton-card"></div>`)
    .join("")}</div>`;
  try {
    const data = await fetchSubtitles({
      tmdbId: route.tmdbId,
      mediaType: route.mediaType,
      language: route.language,
      provider: route.provider,
      season: route.season,
      ...(route.episode ? { episode: route.episode } : {}),
      year: route.year,
      fileName: effectiveFileName
    });
    const tvQueryModeFromApi = data.tvQueryMode || null;
    const pipelineDiagnostics = data.diagnostics || null;
    const providerErrorsList = Array.isArray(data.providerErrors) ? data.providerErrors : [];
    const base = (data.subtitles || []).map((s) => ({ ...s, meta: parseReleaseMetadata(s) }));
    const alternateBase = (data.alternateSubtitles || []).map((s) => ({ ...s, meta: parseReleaseMetadata(s) }));
    if (media) recordRecentSubtitlesPage(media, route);
    trackEvent("subtitle_results_viewed", {
      mediaType: route.mediaType,
      language: route.language,
      provider: route.provider,
      season: route.season || "",
      episode: route.episode || "",
      primaryCount: base.length,
      alternateCount: alternateBase.length,
      providerErrors: providerErrorsList.length
    });
    const form = document.getElementById("subFilterForm");
    const prefs = getSubtitlePreferences();
    const routeLangNorm =
      route.language && route.language !== "all" ? normalizeSubtitleLangForFilter(route.language) : "";
    const langSet = uniqSortedStr([
      "ar",
      "en",
      routeLangNorm,
      ...base.map((s) => normalizeSubtitleLangForFilter(s.language) || String(s.language || "").toLowerCase()),
      ...alternateBase.map((s) => normalizeSubtitleLangForFilter(s.language) || String(s.language || "").toLowerCase())
    ]);
    const resolutionSet = uniqSortedStr([
      ...PRESET_SUBTITLE_RESOLUTIONS,
      ...base.map((s) => s.meta.resolution),
      ...alternateBase.map((s) => s.meta.resolution)
    ]);
    const sourceSet = uniqSortedStr([
      ...PRESET_SUBTITLE_SOURCES,
      ...base.map((s) => s.meta.source),
      ...alternateBase.map((s) => s.meta.source)
    ]);
    const codecSet = uniqSortedStr([
      ...PRESET_SUBTITLE_CODECS,
      ...base.map((s) => s.meta.codec),
      ...alternateBase.map((s) => s.meta.codec)
    ]);
    form.languageFilter.innerHTML = `<option value="all">الكل</option>${langSet
      .map((l) => `<option value="${escapeHtml(l)}">${escapeHtml(l.toUpperCase())}</option>`)
      .join("")}`;
    form.resolutionFilter.innerHTML = `<option value="all">الكل</option>${resolutionSet
      .map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`)
      .join("")}`;
    form.sourceFilter.innerHTML = `<option value="all">الكل</option>${sourceSet
      .map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
      .join("")}`;
    form.codecFilter.innerHTML = `<option value="all">الكل</option>${codecSet
      .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
      .join("")}`;
    form.languageFilter.value =
      route.language && route.language !== "all" ? routeLangNorm || String(route.language).toLowerCase() : "all";
    form.providerFilter.value = route.provider && route.provider !== "all" ? route.provider : "all";
    form.sort.value = prefs.sort || "best";
    form.hiFilter.value = prefs.hi || "all";

    const tvKindSelection = new Set(
      (route.mediaType === "tv" ? route.tvKinds || [] : []).filter((k) => tvQuickChipDefs.some((d) => d.kind === k))
    );
    const tvChipBar = document.getElementById("tvMatchChipBar");

    const updateTvChipCounts = () => {
      if (!tvChipBar) return;
      for (const { kind } of tvQuickChipDefs) {
        const el = tvChipBar.querySelector(`[data-count-for="${kind}"]`);
        if (!el) continue;
        const n = base.filter((s) => String(s.tvMatchKind || "") === kind).length;
        el.textContent = n ? `(${n})` : "";
        el.classList.toggle("is-zero", !n);
      }
    };

    const syncTvMatchChips = () => {
      if (!tvChipBar) return;
      for (const btn of tvChipBar.querySelectorAll("[data-tv-match-filter]")) {
        const k = btn.getAttribute("data-tv-match-filter");
        const on = tvKindSelection.has(k);
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
      }
      const clearBtn = document.getElementById("tvMatchShowAllBtn");
      if (clearBtn) clearBtn.hidden = tvKindSelection.size === 0;
    };

    let visibleSubtitleCount = 40;
    let visibleAlternateSubtitleCount = 40;
    const apply = (resetVisible = false) => {
      if (resetVisible) {
        visibleSubtitleCount = 40;
        visibleAlternateSubtitleCount = 40;
      }
      const filtered = applySubtitleFilters(base, {
        text: form.text.value || "",
        language: form.languageFilter.value,
        provider: form.providerFilter.value,
        hi: form.hiFilter.value,
        resolution: form.resolutionFilter.value,
        source: form.sourceFilter.value,
        codec: form.codecFilter.value,
        sort: form.sort.value,
        mediaType: route.mediaType,
        tvKindFilter: tvKindSelection.size ? [...tvKindSelection] : undefined
      });
      const filteredAlt =
        route.mediaType === "tv" && String(route.episode || "").trim() && alternateBase.length
          ? applySubtitleFilters(alternateBase, {
              text: form.text.value || "",
              language: form.languageFilter.value,
              provider: form.providerFilter.value,
              hi: form.hiFilter.value,
              resolution: form.resolutionFilter.value,
              source: form.sourceFilter.value,
              codec: form.codecFilter.value,
              sort: form.sort.value,
              mediaType: route.mediaType,
              tvKindFilter: tvKindSelection.size ? [...tvKindSelection] : undefined
            })
          : [];
      saveSubtitlePreferences({
        language: form.languageFilter.value,
        provider: form.providerFilter.value,
        sort: form.sort.value,
        hi: form.hiFilter.value,
        fileName: effectiveFileName
      });
      trackEvent("subtitle_filters_applied", {
        language: form.languageFilter.value,
        provider: form.providerFilter.value,
        sort: form.sort.value,
        hi: form.hiFilter.value,
        hasFilename: Boolean(effectiveFileName),
        tvKinds: route.mediaType === "tv" ? [...tvKindSelection] : undefined
      });
      const pick = selectBestSubtitleRecommendation(filtered, {
        mediaType: route.mediaType,
        episode: route.episode
      });
      renderSubtitleBestPick(bestPickHost, pick);

      const hasSeasonAlternates =
        !filtered.length &&
        route.mediaType === "tv" &&
        String(route.episode || "").trim() &&
        filteredAlt.length > 0;

      let forList = filtered;
      let visible = [];
      if (!filtered.length) {
        renderSubtitleEmptyState(list, {
          media,
          route,
          effectiveFileName,
          baseLength: base.length,
          hasSeasonAlternates,
          tvQueryModeFromApi,
          filtersEmptyOnly: base.length > 0,
          mediaType: route.mediaType
        });
        list.querySelector("#subtitleEmptyResetFiltersBtn")?.addEventListener("click", () => {
          document.getElementById("resetSubFilters")?.click();
        });
        trackEvent("subtitle_empty_state_shown", {
          hasSeasonAlternates,
          filtersEmptyOnly: base.length > 0 && !hasSeasonAlternates
        });
      } else {
        if (pick) {
          trackEvent("subtitle_best_pick_shown", {
            provider: pick.sub.provider || "",
            score: Number(pick.sub.score || 0),
            confidence: pick.sub.confidence || "",
            tvMatchKind: pick.sub.tvMatchKind || "",
            filteredCount: filtered.length,
            deduped: filtered.length > 1
          });
        }
        const excludeKey = pick && filtered.length > 1 ? subtitleStableKey(pick.sub) : null;
        forList = excludeKey ? filtered.filter((s) => subtitleStableKey(s) !== excludeKey) : filtered;
        visible = forList.slice(0, visibleSubtitleCount);
        renderSubtitleCards(list, visible);
      }

      count.textContent = filtered.length ? `${t("resultsCount")}: ${filtered.length}` : t("noResults");

      const altVisible = filteredAlt.slice(0, visibleAlternateSubtitleCount);
      if (route.mediaType === "tv" && String(route.episode || "").trim() && alternateBase.length) {
        if (filteredAlt.length) {
          alternateSection.hidden = false;
          alternateSection.innerHTML = `
            <div class="card subtitle-alternate-card">
              <div class="card-inner">
                <h3 class="subtitle-alternate-title">بدائل من نفس الموسم</h3>
                ${buildTvAlternateSectionIntroHtml(filteredAlt, filtered.length > 0)}
                <div id="subtitleAlternateList" class="sub-list sub-list--alternate"></div>
              </div>
            </div>`;
          const altListEl = document.getElementById("subtitleAlternateList");
          if (altListEl) renderSubtitleCards(altListEl, altVisible);
          if (filteredAlt.length > altVisible.length) {
            alternateSection
              .querySelector(".subtitle-alternate-card .card-inner")
              ?.insertAdjacentHTML(
                "beforeend",
                `<div class="row-actions"><button type="button" class="secondary" id="loadMoreAlternateSubtitlesBtn">عرض المزيد من البدائل (${filteredAlt.length - altVisible.length})</button></div>`
              );
            document.getElementById("loadMoreAlternateSubtitlesBtn")?.addEventListener("click", () => {
              visibleAlternateSubtitleCount += 40;
              apply(false);
            });
          }
        } else {
          alternateSection.hidden = true;
          alternateSection.innerHTML = "";
        }
      } else {
        alternateSection.hidden = true;
        alternateSection.innerHTML = "";
      }
      const tvKindLabels =
        route.mediaType === "tv" && tvKindSelection.size
          ? [...tvKindSelection]
              .map((k) => getTvQuickFilterKinds().find((x) => x.kind === k)?.label || k)
              .join(uiLang === "ar" ? "، " : ", ")
          : "";
      const activeFilters = [
        form.languageFilter.value !== "all" ? `${t("subtitleLanguage")}: ${form.languageFilter.value.toUpperCase()}` : "",
        form.providerFilter.value !== "all" ? `${t("subtitleProvider")}: ${providerLabel(form.providerFilter.value)}` : "",
        form.resolutionFilter.value !== "all" ? `${t("imageQuality")}: ${form.resolutionFilter.value}` : "",
        form.sourceFilter.value !== "all" ? `${t("source")}: ${form.sourceFilter.value}` : "",
        form.codecFilter.value !== "all" ? `${t("codec")}: ${form.codecFilter.value}` : "",
        form.hiFilter.value !== "all" ? `HI: ${form.hiFilter.value}` : "",
        tvKindLabels ? `تطابق المسلسل: ${tvKindLabels}` : ""
      ].filter(Boolean);
      document.getElementById("activeFilterChips").innerHTML = activeFilters
        .map((f) => `<span class="pill">${escapeHtml(f)}</span>`)
        .join("");
      const devPanelInner = document.querySelector("#subtitleDevDiagnostics .dev-diagnostics__inner");
      if (devPanelInner) {
        const formControls = {
          text: (form.text.value || "").trim(),
          language: form.languageFilter.value,
          provider: form.providerFilter.value,
          hi: form.hiFilter.value,
          resolution: form.resolutionFilter.value,
          source: form.sourceFilter.value,
          codec: form.codecFilter.value,
          sort: form.sort.value,
          tvKinds:
            route.mediaType === "tv" && tvKindSelection.size ? [...canonicalTvKindsFromSet(tvKindSelection)] : undefined
        };
        subtitleDevDiagnosticsCopySnapshot = {
          pipelineDiagnostics,
          providerErrors: providerErrorsList,
          route,
          tvQueryModeFromApi,
          baseLength: base.length,
          alternateBaseLength: alternateBase.length,
          filteredAlternateLength: filteredAlt.length,
          filtered,
          visibleLength: visible.length,
          bestPick: pick || null,
          formControls
        };
        devPanelInner.innerHTML = buildSubtitleDevDiagnosticsHtml({
          pipelineDiagnostics,
          providerErrors: providerErrorsList,
          route,
          tvQueryModeFromApi,
          baseLength: base.length,
          filtered,
          visibleLength: visible.length,
          formControls,
          alternateBaseLength: alternateBase.length,
          filteredAlternateLength: filteredAlt.length
        });
      }
      insights.querySelector(".card-inner").innerHTML = `
        <div class="sub-meta">
          <span class="pill">إجمالي النتائج: ${filtered.length}</span>
          <span class="pill">${escapeHtml(t("bestMatches"))}: ${Math.min(filtered.length, 6)}</span>
          ${
            route.mediaType === "tv" && tvQueryModeFromApi
              ? `<span class="pill">${tvQueryModeFromApi === "episode" ? escapeHtml(t("tvModeEpisodeStrict")) : escapeHtml(t("tvModeSeasonBroad"))}</span>`
              : ""
          }
          ${effectiveFileName ? `<span class="pill">${escapeHtml(uiLang === "ar" ? "مطابقة الملف: مفعّلة" : "Filename matching: enabled")}</span>` : ""}
          ${route.mediaType === "tv" && tvKindSelection.size ? `<span class="pill">${escapeHtml(uiLang === "ar" ? "تصفية نوع الترجمة" : "TV match filter")}: ${tvKindSelection.size}</span>` : ""}
          ${
            route.mediaType === "tv" && String(route.episode || "").trim() && filteredAlt.length
              ? `<span class="pill">بدائل الموسم (بعد الفلاتر): ${filteredAlt.length}</span>`
              : ""
          }
          ${activeFilters.length ? `<span class="pill">${escapeHtml(uiLang === "ar" ? "فلاتر نشطة" : "Active filters")}: ${activeFilters.length}</span>` : ""}
          <span class="pill">نمط الترتيب: ${escapeHtml(form.sort.value)}</span>
        </div>
      `;
      status.querySelectorAll(".subtitle-empty-status").forEach((el) => el.remove());
      if (!filtered.length && hasSeasonAlternates) {
        status.insertAdjacentHTML(
          "beforeend",
          `<div class="alert alert-info subtitle-empty-status">${escapeHtml(t("subtitleEmptyShortHintAlternates"))}</div>`
        );
      }
      if (forList.length > visible.length) {
        list.insertAdjacentHTML(
          "beforeend",
          `<div class="row-actions"><button type="button" class="secondary" id="loadMoreSubtitlesBtn">عرض المزيد (${forList.length - visible.length})</button></div>`
        );
        document.getElementById("loadMoreSubtitlesBtn")?.addEventListener("click", () => {
          visibleSubtitleCount += 40;
          apply(false);
        });
      }
    };

    status.innerHTML = "";
    if (Array.isArray(data.providerErrors) && data.providerErrors.length) {
      status.innerHTML = `<div class="alert alert-info">${escapeHtml(t("limitedResultsNotice"))}</div>`;
      if (isSubtitleDevDiagnosticsEnabled()) {
        status.insertAdjacentHTML(
          "beforeend",
          `<div class="hint" style="margin-top:6px;">${escapeHtml(
            data.providerErrors.map((e) => `${e.provider}: ${e.message}`).join(" | ")
          )}</div>`
        );
      }
    }

    document.getElementById("applySubFilters").addEventListener("click", () => apply(true));
    document.getElementById("resetSubFilters").addEventListener("click", () => {
      form.text.value = "";
      form.languageFilter.value = "all";
      form.providerFilter.value = "all";
      form.resolutionFilter.value = "all";
      form.sourceFilter.value = "all";
      form.codecFilter.value = "all";
      form.sort.value = "best";
      form.hiFilter.value = "all";
      tvKindSelection.clear();
      syncTvMatchChips();
      if (media && media.mediaType === "tv") syncSubtitlesUrlTvKinds(media, tvKindSelection, { replace: true });
      saveSubtitlePreferences({ language: "all", provider: "all", sort: "best", hi: "all" });
      apply(true);
    });
    document.getElementById("mobileApplyFilters")?.addEventListener("click", () => apply(true));
    document.getElementById("mobileResetFilters")?.addEventListener("click", () => {
      document.getElementById("resetSubFilters")?.click();
    });
    form.addEventListener("change", () => apply(true));
    form.addEventListener("input", () => {
      if ((form.text.value || "").length === 0 || (form.text.value || "").length > 2) apply(true);
    });
    for (const chip of document.querySelectorAll("[data-preset]")) {
      chip.addEventListener("click", () => {
        const preset = chip.getAttribute("data-preset");
        if (preset === "best") form.sort.value = "best";
        if (preset === "1080p") form.resolutionFilter.value = "1080P";
        if (preset === "webdl") form.sourceFilter.value = "WEB-DL";
        if (preset === "bluray") form.sourceFilter.value = "BLURAY";
        if (preset === "nonhi") form.hiFilter.value = "exclude";
        if (preset === "ar") form.languageFilter.value = "ar";
        if (preset === "en") form.languageFilter.value = "en";
        if (preset === "opensubtitles") form.providerFilter.value = "opensubtitles";
        if (preset === "subdl") form.providerFilter.value = "subdl";
        if (preset === "clear") {
          document.getElementById("resetSubFilters")?.click();
          return;
        }
        apply(true);
      });
    }

    if (tvChipBar && media && media.mediaType === "tv") {
      tvChipBar.addEventListener("click", (e) => {
        const chip = e.target.closest("[data-tv-match-filter]");
        if (!chip) return;
        const k = chip.getAttribute("data-tv-match-filter");
        if (!k) return;
        if (tvKindSelection.has(k)) tvKindSelection.delete(k);
        else tvKindSelection.add(k);
        syncTvMatchChips();
        syncSubtitlesUrlTvKinds(media, tvKindSelection, { replace: false });
        apply(true);
      });
      document.getElementById("tvMatchShowAllBtn")?.addEventListener("click", () => {
        tvKindSelection.clear();
        syncTvMatchChips();
        syncSubtitlesUrlTvKinds(media, tvKindSelection, { replace: true });
        apply(true);
      });
    }

    updateTvChipCounts();
    syncTvMatchChips();
    apply(true);
  } catch (err) {
    subtitleDevDiagnosticsCopySnapshot = null;
    count.textContent = "";
    status.innerHTML = `<div class="alert alert-error">${escapeHtml(t("subtitlesLoadFailed"))}: ${escapeHtml(err.message)}</div>`;
    list.innerHTML = "";
    renderSubtitleBestPick(bestPickHost, null);
  }
}

function render404() {
  appEl.innerHTML = `
    <section class="hero hero-card">
      <span class="badge">404</span>
      <h1 class="hero-title">${escapeHtml(t("pageNotFound"))}</h1>
      <p class="hero-subtitle">${escapeHtml(t("pageNotFoundDesc"))}</p>
      <div class="row-actions">
        <a class="btn" href="/" data-link>${escapeHtml(t("navHome"))}</a>
        <a class="btn secondary" href="/search" data-link>${escapeHtml(t("navSearch"))}</a>
      </div>
    </section>
  `;
}

function bindLinkDelegation() {
  document.body.addEventListener("click", (e) => {
    const downloadLink = e.target.closest("a[data-download='1']");
    if (downloadLink) {
      trackEvent("subtitle_download_clicked", {
        provider: downloadLink.getAttribute("data-provider") || "unknown",
        fromBestPick: downloadLink.hasAttribute("data-best-pick")
      });
      return;
    }
    const a = e.target.closest("a[data-link]");
    if (!a) return;
    if (a.hasAttribute("data-search-card")) {
      trackEvent("search_card_clicked", {
        tmdbId: a.getAttribute("data-tmdb-id") || "",
        mediaType: a.getAttribute("data-media-type") || ""
      });
    }
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
  if (route.page !== "search" && typeof state.searchAutocompleteCleanup === "function") {
    state.searchAutocompleteCleanup();
    state.searchAutocompleteCleanup = null;
  }
  if (route.page !== "home" && typeof state.homeAutocompleteCleanup === "function") {
    state.homeAutocompleteCleanup();
    state.homeAutocompleteCleanup = null;
  }
  setActiveNav(window.location.pathname);
  bindGlobalSearch(route);
  updateDocumentMeta(route);
  if (route.page === "home") return renderHome();
  if (route.page === "search") return renderSearch(route);
  if (route.page === "media") return renderMedia(route);
  if (route.page === "subtitles") return renderSubtitles(route);
  return render404();
}

window.addEventListener("popstate", renderRoute);
bindLinkDelegation();
initAppearance();
renderRoute();

