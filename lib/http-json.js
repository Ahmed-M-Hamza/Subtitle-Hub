export async function readJsonResponse(response) {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    const err = new Error(`Invalid JSON (${response.status}): ${text.slice(0, 200)}`);
    err.cause = e;
    throw err;
  }
}
