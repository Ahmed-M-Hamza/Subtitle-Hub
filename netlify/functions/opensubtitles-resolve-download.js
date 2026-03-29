import { json, requireSubtitlesConfig, resolveOpenSubtitlesDownloadClick } from "./_shared.js";

export async function handler(event) {
  try {
    const missing = requireSubtitlesConfig();
    if (missing.length) {
      return json(503, {
        ok: false,
        error: "Missing environment variables",
        missing,
        opensubtitlesResolveOnClickUsed: true,
        opensubtitlesResolveFailureReason: "server_misconfigured"
      });
    }

    let fileIdRaw = "";
    if (event.httpMethod === "POST") {
      try {
        const body = event.body ? JSON.parse(event.body) : {};
        fileIdRaw = body.fileId ?? body.opensubtitlesFileId ?? "";
      } catch {
        return json(400, {
          ok: false,
          error: "Invalid JSON body",
          opensubtitlesResolveOnClickUsed: true,
          opensubtitlesResolveFailureReason: "invalid_json_body"
        });
      }
    } else if (event.httpMethod === "GET") {
      const q = new URLSearchParams(event.queryStringParameters || {});
      fileIdRaw = q.get("fileId") || q.get("opensubtitlesFileId") || "";
    } else {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    const result = await resolveOpenSubtitlesDownloadClick(fileIdRaw);
    if (result.ok) {
      return json(200, result);
    }
    return json(422, result);
  } catch (err) {
    return json(500, {
      ok: false,
      error: err?.message || "Internal error",
      opensubtitlesResolveOnClickUsed: true,
      opensubtitlesResolveFailureReason: String(err?.message || "internal_error").slice(0, 400)
    });
  }
}
