export function normalizeLanguageCode(code = "") {
  const lower = String(code).toLowerCase().trim();
  const aliases = {
    arabic: "ar",
    english: "en",
    french: "fr",
    german: "de",
    spanish: "es",
    italian: "it",
    turkish: "tr"
  };
  return aliases[lower] || lower || "ar";
}
