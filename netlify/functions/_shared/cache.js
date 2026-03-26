const CACHE = new Map();

export function cacheKey(parts = []) {
  return parts
    .map((p) => {
      if (p === undefined || p === null) return "";
      if (typeof p === "object") return JSON.stringify(p);
      return String(p);
    })
    .join("|");
}

export async function getOrSetCache(namespace, key, ttlMs, resolver) {
  const mapKey = `${namespace}:${key}`;
  const now = Date.now();
  const cached = CACHE.get(mapKey);
  if (cached && cached.exp > now) return cached.value;
  const value = await resolver();
  CACHE.set(mapKey, { value, exp: now + Math.max(1000, Number(ttlMs || 0)) });
  return value;
}

