import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { seedFixtures } from "../.server/db.server";
import { listReviewItems as listGovernedItems } from "../.server/governance.server";

export function loader({ request }: LoaderFunctionArgs) {
  seedFixtures();
  const url = new URL(request.url);
  return Response.json({
    reviewItems: listGovernedItems({
      view: url.searchParams.get("view") ?? undefined,
      assigneeId: url.searchParams.get("assignee") ?? undefined,
    }),
  });
}
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST")
    return Response.json(
      {
        error: {
          code: "unsupported_operation",
          message: "Only POST is supported.",
        },
      },
      { status: 405 },
    );
  return Response.json(
    {
      error: {
        code: "unsupported_operation",
        message: "Use a review-item endpoint for mutations.",
      },
    },
    { status: 405 },
  );
}
