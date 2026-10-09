import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SCHEDULE_TIMEZONE,
  ScheduleInputError,
  nextCronOccurrences,
  previousCronOccurrences,
  validateCronSchedule,
} from "../app/.server/schedule-cron.server";

const now = new Date("2026-10-08T12:00:00.000Z");

test("five-field numeric schedules use an IANA timezone and have a 15-minute floor", () => {
  validateCronSchedule("0 9 * * 1", DEFAULT_SCHEDULE_TIMEZONE, now);
  validateCronSchedule("0 9 1 * *", "UTC", now);
  for (const [expression, timezone, code] of [
    ["@daily", "UTC", "invalid_cron"],
    ["0 0 9 * * 1", "UTC", "invalid_cron"],
    ["0 9 * * *", "UTC", "invalid_cron"],
    ["0 9 * * 1; touch file", "UTC", "invalid_cron"],
    ["0 9 * * 1", "Not/A_Zone", "invalid_timezone"],
    ["*/10 * * * 1", "UTC", "too_frequent"],
    ["0,14 9 * * 1", "UTC", "too_frequent"],
  ] as const)
    assert.throws(
      () => validateCronSchedule(expression, timezone, now),
      (error: unknown) => error instanceof ScheduleInputError && error.code === code,
    );
});

test("cron input is bounded and rejects commands, assignments, seconds, and invalid fields", () => {
  for (const expression of [
    "0 9 * * 1 echo unsafe",
    "0 9 * * 1 FOO=bar",
    "0 0 9 * * 1",
    "0 99 * * 1",
    "x".repeat(101),
  ])
    assert.throws(() => validateCronSchedule(expression, "UTC", now), ScheduleInputError);
});

test("next occurrence expansion is bounded and uses the validated timezone", () => {
  const occurrences = nextCronOccurrences("0 9 * * 1", "America/New_York", now, 3);
  assert.equal(occurrences.length, 3);
  assert.ok(occurrences[0].getTime() > now.getTime());
  assert.throws(() => nextCronOccurrences("0 9 * * 1", "UTC", now, 101), ScheduleInputError);
});

test("DST openings skip nonexistent local times and keep the earlier repeated instant", () => {
  const skipped = nextCronOccurrences(
    "30 2 * * 0", "America/New_York", new Date("2024-03-09T05:00:00.000Z"), 2,
  );
  assert.deepEqual(skipped.map((date) => date.toISOString()), [
    "2024-03-17T06:30:00.000Z", "2024-03-24T06:30:00.000Z",
  ]);
  const repeated = nextCronOccurrences(
    "30 1 * * 0", "America/New_York", new Date("2024-11-03T04:00:00.000Z"), 2,
  );
  assert.deepEqual(repeated.map((date) => date.toISOString()), [
    "2024-11-03T05:30:00.000Z", "2024-11-10T06:30:00.000Z",
  ]);
});

test("previous occurrence recovery skips spring gaps and deduplicates repeated wall times", () => {
  assert.equal(
    previousCronOccurrences("30 2 * * 0", "America/New_York", new Date("2024-03-11T12:00:00.000Z"), 1)[0].toISOString(),
    "2024-03-03T07:30:00.000Z",
  );
  assert.equal(
    previousCronOccurrences("30 1 * * 0", "America/New_York", new Date("2024-11-03T07:00:00.000Z"), 1)[0].toISOString(),
    "2024-11-03T05:30:00.000Z",
  );
});
