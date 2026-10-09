import path from "node:path";
import { inflateRawSync } from "node:zlib";
import mammoth from "mammoth";

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 21 * 1024 * 1024;
export class FileInputError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export function safeDisplayName(input: string): string {
  const value = input.normalize("NFC").trim();
  if (
    !value ||
    value.length > 200 ||
    /[\x00-\x1f\x7f/\\:<>"|?*]/.test(value) ||
    /^\.+$/.test(value) ||
    /[. ]$/.test(value)
  )
    throw new FileInputError(
      "Nombre inválido: use hasta 200 caracteres, sin rutas ni caracteres de control.",
    );
  return value;
}

export async function boundedFormData(request: Request): Promise<FormData> {
  const length = request.headers.get("Content-Length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_REQUEST_BYTES))
    throw new FileInputError("La solicitud supera el límite de 21 MiB.", 413);
  if (!request.headers.get("Content-Type")?.startsWith("multipart/form-data;"))
    throw new FileInputError("Se requiere un archivo en formato multipart.");
  const reader = request.body?.getReader();
  if (!reader) throw new FileInputError("Seleccione un archivo.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new FileInputError(
          "La solicitud supera el límite de 21 MiB.",
          413,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return await new Response(new Blob(chunks as BlobPart[]), {
      headers: { "Content-Type": request.headers.get("Content-Type")! },
    }).formData();
  } catch {
    throw new FileInputError("No se pudo leer la carga multipart.");
  }
}

function validateZip(bytes: Buffer) {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (
      bytes.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + bytes.readUInt16LE(i + 20) === bytes.length
    ) {
      end = i;
      break;
    }
  if (end < 0) throw new Error("ZIP inválido");
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  const centralEnd = offset + bytes.readUInt32LE(end + 12);
  if (
    count > 256 ||
    !count ||
    centralEnd !== end ||
    bytes.readUInt32LE(end + 4) !== 0 ||
    bytes.readUInt16LE(end + 8) !== count
  )
    throw new Error("ZIP no compatible");
  let expanded = 0;
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw new Error("ZIP inválido");
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const compressed = bytes.readUInt32LE(offset + 20);
    const size = bytes.readUInt32LE(offset + 24);
    const nameSize = bytes.readUInt16LE(offset + 28);
    const name = bytes
      .subarray(offset + 46, offset + 46 + nameSize)
      .toString("utf8");
    const local = bytes.readUInt32LE(offset + 42);
    expanded += size;
    if (
      expanded > MAX_FILE_BYTES ||
      flags & 1 ||
      ![0, 8].includes(method) ||
      names.has(name) ||
      !name ||
      /(^\/|\\|(^|\/)\.\.($|\/)|vbaProject|\.bin$)/i.test(name)
    )
      throw new Error("DOCX no compatible");
    names.add(name);
    if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50)
      throw new Error("ZIP inválido");
    const start =
      local +
      30 +
      bytes.readUInt16LE(local + 26) +
      bytes.readUInt16LE(local + 28);
    if (start + compressed > bytes.readUInt32LE(end + 16))
      throw new Error("ZIP inválido");
    const data = bytes.subarray(start, start + compressed);
    const decoded =
      method === 0
        ? data
        : inflateRawSync(data, {
            maxOutputLength: Math.max(1, Math.min(size, MAX_FILE_BYTES)),
          });
    if (decoded.length !== size) throw new Error("ZIP inválido");
    if (
      /\.xml$|\.rels$/i.test(name) &&
      /<!DOCTYPE|<!ENTITY|TargetMode\s*=\s*["']External/i.test(
        decoded.toString("utf8"),
      )
    )
      throw new Error("DOCX con contenido externo no compatible");
    offset +=
      46 +
      nameSize +
      bytes.readUInt16LE(offset + 30) +
      bytes.readUInt16LE(offset + 32);
  }
  if (
    offset !== centralEnd ||
    !names.has("[Content_Types].xml") ||
    !names.has("word/document.xml")
  )
    throw new Error("Falta contenido DOCX");
}

export async function validateUpload(file: File) {
  const filename = safeDisplayName(file.name);
  const extension = path.extname(filename).toLowerCase();
  if (!file.size || file.size > MAX_FILE_BYTES)
    throw new FileInputError(
      "El archivo debe contener entre 1 byte y 20 MiB.",
      file.size ? 413 : 400,
    );
  const bytes = Buffer.from(await file.arrayBuffer());
  let valid = false;
  let text = "";
  try {
    switch (extension) {
      case ".pdf":
        valid =
          bytes.subarray(0, 5).toString() === "%PDF-" &&
          bytes.subarray(-1024).includes(Buffer.from("%%EOF"));
        break;
      case ".png":
        valid =
          bytes.length >= 24 &&
          bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
          bytes.subarray(12, 16).toString() === "IHDR";
        break;
      case ".jpg":
      case ".jpeg":
        valid =
          bytes.length > 4 &&
          bytes[0] === 255 &&
          bytes[1] === 216 &&
          bytes[2] === 255 &&
          bytes.at(-2) === 255 &&
          bytes.at(-1) === 217;
        break;
      case ".webp":
        valid =
          bytes.length >= 20 &&
          bytes.subarray(0, 4).toString() === "RIFF" &&
          bytes.subarray(8, 12).toString() === "WEBP" &&
          bytes.readUInt32LE(4) + 8 === bytes.length &&
          /^VP8[ LX]$/.test(bytes.subarray(12, 16).toString());
        break;
      case ".md":
      case ".txt":
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        valid = !text.includes("\0");
        break;
      case ".docx":
        validateZip(bytes);
        text = (await mammoth.extractRawText({ buffer: bytes })).value;
        valid = true;
        break;
    }
  } catch {
    valid = false;
  }
  if (!valid)
    throw new FileInputError(
      "Formato no compatible o contenido inválido. Use PDF, DOCX, MD, TXT, PNG, JPEG o WebP.",
    );
  return { filename, extension, bytes, text: text.slice(0, 100_000) };
}
