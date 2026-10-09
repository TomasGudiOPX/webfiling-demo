import type { DatabaseSync } from "node:sqlite";
import type { DemoProfileId } from "../types";
import { saveManagedUpload } from "./managed-upload.server";
import { createFolder } from "./library-management.server";

const pending = new WeakMap<DatabaseSync, Promise<void>>();
export function seedLibrarySamples(db: DatabaseSync): Promise<void> {
  const running = pending.get(db);
  if (running) return running;
  const work = (async () => {
    const constructionFolders = [
      "00_EMPRESA_Y_ORGANIZACION",
      "01_PRESUPUESTOS_Y_LICITACIONES",
      "02_DOCUMENTACION_TECNICA",
      "03_CONTROL_Y_AVANCE_DE_OBRA",
      "04_INVENTARIO_LOGISTICA_Y_MAQUINARIA",
      "05_GESTION_DE_PERSONAL_Y_HSE",
      "06_PROVEEDORES_Y_SUBCONTRATISTAS",
      "PROYECTOS/PRJ-EDIF26-001_Torre_Horizonte_Residencial/00_FICHA_Y_CONTRATO",
      "PROYECTOS/PRJ-EDIF26-001_Torre_Horizonte_Residencial/01_PRESUPUESTO_Y_FINANZAS",
      "PROYECTOS/PRJ-EDIF26-001_Torre_Horizonte_Residencial/02_DOCUMENTACION_TECNICA",
      "PROYECTOS/PRJ-EDIF26-001_Torre_Horizonte_Residencial/03_AVANCE_Y_CALIDAD",
      "PROYECTOS/PRJ-EDIF26-001_Torre_Horizonte_Residencial/04_LOGISTICA_Y_MATERIALES",
      "PROYECTOS/PRJ-EDIF26-001_Torre_Horizonte_Residencial/05_PERSONAL_Y_HSE",
      "PROYECTOS/PRJ-EDIF26-001_Torre_Horizonte_Residencial/06_SUBCONTRATISTAS",
      "PROYECTOS/PRJ-COM26-005_Mall_Comercial_Paseo_del_Valle/00_FICHA_Y_CONTRATO",
      "PROYECTOS/PRJ-COM26-005_Mall_Comercial_Paseo_del_Valle/02_DOCUMENTACION_TECNICA",
    ];
    const constructionDocs = [
      ["00_EMPRESA_Y_ORGANIZACION", "Perfil_y_cultura.md"],
      ["00_EMPRESA_Y_ORGANIZACION", "Organigrama_y_roles.md"],
      ["00_EMPRESA_Y_ORGANIZACION", "Mapa_de_macroprocesos.md"],
      ["01_PRESUPUESTOS_Y_LICITACIONES", "Procedimiento_de_licitaciones.md"],
      ["01_PRESUPUESTOS_Y_LICITACIONES", "Analisis_de_precios_unitarios.md"],
      ["01_PRESUPUESTOS_Y_LICITACIONES", "Registro_de_ofertas_2026.md"],
      ["02_DOCUMENTACION_TECNICA", "Control_de_planos_y_revisiones.md"],
      ["02_DOCUMENTACION_TECNICA", "Circuito_de_consultas_RFI.md"],
      ["02_DOCUMENTACION_TECNICA", "Matriz_de_planos.md"],
      ["03_CONTROL_Y_AVANCE_DE_OBRA", "Curva_S_y_avance_semanal.md"],
      ["03_CONTROL_Y_AVANCE_DE_OBRA", "Libro_diario_de_obra.md"],
      ["03_CONTROL_Y_AVANCE_DE_OBRA", "Certificados_de_avance.md"],
      ["04_INVENTARIO_LOGISTICA_Y_MAQUINARIA", "Control_de_acopios.md"],
      ["04_INVENTARIO_LOGISTICA_Y_MAQUINARIA", "Equipos_asignados.md"],
      ["04_INVENTARIO_LOGISTICA_Y_MAQUINARIA", "Remitos_y_recepcion.md"],
      ["05_GESTION_DE_PERSONAL_Y_HSE", "Dotacion_y_asistencia.md"],
      ["05_GESTION_DE_PERSONAL_Y_HSE", "Plan_de_seguridad_ATS.md"],
      ["05_GESTION_DE_PERSONAL_Y_HSE", "Inspecciones_HSE.md"],
      ["06_PROVEEDORES_Y_SUBCONTRATISTAS", "Registro_de_subcontratos.md"],
      ["06_PROVEEDORES_Y_SUBCONTRATISTAS", "Mediciones_y_pagos.md"],
      ["06_PROVEEDORES_Y_SUBCONTRATISTAS", "Auditoria_de_proveedores.md"],
      ["PROYECTOS/PRJ-EDIF26-001_Torre_Horizonte_Residencial/00_FICHA_Y_CONTRATO", "Ficha_tecnica_Torre_Horizonte.md"],
      ["PROYECTOS/PRJ-EDIF26-001_Torre_Horizonte_Residencial/00_FICHA_Y_CONTRATO", "Contrato_y_alcance.md"],
      ["PROYECTOS/PRJ-EDIF26-001_Torre_Horizonte_Residencial/01_PRESUPUESTO_Y_FINANZAS", "Presupuesto_desglosado.md"],
      ["PROYECTOS/PRJ-EDIF26-001_Torre_Horizonte_Residencial/01_PRESUPUESTO_Y_FINANZAS", "Flujo_de_fondos.md"],
      ["PROYECTOS/PRJ-EDIF26-001_Torre_Horizonte_Residencial/02_DOCUMENTACION_TECNICA", "Registro_de_RFI.md"],
      ["PROYECTOS/PRJ-EDIF26-001_Torre_Horizonte_Residencial/02_DOCUMENTACION_TECNICA", "Planos_estructura_Rev_C.md"],
      ["PROYECTOS/PRJ-EDIF26-001_Torre_Horizonte_Residencial/03_AVANCE_Y_CALIDAD", "Certificacion_mensual_09.md"],
      ["PROYECTOS/PRJ-EDIF26-001_Torre_Horizonte_Residencial/04_LOGISTICA_Y_MATERIALES", "Acopio_de_hormigon_y_acero.md"],
      ["PROYECTOS/PRJ-EDIF26-001_Torre_Horizonte_Residencial/05_PERSONAL_Y_HSE", "Parte_de_asistencia.md"],
      ["PROYECTOS/PRJ-EDIF26-001_Torre_Horizonte_Residencial/06_SUBCONTRATISTAS", "Acta_de_medicion_subcontrato.md"],
      ["PROYECTOS/PRJ-COM26-005_Mall_Comercial_Paseo_del_Valle/00_FICHA_Y_CONTRATO", "Ficha_tecnica_Mall_Paseo_del_Valle.md"],
      ["PROYECTOS/PRJ-COM26-005_Mall_Comercial_Paseo_del_Valle/02_DOCUMENTACION_TECNICA", "Memoria_de_instalaciones.md"],
    ];
    constructionDocs.push(
      ...Array.from({ length: 48 }, (_, index) => [
        constructionFolders[index % constructionFolders.length],
        `Anexo_de_demostracion_${String(index + 1).padStart(2, "0")}.md`,
      ]),
    );
    const sampleFolderIds = new Map<string, string>();
    const existingRoot = db.prepare("SELECT id FROM managed_folders WHERE id=?").get("sample-construction-root") as {id:string}|undefined;
    if (!existingRoot) {
      const now = new Date().toISOString();
      db.prepare("INSERT INTO managed_folders (id,collection_id,parent_id,display_name,created_at,updated_at) VALUES (?,?,NULL,?,?,?)").run("sample-construction-root", "collection-administration", "Empresa Constructora", now, now);
      sampleFolderIds.set("", "sample-construction-root");
      for (const folder of constructionFolders) {
        let parent = "sample-construction-root";
        let current = "";
        for (const part of folder.split("/")) {
          current = current ? current + "/" + part : part;
          let row = db.prepare("SELECT id FROM managed_folders WHERE collection_id=? AND parent_id IS ? AND display_name=?").get("collection-administration", parent, part) as { id: string } | undefined;
          if (!row) row = createFolder("system-administrator", "collection-administration", parent, part, db);
          sampleFolderIds.set(current, row.id);
          parent = row.id;
        }
      }
    } else {
      sampleFolderIds.set("", existingRoot.id);
      const rows = db.prepare("SELECT id,display_name,parent_id FROM managed_folders WHERE collection_id=?").all("collection-administration") as Array<{id:string;display_name:string;parent_id:string|null}>;
      for (let pass = 0; pass < rows.length; pass++) for (const row of rows) {
        const parentPath = [...sampleFolderIds.entries()].find(([,id]) => id === row.parent_id)?.[0];
        if (parentPath !== undefined) sampleFolderIds.set(parentPath ? parentPath + "/" + row.display_name : row.display_name, row.id);
      }
    }
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
    const trashSamples = [
      [
        "trash-plan",
        "Plano de instalaciones obsoleto.md",
        "# Plano obsoleto\n\nArchivo ficticio enviado a la papelera para demostración.",
      ],
      [
        "trash-report",
        "Informe semanal duplicado.txt",
        "Informe ficticio duplicado. Puede restaurarse desde la papelera.",
      ],
      [
        "trash-note",
        "Nota de coordinación de prueba.md",
        "# Nota de prueba\n\nContenido ficticio para mostrar la papelera.",
      ],
    ] as const;
    for (const [key, name, text] of trashSamples) {
      if (
        db
          .prepare("SELECT id FROM files WHERE stable_identity=?")
          .get("sample-managed:" + key)
      )
        continue;
      const file = await saveManagedUpload("system-administrator", {
        collectionId: "collection-administration",
        file: new File([text], name),
      }, db);
      const now = new Date().toISOString();
      db.prepare(
        "UPDATE files SET stable_identity=?,demo_owned=1 WHERE id=?",
      ).run("sample-managed:" + key, file.id);
      db.prepare(
        "UPDATE library_file_metadata SET sample_owned=1,trashed_at=?,updated_at=? WHERE file_id=?",
      ).run(now, now, file.id);
    }
    for (const [folderPath, name] of constructionDocs) {
      const key = "construction-" + folderPath + "/" + name;
      if (db.prepare("SELECT id FROM files WHERE stable_identity=?").get("sample-managed:" + key)) continue;
      const folderId = sampleFolderIds.get(folderPath);
      if (!folderId) throw new Error(`Missing sample folder: ${folderPath}`);
      const title = name.replace(/\.md$/, "").replaceAll("_", " ");
      const content = `# ${title}\n\nDocumento ficticio de demostración para Empresa Constructora.\n\n- Proyecto: Torre Horizonte / cartera corporativa\n- Emisión: 08/10/2026\n- Responsable: Equipo de obra\n- Estado: En revisión\n\nEste contenido es ilustrativo y no corresponde a una obra ni persona real.`;
      const file = await saveManagedUpload("system-administrator", {
        collectionId: "collection-administration",
        folderId,
        file: new File([content], name),
      }, db);
      db.prepare("UPDATE files SET stable_identity=?,demo_owned=1 WHERE id=?").run("sample-managed:" + key, file.id);
      db.prepare("UPDATE library_file_metadata SET sample_owned=1 WHERE file_id=?").run(file.id);
    }
  })();
  pending.set(db, work);
  return work.finally(() => pending.delete(db));
}
