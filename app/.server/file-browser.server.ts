import { createHash } from "node:crypto";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { getPublicFile, openDatabase, seedFixtures } from "./db.server";
import { getConfig } from "./config";
import { collectionCapabilities, fileCapabilities } from "./file-access.server";
import { allowedProjects } from "./library-management.server";
import { FileInputError } from "./upload-validation.server";
import { seedLibrarySamples } from "./library-samples.server";
import { containedPath, contentTypes } from "./file-content.server";
import { parseSearchFilters } from "../search-filters";
import { groupDocumentRevisions } from "../document-navigation";
import type { DemoProfileId, PublicFile, RelationFixture } from "../types";

export interface BrowserFolder {
  id: string;
  parentId: string | null;
  collectionId: string;
  name: string;
  location: string;
  kind: "source" | "managed" | "fixture";
  count: number;
}
export interface BrowserFile extends PublicFile {
  collectionId: string;
  collectionName: string;
  folderId: string;
  location: string;
  capabilities: NonNullable<ReturnType<typeof fileCapabilities>>;
  contributorId: string | null;
  trashedAt: string | null;
}
type FileRow = {
  id: string;
  collection_id: string;
  name: string;
  origin: PublicFile["origin"];
  source_path: string;
  content_key: string | null;
  managed_folder_id: string | null;
  metadata_text: string;
  contributor_id: string | null;
  trashed_at: string | null;
};
const opaque = (value: string) =>
  createHash("sha256").update(value).digest("hex").slice(0, 24);

function folderModel(
  rows: FileRow[],
  db: DatabaseSync,
  permitted: Set<string>,
) {
  const folders = new Map<string, BrowserFolder>();
  const fileFolders = new Map<string, string>();
  const add = (folder: Omit<BrowserFolder, "count">) => {
    if (!folders.has(folder.id))
      folders.set(folder.id, { ...folder, count: 0 });
    return folder.id;
  };
  for (const row of rows) {
    const kind =
      row.origin === "managed_upload"
        ? "managed"
        : row.origin === "fixture"
          ? "fixture"
          : "source";
    const rootId = `${kind}:${opaque(row.collection_id + getConfig().sourceRoot)}`;
    const label =
      kind === "managed"
        ? "Archivos cargados"
        : kind === "fixture"
          ? "Ejemplos"
          : "Servidor (solo lectura)";
    let parentId = add({
      id: rootId,
      parentId: null,
      collectionId: row.collection_id,
      name: label,
      location: label,
      kind,
    });
    if (kind !== "managed") {
      // Real source paths are relative to the configured root; fixture location is its private collection.
      const relative =
        kind === "source"
          ? path.relative(getConfig().sourceRoot, row.source_path)
          : "";
      if (
        relative === ".." ||
        relative.startsWith(".." + path.sep) ||
        path.isAbsolute(relative)
      ) {
        fileFolders.set(row.id, rootId);
        continue;
      }
      const directory = relative ? path.dirname(relative) : ".";
      let location = "";
      for (const part of directory === "." ? [] : directory.split(path.sep)) {
        location = location ? location + "/" + part : part;
        const key =
          process.platform === "win32" ? location.toLowerCase() : location;
        parentId = add({
          id: `source:${opaque(row.collection_id + getConfig().sourceRoot + key)}`,
          parentId,
          collectionId: row.collection_id,
          name: part,
          location: label + " / " + location,
          kind,
        });
      }
    }
    fileFolders.set(
      row.id,
      row.managed_folder_id ? "managed:" + row.managed_folder_id : parentId,
    );
  }
  const managed = db
    .prepare(
      "SELECT id,collection_id,parent_id,display_name FROM managed_folders",
    )
    .all() as Array<{
    id: string;
    collection_id: string;
    parent_id: string | null;
    display_name: string;
  }>;
  for (const row of managed.filter((m) => permitted.has(m.collection_id))) {
    const rootId = `managed:${opaque(row.collection_id + getConfig().sourceRoot)}`;
    add({
      id: rootId,
      parentId: null,
      collectionId: row.collection_id,
      name: "Archivos cargados",
      location: "Archivos cargados",
      kind: "managed",
    });
    add({
      id: "managed:" + row.id,
      parentId: row.parent_id ? "managed:" + row.parent_id : rootId,
      collectionId: row.collection_id,
      name: row.display_name,
      location: row.display_name,
      kind: "managed",
    });
  }
  for (const folder of folders.values())
    if (folder.kind === "managed" && folder.parentId) {
      const names = [folder.name];
      const seen = new Set([folder.id]);
      let parent = folders.get(folder.parentId);
      while (parent && !seen.has(parent.id)) {
        names.unshift(parent.name);
        seen.add(parent.id);
        parent = parent.parentId ? folders.get(parent.parentId) : undefined;
      }
      folder.location = names.join(" / ");
    }
  return { folders, fileFolders };
}
function descends(
  folder: string,
  ancestor: string,
  folders: Map<string, BrowserFolder>,
) {
  const seen = new Set<string>();
  let current: string | null = folder;
  while (current && !seen.has(current)) {
    if (current === ancestor) return true;
    seen.add(current);
    current = folders.get(current)?.parentId ?? null;
  }
  return false;
}

export async function browserModel(
  profile: DemoProfileId,
  url: URL,
  projectSlug?: string,
  db = openDatabase(),
) {
  seedFixtures(db);
  await seedLibrarySamples(db);
  const projects = allowedProjects(profile, db);
  const project = projectSlug
    ? projects.find((p) => p.slug === projectSlug)
    : undefined;
  if (projectSlug && !project)
    throw new FileInputError("Proyecto no disponible.", 404);
  const collections = (
    db
      .prepare(
        "SELECT c.id,c.name,c.kind,c.project_id AS projectId FROM collections c JOIN collection_grants g ON g.collection_id=c.id WHERE g.profile_id=? AND g.can_read=1 ORDER BY c.name",
      )
      .all(profile) as Array<{
      id: string;
      name: string;
      kind: string;
      projectId: string | null;
    }>
  ).map((c) => ({
    ...c,
    capabilities: collectionCapabilities(profile, c.id, db),
    ...(profile === "system-administrator" ? { authorizedRecipients: db.prepare(
      "SELECT p.id,p.display_name AS name FROM collection_grants g JOIN demo_profiles p ON p.id=g.profile_id WHERE g.collection_id=? AND g.can_contribute=1 AND p.is_system_administrator=0 ORDER BY p.display_name",
    ).all(c.id) as Array<{ id: string; name: string }> } : {}),
  }));
  const params = url.searchParams;
  const { filters, invalid } = parseSearchFilters(params);
  filters.status = "";
  const all =
    !project &&
    (params.get("searchScope") === "all" || filters.scope === "all");
  const collectionId = all ? "" : (params.get("collection") ?? "");
  if (collectionId && !collections.some((c) => c.id === collectionId))
    throw new FileInputError("Colección no disponible.", 404);
  const trash = params.get("trash") === "1";
  const rows = db
    .prepare(
      `SELECT f.id,f.source_path,f.metadata_text,m.collection_id,c.name,m.origin,m.content_key,m.managed_folder_id,m.contributor_id,m.trashed_at
    FROM files f JOIN library_file_metadata m ON m.file_id=f.id JOIN collections c ON c.id=m.collection_id
    JOIN collection_grants g ON g.collection_id=c.id WHERE g.profile_id=? AND g.can_read=1`,
    )
    .all(profile) as FileRow[];
  const { folders, fileFolders } = folderModel(
    rows.filter(
      (r) =>
        !r.trashed_at ||
        (trash && fileCapabilities(profile, r.id, db)?.canEdit),
    ),
    db,
    new Set(collections.map((c) => c.id)),
  );
  // Include empty managed folders only in collections the current profile may read.
  const allowedCollections = new Set(collections.map((c) => c.id));
  const emptyFolders = db
    .prepare(
      "SELECT id,collection_id,parent_id,display_name FROM managed_folders",
    )
    .all() as Array<{
    id: string;
    collection_id: string;
    parent_id: string | null;
    display_name: string;
  }>;
  for (const f of emptyFolders.filter((f) =>
    allowedCollections.has(f.collection_id),
  ))
    if (!folders.has("managed:" + f.id))
      folders.set("managed:" + f.id, {
        id: "managed:" + f.id,
        parentId: f.parent_id ? "managed:" + f.parent_id : null,
        collectionId: f.collection_id,
        name: f.display_name,
        location: f.display_name,
        kind: "managed",
        count: 0,
      });
  const folderId = all ? "" : (params.get("folder") ?? "");
  const folder = folderId ? folders.get(folderId) : undefined;
  if (
    folderId &&
    (!folder ||
      (collectionId && folder.collectionId !== collectionId) ||
      (project &&
        !all &&
        !collections.some(
          (c) => c.id === folder.collectionId && c.projectId === project.id,
        ) &&
        !rows.some(
          (r) =>
            r.collection_id === folder.collectionId &&
            db
              .prepare(
                "SELECT 1 FROM file_projects WHERE file_id=? AND project_id=?",
              )
              .get(r.id, project.id),
        )))
  )
    throw new FileInputError("Carpeta no disponible.", 404);
  const projectIds = new Set(projects.map((p) => p.id));
  const readableIds = new Set(
    rows.filter((r) => !r.trashed_at).map((r) => r.id),
  );
  const publicFiles: BrowserFile[] = [];
  for (const row of rows) {
    const caps = fileCapabilities(profile, row.id, db)!;
    if (
      trash
        ? !row.trashed_at || !caps.canEdit || row.origin !== "managed_upload"
        : Boolean(row.trashed_at)
    )
      continue;
    const f = getPublicFile(row.id, db)!;
    const projects = f.projects.filter((p) => projectIds.has(p.projectId));
    f.projects = projects;
    if (f.primaryProjectId && !projectIds.has(f.primaryProjectId))
      f.primaryProjectId = null;
    f.versions = {
      supersedes: f.versions.supersedes.filter((id) => readableIds.has(id)),
      supersededBy: f.versions.supersededBy.filter((id) => readableIds.has(id)),
    };
    // No static URL, inline file content, or legacy workflow metadata in public DTOs.
    if (row.origin === "source" && !contentTypes[f.extension.toLowerCase()])
      f.preview = { kind: "unavailable", title: f.displayName };
    if (f.preview)
      f.preview = {
        kind: f.preview.kind,
        title: f.displayName,
        url: `/api/files/${encodeURIComponent(f.id)}/preview`,
        ...(f.preview.kind === "unavailable"
          ? { reason: "Este formato no dispone de vista previa." }
          : {}),
      };
    if (row.origin === "managed_upload" || row.origin === "source") {
      try {
        const root =
          row.origin === "source"
            ? getConfig().sourceRoot
            : getConfig().managedStorageRoot;
        const candidate =
          row.origin === "source"
            ? row.source_path
            : path.join(root, "objects", row.content_key ?? "invalid");
        await containedPath(root, candidate);
      } catch {
        f.availability = "unavailable";
        f.preview = {
          kind: "unavailable",
          title: f.displayName,
          reason: "El contenido no está disponible.",
        };
      }
    }
    const location = folders.get(fileFolders.get(row.id) ?? "")?.location ?? "";
    publicFiles.push({
      ...f,
      collectionId: row.collection_id,
      collectionName: row.name,
      folderId: fileFolders.get(row.id) ?? "",
      location,
      capabilities: caps,
      contributorId: row.contributor_id,
      trashedAt: row.trashed_at,
    });
  }
  const q = filters.query.toLocaleLowerCase("es");
  const hasSearch = Boolean(
    q ||
      filters.category ||
      filters.discipline ||
      filters.location ||
      filters.type ||
      filters.timeframe,
  );
  const days = filters.timeframe
    ? { "7d": 7, "30d": 30, "90d": 90, year: 365 }[filters.timeframe]
    : undefined;
  const matching = publicFiles
    .filter((f) => {
      if (collectionId && f.collectionId !== collectionId) return false;
      if (
        project &&
        !all &&
        !f.projects.some((p) => p.projectId === project.id)
      )
        return false;
      if (
        folderId &&
        !(hasSearch
          ? descends(f.folderId, folderId, folders)
          : f.folderId === folderId)
      )
        return false;
      if (
        filters.category &&
        (filters.category === "unclassified"
          ? f.organization.categoryId !== null
          : f.organization.categoryId !== filters.category)
      )
        return false;
      if (
        filters.discipline &&
        f.organization.tags.discipline !== filters.discipline
      )
        return false;
      if (filters.location && f.organization.tags.location !== filters.location)
        return false;
      if (filters.type && f.documentType !== filters.type) return false;
      if (
        days &&
        new Date(f.modifiedAt).getTime() < Date.now() - days * 86400000
      )
        return false;
      const row = rows.find((r) => r.id === f.id)!;
      return (
        !q ||
        `${f.filename} ${f.displayName} ${row.metadata_text} ${f.location}`
          .toLocaleLowerCase("es")
          .includes(q)
      );
    })
    .sort((a, b) =>
      filters.sort === "name"
        ? a.displayName.localeCompare(b.displayName, "es")
        : (filters.sort === "oldest" ? 1 : -1) *
          a.modifiedAt.localeCompare(b.modifiedAt),
    );
  for (const f of matching)
    for (const folder of folders.values())
      if (descends(f.folderId, folder.id, folders)) folder.count++;
  const selectedId = params.get("selected") || params.get("evidence") || "";
  const selected = selectedId
    ? publicFiles.find((f) => f.id === selectedId)
    : null;
  if (selectedId && !selected)
    throw new FileInputError("Archivo no disponible.", 404);
  const edges = db
    .prepare(
      "SELECT from_file_id AS 'from',to_file_id AS 'to',relation AS type FROM file_relations",
    )
    .all() as unknown as RelationFixture[];
  const graphFiles = project
    ? publicFiles.filter((file) =>
        file.projects.some((p) => p.projectId === project.id),
      )
    : matching;
  const graphFileIds = new Set(graphFiles.map((file) => file.id));
  const revisionFiles = publicFiles.map((f) => ({
    id: f.id,
    filename: f.displayName,
    projectId: f.collectionId,
    status: "pending_review" as const,
  }));
  const group = selected
    ? groupDocumentRevisions(revisionFiles, edges).find((g) =>
        g.files.some((f) => f.id === selected.id),
      )
    : null;
  const visible = new Map(publicFiles.map((f) => [f.id, f]));
  const related = selected
    ? edges
        .filter(
          (e) =>
            e.type !== "supersedes" &&
            (e.from === selected.id || e.to === selected.id),
        )
        .flatMap((e) => {
          const f = visible.get(e.from === selected.id ? e.to : e.from);
          return f
            ? [
                {
                  id: f.id,
                  name: f.displayName,
                  label:
                    e.type === "awaiting confirmation"
                      ? "Vínculo sugerido"
                      : "Relacionado",
                },
              ]
            : [];
        })
    : [];
  const activity = selected
    ? (db
        .prepare(
          "SELECT id,event_type AS eventType,actor_id AS actorId,occurred_at AS occurredAt FROM file_events WHERE file_id=? ORDER BY occurred_at DESC,id DESC",
        )
        .all(selected.id) as Array<{
        id: string;
        eventType: string;
        actorId: string;
        occurredAt: string;
      }>)
    : [];
  const view = ["list", "grid", "folders"].includes(params.get("view") ?? "")
    ? params.get("view")!
    : "list";
  return {
    profile,
    projects,
    project: all ? null : (project ?? null),
    collections,
    collectionId,
    folderId,
    folder: folder ?? null,
    filters,
    invalid,
    view,
    trash,
    all,
    retired: params.has("status") || params.has("at") || params.has("retired"),
    files: matching,
    graph: {
      nodes: graphFiles.map((file) => ({
        id: file.id,
        kind: "file" as const,
        label: file.displayName,
        status: file.availability,
        categoryId: file.organization.categoryId,
        disciplineTag: file.organization.tags.discipline,
        locationTag: file.organization.tags.location,
      })),
      edges: edges.filter(
        (edge) => graphFileIds.has(edge.from) && graphFileIds.has(edge.to),
      ),
    },
    count: matching.length,
    selected: selected ?? null,
    folders: [...folders.values()].filter(
      (f) =>
        (!collectionId || f.collectionId === collectionId) &&
        (!project ||
          all ||
          rows.some(
            (r) =>
              r.collection_id === f.collectionId &&
              publicFiles
                .find((p) => p.id === r.id)
                ?.projects.some((p) => p.projectId === project.id),
          )),
    ),
    versions: group?.files.map((f) => ({ id: f.id, name: f.filename })) ?? [],
    latestId: group?.current?.id ?? null,
    related,
    activity,
  };
}
