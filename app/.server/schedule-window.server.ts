import {
  ScheduleInputError,
  nextCronOccurrences,
  validateCronSchedule,
} from "./schedule-cron.server";

const MAX_WINDOW_MINUTES = 28 * 24 * 60;
export type CollectionRecurrence =
  | { kind: "one_off"; timezone: string; opensAt: string; closesAt: string }
  | { kind: "weekly"; timezone: string; weekday: number; hour: number; minute: number; windowMinutes: number }
  | { kind: "monthly"; timezone: string; day: number; hour: number; minute: number; windowMinutes: number }
  | { kind: "cron"; timezone: string; expression: string; windowMinutes: number };

export interface CollectionWindowPreview {
  opensAt: string;
  closesAt: string;
  timezone: string;
  closingAdjusted: boolean;
}

type LocalDateTime = { year: number; month: number; day: number; hour: number; minute: number };
const localDateTime = (date: Date, timezone: string): LocalDateTime => {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en", {
      timeZone: timezone, year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", hourCycle: "h23",
    }).formatToParts(date).filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return { year: values.year!, month: values.month!, day: values.day!, hour: values.hour!, minute: values.minute! };
};
const sameLocal = (a: LocalDateTime, b: LocalDateTime) =>
  a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute;
const wallTimestamp = (value: LocalDateTime) =>
  Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute);
const fromWallTimestamp = (value: number): LocalDateTime => {
  const date = new Date(value);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: date.getUTCHours(), minute: date.getUTCMinutes() };
};

function offsetsNear(local: LocalDateTime, timezone: string): number[] {
  const naive = wallTimestamp(local);
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 3) {
    const instant = new Date(naive + hours * 3_600_000);
    const rendered = localDateTime(instant, timezone);
    offsets.add(wallTimestamp(rendered) - instant.getTime());
  }
  return [...offsets];
}

function resolveWallTime(value: LocalDateTime, timezone: string): { date: Date; adjusted: boolean } {
  const offsets = offsetsNear(value, timezone);
  for (let advance = 0; advance <= 24 * 60; advance++) {
    const candidateLocal = fromWallTimestamp(wallTimestamp(value) + advance * 60_000);
    const matches = offsets
      .map((offset) => new Date(wallTimestamp(candidateLocal) - offset))
      .filter((instant) => sameLocal(localDateTime(instant, timezone), candidateLocal))
      .sort((a, b) => a.getTime() - b.getTime());
    if (matches.length) return { date: matches[0], adjusted: advance > 0 };
  }
  throw new ScheduleInputError("invalid_timezone");
}

function positiveWindow(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_WINDOW_MINUTES)
    throw new ScheduleInputError("invalid_cron");
}

function recurrenceExpression(recurrence: Exclude<CollectionRecurrence, { kind: "one_off" }>): string {
  if (recurrence.kind === "cron") return recurrence.expression;
  const { hour, minute } = recurrence;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59)
    throw new ScheduleInputError("invalid_cron");
  if (recurrence.kind === "weekly") {
    if (!Number.isInteger(recurrence.weekday) || recurrence.weekday < 0 || recurrence.weekday > 6)
      throw new ScheduleInputError("invalid_cron");
    return `${minute} ${hour} * * ${recurrence.weekday}`;
  }
  if (!Number.isInteger(recurrence.day) || recurrence.day < 1 || recurrence.day > 28)
    throw new ScheduleInputError("invalid_cron");
  return `${minute} ${hour} ${recurrence.day} * *`;
}

export function previewCollectionWindows(
  recurrence: CollectionRecurrence,
  from: Date,
  count = 3,
): CollectionWindowPreview[] {
  if (!Number.isInteger(count) || count < 1 || count > 100)
    throw new ScheduleInputError("invalid_cron");
  if (recurrence.kind === "one_off") {
    const opensAt = new Date(recurrence.opensAt);
    const closesAt = new Date(recurrence.closesAt);
    if (!Number.isFinite(opensAt.getTime()) || !Number.isFinite(closesAt.getTime()) || closesAt <= opensAt)
      throw new ScheduleInputError("invalid_cron");
    try { new Intl.DateTimeFormat("en", { timeZone: recurrence.timezone }).format(opensAt); }
    catch { throw new ScheduleInputError("invalid_timezone"); }
    return [{ opensAt: opensAt.toISOString(), closesAt: closesAt.toISOString(), timezone: recurrence.timezone, closingAdjusted: false }];
  }

  positiveWindow(recurrence.windowMinutes);
  const expression = recurrenceExpression(recurrence);
  validateCronSchedule(expression, recurrence.timezone, from);
  const openings = nextCronOccurrences(expression, recurrence.timezone, from, count);
  if (openings.length !== count) throw new ScheduleInputError("invalid_cron");
  return openings.map((opening) => {
    const localOpen = localDateTime(opening, recurrence.timezone);
    const closeWall = fromWallTimestamp(wallTimestamp(localOpen) + recurrence.windowMinutes * 60_000);
    const resolved = resolveWallTime(closeWall, recurrence.timezone);
    return {
      opensAt: opening.toISOString(),
      closesAt: resolved.date.toISOString(),
      timezone: recurrence.timezone,
      closingAdjusted: resolved.adjusted,
    };
  });
}

export function assertNoOverlappingWindows(windows: readonly CollectionWindowPreview[]): void {
  for (let index = 1; index < windows.length; index++) {
    if (new Date(windows[index - 1].closesAt).getTime() >= new Date(windows[index].opensAt).getTime())
      throw new ScheduleInputError("invalid_cron");
  }
}

export function isWithinCollectionWindow(
  uploadedAt: string | Date,
  window: Pick<CollectionWindowPreview, "opensAt" | "closesAt">,
): boolean {
  const instant = uploadedAt instanceof Date ? uploadedAt.getTime() : new Date(uploadedAt).getTime();
  return Number.isFinite(instant) && instant >= new Date(window.opensAt).getTime() && instant <= new Date(window.closesAt).getTime();
}
