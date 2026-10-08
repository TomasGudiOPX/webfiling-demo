import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  openDatabase,
  resetDemoFixtures,
  seedFixtures,
} from "../app/.server/db.server";
import {
  assignReviewItem,
  decideReviewItem,
  getReviewEvidence,
  listDecisionEvents,
  listReviewItems,
  updateReviewUrgency,
} from "../app/.server/governance.server";

function fixtureDb() {
  return openDatabase(
    path.join(
      os.tmpdir(),
      `webfiling-governance-${Date.now()}-${Math.random()}.sqlite`,
    ),
  );
}
test("review inbox exposes cross-project, unassigned, overdue, and mine queues", () => {
  const db = fixtureDb();
  seedFixtures(db);
  assert.ok(
    listReviewItems({}, db).some((item) => item.projectSlug === "costa-norte"),
  );
  assert.ok(
    listReviewItems({}, db).some(
      (item) => item.projectSlug === "parque-industrial",
    ),
  );
  assert.ok(
    listReviewItems({ view: "unassigned" }, db).every(
      (item) => item.assigneeId === null,
    ),
  );
  assert.ok(
    listReviewItems(
      { view: "mine", assigneeId: "document-controller" },
      db,
    ).every((item) => item.assigneeId === "document-controller"),
  );
  assert.ok(listReviewItems({ view: "overdue" }, db).length > 0);
});
test("assignment, urgency, and decisions create immutable evidence snapshots", () => {
  const db = fixtureDb();
  seedFixtures(db);
  const id = "review-parque-duplicate-a";
  const claimed = assignReviewItem(
    id,
    "document-controller",
    "technical-lead",
    "Technical lead",
    db,
  );
  assert.equal(claimed.assigneeId, "technical-lead");
  const urgent = updateReviewUrgency(
    id,
    "technical-lead",
    {
      severity: "critical",
      priority: "critical",
      dueAt: "2026-10-08T00:00:00.000Z",
    },
    db,
  );
  assert.equal(urgent.severity, "critical");
  assert.throws(
    () =>
      updateReviewUrgency(
        id,
        "technical-lead",
        {
          severity: "invalid" as any,
          priority: "critical",
          dueAt: "not-a-date",
        },
        db,
      ),
    /Invalid severity/,
  );
  assert.throws(
    () =>
      assignReviewItem(id, "unknown", "technical-lead", "Technical lead", db),
    /Invalid demo identity/,
  );
  assert.throws(
    () => decideReviewItem(id, "technical-lead", "return", "", db),
    /reason/,
  );
  const completed = decideReviewItem(
    id,
    "technical-lead",
    "approve",
    undefined,
    db,
  );
  assert.equal(completed.state, "completed");
  const evidence = getReviewEvidence(id, db)!;
  assert.equal(evidence.file.status, "approved");
  const events = listDecisionEvents({ reviewItemId: id }, db);
  const approval = events.find((event) => event.eventType === "approve");
  assert.ok(approval);
  const originalPath = String(approval.context.sourcePath);
  db.prepare("UPDATE files SET source_path='changed-after-decision' WHERE id='parque-duplicate-a'").run();
  assert.equal(listDecisionEvents({ reviewItemId: id }, db).find((event) => event.eventType === "approve")?.context.sourcePath, originalPath);
});
test("fixture reset restores governed work after completed decisions", () => {
  const db = fixtureDb();
  seedFixtures(db);
  decideReviewItem(
    "review-parque-duplicate-b",
    "document-controller",
    "return",
    "Revisar versión",
    db,
  );
  resetDemoFixtures(db);
  const restored = listReviewItems({ view: "unassigned" }, db);
  assert.ok(restored.some((item) => item.id === "review-parque-duplicate-b"));
});
