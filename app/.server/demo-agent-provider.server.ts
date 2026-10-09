import type { DemoProfileId } from "../types";
import type { DemoAgentOperation } from "./agent-safety.server";

export const DEMO_PROVIDER_VERSION = "demo-intents-v1" as const;
export const DEMO_INTENT_TEMPLATES = [
  "Subir un archivo a [colección]",
  "Organizar [archivo] en [categoría]",
  "Resumir [archivo o colección]",
  "Revisar faltantes de [colección]",
  "Preparar una regla para [perfil]",
] as const;

export type DemoIntentResult =
  | { status: "ready"; providerVersion: typeof DEMO_PROVIDER_VERSION; operation: DemoAgentOperation; explanation: string }
  | { status: "clarify"; providerVersion: typeof DEMO_PROVIDER_VERSION; reason: "missing_target" | "ambiguous_target"; choices: string[] }
  | { status: "forbidden"; providerVersion: typeof DEMO_PROVIDER_VERSION; reason: "calendar_configuration_admin_only" }
  | { status: "unsupported"; providerVersion: typeof DEMO_PROVIDER_VERSION };

export interface DemoIntentContext {
  profileId: DemoProfileId;
  collections: Array<{ id: string; name: string }>;
  files: Array<{ id: string; name: string }>;
  today?: string;
}

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();
const ready = (operation: DemoAgentOperation, explanation: string): DemoIntentResult => ({
  status: "ready", providerVersion: DEMO_PROVIDER_VERSION, operation, explanation,
});

/** Deterministic local templates only: never evaluates document text or calls a model/network. */
export function interpretDemoIntent(input: unknown, context: DemoIntentContext): DemoIntentResult {
  if (typeof input !== "string" || input.length > 500 || !input.trim()) return { status: "unsupported", providerVersion: DEMO_PROVIDER_VERSION };
  const text = normalize(input);
  const dates = text.match(/\b(?:\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre))\b/g) ?? [];
  if (dates.length > 1) return { status: "clarify", providerVersion: DEMO_PROVIDER_VERSION, reason: "ambiguous_target", choices: dates.slice(0, 5) };
  const collection = context.collections.find((item) => text.includes(normalize(item.name)));
  const fileMatches = context.files.filter((item) => {
    const name = normalize(item.name);
    return name.length > 2 && text.includes(name);
  });
  if (/\b(resumir|resumen|sintetizar)\b/.test(text)) {
    if (fileMatches.length > 1) return { status: "clarify", providerVersion: DEMO_PROVIDER_VERSION, reason: "ambiguous_target", choices: fileMatches.slice(0, 5).map((item) => item.name) };
    return fileMatches.length === 1
      ? ready({ type: "summarize", fileIds: [fileMatches[0].id] }, "Prepararé un resumen basado en el contenido disponible.")
      : collection
        ? ready({ type: "summarize_collection", collectionId: collection.id }, "Prepararé un resumen extractivo de los archivos accesibles de la colección.")
        : { status: "clarify", providerVersion: DEMO_PROVIDER_VERSION, reason: "missing_target", choices: [] };
  }
  if (/\b(faltantes?|pendientes?|revisar|verificar)\b/.test(text))
    return collection ? ready({ type: "check_collection", collectionId: collection.id }, "Revisaré los períodos y archivos faltantes.") : { status: "clarify", providerVersion: DEMO_PROVIDER_VERSION, reason: "missing_target", choices: context.collections.slice(0, 5).map((item) => item.name) };
  if (/\b(subir|cargar|adjuntar)\b/.test(text))
    return collection ? ready({ type: "upload", collectionId: collection.id }, "Abriré la carga para esa colección; el archivo aún requiere tu confirmación.") : { status: "clarify", providerVersion: DEMO_PROVIDER_VERSION, reason: "missing_target", choices: context.collections.slice(0, 5).map((item) => item.name) };
  if (/\b(regla|solicitud|solicitar)\b/.test(text)) {
    if (context.profileId !== "system-administrator") return { status: "forbidden", providerVersion: DEMO_PROVIDER_VERSION, reason: "calendar_configuration_admin_only" };
    const recipients: Array<[RegExp, DemoProfileId]> = [[/\bemplead[oa]\b/, "employee"], [/\bgerente\b/, "manager"], [/\badministracion\b/, "administration-staff"]];
    const recipient = recipients.find(([pattern]) => pattern.test(text))?.[1];
    return collection && recipient
      ? ready({ type: "draft_rule", collectionId: collection.id, recipientProfileId: recipient }, "Prepararé un borrador; no se activará hasta que lo revises.")
      : { status: "clarify", providerVersion: DEMO_PROVIDER_VERSION, reason: "missing_target", choices: [...context.collections.slice(0, 3).map((item) => item.name), "empleado", "gerente"] };
  }
  if (/\b(organizar|clasificar|etiquetar)\b/.test(text)) {
    if (fileMatches.length > 1) return { status: "clarify", providerVersion: DEMO_PROVIDER_VERSION, reason: "ambiguous_target", choices: fileMatches.slice(0, 5).map((item) => item.name) };
    if (!fileMatches.length) return { status: "clarify", providerVersion: DEMO_PROVIDER_VERSION, reason: "missing_target", choices: context.files.slice(0, 5).map((item) => item.name) };
    const categories: Array<[RegExp, string]> = [[/\bcontratos?\b/, "contracts"], [/\bfinanzas?\b/, "finance"], [/\btecnica|tecnicos?\b/, "technical"], [/\bcalidad\b/, "progress-quality"], [/\blogistica\b/, "logistics"]];
    const categoryId = categories.find(([pattern]) => pattern.test(text))?.[1];
    return categoryId
      ? ready({ type: "organize", fileId: fileMatches[0].id, categoryId }, "Propondré la categoría para que confirmes antes de aplicar.")
      : { status: "clarify", providerVersion: DEMO_PROVIDER_VERSION, reason: "missing_target", choices: ["contratos", "finanzas", "técnica", "calidad", "logística"] };
  }
  return { status: "unsupported", providerVersion: DEMO_PROVIDER_VERSION };
}
