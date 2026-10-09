import assert from "node:assert/strict";
import test from "node:test";
import {
  groupDocumentRevisions,
  matchRevisionGroups,
  relatedDocumentUrl,
  supersessionPredecessors,
  type RevisionFile,
} from "../app/document-navigation";
import type { RelationFixture } from "../app/types";

const file = (
  id: string,
  status: RevisionFile["status"] = "superseded",
  projectId = "project-a",
  filename = `${id}.pdf`,
): RevisionFile => ({ id, status, projectId, filename });
const supersedes = (from: string, to: string): RelationFixture => ({
  from,
  to,
  type: "supersedes",
});

test("revision groups follow a linear supersession chain and keep singletons", () => {
  const groups = groupDocumentRevisions(
    [file("rev-a"), file("rev-b"), file("rev-c", "approved"), file("standalone", "approved")],
    [supersedes("rev-c", "rev-b"), supersedes("rev-b", "rev-a")],
  );
  const lineage = groups.find((group) => group.files.length === 3)!;
  assert.deepEqual(lineage.files.map((item) => item.id), ["rev-a", "rev-b", "rev-c"]);
  assert.equal(lineage.current?.id, "rev-c");
  assert.equal(lineage.ambiguous, false);
  assert.equal(groups.find((group) => group.files[0].id === "standalone")?.files.length, 1);
});

test("generic, uncertain and duplicate-looking files never form revision groups", () => {
  const groups = groupDocumentRevisions(
    [file("duplicate-a", "pending_review", "project-a", "Plano Rev A.pdf"), file("duplicate-b", "pending_review", "project-a", "Plano Rev A copia.pdf"), file("uncertain")],
    [
      { from: "duplicate-a", to: "duplicate-b", type: "related to" },
      { from: "duplicate-b", to: "uncertain", type: "awaiting confirmation" },
    ],
  );
  assert.equal(groups.length, 3);
  assert.ok(groups.every((group) => group.files.length === 1 && !group.ambiguous));
});

test("cycles, missing endpoints, cross-project edges and branches stay visible and ambiguous", () => {
  const groups = groupDocumentRevisions(
    [
      file("cycle-a"), file("cycle-b"), file("missing-a"),
      file("foreign-a", "approved", "project-a"), file("foreign-b", "approved", "project-b"),
      file("branch-new-a", "approved"), file("branch-new-b", "approved"), file("branch-old"),
    ],
    [
      supersedes("cycle-a", "cycle-b"), supersedes("cycle-b", "cycle-a"),
      supersedes("missing-a", "missing-target"), supersedes("foreign-a", "foreign-b"),
      supersedes("branch-new-a", "branch-old"), supersedes("branch-new-b", "branch-old"),
    ],
  );
  const byId = new Map(groups.flatMap((group) => group.files.map((item) => [item.id, group])));
  for (const id of ["cycle-a", "cycle-b", "missing-a", "foreign-a", "foreign-b", "branch-old", "branch-new-a", "branch-new-b"]) {
    assert.equal(byId.get(id)?.ambiguous, true, id);
    assert.equal(byId.get(id)?.current, null, id);
  }
  assert.ok(byId.get("cycle-a")?.reasons.includes("cyclic-lineage"));
  assert.ok(byId.get("missing-a")?.reasons.includes("missing-endpoint"));
  assert.ok(byId.get("foreign-b")?.reasons.includes("cross-project-edge"));
  assert.ok(byId.get("branch-old")?.reasons.includes("branching-lineage"));
  assert.notEqual(byId.get("foreign-a"), byId.get("foreign-b"));
});

test("a unique terminal revision is current without an approval", () => {
  const [group] = groupDocumentRevisions(
    [file("new", "pending_review"), file("old", "approved")],
    [supersedes("new", "old")],
  );
  assert.equal(group.current?.id, "new");
  assert.equal(group.ambiguous, false);
  assert.deepEqual(group.reasons, []);
});

test("filtering keeps only matching revisions selectable and counts groups separately", () => {
  const allFiles = [
    file("rev-b", "superseded", "project-a", "Plano Rev B.pdf"),
    file("rev-c", "approved", "project-a", "Plano Rev C.pdf"),
  ];
  const groups = groupDocumentRevisions(allFiles, [supersedes("rev-c", "rev-b")]);
  const oldRevision = { ...allFiles[0], projectName: "Costa Norte", projectSlug: "costa-norte" };
  const filtered = matchRevisionGroups(groups, [oldRevision]);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].matchingFiles.length, 1);
  assert.equal(filtered[0].representative.id, "rev-b");
  assert.equal(filtered[0].contextCurrent?.id, "rev-c");
  const direct = matchRevisionGroups(groups, [oldRevision], "rev-b");
  assert.equal(direct[0].representative.id, "rev-b");
});

test("comparison predecessors come only from the selected file's outgoing edges", () => {
  const files = [
    file("selected", "approved"),
    file("actual-old", "superseded"),
    file("unrelated-old", "superseded"),
    file("second-old", "superseded"),
    file("foreign-old", "superseded", "project-b"),
  ];
  const relations = [
    supersedes("selected", "actual-old"),
    supersedes("selected", "missing-old"),
    supersedes("selected", "foreign-old"),
    supersedes("other-current", "unrelated-old"),
    supersedes("selected", "second-old"),
  ];
  assert.deepEqual(
    supersessionPredecessors("selected", files, relations).map((item) => item.id),
    ["actual-old", "second-old"],
  );
});

test("relation links preserve same-project filters and switch projects without stale context", () => {
  const filters = {
    query: "plano", scope: "all" as const, status: "superseded" as const,
    type: "plan" as const, timeframe: "30d" as const, sort: "oldest" as const,
    category: "technical" as const, discipline: "structures" as const,
    location: "tower-a" as const,
  };
  assert.match(
    relatedDocumentUrl({ id: "old", projectId: "project-a", projectSlug: "costa-norte" }, "project-a", filters) ?? "",
    /q=plano.*scope=all.*status=superseded.*selected=old/,
  );
  assert.equal(
    relatedDocumentUrl({ id: "foreign", projectId: "project-b", projectSlug: "parque-industrial" }, "project-a", filters),
    "/file/parque-industrial?selected=foreign",
  );
  assert.equal(relatedDocumentUrl(null, "project-a", filters), null);
});
