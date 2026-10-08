import type { ActionFunctionArgs } from "react-router";
import { seedFixtures } from "../.server/db.server";
import { decideReviewItem } from "../.server/governance.server";
export async function action({ params, request }: ActionFunctionArgs) {
  seedFixtures();
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
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      {
        error: {
          code: "malformed_payload",
          message: "Expected a JSON decision payload.",
        },
      },
      { status: 400 },
    );
  }
  try {
    return Response.json({
      reviewItem: decideReviewItem(
        params.reviewItemId ?? "",
        String(body.actorId),
        body.decision,
        typeof body.reason === "string" ? body.reason : undefined,
      ),
    });
  } catch (value) {
    return Response.json(
      {
        error: {
          code: "invalid_review_decision",
          message:
            value instanceof Error
              ? value.message
              : "Unable to record decision.",
        },
      },
      { status: 400 },
    );
  }
}
