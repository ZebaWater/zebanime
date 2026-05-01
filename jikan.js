// jikan.js — Jikan API (MAL) wrapper, no key required

const BASE = "https://api.jikan.moe/v4";

// Jikan rate-limits to 3 req/sec — this helper adds a small delay if needed
let lastFetch = 0;
async function rateLimitedFetch(url) {
  const now = Date.now();
  const gap = now - lastFetch;
  if (gap < 400) await sleep(400 - gap);
  lastFetch = Date.now();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Jikan ${res.status}: ${url}`);
  return res.json();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Fetch anime details by MAL ID.
 * Returns the raw Jikan anime object.
 */
export async function fetchAnimeById(malId) {
  const data = await rateLimitedFetch(`${BASE}/anime/${malId}`);
  return data.data;
}

/**
 * Fetch top voice actor for an anime (first character's first VA).
 * Returns a name string or null.
 */
export async function fetchMainVA(malId) {
  try {
    const data = await rateLimitedFetch(`${BASE}/anime/${malId}/characters`);
    const chars = data.data;
    if (!chars?.length) return null;

    // Find first main role character with a JP VA
    const mainChar = chars.find(c =>
      c.role === "Main" && c.voice_actors?.some(va => va.language === "Japanese")
    ) || chars[0];

    const jpVA = mainChar?.voice_actors?.find(va => va.language === "Japanese");
    return jpVA?.person?.name || null;
  } catch {
    return null;
  }
}

/**
 * Full enriched fetch: anime data + main VA.
 * Returns combined object ready for clue extraction.
 */
export async function fetchEnrichedAnime(malId) {
  const anime = await fetchAnimeById(malId);
  const va    = await fetchMainVA(malId);
  return { ...anime, _mainVA: va || "Unknown" };
}

/**
 * Normalize a title for loose comparison during guessing.
 * Strips articles, punctuation, extra spaces, lowercases.
 */
export function normalizeTitle(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|a|an)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Check if a guess matches any of the anime's known titles.
 * Returns true on match.
 */
export function checkGuess(guess, animeData) {
  const titles = [
    animeData.title,
    animeData.title_english,
    animeData.title_japanese,
    ...(animeData.titles?.map(t => t.title) || [])
  ].filter(Boolean);

  const normGuess = normalizeTitle(guess);
  return titles.some(t => normalizeTitle(t) === normGuess);
}