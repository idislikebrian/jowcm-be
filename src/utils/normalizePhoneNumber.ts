const E164_REGEX = /^\+[1-9]\d{1,14}$/;
const BLOCKED_VALUES = new Set(['', 'anonymous', 'private']);

/**
 * Convert a Twilio From value into a canonical E.164 phone number or null.
 */
export function normalizePhoneNumber(from: string | undefined | null): string | null {
  if (!from) {
    return null;
  }

  const normalized = from.trim().replace(/\s+/g, '');

  if (BLOCKED_VALUES.has(normalized.toLowerCase())) {
    return null;
  }

  if (!normalized.startsWith('+')) {
    return null;
  }

  if (!E164_REGEX.test(normalized)) {
    return null;
  }

  return normalized;
}
