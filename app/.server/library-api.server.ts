import { browserModel } from "./file-browser.server";
import {
  resolveDemoProfile,
  ProfileContextError,
} from "./profile-session.server";
import { FileInputError } from "./upload-validation.server";
import { privateHeaders } from "./file-content.server";
import { allowedProjects } from "./library-management.server";
import { openDatabase, seedFixtures } from "./db.server";
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: privateHeaders });
function failure(error: unknown) {
  if (error instanceof FileInputError || error instanceof ProfileContextError)
    return json(
      {
        error: {
          code: error.status === 404 ? "not_found" : "invalid_request",
          message:
            error.status === 404
              ? "Archivo o ubicación no disponible."
              : error.message,
        },
      },
      error.status,
    );
  throw error;
}
export async function fileApi(
  request: Request,
  fileId: string,
  activity = false,
) {
  try {
    const url = new URL(request.url);
    url.search = "";
    url.searchParams.set("selected", fileId);
    const model = await browserModel(resolveDemoProfile(request), url);
    if (!model.selected)
      throw new FileInputError("Archivo no disponible.", 404);
    return json(
      activity
        ? { events: model.activity }
        : {
            file: model.selected,
            versions: model.versions,
            latestId: model.latestId,
            related: model.related,
          },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function searchApi(request: Request) {
  try {
    const profile = resolveDemoProfile(request);
    const url = new URL(request.url);
    url.searchParams.delete("selected");
    url.searchParams.delete("evidence");
    if (url.searchParams.has("status") || url.searchParams.has("at"))
      return json(
        {
          error: {
            code: "feature_retired",
            message: "Use los filtros de archivos actuales.",
          },
        },
        410,
      );
    let slug: string | undefined;
    const id = url.searchParams.get("projectId");
    if (id) {
      const db = openDatabase();
      seedFixtures(db);
      slug = allowedProjects(profile, db).find((p) => p.id === id)?.slug;
      if (!slug) throw new FileInputError("Proyecto no disponible.", 404);
    }
    const model = await browserModel(profile, url, slug);
    if (model.invalid.length)
      return json(
        {
          error: {
            code: "invalid_filter",
            message: "Uno o más filtros no son válidos.",
          },
        },
        400,
      );
    return json({
      query: model.filters.query,
      results: model.files,
      counts: { matchingFiles: model.count },
      folders: model.folders,
    });
  } catch (error) {
    return failure(error);
  }
}
export async function projectsApi(request: Request, projectId?: string) {
  try {
    const profile = resolveDemoProfile(request);
    const db = openDatabase();
    seedFixtures(db);
    const projects = allowedProjects(profile, db);
    if (!projectId) return json({ projects });
    const project = projects.find((p) => p.id === projectId);
    if (!project) throw new FileInputError("Proyecto no disponible.", 404);
    const model = await browserModel(
      profile,
      new URL(request.url),
      project.slug,
      db,
    );
    return json({ project, files: model.files });
  } catch (error) {
    return failure(error);
  }
}
