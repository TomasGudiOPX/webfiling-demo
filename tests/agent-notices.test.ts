import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDatabase, seedFixtures } from "../app/.server/db.server";
import { createCollectionRule, setCollectionRuleState } from "../app/.server/collection-rules.server";
import { cancelCollectionPeriod as cancelPeriod } from "../app/.server/collection-periods.server";
import { materializeRulePeriods } from "../app/.server/collection-periods.server";
import { reconcileAgentNotices } from "../app/.server/agent-worker.server";

test("due-soon and overdue notices are deduplicated, updated, and suppressed for cancelled periods", () => {
  const db = openDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "webfiling-notices-")), "demo.sqlite"));
  process.env.DEMO_MODE = "true";
  seedFixtures(db);
  const now = new Date("2026-10-09T12:00:00.000Z");
  const collectionId = "collection-project-project-costa-norte";
  const opensAt = new Date(now.getTime() - 60 * 60_000);
  const closesAt = new Date(now.getTime() + 12 * 60 * 60_000);
  const rule = createCollectionRule("system-administrator", {
    recipientProfileId: "employee", collectionId, projectId: "project-costa-norte",
    definition: {
      slots: [{ key: "report", label: "Informe", requiredCount: 1, allowedExtensions: [".txt"], criteria: {} }],
      organizationDefaults: {}, recurrence: { kind: "one_off", timezone: "UTC", opensAt: opensAt.toISOString(), closesAt: closesAt.toISOString() },
    },
  }, db, new Date(now.getTime() - 2 * 60 * 60_000));
  setCollectionRuleState("system-administrator", rule.id, "enable", rule.version, db, now);
  materializeRulePeriods(rule.id, now, db);
  const periodId = (db.prepare("SELECT id FROM collection_periods WHERE rule_id=?").get(rule.id) as { id: string }).id;
  assert.equal(reconcileAgentNotices(now, db, 100, collectionId), 1);
  const dueNotice = db.prepare("SELECT id,updated_at FROM agent_notices WHERE period_id=? AND notice_kind='due_soon'").get(periodId) as { id: string; updated_at: string };
  assert.equal(reconcileAgentNotices(now, db, 100, collectionId), 0);
  assert.equal((db.prepare("SELECT count(*) AS count FROM agent_notices WHERE period_id=?").get(periodId) as { count: number }).count, 1);
  assert.equal((db.prepare("SELECT updated_at FROM agent_notices WHERE id=?").get(dueNotice.id) as { updated_at: string }).updated_at, dueNotice.updated_at);

  const overdueAt = new Date(closesAt.getTime() + 60_000);
  reconcileAgentNotices(overdueAt, db, 100, collectionId);
  assert.equal((db.prepare("SELECT count(*) AS count FROM agent_notices WHERE period_id=? AND notice_kind='overdue' AND dismissed_at IS NULL").get(periodId) as { count: number }).count, 1);
  assert.ok((db.prepare("SELECT dismissed_at FROM agent_notices WHERE id=?").get(dueNotice.id) as { dismissed_at: string | null }).dismissed_at);
  cancelPeriod("system-administrator", periodId, "Período cancelado por el administrador", db, overdueAt);
  reconcileAgentNotices(overdueAt, db, 100, collectionId);
  assert.equal((db.prepare("SELECT count(*) AS count FROM agent_notices WHERE period_id=? AND dismissed_at IS NULL").get(periodId) as { count: number }).count, 0);
  db.close();
});
