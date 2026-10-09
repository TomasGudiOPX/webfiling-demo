import type { RelationFixture, DocumentFile } from "./types";
import type { SearchFilters } from "./search-filters";
import { workspaceUrl } from "./search-filters";

export type RevisionFile = Pick<
  DocumentFile,
  "id" | "projectId" | "filename" | "status"
>;

export interface RevisionGroup {
  id: string;
  files: RevisionFile[];
  current: RevisionFile | null;
  ambiguous: boolean;
  reasons: string[];
}

export interface MatchingRevisionGroup<T extends RevisionFile> {
  group: RevisionGroup;
  matchingFiles: T[];
  representative: T;
  contextCurrent: RevisionFile | null;
}

export function relatedDocumentUrl(
  target: { id: string; projectId: string; projectSlug: string } | null,
  selectedProjectId: string,
  filters: SearchFilters,
): string | null {
  if (!target) return null;
  if (target.projectId === selectedProjectId)
    return workspaceUrl(target.projectSlug, filters, target.id);
  return `/file/${encodeURIComponent(target.projectSlug)}?selected=${encodeURIComponent(target.id)}`;
}

export function matchRevisionGroups<T extends RevisionFile>(
  groups: readonly RevisionGroup[],
  matchingFiles: readonly T[],
  selectedId?: string,
): MatchingRevisionGroup<T>[] {
  const matchingById = new Map(matchingFiles.map((file) => [file.id, file]));
  return groups.flatMap((group) => {
    const matches = group.files
      .map((file) => matchingById.get(file.id))
      .filter((file): file is T => Boolean(file));
    if (!matches.length) return [];
    const representative =
      matches.find((file) => file.id === selectedId) ??
      matches.find((file) => file.id === group.current?.id) ??
      matches[0];
    return [{
      group,
      matchingFiles: matches,
      representative,
      contextCurrent:
        group.current && !matchingById.has(group.current.id)
          ? group.current
          : null,
    }];
  });
}

export function supersessionPredecessors(
  selectedId: string,
  files: readonly RevisionFile[],
  relations: readonly RelationFixture[],
): RevisionFile[] {
  const byId = new Map(files.map((file) => [file.id, file]));
  const selected = byId.get(selectedId);
  if (!selected) return [];
  const predecessors = new Map<string, RevisionFile>();
  for (const relation of relations) {
    if (relation.type !== "supersedes" || relation.from !== selectedId) continue;
    const predecessor = byId.get(relation.to);
    if (predecessor?.projectId === selected.projectId)
      predecessors.set(predecessor.id, predecessor);
  }
  return [...predecessors.values()].sort((a, b) => a.filename.localeCompare(b.filename, "es"));
}

export function groupDocumentRevisions(
  files: readonly RevisionFile[],
  relations: readonly RelationFixture[],
): RevisionGroup[] {
  const byId = new Map(files.map((file) => [file.id, file]));
  const neighbors = new Map(files.map((file) => [file.id, new Set<string>()]));
  const outgoing = new Map(files.map((file) => [file.id, new Set<string>()]));
  const incomingCount = new Map(files.map((file) => [file.id, 0]));
  const reasons = new Map(files.map((file) => [file.id, new Set<string>()]));

  for (const relation of relations) {
    if (relation.type !== "supersedes") continue;
    const newer = byId.get(relation.from);
    const older = byId.get(relation.to);
    if (!newer || !older) {
      if (newer) reasons.get(newer.id)?.add("missing-endpoint");
      if (older) reasons.get(older.id)?.add("missing-endpoint");
      continue;
    }
    if (newer.projectId !== older.projectId) {
      reasons.get(newer.id)?.add("cross-project-edge");
      reasons.get(older.id)?.add("cross-project-edge");
      continue;
    }
    neighbors.get(newer.id)?.add(older.id);
    neighbors.get(older.id)?.add(newer.id);
    outgoing.get(newer.id)?.add(older.id);
    incomingCount.set(older.id, (incomingCount.get(older.id) ?? 0) + 1);
  }

  const visited = new Set<string>();
  const groups: RevisionGroup[] = [];
  for (const file of files) {
    if (visited.has(file.id)) continue;
    const ids: string[] = [];
    const pending = [file.id];
    visited.add(file.id);
    while (pending.length) {
      const id = pending.pop()!;
      ids.push(id);
      for (const neighbor of neighbors.get(id) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        pending.push(neighbor);
      }
    }
    const members = ids.map((id) => byId.get(id)!).sort((a, b) => a.id.localeCompare(b.id));
    const memberIds = new Set(ids);
    const groupReasons = new Set(ids.flatMap((id) => [...(reasons.get(id) ?? [])]));
    const outgoingEdges = ids.flatMap((id) =>
      [...(outgoing.get(id) ?? [])].filter((target) => memberIds.has(target)).map((target) => [id, target] as const),
    );
    if (ids.some((id) => (outgoing.get(id)?.size ?? 0) > 1) || ids.some((id) => (incomingCount.get(id) ?? 0) > 1))
      groupReasons.add("branching-lineage");
    if (containsCycle(ids, outgoing)) groupReasons.add("cyclic-lineage");

    const candidates = members.filter((member) => (incomingCount.get(member.id) ?? 0) === 0);
    let current: RevisionFile | null = null;
    if (members.length > 1 || outgoingEdges.length > 0) {
      if (candidates.length === 1 && groupReasons.size === 0)
        current = candidates[0];
      else if (groupReasons.size === 0)
        groupReasons.add("no-unique-terminal");
    }

    groups.push({
      id: members.map((member) => member.id).join("|"),
      files: members,
      current,
      ambiguous: groupReasons.size > 0,
      reasons: [...groupReasons].sort(),
    });
  }
  return groups;
}

function containsCycle(
  ids: readonly string[],
  outgoing: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (id: string): boolean => {
    if (active.has(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    active.add(id);
    for (const target of outgoing.get(id) ?? [])
      if (visit(target)) return true;
    active.delete(id);
    return false;
  };
  return ids.some((id) => visit(id));
}
