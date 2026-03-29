/**
 * Unit tests: provider health tier derivation (stable product contract).
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildProviderHealthSummary } from "../netlify/functions/_shared.js";

const ALLOWED_TIERS = new Set([
  "full",
  "focused",
  "partial_outage",
  "partial_outage_empty",
  "partial_catalog",
  "sparse",
  "no_matches_upstream",
  "unavailable"
]);

function ph(args) {
  return buildProviderHealthSummary(args);
}

test("tier full: both providers succeeded and contributed rows", () => {
  const row = (p) => ({ provider: p, releaseName: "x" });
  const h = ph({
    providerFilter: "all",
    requested: ["subdl", "opensubtitles"],
    providerErrors: [],
    finalSubtitles: [row("subdl"), row("opensubtitles"), row("subdl"), row("opensubtitles"), row("subdl")],
    alternateSubtitles: [],
    debugCounts: {}
  });
  assert.equal(h.tier, "full");
  assert.ok(ALLOWED_TIERS.has(h.tier));
  assert.equal(h.failedProviders.length, 0);
});

test("tier sparse: both succeeded, both contributed, but very few rows", () => {
  const row = (p) => ({ provider: p, releaseName: "x" });
  const h = ph({
    providerFilter: "all",
    requested: ["subdl", "opensubtitles"],
    providerErrors: [],
    finalSubtitles: [row("subdl"), row("opensubtitles")],
    alternateSubtitles: [],
    debugCounts: {}
  });
  assert.equal(h.tier, "sparse");
});

test("tier partial_catalog: both APIs ok, only one provider has rows", () => {
  const h = ph({
    providerFilter: "all",
    requested: ["subdl", "opensubtitles"],
    providerErrors: [],
    finalSubtitles: [{ provider: "subdl", releaseName: "a" }],
    alternateSubtitles: [],
    debugCounts: {}
  });
  assert.equal(h.tier, "partial_catalog");
});

test("tier no_matches_upstream: both ok, zero subtitles", () => {
  const h = ph({
    providerFilter: "all",
    requested: ["subdl", "opensubtitles"],
    providerErrors: [],
    finalSubtitles: [],
    alternateSubtitles: [],
    debugCounts: {}
  });
  assert.equal(h.tier, "no_matches_upstream");
});

test("tier partial_outage: one provider failed, still have rows", () => {
  const h = ph({
    providerFilter: "all",
    requested: ["subdl", "opensubtitles"],
    providerErrors: [{ provider: "subdl", message: "network error" }],
    finalSubtitles: [{ provider: "opensubtitles", releaseName: "a" }],
    alternateSubtitles: [],
    debugCounts: {}
  });
  assert.equal(h.tier, "partial_outage");
  assert.equal(h.failedProviders.length, 1);
});

test("tier partial_outage_empty: one provider failed, zero rows", () => {
  const h = ph({
    providerFilter: "all",
    requested: ["subdl", "opensubtitles"],
    providerErrors: [{ provider: "opensubtitles", message: "timeout" }],
    finalSubtitles: [],
    alternateSubtitles: [],
    debugCounts: {}
  });
  assert.equal(h.tier, "partial_outage_empty");
});

test("anyRateLimited when message looks like rate limit", () => {
  const h = ph({
    providerFilter: "all",
    requested: ["subdl", "opensubtitles"],
    providerErrors: [{ provider: "opensubtitles", message: "HTTP 429 Too Many Requests" }],
    finalSubtitles: [{ provider: "subdl", releaseName: "a" }],
    alternateSubtitles: [],
    debugCounts: {}
  });
  assert.equal(h.tier, "partial_outage");
  assert.equal(h.anyRateLimited, true);
});

test("fallbackAssisted forwarded from debugCounts", () => {
  const h = ph({
    providerFilter: "all",
    requested: ["subdl", "opensubtitles"],
    providerErrors: [],
    finalSubtitles: [{ provider: "subdl", releaseName: "a" }],
    alternateSubtitles: [],
    debugCounts: { subdlHtmlFallbackUsed: true }
  });
  assert.equal(h.fallbackAssisted, true);
});

test("tier focused: single provider filter and it succeeded", () => {
  const h = ph({
    providerFilter: "subdl",
    requested: ["subdl"],
    providerErrors: [],
    finalSubtitles: [{ provider: "subdl", releaseName: "a" }],
    alternateSubtitles: [],
    debugCounts: {}
  });
  assert.equal(h.tier, "focused");
});

test("alternateRouteOffered passthrough", () => {
  const h = ph({
    providerFilter: "all",
    requested: ["subdl", "opensubtitles"],
    providerErrors: [],
    finalSubtitles: [{ provider: "subdl", releaseName: "e", tvMatchKind: "exactEpisode" }],
    alternateSubtitles: [{ provider: "subdl", releaseName: "s", tvMatchKind: "seasonScoped" }],
    debugCounts: {}
  });
  assert.equal(h.alternateRouteOffered, true);
});
