import test from "node:test";
import assert from "node:assert/strict";
import { classifyOpenSubtitlesResolveFailure } from "../netlify/functions/_shared.js";

test("classifies proven OpenSubtitles daily quota message as quota_exhausted", () => {
  assert.equal(
    classifyOpenSubtitlesResolveFailure(
      "You have downloaded your allowed 100 subtitles for 24h. Try again tomorrow."
    ),
    "quota_exhausted"
  );
});

test("classifies HTTP 429 / rate limit copy as rate_limited", () => {
  assert.equal(classifyOpenSubtitlesResolveFailure("OpenSubtitles HTTP 429"), "rate_limited");
  assert.equal(classifyOpenSubtitlesResolveFailure("Rate limit exceeded. Slow down."), "rate_limited");
  assert.equal(classifyOpenSubtitlesResolveFailure("Too many requests"), "rate_limited");
});

test("classifies generic removal / 404 as unavailable", () => {
  assert.equal(classifyOpenSubtitlesResolveFailure("OpenSubtitles HTTP 404"), "unavailable");
  assert.equal(classifyOpenSubtitlesResolveFailure("Subtitle file not found"), "unavailable");
});
