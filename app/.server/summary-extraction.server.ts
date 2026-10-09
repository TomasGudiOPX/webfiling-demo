import { createHash } from "node:crypto";
import mammoth from "mammoth";
import type { DatabaseSync } from "node:sqlite";
import type { DemoProfileId } from "../types";
import { readFileContent } from "./file-content.server";
import { openDatabase } from "./db.server";
import { canReadFile } from "./file-access.server";

const MAX_EXTRACT_BYTES = 5 * 1024 * 1024;
const MAX_EXCERPT_CHARS = 12_000;

export type ExtractedSummarySource = {
  fileId: string;
  filename: string;
  sourceFingerprint: string;
  sourceFileUpdatedAt: string;
  sourceMetadataUpdatedAt: string;
  extractionMethod: "text" | "docx" | "metadata_only";
  excerptText: string;
  truncated: boolean;
};

function excerpt(text: string) {
  const normalized = text.replace(/\u0000/g, "").replace(/[\t\r ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const bounded = normalized.slice(0, MAX_EXCERPT_CHARS);
  const sentences = bounded.split(/(?<=[.!?])\s+/u).filter(Boolean);
  const selected = sentences.slice(0, 5).join(" ").slice(0, MAX_EXCERPT_CHARS);
  return { text: selected, truncated: normalized.length > selected.length };
}

export async function extractGroundedSummarySource(profileId: DemoProfileId, fileId: string, db: DatabaseSync = openDatabase()): Promise<ExtractedSummarySource | null> {
  if (!canReadFile(profileId, fileId, db)) return null;
  const content = await readFileContent(profileId, fileId, db);
  if (!content || content.bytes.byteLength > MAX_EXTRACT_BYTES) return null;
  const row = db.prepare("SELECT f.extension,f.size_bytes,f.updated_at,m.updated_at AS metadata_updated_at,m.display_name,f.category_id,f.discipline_tag,f.location_tag,m.collection_id FROM files f JOIN library_file_metadata m ON m.file_id=f.id WHERE f.id=?")
    .get(fileId) as { extension: string; size_bytes: number; updated_at: string; metadata_updated_at: string; display_name: string; category_id: string | null; discipline_tag: string | null; location_tag: string | null; collection_id: string } | undefined;
  if (!row) return null;
  const extension = row.extension.startsWith(".") ? row.extension.toLowerCase() : `.${row.extension.toLowerCase()}`;
  let extractionMethod: ExtractedSummarySource["extractionMethod"];
  let sourceText: string;
  try {
    if (extension === ".txt" || extension === ".md" || extension === ".markdown") {
      extractionMethod = "text";
      sourceText = new TextDecoder("utf-8", { fatal: true }).decode(content.bytes);
    } else if (extension === ".docx") {
      extractionMethod = "docx";
      sourceText = (await mammoth.extractRawText({ buffer: content.bytes })).value;
    } else if ([".pdf", ".png", ".jpg", ".jpeg", ".webp"].includes(extension)) {
      extractionMethod = "metadata_only";
      sourceText = [
        `Archivo: ${row.display_name}`,
        `Formato: ${extension.slice(1).toUpperCase() || "desconocido"}`,
        `Tamaño: ${row.size_bytes} bytes`,
        row.category_id ? `Categoría: ${row.category_id}` : "",
        row.discipline_tag ? `Disciplina: ${row.discipline_tag}` : "",
        row.location_tag ? `Ubicación: ${row.location_tag}` : "",
      ].filter(Boolean).join("\n");
    } else return null;
  } catch {
    return null;
  }
  const bounded = excerpt(sourceText);
  return {
    fileId,
    filename: content.filename,
    sourceFingerprint: createHash("sha256").update(content.bytes).update(JSON.stringify(row)).digest("hex"),
    sourceFileUpdatedAt: row.updated_at,
    sourceMetadataUpdatedAt: row.metadata_updated_at,
    extractionMethod,
    excerptText: bounded.text,
    truncated: bounded.truncated || content.bytes.byteLength > MAX_EXTRACT_BYTES,
  };
}
