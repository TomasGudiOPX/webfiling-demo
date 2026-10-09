import { getConfig } from "../.server/config";
import { getHealth, openDatabase, seedFixtures } from "../.server/db.server";
export function loader() {
  const config = getConfig();
  const db = openDatabase();
  if (config.demoMode) seedFixtures(db);
  return Response.json({
    status: "ok",
    mode: config.demoMode ? "fixture" : "indexed",
    database: "sqlite",
    index: { status: getHealth(db).status },
  });
}
