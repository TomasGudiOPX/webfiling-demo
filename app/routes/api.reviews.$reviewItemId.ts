import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { seedFixtures } from "../.server/db.server";
import {
  assignReviewItem,
  getReviewEvidence,
  updateReviewUrgency,
} from "../.server/governance.server";

const error = (value: unknown) =>
  Response.json(
    {
      error: {
        code: "invalid_review_request",
        message:
          value instanceof Error
            ? value.message
            : "Unable to update review item.",
      },
    },
    { status: 400 },
  );
export function loader({ params }: LoaderFunctionArgs) {
  seedFixtures();
  const evidence = getReviewEvidence(params.reviewItemId ?? "");
  return evidence
    ? Response.json({ evidence })
    : Response.json(
        { error: { code: "not_found", message: "Review item was not found." } },
        { status: 404 },
      );
}
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
          message: "Expected a JSON review payload.",
        },
      },
      { status: 400 },
    );
  }
  try {
    const id = params.reviewItemId ?? "";
    if (body.intent === "assign")
      return Response.json({
        reviewItem: assignReviewItem(
          id,
          String(body.actorId),
          String(body.assigneeId),
          body.assigneeRole,
        ),
      });
    if (body.intent === "urgency")
      return Response.json({
        reviewItem: updateReviewUrgency(id, String(body.actorId), {
          severity: body.severity,
          priority: body.priority,
          dueAt: body.dueAt,
        }),
      });
    return Response.json(
      {
        error: {
          code: "unsupported_operation",
          message: "Unsupported review mutation.",
        },
      },
      { status: 405 },
    );
  } catch (value) {
    return error(value);
  }
}
