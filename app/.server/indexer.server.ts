import fs from "node:fs";
import path from "node:path";
import { assertAllowedSourceRoot, getConfig } from "./config";
import {
  openDatabase,
  rebuildSearchIndex,
  upsertIndexedFile,
} from "./db.server";

export interface IndexSummary {
  indexedCount: number;
  errorCount: number;
  errors: string[];
  runId: number;
}

export function indexSource(sourceRoot = getConfig().sourceRoot): IndexSummary {
  const root = assertAllowedSourceRoot(sourceRoot);
  const db = openDatabase();
  const startedAt = new Date().toISOString();
  const run = db
    .prepare(
      "INSERT INTO index_runs (started_at,source_root,status) VALUES (?,?,?)",
    )
    .run(startedAt, root, "running");
  const project = db
    .prepare("SELECT id FROM projects ORDER BY id LIMIT 1")
    .get() as { id: string } | undefined;
  if (!project)
    throw new Error(
      "Cannot index without a project mapping. Seed or configure a project first.",
    );
  let indexedCount = 0;
  let errorCount = 0;
  const errors: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      errorCount++;
      errors.push(
        `${dir}: ${error instanceof Error ? error.message : "inaccessible"}`,
      );
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      assertAllowedSourceRoot(entryPath, root);
      if (entry.isDirectory()) {
        walk(entryPath);
        continue;
      }
      try {
        const stat = fs.statSync(entryPath);
        upsertIndexedFile({
          projectId: project.id,
          sourcePath: entryPath,
          filename: entry.name,
          extension: path.extname(entry.name),
          sizeBytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          documentType:
            path.extname(entry.name).toLowerCase() === ".pdf"
              ? "plan"
              : "other",
        });
        indexedCount++;
      } catch (error) {
        errorCount++;
        errors.push(
          `${entryPath}: ${error instanceof Error ? error.message : "inaccessible"}`,
        );
      }
    }
  };
  walk(root);
  const finishedAt = new Date().toISOString();
  db.prepare(
    "UPDATE index_runs SET finished_at=?,indexed_count=?,error_count=?,status=?,last_error=? WHERE id=?",
  ).run(
    finishedAt,
    indexedCount,
    errorCount,
    errorCount ? "completed_with_errors" : "success",
    errors.join("; ") || null,
    run.lastInsertRowid,
  );
  rebuildSearchIndex(db);
  return {
    indexedCount,
    errorCount,
    errors,
    runId: Number(run.lastInsertRowid),
  };
}
