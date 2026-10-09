import assert from "node:assert/strict";
import test from "node:test";
import { ScheduleInputError } from "../app/.server/schedule-cron.server";
import {
  assertNoOverlappingWindows,
  isWithinCollectionWindow,
  previewCollectionWindows,
} from "../app/.server/schedule-window.server";

test("weekly and monthly presets preview three timezone-aware windows", () => {
  const weekly = previewCollectionWindows({
    kind: "weekly", timezone: "UTC", weekday: 1, hour: 9, minute: 0, windowMinutes: 60,
  }, new Date("2026-10-08T00:00:00.000Z"));
  assert.equal(weekly.length, 3);
  assert.equal(weekly[0].opensAt, "2026-10-12T09:00:00.000Z");
  assert.equal(weekly[0].closesAt, "2026-10-12T10:00:00.000Z");
  const monthly = previewCollectionWindows({
    kind: "monthly", timezone: "UTC", day: 1, hour: 9, minute: 0, windowMinutes: 1440,
  }, new Date("2026-10-02T00:00:00.000Z"));
  assert.deepEqual(monthly.map((window) => window.opensAt), [
    "2026-11-01T09:00:00.000Z", "2026-12-01T09:00:00.000Z", "2027-01-01T09:00:00.000Z",
  ]);
});

test("advanced cron skips month-end gaps and observes leap days", () => {
  const monthEnd = previewCollectionWindows({
    kind: "cron", timezone: "UTC", expression: "0 9 31 * *", windowMinutes: 30,
  }, new Date("2026-01-01T00:00:00.000Z"), 3);
  assert.deepEqual(monthEnd.map((window) => window.opensAt), [
    "2026-01-31T09:00:00.000Z", "2026-03-31T09:00:00.000Z", "2026-05-31T09:00:00.000Z",
  ]);
  const leap = previewCollectionWindows({
    kind: "cron", timezone: "UTC", expression: "0 9 29 2 *", windowMinutes: 30,
  }, new Date("2024-01-01T00:00:00.000Z"), 2);
  assert.deepEqual(leap.map((window) => window.opensAt), [
    "2024-02-29T09:00:00.000Z", "2028-02-29T09:00:00.000Z",
  ]);
});

test("wall-clock closing resolves DST gaps forward and repeated times to the earlier instant", () => {
  const gap = previewCollectionWindows({
    kind: "weekly", timezone: "America/New_York", weekday: 0, hour: 1, minute: 30, windowMinutes: 60,
  }, new Date("2024-03-10T05:00:00.000Z"), 1)[0];
  assert.equal(gap.opensAt, "2024-03-10T06:30:00.000Z");
  assert.equal(gap.closesAt, "2024-03-10T07:00:00.000Z");
  assert.equal(gap.closingAdjusted, true);
  const repeated = previewCollectionWindows({
    kind: "weekly", timezone: "America/New_York", weekday: 0, hour: 0, minute: 30, windowMinutes: 60,
  }, new Date("2024-11-03T04:00:00.000Z"), 1)[0];
  assert.equal(repeated.closesAt, "2024-11-03T05:30:00.000Z");
  assert.equal(repeated.closingAdjusted, false);
});

test("one-off boundaries and recurring overlap are validated inclusively", () => {
  const oneOff = previewCollectionWindows({
    kind: "one_off", timezone: "UTC", opensAt: "2026-10-08T09:00:00Z", closesAt: "2026-10-08T10:00:00Z",
  }, new Date("2026-10-01T00:00:00Z"));
  assert.equal(oneOff[0].closesAt, "2026-10-08T10:00:00.000Z");
  assert.equal(isWithinCollectionWindow(oneOff[0].opensAt, oneOff[0]), true);
  assert.equal(isWithinCollectionWindow(oneOff[0].closesAt, oneOff[0]), true);
  assert.equal(isWithinCollectionWindow("2026-10-08T10:00:00.001Z", oneOff[0]), false);
  assert.throws(() => previewCollectionWindows({
    kind: "one_off", timezone: "UTC", opensAt: "2026-10-08T09:00:00Z", closesAt: "2026-10-08T09:00:00Z",
  }, new Date()), ScheduleInputError);
  const overlapping = previewCollectionWindows({
    kind: "weekly", timezone: "UTC", weekday: 1, hour: 9, minute: 0, windowMinutes: 10080,
  }, new Date("2026-10-08T00:00:00Z"));
  assert.throws(() => assertNoOverlappingWindows(overlapping), ScheduleInputError);
});
