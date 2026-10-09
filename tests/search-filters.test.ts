import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseSearchFilters, workspaceUrl } from "../app/search-filters";
import {
  getProject,
  openDatabase,
  searchFileCounts,
  searchFiles,
  seedFixtures,
  upsertIndexedFile,
} from "../app/.server/db.server";

const emptyFilters = () => ({
  query: "",
  scope: "project" as const,
  status: "" as const,
  type: "" as const,
  timeframe: "" as const,
  sort: "recent" as const,
  category: "" as const,
  discipline: "" as const,
  location: "" as const,
});

test("search filter parser accepts supported values and trims query", () => {
  const parsed = parseSearchFilters(
    new URLSearchParams(
      "q=%20plano%20vigente%20&scope=all&status=pending_review&type=contract&timeframe=30d&sort=oldest&category=unclassified&discipline=structures&location=tower-a",
    ),
  );
  assert.deepEqual(parsed, {
    filters: {
      query: "plano vigente",
      scope: "all",
      status: "pending_review",
      type: "contract",
      timeframe: "30d",
      sort: "oldest",
      category: "unclassified",
      discipline: "structures",
      location: "tower-a",
    },
    invalid: [],
  });
});

test("unsupported filters recover to safe defaults and report rejected values", () => {
  const parsed = parseSearchFilters(
    new URLSearchParams(
      "scope=workspace&status=approved-ish&type=unknown&timeframe=all&sort=score&category=made-up&discipline=concrete&location=basement",
    ),
  );
  assert.deepEqual(parsed.filters, {
    query: "",
    scope: "project",
    status: "",
    type: "",
    timeframe: "",
    sort: "recent",
    category: "",
    discipline: "",
    location: "",
  });
  assert.deepEqual(parsed.invalid, [
    { key: "category", value: "made-up" },
    { key: "scope", value: "workspace" },
    { key: "status", value: "approved-ish" },
    { key: "type", value: "unknown" },
    { key: "timeframe", value: "all" },
    { key: "sort", value: "score" },
    { key: "discipline", value: "concrete" },
    { key: "location", value: "basement" },
  ]);
});

test("independent filter dimensions remain composed in one normalized contract", () => {
  const { filters, invalid } = parseSearchFilters(
    new URLSearchParams(
      "q=estructura&scope=project&status=pending_review&type=plan&category=technical&discipline=structures&location=tower-a",
    ),
  );
  assert.deepEqual(invalid, []);
  assert.equal(filters.query, "estructura");
  assert.equal(filters.scope, "project");
  assert.equal(filters.status, "pending_review");
  assert.equal(filters.type, "plan");
  assert.equal(filters.category, "technical");
  assert.equal(filters.discipline, "structures");
  assert.equal(filters.location, "tower-a");
});

test("workspace links retain active filters and clear selection on filter changes", () => {
  const current = {
    ...emptyFilters(),
    query: "plano",
    scope: "all" as const,
    category: "technical" as const,
    discipline: "structures" as const,
    location: "tower-a" as const,
  };
  const fileUrl = workspaceUrl("torre-horizonte", current, "th-matriz");
  const fileParams = new URL(fileUrl, "http://localhost").searchParams;
  assert.equal(fileParams.get("selected"), "th-matriz");
  assert.equal(fileParams.get("q"), "plano");
  assert.equal(fileParams.get("category"), "technical");
  assert.equal(fileParams.get("discipline"), "structures");
  assert.equal(fileParams.get("location"), "tower-a");
  const categoryUrl = workspaceUrl("torre-horizonte", {
    ...current,
    category: "finance",
  });
  const categoryParams = new URL(categoryUrl, "http://localhost").searchParams;
  assert.equal(categoryParams.get("category"), "finance");
  assert.equal(categoryParams.get("selected"), null);
});

test("database search applies status without query and keeps project scope", () => {
  const db = openDatabase(
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), "webfiling-filter-scope-")), "db.sqlite"),
  );
  seedFixtures(db);
  const costa = getProject("costa-norte", db)!;
  const local = searchFiles(
    { ...emptyFilters(), status: "pending_review" },
    costa.id,
    db,
  );
  assert.ok(local.length > 0);
  assert.ok(local.every((file) => file.status === "pending_review"));
  assert.ok(local.every((file) => file.projectSlug === "costa-norte"));

  assert.equal(
    searchFiles({ ...emptyFilters(), query: "Contrato" }, costa.id, db).length,
    0,
  );
  const global = searchFiles({ ...emptyFilters(), query: "Contrato", scope: "all" }, undefined, db);
  assert.ok(global.some((file) => file.id === "parque-contract"));
  assert.ok(global.some((file) => file.id === "th-resumen" && file.projectSlug === "torre-horizonte"));
  assert.ok(global.every((file) => Boolean(file.projectSlug)));
});

test("counts match files before category groups and result truncation", () => {
  const db = openDatabase(
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), "webfiling-filter-counts-")), "db.sqlite"),
  );
  seedFixtures(db);
  const costa = getProject("costa-norte", db)!;
  const revisions = searchFileCounts(
    {
      ...emptyFilters(),
      query: "Plano general",
      status: "approved",
      category: "technical",
    },
    costa.id,
    db,
  );
  assert.equal(revisions.matchingFiles, 1);
  assert.equal(revisions.categoryCounts.technical, 1);
  assert.equal(revisions.truncated, false);

  const project = getProject("torre-horizonte", db)!;
  for (let i = 0; i < 55; i++) {
    const sourcePath = `C:/count-candidates/candidate-${i}.md`;
    upsertIndexedFile(
      {
        projectId: project.id,
        sourcePath,
        filename: `Count candidate ${i}.md`,
        extension: ".md",
        sizeBytes: 1,
        modifiedAt: "2026-10-08T12:00:00.000Z",
        documentType: "technical",
      },
      db,
    );
  }
  const limited = searchFileCounts(
    { ...emptyFilters(), query: "Count candidate" },
    project.id,
    db,
  );
  assert.equal(limited.matchingFiles, 55);
  assert.equal(limited.categoryCounts.unclassified, 55);
  assert.equal(limited.truncated, true);
});

test("type, date, category, tag, and query restrictions compose before result limit", () => {
  const db = openDatabase(
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), "webfiling-filter-composition-")), "db.sqlite"),
  );
  seedFixtures(db);
  const tower = getProject("torre-del-parque", db)!;
  const matches = searchFiles(
    {
      ...emptyFilters(),
      query: "fachada",
      type: "plan",
      timeframe: "year",
      category: "technical",
      discipline: "architecture",
      location: "facade",
    },
    tower.id,
    db,
  );
  assert.deepEqual(matches.map((file) => file.id), ["torre-fachada"]);

  const project = getProject("torre-horizonte", db)!;
  const totalCandidates = 55;
  for (let i = 0; i < totalCandidates; i++) {
    const sourcePath = `C:/search-candidates/candidate-${i}.md`;
    upsertIndexedFile(
      {
        projectId: project.id,
        sourcePath,
        filename: `Candidate ${i}.md`,
        extension: ".md",
        sizeBytes: 1,
        modifiedAt: new Date(Date.parse("2026-10-08T12:00:00.000Z") - i * 60_000).toISOString(),
        documentType: "technical",
      },
      db,
    );
  }
  db.prepare(
    "UPDATE files SET category_id='technical' WHERE stable_identity='C:/search-candidates/candidate-54.md'",
  ).run();
  const query = { ...emptyFilters(), query: "Candidate" };
  const unfiltered = searchFiles(query, project.id, db);
  assert.equal(unfiltered.length, 50);
  assert.ok(!unfiltered.some((file) => file.sourcePath.endsWith("candidate-54.md")));
  const filtered = searchFiles({ ...query, category: "technical" }, project.id, db);
  assert.deepEqual(
    filtered.map((file) => file.sourcePath),
    ["C:/search-candidates/candidate-54.md"],
  );
});
