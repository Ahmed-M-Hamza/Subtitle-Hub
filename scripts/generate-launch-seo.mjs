import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

const baseRaw = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.SITE_URL || "";
const base = String(baseRaw).replace(/\/$/, "");

if (!base) {
  console.warn(
    "generate-launch-seo: URL not set; using http://127.0.0.1:8888 (Netlify sets URL on deploy)."
  );
}

const SITE = base || "http://127.0.0.1:8888";

function escapeXml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

const entries = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/search", changefreq: "weekly", priority: "0.9" }
];

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    (e) => `  <url>
    <loc>${escapeXml(`${SITE}${e.path}`)}</loc>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>
`;

const robots = `User-agent: *
Allow: /

Sitemap: ${SITE}/sitemap.xml
`;

writeFileSync(join(publicDir, "sitemap.xml"), sitemap, "utf8");
writeFileSync(join(publicDir, "robots.txt"), robots, "utf8");
console.log(`generate-launch-seo: wrote robots.txt and sitemap.xml (${SITE})`);
