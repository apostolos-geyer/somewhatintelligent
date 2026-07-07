/** Parse a `datetime-local` value (local time, no tz) into epoch-ms; "" → null. */
export function parseDateTime(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const ms = new Date(t).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Parse a start/end `datetime-local` pair; both must parse and end must follow start. */
export function parseDateTimeRange(
  startRaw: string,
  endRaw: string,
): { ok: true; startsAt: number; endsAt: number } | { ok: false; error: string } {
  const startsAt = parseDateTime(startRaw);
  const endsAt = parseDateTime(endRaw);
  if (startsAt == null || endsAt == null) {
    return { ok: false, error: "Pick a valid start and end date/time." };
  }
  if (endsAt <= startsAt) return { ok: false, error: "End must be after start." };
  return { ok: true, startsAt, endsAt };
}

/** epoch-ms → the `datetime-local` value shape (YYYY-MM-DDThh:mm), local tz; null → "". */
export function toDateTimeLocal(ms: number | null | undefined): string {
  if (ms == null) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
