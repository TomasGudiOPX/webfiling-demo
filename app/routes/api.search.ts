import type { LoaderFunctionArgs } from "react-router";
import { searchFiles, seedFixtures } from "../.server/db.server";
export function loader({ request }: LoaderFunctionArgs) {
  seedFixtures();
  const url = new URL(request.url);
  return Response.json({
    query: url.searchParams.get("q") ?? "",
    results: searchFiles(
      url.searchParams.get("q") ?? "",
      url.searchParams.get("projectId") || undefined,
      url.searchParams.get("status") || undefined,
    ),
  });
}
