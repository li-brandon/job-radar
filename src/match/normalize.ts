// Text normalization shared by matching and dedupe (LIB-542).

/** Title tokens expanded before comparing, so "Sr." and "Senior" match. */
const TITLE_ABBREVIATIONS: Readonly<Record<string, string>> = {
  sr: "senior",
  jr: "junior",
};

/** Spellings of the United States after `normalizeText`, longest first. */
const US_NAMES = "united states of america|united states|usa|us|u s a|u s";
/** Whole-token matches only: "us" never matches inside "business". */
const US_COUNTRY = new RegExp(`(?<=^| )(?:${US_NAMES})(?= |$)`, "g");
const REMOTE_WORD = /(?<=^| )remote(?= |$)/g;
const STATE_CODE = /^[a-z]{2}$/;

/**
 * Lowercases, strips accents, turns "&" into "and", and collapses every run of
 * punctuation and whitespace to a single space.
 */
export function normalizeText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function normalizeCompany(company: string): string {
  return normalizeText(company);
}

/**
 * `normalizeText` plus abbreviation expansion, so "Sr. Widget Engineer"
 * becomes "senior widget engineer".
 */
export function normalizeTitle(title: string): string {
  return normalizeText(title)
    .split(" ")
    .map((token) => TITLE_ABBREVIATIONS[token] ?? token)
    .join(" ");
}

/**
 * True when `phrase` appears in `text` as whole tokens. Both must already be
 * normalized. "manager" matches "engineering manager" but "intern" does not
 * match "internal".
 */
export function containsPhrase(text: string, phrase: string): boolean {
  if (!phrase) return false;
  return ` ${text} `.includes(` ${phrase} `);
}

function isUsCountry(normalized: string): boolean {
  return normalized.replace(US_COUNTRY, "").trim() === "";
}

/**
 * Location part of the dedupe key. Deliberately conservative:
 * - Remote: any text with the word "remote" (or empty text on a remote job)
 *   drops "remote" and US country names, so "Remote", "Remote - US",
 *   "US Remote", and "Remote (United States)" all become "remote". Anything
 *   else stays: "Remote - Canada" becomes "remote canada".
 * - Otherwise, trailing comma-separated US country names are dropped, then one
 *   trailing comma-separated two-letter code ("Example City, EX" becomes
 *   "example city"). Codes without a comma, and other places, are kept.
 */
export function normalizeLocation(location: string, remote = false): string {
  const text = normalizeText(location);
  if (containsPhrase(text, "remote") || (text === "" && remote)) {
    const rest = text
      .replace(REMOTE_WORD, " ")
      .replace(US_COUNTRY, " ")
      .replace(/ +/g, " ")
      .trim();
    return rest ? `remote ${rest}` : "remote";
  }

  const segments = location.split(",").map(normalizeText).filter(Boolean);
  while (segments.length > 1 && isUsCountry(segments.at(-1) ?? "")) {
    segments.pop();
  }
  if (segments.length > 1 && STATE_CODE.test(segments.at(-1) ?? "")) {
    segments.pop();
  }
  return segments.join(" ");
}
