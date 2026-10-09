import { privateHeaders } from "./file-content.server";
import { ProfileContextError } from "./profile-session.server";
import { ScheduleServiceError } from "./agent-schedules.server";
import { RuleInputError } from "./collection-rules.server";
import { AgentPlanError } from "./agent-plans.server";
import { AgentInputError } from "./agent-safety.server";

export async function boundedJson(request: Request, maxBytes = 16 * 1024): Promise<unknown> {
  const length = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(length) && length > maxBytes)
    throw new ScheduleServiceError("invalid", 400);
  if (!request.body) throw new ScheduleServiceError("invalid", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ScheduleServiceError("invalid", 400);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ScheduleServiceError("invalid", 400);
  }
}

export function scheduleErrorResponse(error: unknown): Response {
  if (error instanceof ProfileContextError)
    return Response.json(
      { error: { code: error.status === 404 ? "not_found" : "invalid_context", message: error.status === 404 ? "Programación no disponible." : error.message } },
      { status: error.status, headers: privateHeaders },
    );
  if (error instanceof ScheduleServiceError)
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status, headers: privateHeaders },
    );
  if (error instanceof RuleInputError)
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status, headers: privateHeaders },
    );
  if (error instanceof AgentPlanError)
    return Response.json(
      { error: { code: error.code, message: "No se pudo validar o aplicar el plan." } },
      { status: error.status, headers: privateHeaders },
    );
  if (error instanceof AgentInputError)
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status, headers: privateHeaders },
    );
  return Response.json(
    { error: { code: "unavailable", message: "No se pudo completar la solicitud." } },
    { status: 500, headers: privateHeaders },
  );
}
