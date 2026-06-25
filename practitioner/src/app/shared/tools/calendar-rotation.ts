/**
 * Computes the background color for a given day from a continuous, never-resetting
 * 4-week (or N-color) rotation anchored to a fixed date.
 *
 * Each calendar week (aligned to `firstDayOfWeek`) maps to a single color: every
 * day is first snapped back to the start of its week, then the week index is
 * `floor((weekStart - anchorWeekStart) / 7 days)`, taken modulo the number of
 * colors. Because the counter is continuous from the anchor, the sequence stays
 * consistent across year boundaries (the first week of a new year keeps the color
 * the rotation logically expects, never a reset). A positive modulo keeps dates
 * before the anchor consistent too. Snapping both the day and the anchor to their
 * week start guarantees all seven days of a displayed week share one color,
 * whatever the configured first day of the week.
 *
 * @param firstDayOfWeek 0 = Sunday, 1 = Monday, … 6 = Saturday.
 * @returns the hex color string, or `null` when colorization is not applicable
 *          (no colors configured or an invalid anchor date).
 */
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/** UTC timestamp of midnight at the start of the week containing `date`. */
function startOfWeekUtc(date: Date, firstDayOfWeek: number): number {
  const dayStart = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = new Date(dayStart).getUTCDay();
  const offset = ((dow - firstDayOfWeek) % 7 + 7) % 7;
  return dayStart - offset * 24 * 60 * 60 * 1000;
}

export function weekRotationColor(
  date: Date,
  anchorIso: string,
  colors: string[],
  firstDayOfWeek = 0,
): string | null {
  if (!colors || colors.length === 0) {
    return null;
  }

  const anchor = new Date(`${anchorIso}T00:00:00`);
  if (Number.isNaN(anchor.getTime())) {
    return null;
  }

  const weekStart = startOfWeekUtc(date, firstDayOfWeek);
  const anchorWeekStart = startOfWeekUtc(anchor, firstDayOfWeek);
  const weeks = Math.round((weekStart - anchorWeekStart) / MS_PER_WEEK);
  const index = ((weeks % colors.length) + colors.length) % colors.length;
  return colors[index];
}
