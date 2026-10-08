import type { LoaderFunctionArgs } from "react-router";
import { seedFixtures } from "../.server/db.server";
import { reconstructAsOf } from "../.server/reconstruction.server";

export function loader({ params, request }: LoaderFunctionArgs) {
  seedFixtures();
  const url = new URL(request.url);
  const at = url.searchParams.get("at") ?? "";
  const result = reconstructAsOf(params.projectId ?? "", at);
  if (result.error) {
    const status = result.error.code === "project_not_found" ? 404 : 400;
    return Response.json({ error: result.error }, { status });
  }
  return Response.json(result.snapshot);
}
