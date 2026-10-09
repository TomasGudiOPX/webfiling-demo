import os from "node:os";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { openDatabase, seedFixtures } from "../app/.server/db.server";
import {
  claimDueScheduledRun,
  executeClaimedScheduledRun,
  materializeDueScheduledRuns,
  renewScheduledRunLease,
  writeAgentWorkerHeartbeat,
} from "../app/.server/agent-worker.server";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--once")) throw new Error("Usage: agent-worker [--once]");
const once = args.includes("--once");
const workerId = process.env.AGENT_WORKER_ID ?? `agent-${os.hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
const db = openDatabase();
seedFixtures(db);
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function tick() {
  const now = new Date();
  materializeDueScheduledRuns(db, now, 50);
  const claim = claimDueScheduledRun(workerId, db, now);
  if (!claim) {
    writeAgentWorkerHeartbeat(workerId, "running", db, now);
    return false;
  }
  const renewTimer = setInterval(() => {
    const at = new Date();
    const renewed = renewScheduledRunLease(workerId, claim.id, claim.attempt, db, at);
    writeAgentWorkerHeartbeat(workerId, renewed ? "running" : "error", db, at, renewed ? null : "lease_lost");
  }, 15_000);
  try {
    const result = await executeClaimedScheduledRun(workerId, claim, db);
    const success = result.status === "succeeded";
    writeAgentWorkerHeartbeat(workerId, "running", db, new Date(), success ? null : result.status === "lease_lost" ? "lease_lost" : "run_not_succeeded", success ? new Date().toISOString() : null);
  } finally {
    clearInterval(renewTimer);
  }
  return true;
}

try {
  writeAgentWorkerHeartbeat(workerId, "running", db);
  do {
    try {
      await tick();
    } catch {
      writeAgentWorkerHeartbeat(workerId, "error", db, new Date(), "worker_error");
      if (once) process.exitCode = 1;
    }
    if (!once && !stopping) await delay(10_000);
  } while (!once && !stopping);
} finally {
  writeAgentWorkerHeartbeat(workerId, "stopped", db);
  db.close();
}
