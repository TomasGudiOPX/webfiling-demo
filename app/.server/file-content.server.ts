import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";
import { scenarioRegistry } from "../scenarios";
import type { DemoProfileId } from "../types";
import { getConfig } from "./config";
import { canReadFile } from "./file-access.server";
import { openDatabase } from "./db.server";

// Use the ZIP implementation already shipped with the installed DOCX reader.
const require = createRequire(import.meta.url);
const JSZip = createRequire(require.resolve("mammoth"))(
  "jszip",
) as typeof import("jszip");
const fixtureFiles = new Map(
  scenarioRegistry.flatMap((s) => s.files.map((f) => [f.id, f] as const)),
);
export const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
export const contentTypes: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export async function containedPath(root: string, candidate: string) {
  const actualRoot = await fs.realpath(root);
  const actual = await fs.realpath(candidate);
  const relative = path.relative(actualRoot, actual);
  if (
    !relative ||
    relative.startsWith(".." + path.sep) ||
    relative === ".." ||
    path.isAbsolute(relative)
  )
    throw new Error("Content path is outside its storage root.");
  if (!(await fs.stat(actual)).isFile())
    throw new Error("Content is not a file.");
  return actual;
}

export async function fixtureDocx(text: string): Promise<Buffer> {
  const zip = new JSZip();
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
}

export async function readFileContent(
  profile: DemoProfileId,
  fileId: string,
  db: DatabaseSync = openDatabase(),
) {
  if (!canReadFile(profile, fileId, db)) return null;
  const row = db
    .prepare(
      `SELECT f.filename,f.source_path,f.extension,m.origin,m.content_key,m.display_name
    FROM files f JOIN library_file_metadata m ON m.file_id=f.id WHERE f.id=?`,
    )
    .get(fileId) as {
    filename: string;
    source_path: string;
    extension: string;
    origin: string;
    content_key: string | null;
    display_name: string;
  };
  let bytes: Buffer;
  let extension = row.extension.startsWith(".")
    ? row.extension.toLowerCase()
    : "." + row.extension.toLowerCase();
  try {
    if (row.origin === "fixture") {
      const fixture = fixtureFiles.get(fileId);
      if (!fixture) return null;
      if (fixture.preview.url?.startsWith("/fixtures/")) {
        const root = path.resolve("private-fixtures");
        const file = await containedPath(
          root,
          path.join(root, fixture.preview.url.slice("/fixtures/".length)),
        );
        bytes = await fs.readFile(file);
        extension = path.extname(file);
      } else if (fixture.preview.content && fixture.preview.kind === "docx") {
        bytes = await fixtureDocx(fixture.preview.content);
        extension = ".docx";
      } else if (
        fixture.preview.content &&
        fixture.preview.kind === "markdown"
      ) {
        bytes = Buffer.from(fixture.preview.content);
        extension = ".md";
      } else return null;
    } else if (row.origin === "managed_upload") {
      if (!row.content_key || !/^[a-f0-9-]{36}$/.test(row.content_key))
        return null;
      const root = getConfig().managedStorageRoot;
      bytes = await fs.readFile(
        await containedPath(root, path.join(root, "objects", row.content_key)),
      );
    } else if (row.origin === "source") {
      bytes = await fs.readFile(
        await containedPath(getConfig().sourceRoot, row.source_path),
      );
    } else return null;
  } catch {
    return null;
  }
  // Only the packaged, trusted SVG fixture is rendered; SVG uploads/source previews are not enabled.
  const mime =
    row.origin === "fixture" && extension === ".svg"
      ? "image/svg+xml"
      : contentTypes[extension];
  return {
    bytes,
    filename: row.display_name,
    mime: mime ?? "application/octet-stream",
    inline: Boolean(mime),
  };
}

export async function contentResponse(
  profile: DemoProfileId,
  fileId: string,
  download: boolean,
  db = openDatabase(),
) {
  const content = await readFileContent(profile, fileId, db);
  if (!content)
    return Response.json(
      { error: { code: "not_found", message: "Archivo no disponible." } },
      { status: 404, headers: privateHeaders },
    );
  return new Response(new Uint8Array(content.bytes), {
    headers: {
      ...privateHeaders,
      "Content-Type": content.mime,
      "Content-Disposition": `${download || !content.inline ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(content.filename)}`,
      "Content-Security-Policy":
        "sandbox; default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}
