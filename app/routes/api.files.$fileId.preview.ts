import fs from "node:fs/promises";
import path from "node:path";
import type { LoaderFunctionArgs } from "react-router";
import { assertAllowedSourceRoot, getConfig } from "../.server/config";
import { getFile, seedFixtures } from "../.server/db.server";

const contentTypes: Record<string, string> = {
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

export async function loader({ params }: LoaderFunctionArgs) {
  seedFixtures();
  const file = getFile(params.fileId ?? "");
  if (!file)
    return Response.json(
      { error: { code: "not_found", message: "File was not found." } },
      { status: 404 },
    );
  try {
    const sourcePath = assertAllowedSourceRoot(
      file.sourcePath,
      getConfig().sourceRoot,
    );
    const body = await fs.readFile(sourcePath);
    const bytes = new Uint8Array(body.length);
    bytes.set(body);
    return new Response(bytes, {
      headers: {
        "Content-Type":
          contentTypes[path.extname(sourcePath).toLowerCase()] ??
          "application/octet-stream",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return Response.json(
      {
        error: {
          code: "preview_unavailable",
          message: "The protected source file is not available for preview.",
        },
      },
      { status: 404 },
    );
  }
}
