import type { LoaderFunctionArgs } from "react-router";
import { seedFixtures } from "../.server/db.server";
import { listDecisionEvents } from "../.server/governance.server";
export function loader({ params }: LoaderFunctionArgs) {
  seedFixtures();
  return Response.json({
    events: listDecisionEvents({ fileId: params.fileId ?? "" }),
  });
}
