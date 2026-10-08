import type { ActionFunctionArgs } from "react-router";
import { reviewFile, seedFixtures } from "../.server/db.server";

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
  const decision = body?.decision;
  const reviewer = body?.reviewer || "api-reviewer";
  if (!(["approve", "return"] as string[]).includes(decision))
    return Response.json(
      {
        error: {
          code: "malformed_payload",
          message: "decision must be approve or return.",
        },
      },
      { status: 422 },
    );
  try {
    const file = reviewFile(
      params.fileId ?? "",
      decision,
      reviewer,
      body?.reason,
    );
    if (!file)
      return Response.json(
        { error: { code: "file_not_found", message: "File was not found." } },
        { status: 404 },
      );
    return Response.json({ file });
  } catch (error) {
    return Response.json(
      {
        error: {
          code: "review_rejected",
          message:
            error instanceof Error
              ? error.message
              : "Review could not be recorded.",
        },
      },
      { status: 422 },
    );
  }
}
