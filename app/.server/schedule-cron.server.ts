import { CronExpressionParser } from "cron-parser";

export const DEFAULT_SCHEDULE_TIMEZONE = "America/Argentina/Buenos_Aires";
export const MAX_CRON_LENGTH = 100;
const MIN_INTERVAL_MS = 15 * 60_000;
const MAX_INTERVAL_CHECKS = 200;

export class ScheduleInputError extends Error {
  constructor(readonly code: "invalid_cron" | "invalid_timezone" | "too_frequent") {
    super(
      code === "invalid_timezone"
        ? "Selecciona una zona horaria IANA válida."
        : code === "too_frequent"
          ? "La frecuencia mínima permitida es cada 15 minutos."
          : "Usa una expresión cron numérica de cinco campos, sin comandos ni segundos.",
    );
  }
}

function localMinuteKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return parts.filter((part) => part.type !== "literal").map((part) => part.value).join("");
}

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  return {
    year: value.year!, month: value.month!, day: value.day!, hour: value.hour!, minute: value.minute!,
  };
}

function matchesLocalCron(parsed: ReturnType<typeof CronExpressionParser.parse>, date: Date, timezone: string): boolean {
  const local = localParts(date, timezone);
  const dayOfWeek = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
  const fields = parsed.fields;
  const includes = (values: unknown, candidate: number) => (values as number[]).includes(candidate);
  return includes(fields.minute.values, local.minute) &&
    includes(fields.hour.values, local.hour) &&
    includes(fields.dayOfMonth.values, local.day) &&
    includes(fields.month.values, local.month) &&
    includes(fields.dayOfWeek.values, dayOfWeek);
}

function validateTimezone(timezone: string): void {
  if (timezone.length > 80) throw new ScheduleInputError("invalid_timezone");
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(0);
  } catch {
    throw new ScheduleInputError("invalid_timezone");
  }
}

function parseExpression(expression: string, timezone: string, currentDate: Date) {
  if (
    expression.length === 0 || expression.length > MAX_CRON_LENGTH ||
    /[\r\n;|&$<>]/.test(expression)
  ) throw new ScheduleInputError("invalid_cron");
  const fields = expression.trim().split(/\s+/);
  if (
    fields.length !== 5 ||
    fields.some((field) => !/^[0-9*/,-]+$/.test(field)) ||
    ((fields[2] === "*") === (fields[4] === "*"))
  ) throw new ScheduleInputError("invalid_cron");
  validateTimezone(timezone);
  try {
    return CronExpressionParser.parse(expression, { currentDate, tz: timezone });
  } catch {
    throw new ScheduleInputError("invalid_cron");
  }
}

/** Five numeric cron fields only; day-of-month XOR day-of-week wildcard is required. */
export function validateCronSchedule(expression: string, timezone: string, now = new Date()): void {
  const parsed = parseExpression(expression, timezone, now);
  let previous: Date | undefined;
  const localKeys = new Set<string>();
  try {
    for (let index = 0; index < MAX_INTERVAL_CHECKS; index++) {
      const occurrence = parsed.next().toDate();
      // cron-parser shifts a nonexistent spring-forward wall time; reject that shifted result.
      if (!matchesLocalCron(parsed, occurrence, timezone)) continue;
      const key = localMinuteKey(occurrence, timezone);
      if (localKeys.has(key)) continue;
      localKeys.add(key);
      if (previous && occurrence.getTime() - previous.getTime() < MIN_INTERVAL_MS)
        throw new ScheduleInputError("too_frequent");
      previous = occurrence;
    }
  } catch (error) {
    if (error instanceof ScheduleInputError) throw error;
    // Sparse annual schedules may exhaust the parser's supported date span; their observed gaps are safe.
  }
  if (localKeys.size === 0) throw new ScheduleInputError("invalid_cron");
}

/** Shared worker/preview expansion; duplicate wall-clock times retain their earlier instant. */
export function nextCronOccurrences(
  expression: string,
  timezone: string,
  from: Date,
  count: number,
): Date[] {
  if (!Number.isInteger(count) || count < 1 || count > 100)
    throw new ScheduleInputError("invalid_cron");
  const parsed = parseExpression(expression, timezone, from);
  const occurrences: Date[] = [];
  const localKeys = new Set<string>();
  for (let index = 0; index < count * 3 + 4 && occurrences.length < count; index++) {
    let occurrence: Date;
    try { occurrence = parsed.next().toDate(); }
    catch { break; }
    if (!matchesLocalCron(parsed, occurrence, timezone)) continue;
    const key = localMinuteKey(occurrence, timezone);
    if (localKeys.has(key)) continue;
    localKeys.add(key);
    occurrences.push(occurrence);
  }
  return occurrences;
}

export function previousCronOccurrences(
  expression: string,
  timezone: string,
  before: Date,
  count: number,
): Date[] {
  if (!Number.isInteger(count) || count < 1 || count > 100)
    throw new ScheduleInputError("invalid_cron");
  const parsed = parseExpression(expression, timezone, before);
  const byLocalTime = new Map<string, Date>();
  for (let index = 0; index < count * 3 + 4; index++) {
    let occurrence: Date;
    try { occurrence = parsed.prev().toDate(); }
    catch { break; }
    if (!matchesLocalCron(parsed, occurrence, timezone)) continue;
    const key = localMinuteKey(occurrence, timezone);
    const existing = byLocalTime.get(key);
    if (!existing || occurrence.getTime() < existing.getTime()) byLocalTime.set(key, occurrence);
  }
  return [...byLocalTime.values()].sort((a, b) => b.getTime() - a.getTime()).slice(0, count);
}
