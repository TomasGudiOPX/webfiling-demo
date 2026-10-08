import type { LoaderFunctionArgs } from "react-router";
import {
  getProject,
  listProjectFiles,
  seedFixtures,
} from "../.server/db.server";
export function loader({ params }: LoaderFunctionArgs) {
  seedFixtures();
  const project = getProject(params.projectId ?? "");
  if (!project)
    return Response.json(
      {
        error: { code: "project_not_found", message: "Project was not found." },
      },
      { status: 404 },
    );
  return Response.json({ project, files: listProjectFiles(project.id) });
}
