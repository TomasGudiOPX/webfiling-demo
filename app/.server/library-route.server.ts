import {
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { browserModel } from "./file-browser.server";
import {
  resolveDemoProfile,
  assertSameOrigin,
  ProfileContextError,
} from "./profile-session.server";
import { boundedFormData, FileInputError } from "./upload-validation.server";
import {
  createFolder,
  editLibraryFile,
  resetSamples,
  setTrashed,
} from "./library-management.server";
import { saveManagedUpload } from "./managed-upload.server";
import { privateHeaders } from "./file-content.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const profile = resolveDemoProfile(request);
    const url = new URL(request.url);
    if (url.searchParams.get("panel") === "rules" && profile === "system-administrator") {
      url.pathname = "/settings/calendar";
      url.searchParams.delete("panel");
      throw redirect(url.pathname + url.search, { headers: privateHeaders });
    }
    return Response.json(
      await browserModel(
        profile,
        url,
        params.projectSlug,
      ),
      { headers: privateHeaders },
    );
  } catch (error) {
    if (error instanceof FileInputError || error instanceof ProfileContextError)
      throw new Response(error.message, {
        status: error.status,
        headers: privateHeaders,
      });
    throw error;
  }
}
export async function action({ request, params }: ActionFunctionArgs) {
  try {
    const profile = resolveDemoProfile(request);
    assertSameOrigin(request);
    const form = await boundedFormData(request);
    const field = (name: string) => String(form.get(name) ?? "");
    const intent = field("intent");
    const fileId = field("fileId");
    const canAdministerFiles = profile === "administration-staff" || profile === "system-administrator";
    if (["edit", "trash", "restore"].includes(intent) && !canAdministerFiles)
      throw new FileInputError("Solo Administración o un perfil superior puede editar o eliminar archivos.", 403);
    const url = new URL(request.url);
    // Framework data requests may use /file.data; redirects must target the public route.
    url.pathname = params.projectSlug ? `/file/${encodeURIComponent(params.projectSlug)}` : "/file";
    url.searchParams.delete("_routes");
    url.searchParams.delete("_data");
    let message = "Cambios guardados.";
    if (intent === "upload") {
      const file = form.get("file");
      if (
        !(file instanceof File) ||
        [...form.values()].filter((v) => v instanceof File).length !== 1
      )
        throw new FileInputError("Seleccione un solo archivo.");
      const result = await saveManagedUpload(profile, {
        collectionId: field("collectionId"),
        file,
        folderId: field("folderId") || null,
        projectIds: form.getAll("projectId").map(String),
      });
      url.searchParams.set("selected", result.id);
      message = result.duplicateName
        ? "Archivo cargado. Ya existe otro con el mismo nombre; se conservaron ambos."
        : "Archivo cargado.";
    } else if (intent === "edit") {
      editLibraryFile(profile, fileId, {
        categoryId: field("categoryId") || null,
        discipline: field("discipline") || null,
        location: field("location") || null,
        projectIds: form.getAll("projectId").map(String),
        ...(form.has("displayName")
          ? {
              displayName: field("displayName"),
              folderId: field("folderId") || null,
            }
          : {}),
      });
    } else if (intent === "folder")
      createFolder(
        profile,
        field("collectionId"),
        field("parentId") || null,
        field("name"),
      );
    else if (intent === "trash" || intent === "restore") {
      setTrashed(profile, fileId, intent === "trash");
      url.searchParams.delete("selected");
      url.searchParams.delete("evidence");
      message =
        intent === "trash"
          ? "Archivo en la papelera. Puede restaurarlo."
          : "Archivo restaurado.";
    } else if (intent === "reset") {
      resetSamples(profile);
      url.search = "";
      url.searchParams.set("browse", "1");
      message = "Ejemplos restablecidos; sus cargas se conservaron.";
    } else
      return Response.json(
        {
          error: "Esta operación ya no forma parte de la biblioteca.",
          code: "feature_retired",
        },
        { status: 410, headers: privateHeaders },
      );
    url.searchParams.set("message", message);
    return redirect(url.pathname + url.search, {
      status: 303,
      headers: privateHeaders,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof FileInputError ||
          error instanceof ProfileContextError
            ? error.message
            : "No se pudieron guardar los cambios. Intente nuevamente.",
      },
      {
        status:
          error instanceof FileInputError ||
          error instanceof ProfileContextError
            ? error.status
            : 500,
        headers: privateHeaders,
      },
    );
  }
}
