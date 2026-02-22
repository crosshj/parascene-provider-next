/**
 * Shared date/time formatting utilities for the UI.
 *
 * Notes:
 * - Inputs are typically ISO strings from the API (e.g. "2026-01-21T12:34:56.789Z").
 * - Functions are defensive: if parsing fails, they return an empty string or a fallback.
 */

export function parseDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return null;

    // Try native parsing first (handles ISO, RFC 2822, etc.)
    const d1 = new Date(s);
    if (!Number.isNaN(d1.getTime())) return d1;

    // Common DB format without timezone: "YYYY-MM-DD HH:mm:ss"
    // Treat as UTC for consistency.
    const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?$/);
    if (m) {
      const d2 = new Date(`${m[1]}T${m[2]}${m[3] || ''}Z`);
      if (!Number.isNaN(d2.getTime())) return d2;
    }
  }

  return null;
}

function getRelativeUnit(secondsAbs) {
  const MIN = 60;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const MONTH = 30 * DAY;
  const YEAR = 365 * DAY;

  if (secondsAbs >= YEAR) return ['year', YEAR];
  if (secondsAbs >= MONTH) return ['month', MONTH];
  if (secondsAbs >= DAY) return ['day', DAY];
  if (secondsAbs >= HOUR) return ['hour', HOUR];
  if (secondsAbs >= MIN) return ['minute', MIN];
  return ['second', 1];
}

/**
 * Formats relative time like "3 minutes ago" / "in 2 days".
 */
export function formatRelativeTime(value, options = {}) {
  const date = parseDate(value);
  if (!date) return '';

  const {
    now = new Date(),
    // Intl.RelativeTimeFormat: 'long' | 'short' | 'narrow'
    style = 'short',
    // Intl.RelativeTimeFormat: 'always' | 'auto'
    numeric = 'auto',
    // Allows forcing language if needed later
    locale,
  } = options;

  const deltaSeconds = (date.getTime() - now.getTime()) / 1000;
  const secondsAbs = Math.abs(deltaSeconds);
  const [unit, unitSeconds] = getRelativeUnit(secondsAbs);

  // Value must be negative for the past, positive for the future.
  const valueInUnit = Math.round(deltaSeconds / unitSeconds);
  const clamped = valueInUnit === 0 ? (deltaSeconds < 0 ? -1 : 1) : valueInUnit;

  if (typeof Intl !== 'undefined' && typeof Intl.RelativeTimeFormat === 'function') {
    const rtf = new Intl.RelativeTimeFormat(locale, { style, numeric });
    return rtf.format(clamped, unit);
  }

  // Fallback: English-only.
  const abs = Math.abs(clamped);
  const plural = abs === 1 ? '' : 's';
  const base = `${abs} ${unit}${plural}`;
  return clamped < 0 ? `${base} ago` : `in ${base}`;
}

/**
 * Formats an absolute date+time like "Jan 21, 2026, 3:04 PM".
 */
export function formatDateTime(value, options = {}) {
  const date = parseDate(value);
  if (!date) return '';

  const {
    locale,
    dateStyle = 'medium',
    timeStyle = 'short',
  } = options;

  try {
    if (typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function') {
      return new Intl.DateTimeFormat(locale, { dateStyle, timeStyle }).format(date);
    }
  } catch {
    // ignore and fall back
  }

  return date.toLocaleString();
}

/**
 * Formats a date-only value like "January 21, 2026".
 */
export function formatDate(value, options = {}) {
  const date = parseDate(value);
  if (!date) return '';

  const {
    locale,
    dateStyle = 'long',
  } = options;

  try {
    if (typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function') {
      return new Intl.DateTimeFormat(locale, { dateStyle }).format(date);
    }
  } catch {
    // ignore and fall back
  }

  return date.toLocaleDateString();
}

