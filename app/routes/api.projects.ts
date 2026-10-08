import { listProjects, seedFixtures } from "../.server/db.server";
export function loader() {
  seedFixtures();
  return Response.json({ projects: listProjects() });
}
