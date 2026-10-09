import type { LoaderFunctionArgs } from "react-router";
import { openDatabase, seedFixtures } from "../.server/db.server";
import { resolveDemoProfile } from "../.server/profile-session.server";
import { contentResponse } from "../.server/file-content.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const profile = resolveDemoProfile(request);
  const db = openDatabase();
  seedFixtures(db);
  return contentResponse(profile, params.fileId ?? "", true, db);
}
