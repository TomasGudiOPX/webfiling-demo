import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDatabase, seedFixtures } from "../app/.server/db.server";
import {
  AgentInputError,
  assertAgentCollectionCapability,
  assertAgentFileCapability,
  parseDemoAgentOperation,
  readableAgentHistory,
  safeAgentError,
} from "../app/.server/agent-safety.server";

test("agent operation parser accepts only bounded typed operations", () => {
  assert.deepEqual(parseDemoAgentOperation({ type: "summarize", fileIds: ["file-1"] }), {
    type: "summarize", fileIds: ["file-1"],
  });
  assert.deepEqual(parseDemoAgentOperation({ type: "summarize_collection", collectionId: "collection-1" }), {
    type: "summarize_collection", collectionId: "collection-1",
  });
  for (const input of [
    { type: "run_command", command: "whoami" },
    { type: "check_collection", collectionId: "collection-x", actorId: "system-administrator" },
    { type: "summarize", fileIds: [] },
    { type: "summarize", fileIds: Array.from({ length: 21 }, (_, index) => `file-${index}`) },
    { type: "organize", fileId: "file-1", categoryId: "unknown" },
    { type: "draft_rule", collectionId: "collection-x", recipientProfileId: "guest" },
  ])
    assert.throws(() => parseDemoAgentOperation(input), AgentInputError);
});

test("private history hides restricted targets and cached summaries after grants change", () => {
  const db = openDatabase(
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), "webfiling-agent-history-")), "demo.sqlite"),
  );
  seedFixtures(db);
  const timestamp = "2026-10-08T00:00:00.000Z";
  db.prepare(
    "INSERT INTO files (id,project_id,stable_identity,filename,source_path,modified_at,status,created_at,updated_at) VALUES ('private-file','project-costa-norte','private-file','secreto.txt','',?,?,?,?)",
  ).run(timestamp, "pending_review", timestamp, timestamp);
  db.prepare(
    "INSERT INTO library_file_metadata (file_id,collection_id,origin,display_name,contributor_id,availability,sample_owned,created_at,updated_at) VALUES ('private-file','collection-project-project-costa-norte','managed_upload','secreto.txt','employee','available',0,?,?)",
  ).run(timestamp, timestamp);
  db.prepare(
    "INSERT INTO agent_runs (id,profile_id,provider_version,intent,status,created_at) VALUES ('private-run','employee','demo-v1','summary','completed',?)",
  ).run(timestamp);
  db.prepare(
    "INSERT INTO agent_steps (id,run_id,step_key,action_type,target_ids_json,state,reason,result_json,created_at,updated_at) VALUES ('hidden-step','private-run','summary','summarize','[\"private-file\"]','succeeded','Resumen disponible','{\"outcome\":\"succeeded\",\"text\":\"cached secret\"}',?,?)",
  ).run(timestamp, timestamp);
  db.prepare(
    "INSERT INTO agent_summaries (id,run_id,file_id,source_fingerprint,source_file_updated_at,source_metadata_updated_at,extraction_method,excerpt_text,created_at) VALUES ('hidden-summary','private-run','private-file','sha256:test',?,?,'extractive','cached secret',?)",
  ).run(timestamp, timestamp, timestamp);
  const beforeRevoke = readableAgentHistory("employee", "private-run", db);
  assert.equal(beforeRevoke.steps.length, 1);
  assert.equal(beforeRevoke.summaries.length, 1);
  db.prepare(
    "UPDATE collection_grants SET can_read=0,can_contribute=0,can_organize=0 WHERE profile_id='employee' AND collection_id='collection-project-project-costa-norte'",
  ).run();
  const afterRevoke = readableAgentHistory("employee", "private-run", db);
  assert.deepEqual(afterRevoke.steps, []);
  assert.deepEqual(afterRevoke.summaries, []);
  assert.equal(JSON.stringify(afterRevoke).includes("private-file"), false);
  assert.equal(JSON.stringify(afterRevoke).includes("cached secret"), false);
  assert.throws(() => readableAgentHistory("manager", "private-run", db), (error: unknown) =>
    error instanceof AgentInputError && error.status === 404,
  );
  assert.throws(() => readableAgentHistory("employee", "missing-run", db), (error: unknown) =>
    error instanceof AgentInputError && error.status === 404,
  );
  db.close();
});

test("safe agent errors never serialize exception details", () => {
  const result = safeAgentError(new Error("C:\\secret\\private.sqlite stack trace"));
  assert.deepEqual(result, {
    code: "unavailable",
    message: "No se pudo completar la acción. Puedes intentarlo de nuevo.",
  });
  assert.equal(JSON.stringify(result).includes("private.sqlite"), false);
});

test("unknown and restricted targets share 404 while readable forbidden actions return 403", () => {
  const db = openDatabase(
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), "webfiling-agent-errors-")), "demo.sqlite"),
  );
  seedFixtures(db);
  for (const collectionId of ["missing-collection", "collection-administration"])
    assert.throws(
      () => assertAgentCollectionCapability("manager", collectionId, "read", db),
      (error: unknown) => error instanceof AgentInputError && error.status === 404,
    );
  assert.throws(
    () => assertAgentCollectionCapability("manager", "collection-project-project-torre-del-parque", "organize", db),
    (error: unknown) => error instanceof AgentInputError && error.status === 403,
  );
  assert.throws(
    () => assertAgentFileCapability("manager", "missing-file", "read", db),
    (error: unknown) => error instanceof AgentInputError && error.status === 404,
  );
  db.close();
});
