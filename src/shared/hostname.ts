import { MAX_HOSTNAME_LENGTH } from "@/shared/constants";

/**
 * A hostname as produced by `URL.hostname`: DNS labels, an IPv4 address, or a
 * bracketed IPv6 literal. The pattern deliberately excludes slashes, query
 * separators and whitespace so a path, query string or free text can never be
 * mistaken for — or persisted as — a hostname.
 */
const HOSTNAME_PATTERN = /^[a-z0-9._:[\]-]+$/;

/** Lowercases and validates a hostname, returning undefined when it is not one. */
export function normalizeHostname(hostname: unknown): string | undefined {
  if (typeof hostname !== "string") {
    return undefined;
  }

  const normalized = hostname.toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_HOSTNAME_LENGTH ||
    !HOSTNAME_PATTERN.test(normalized)
  ) {
    return undefined;
  }

  return normalized;
}

export function isHostname(value: unknown): value is string {
  return normalizeHostname(value) !== undefined;
}
