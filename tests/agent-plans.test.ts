import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDatabase, seedFixtures } from "../app/.server/db.server";
import { AgentPlanError, applyAgentPlan, createAgentPlan, executeAgentOrganizationStep, executeAgentSummaryStep } from "../app/.server/agent-plans.server";
import { saveManagedUpload } from "../app/.server/managed-upload.server";
import { editLibraryFile } from "../app/.server/library-management.server";
import { readableAgentHistory } from "../app/.server/agent-safety.server";

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "webfiling-agent-plan-"));
  process.env.DATABASE_PATH = path.join(root, "demo.sqlite");
  process.env.MANAGED_STORAGE_ROOT = path.join(root, "managed");
  process.env.SOURCE_ROOT = path.join(root, "source");
  process.env.DEMO_MODE = "true";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
  await fs.mkdir(process.env.SOURCE_ROOT);
  const db = openDatabase(process.env.DATABASE_PATH);
  seedFixtures(db);
  const uploaded = await saveManagedUpload("employee", {
    collectionId: "collection-project-project-costa-norte",
    file: new File(["bytes"], "informe.txt", { type: "text/plain" }),
    projectIds: ["project-costa-norte"],
  }, db);
  return { root, db, uploaded };
}

test("plans are profile-private, require explicit apply, and queue a typed durable run", async () => {
  const { root, db, uploaded } = await setup();
  const now = new Date("2026-10-08T12:00:00.000Z");
  const plan = createAgentPlan("employee", "demo-intents-v1", "Organizar informe", {
    type: "organize", fileId: uploaded.id, categoryId: "technical",
  }, "Categoría sugerida", db, now);
  assert.equal((db.prepare("SELECT count(*) AS count FROM agent_runs").get() as { count: number }).count, 0);
  assert.throws(() => applyAgentPlan("manager", plan.id, db, now), (error: unknown) => error instanceof AgentPlanError && error.status === 404);
  const result = applyAgentPlan("employee", plan.id, db, now);
  assert.equal(result.status, "queued");
  assert.equal((db.prepare("SELECT status FROM agent_runs WHERE id=?").get(result.runId) as { status: string }).status, "queued");
  assert.equal((db.prepare("SELECT action_type,state FROM agent_steps WHERE run_id=?").get(result.runId) as { action_type: string; state: string }).state, "queued");
  assert.throws(() => applyAgentPlan("employee", plan.id, db, now), (error: unknown) => error instanceof AgentPlanError && error.status === 409);
  db.close();
  await fs.rm(root, { recursive: true, force: true });
});

test("apply refreshes target fingerprint and rejects expired plans", async () => {
  const { root, db, uploaded } = await setup();
  const now = new Date("2026-10-08T12:00:00.000Z");
  const stale = createAgentPlan("employee", "demo-intents-v1", "Organizar informe", { type: "organize", fileId: uploaded.id }, "Organización", db, now);
  db.prepare("UPDATE files SET category_id='finance',updated_at='2026-10-08T12:01:00.000Z' WHERE id=?").run(uploaded.id);
  assert.throws(() => applyAgentPlan("employee", stale.id, db, now), (error: unknown) => error instanceof AgentPlanError && error.code === "stale_plan");
  const expiring = createAgentPlan("employee", "demo-intents-v1", "Organizar informe", { type: "organize", fileId: uploaded.id }, "Organización", db, now);
  assert.throws(() => applyAgentPlan("employee", expiring.id, db, new Date(now.getTime() + 16 * 60_000)), (error: unknown) => error instanceof AgentPlanError && error.code === "plan_expired");
  db.close();
  await fs.rm(root, { recursive: true, force: true });
});

test("organization uses existing metadata service with provenance and retry-safe history", async () => {
  const { root, db, uploaded } = await setup();
  const now = new Date("2026-10-08T12:00:00.000Z");
  const plan = createAgentPlan("employee", "demo-intents-v1", "Organizar informe", {
    type: "organize", fileId: uploaded.id, categoryId: "technical",
  }, "Clasificación sugerida", db, now);
  const { runId } = applyAgentPlan("employee", plan.id, db, now);
  assert.deepEqual(executeAgentOrganizationStep("employee", runId, "apply", db, now), { status: "completed", fileId: uploaded.id });
  assert.equal((db.prepare("SELECT category_id FROM files WHERE id=?").get(uploaded.id) as { category_id: string }).category_id, "technical");
  const event = db.prepare("SELECT agent_run_id,agent_step_key FROM file_events WHERE file_id=? AND event_type='metadata_changed'").get(uploaded.id) as { agent_run_id: string; agent_step_key: string };
  assert.deepEqual({ ...event }, { agent_run_id: runId, agent_step_key: "apply" });
  db.prepare("UPDATE agent_steps SET state='failed' WHERE run_id=? AND step_key='apply'").run(runId);
  executeAgentOrganizationStep("employee", runId, "apply", db, now);
  assert.equal((db.prepare("SELECT count(*) AS count FROM file_events WHERE file_id=? AND event_type='metadata_changed'").get(uploaded.id) as { count: number }).count, 1);
  db.close();
  await fs.rm(root, { recursive: true, force: true });
});

test("summary execution persists source fingerprints and excerpt-only results", async () => {
  const { root, db, uploaded } = await setup();
  const plan = createAgentPlan("employee", "demo-intents-v1", "Resumir informe", { type: "summarize", fileIds: [uploaded.id] }, "Resumen extractivo", db);
  const { runId } = applyAgentPlan("employee", plan.id, db);
  const result = await executeAgentSummaryStep("employee", runId, "apply", db);
  assert.equal(result.status, "completed");
  assert.equal(result.coverage.available, 1);
  assert.match(result.sources[0].summaryText, /Extracto del documento/);
  assert.equal((db.prepare("SELECT count(*) AS count FROM agent_summaries WHERE run_id=? AND file_id=?").get(runId, uploaded.id) as { count: number }).count, 1);
  db.close();
  await fs.rm(root, { recursive: true, force: true });
});

test("collection summary reports authorized coverage and invalidates changed-source excerpts", async () => {
  const { root, db, uploaded } = await setup();
  const plan = createAgentPlan("employee", "demo-intents-v1", "Resumir Costa Norte", {
    type: "summarize_collection", collectionId: "collection-project-project-costa-norte",
  }, "Resumen de colección", db);
  const { runId } = applyAgentPlan("employee", plan.id, db);
  const result = await executeAgentSummaryStep("employee", runId, "apply", db);
  assert.ok(result.coverage.requested >= 1);
  assert.ok(result.sources.some((source) => source.fileId === uploaded.id));
  assert.ok(readableAgentHistory("employee", runId, db).summaries.some((summary) => summary.fileId === uploaded.id));
  editLibraryFile("employee", uploaded.id, { categoryId: "finance" }, db);
  assert.equal(readableAgentHistory("employee", runId, db).summaries.some((summary) => summary.fileId === uploaded.id), false);
  db.close();
  await fs.rm(root, { recursive: true, force: true });
});
