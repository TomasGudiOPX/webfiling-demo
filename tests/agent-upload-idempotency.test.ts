import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDatabase, seedFixtures } from "../app/.server/db.server";
import { applyAgentPlan, createAgentPlan } from "../app/.server/agent-plans.server";
import { saveManagedUpload } from "../app/.server/managed-upload.server";

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "webfiling-agent-upload-"));
  process.env.DATABASE_PATH = path.join(root, "demo.sqlite");
  process.env.MANAGED_STORAGE_ROOT = path.join(root, "managed");
  process.env.SOURCE_ROOT = path.join(root, "source");
  process.env.DEMO_MODE = "true";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
  await fs.mkdir(process.env.SOURCE_ROOT);
  const db = openDatabase(process.env.DATABASE_PATH);
  seedFixtures(db);
  return { root, db };
}
const destination = "collection-project-project-costa-norte";
const file = (content = "real upload bytes") => new File([content], "agent-report.txt", { type: "text/plain" });

test("same profile-bound agent token coalesces concurrent upload retries and records step success", async () => {
  const { root, db } = await setup();
  const plan = createAgentPlan("employee", "demo-intents-v1", "Subir a Costa Norte", { type: "upload", collectionId: destination }, "Carga solicitada", db);
  const { runId } = applyAgentPlan("employee", plan.id, db);
  const operation = { key: "agent-upload-request-001", runId, stepKey: "apply" };
  const args = { collectionId: destination, file: file(), projectIds: ["project-costa-norte"], operation };
  const [first, second] = await Promise.all([
    saveManagedUpload("employee", args, db),
    saveManagedUpload("employee", { ...args, file: file() }, db),
  ]);
  assert.equal(first.id, second.id);
  assert.equal((db.prepare("SELECT count(*) AS count FROM library_file_metadata WHERE contributor_id='employee' AND display_name='agent-report.txt'").get() as { count: number }).count, 1);
  assert.equal((db.prepare("SELECT state FROM agent_steps WHERE run_id=? AND step_key='apply'").get(runId) as { state: string }).state, "succeeded");
  assert.equal((db.prepare("SELECT status FROM agent_runs WHERE id=?").get(runId) as { status: string }).status, "completed");
  db.close();
  await fs.rm(root, { recursive: true, force: true });
});

test("a reused key with different bytes conflicts while separate keys remain separate uploads", async () => {
  const { root, db } = await setup();
  const operation = { key: "agent-upload-request-002" };
  const base = { collectionId: destination, projectIds: ["project-costa-norte"] };
  const first = await saveManagedUpload("employee", { ...base, file: file(), operation }, db);
  const replay = await saveManagedUpload("employee", { ...base, file: file(), operation }, db);
  assert.equal(replay.id, first.id);
  const directRun = db.prepare("SELECT id,status FROM agent_runs WHERE profile_id='employee' AND request_key=?").get("direct-upload:agent-upload-request-002") as { id: string; status: string };
  assert.equal(directRun.status, "completed");
  assert.equal((db.prepare("SELECT state FROM agent_steps WHERE run_id=? AND step_key='attach'").get(directRun.id) as { state: string }).state, "succeeded");
  await assert.rejects(
    saveManagedUpload("employee", { ...base, file: file("different bytes"), operation }, db),
    (error: unknown) => error instanceof Error && "status" in error && error.status === 409,
  );
  const separate = await saveManagedUpload("employee", { ...base, file: file(), operation: { key: "agent-upload-request-003" } }, db);
  assert.notEqual(first.id, separate.id);
  const otherProfile = await saveManagedUpload("manager", { ...base, file: file(), operation }, db);
  assert.notEqual(first.id, otherProfile.id);
  db.close();
  await fs.rm(root, { recursive: true, force: true });
});
