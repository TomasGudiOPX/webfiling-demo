import type { DatabaseSync } from "node:sqlite";
import type { DemoProfileId } from "../types";
import { saveManagedUpload } from "./managed-upload.server";

const pending = new WeakMap<DatabaseSync, Promise<void>>();
export function seedLibrarySamples(db: DatabaseSync): Promise<void> {
  const running = pending.get(db);
  if (running) return running;
  const work = (async () => {
    const samples = [
      {
        key: "shared-guide",
        name: "Guía de archivos compartidos.md",
        collection: "collection-shared-resources",
        actor: "system-administrator",
        text: "# Archivos compartidos\n\nDocumentos de consulta disponibles para todos los perfiles. Cada archivo puede vincularse a más de un proyecto.",
      },
      {
        key: "admin-list",
        name: "Listado administrativo de ejemplo.txt",
        collection: "collection-administration",
        actor: "administration-staff",
        text: "Archivo de ejemplo para la colección Administración. No contiene información real.",
      },
      {
        key: "manager-notes",
        name: "Notas de colección Costa Norte.md",
        collection: "collection-project-project-costa-norte",
        actor: "manager",
        text: "# Notas de archivos\n\nEjemplo aportado por Gerencia. Empleado puede consultarlo; Gerencia puede organizarlo.",
      },
    ];
    for (const sample of samples) {
      if (
        db
          .prepare("SELECT id FROM files WHERE stable_identity=?")
          .get("sample-managed:" + sample.key)
      )
        continue;
      const file = await saveManagedUpload(
        sample.actor as DemoProfileId,
        {
          collectionId: sample.collection,
          file: new File([sample.text], sample.name),
          projectIds:
            sample.key === "manager-notes" ? ["project-costa-norte"] : [],
        },
        db,
      );
      db.prepare(
        "UPDATE files SET stable_identity=?,demo_owned=1 WHERE id=?",
      ).run("sample-managed:" + sample.key, file.id);
      db.prepare(
        "UPDATE library_file_metadata SET sample_owned=1 WHERE file_id=?",
      ).run(file.id);
    }
  })();
  pending.set(db, work);
  return work.finally(() => pending.delete(db));
}
