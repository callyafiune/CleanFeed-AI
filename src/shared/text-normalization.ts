/**
 * Produces a stable representation suitable for local classification and
 * hashing without changing meaningful text such as accents, URLs or emojis.
 */
export function normalizeText(text: string): string {
  return text
    .replace(/[\u200B-\u200D\u2060\uFEFF]/gu, "")
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/gu, " ").trim())
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}
