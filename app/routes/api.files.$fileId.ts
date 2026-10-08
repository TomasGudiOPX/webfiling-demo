import type { LoaderFunctionArgs } from "react-router";
import { getFile, seedFixtures } from "../.server/db.server";
export function loader({ params }: LoaderFunctionArgs) {
  seedFixtures();
  const file = getFile(params.fileId ?? "");
  if (!file)
    return Response.json(
      { error: { code: "file_not_found", message: "File was not found." } },
      { status: 404 },
    );
  return Response.json({ file });
}
