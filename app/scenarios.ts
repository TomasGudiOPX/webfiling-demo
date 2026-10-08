import type { ScenarioDefinition } from "./types";

const base = (slug: string, filename: string) =>
  `/app/source/${slug}/${filename}`;
export const scenarioRegistry: readonly ScenarioDefinition[] = [
  {
    slug: "costa-norte",
    name: "Obra Costa Norte",
    story:
      "La pregunta es cuál es el plano vigente y qué aprobación humana lo respalda.",
    dominantIssue: "Versiones y aprobación humana",
    recommendedQuery: "plano vigente",
    sourceRoot: "/app/source/costa-norte",
    files: [
      {
        id: "costa-plan-current",
        filename: "Plano general - Rev C.pdf",
        sourcePath: base("costa-norte", "planos/Plano general - Rev C.pdf"),
        extension: ".pdf",
        sizeBytes: 2480000,
        modifiedAt: "2026-10-05T09:30:00.000Z",
        documentType: "plan",
        status: "approved",
        metadataText:
          "plano general vigente estructura arquitectura revision C",
        preview: {
          kind: "pdf",
          title: "Plano general · Rev C",
          url: "/fixtures/costa-norte/plano-rev-c.pdf",
        },
      },
      {
        id: "costa-plan-old",
        filename: "Plano general - Rev B.pdf",
        sourcePath: base("costa-norte", "planos/Plano general - Rev B.pdf"),
        extension: ".pdf",
        sizeBytes: 2310000,
        modifiedAt: "2026-08-14T11:20:00.000Z",
        documentType: "plan",
        status: "superseded",
        metadataText: "plano general anterior reemplazado revision B",
        preview: {
          kind: "pdf",
          title: "Plano general · Rev B (superado)",
          url: "/fixtures/costa-norte/plano-rev-b.pdf",
        },
      },
      {
        id: "costa-notice",
        filename: "Aviso de obra 18.docx",
        sourcePath: base("costa-norte", "comunicaciones/Aviso de obra 18.docx"),
        extension: ".docx",
        sizeBytes: 84000,
        modifiedAt: "2026-10-06T15:45:00.000Z",
        documentType: "notice",
        status: "pending_review",
        metadataText: "aviso comunicación cambio de alcance pendiente revisión",
        preview: {
          kind: "docx",
          title: "Aviso de obra 18 · vista de ficha",
          sections: ["Cambio de alcance", "Aprobación pendiente"],
          content:
            "AVISO DE OBRA 18\n\nCambio de alcance\nSe incorpora una canaleta técnica en el acceso norte y se actualiza el detalle de terminación.\n\nAprobación pendiente\nLa jefatura de obra debe confirmar el impacto en plazo y presupuesto antes de emitir la revisión final.",
          reason:
            "Ficha registrada para la demo cuando el archivo original no está montado.",
        },
      },
      {
        id: "costa-photo",
        filename: "IMG_0042.jpg",
        sourcePath: base("costa-norte", "recibidos/IMG_0042.jpg"),
        extension: ".jpg",
        sizeBytes: 920000,
        modifiedAt: "2026-09-28T08:00:00.000Z",
        documentType: "other",
        status: "missing_metadata",
        metadataText: "imagen recibida metadata faltante",
        preview: {
          kind: "image",
          title: "Foto de obra recibida",
          url: "/fixtures/costa-norte/obra-relevamiento.svg",
          reason:
            "La imagen está disponible, pero todavía requiere metadatos y revisión humana.",
        },
      },
    ],
    relations: [
      { from: "costa-plan-current", to: "costa-plan-old", type: "supersedes" },
    ],
    findings: [],
  },
  {
    slug: "parque-industrial",
    name: "Parque Industrial",
    story:
      "La búsqueda ayuda a ordenar documentos con metadatos incompletos y relaciones que aún requieren criterio.",
    dominantIssue: "Calidad de datos y relaciones inciertas",
    recommendedQuery: "memoria técnica",
    sourceRoot: "/app/source/parque-industrial",
    files: [
      {
        id: "parque-memoria",
        filename: "Memoria técnica nave A.md",
        sourcePath: base(
          "parque-industrial",
          "ingenieria/Memoria técnica nave A.md",
        ),
        extension: ".md",
        sizeBytes: 18000,
        modifiedAt: "2026-10-03T10:00:00.000Z",
        documentType: "technical",
        status: "missing_metadata",
        metadataText: "memoria técnica nave industrial estructura",
        preview: {
          kind: "markdown",
          title: "Memoria técnica · extracto",
          content:
            "# Memoria técnica\n\nLa nave A requiere verificar el metraje y el responsable de revisión.",
        },
      },
      {
        id: "parque-duplicate-a",
        filename: "Plano instalaciones Rev A.pdf",
        sourcePath: base(
          "parque-industrial",
          "planos/Plano instalaciones Rev A.pdf",
        ),
        extension: ".pdf",
        sizeBytes: 1220000,
        modifiedAt: "2026-09-20T12:00:00.000Z",
        documentType: "plan",
        status: "pending_review",
        metadataText: "plano instalaciones nave A revision inicial",
        preview: {
          kind: "pdf",
          title: "Plano de instalaciones · Rev A",
          url: "/fixtures/parque-industrial/instalaciones-a.pdf",
        },
      },
      {
        id: "parque-duplicate-b",
        filename: "Plano instalaciones Rev A (copia).pdf",
        sourcePath: base(
          "parque-industrial",
          "recibidos/Plano instalaciones Rev A (copia).pdf",
        ),
        extension: ".pdf",
        sizeBytes: 1220000,
        modifiedAt: "2026-09-21T08:30:00.000Z",
        documentType: "plan",
        status: "pending_review",
        metadataText: "posible duplicado plano instalaciones nave A",
        preview: {
          kind: "pdf",
          title: "Posible duplicado",
          url: "/fixtures/parque-industrial/instalaciones-a-copy.pdf",
        },
      },
      {
        id: "parque-contract",
        filename: "Contrato proveedor.md",
        sourcePath: base(
          "parque-industrial",
          "contratos/Contrato proveedor.md",
        ),
        extension: ".md",
        sizeBytes: 9000,
        modifiedAt: "2026-08-11T14:00:00.000Z",
        documentType: "contract",
        status: "approved",
        metadataText: "contrato proveedor instalaciones relacionado",
        preview: {
          kind: "markdown",
          title: "Contrato proveedor",
          content: "## Alcance\n\nSuministro e instalación de equipamiento.",
        },
      },
    ],
    relations: [
      {
        from: "parque-duplicate-a",
        to: "parque-duplicate-b",
        type: "related to",
      },
      {
        from: "parque-memoria",
        to: "parque-contract",
        type: "awaiting confirmation",
      },
    ],
    findings: [
      {
        id: "finding-parque-metadata",
        fileId: "parque-memoria",
        type: "missing_metadata",
        reason: "Faltan responsable y fecha de emisión.",
        evidence:
          "El nombre y la ruta identifican la nave, pero no hay responsable en los metadatos.",
        confidence: 0.96,
      },
      {
        id: "finding-parque-duplicate",
        fileId: "parque-duplicate-b",
        type: "possible_duplicate",
        reason: "El nombre, tamaño y contenido sugieren un duplicado.",
        evidence:
          "Coincide con Plano instalaciones Rev A.pdf; requiere confirmación humana.",
        confidence: 0.89,
      },
      {
        id: "finding-parque-relation",
        fileId: "parque-memoria",
        type: "uncertain_relation",
        reason:
          "La memoria parece relacionada con el contrato, pero falta confirmación.",
        evidence:
          "La ruta de ingeniería y el alcance del contrato comparten el mismo subsistema.",
        confidence: 0.74,
      },
    ],
  },
  {
    slug: "torre-del-parque",
    name: "Torre del Parque",
    story:
      "Una entrada nueva llega sin tocar la fuente y puede avanzar de ingestión pendiente a revisión.",
    dominantIssue: "Formatos y nueva ingesta simulada",
    recommendedQuery: "fachada",
    sourceRoot: "/app/source/torre-del-parque",
    files: [
      {
        id: "torre-fachada",
        filename: "Fachada principal.pdf",
        sourcePath: base("torre-del-parque", "planos/Fachada principal.pdf"),
        extension: ".pdf",
        sizeBytes: 1780000,
        modifiedAt: "2026-10-01T09:00:00.000Z",
        documentType: "plan",
        status: "approved",
        metadataText: "fachada principal torre parque plano",
        preview: {
          kind: "pdf",
          title: "Fachada principal",
          url: "/fixtures/torre-del-parque/fachada.pdf",
        },
      },
      {
        id: "torre-bitacora",
        filename: "Bitácora de coordinación.md",
        sourcePath: base(
          "torre-del-parque",
          "coordinacion/Bitácora de coordinación.md",
        ),
        extension: ".md",
        sizeBytes: 12000,
        modifiedAt: "2026-09-29T16:00:00.000Z",
        documentType: "log",
        status: "approved",
        metadataText: "bitácora coordinación fachada pendientes",
        preview: {
          kind: "markdown",
          title: "Bitácora de coordinación",
          content:
            "# Bitácora\n\n- Revisar encuentro de fachada con estructura.\n- Confirmar muestra de material.",
        },
      },
      {
        id: "torre-especificacion",
        filename: "Especificación de materiales.docx",
        sourcePath: base(
          "torre-del-parque",
          "especificaciones/Especificación de materiales.docx",
        ),
        extension: ".docx",
        sizeBytes: 65000,
        modifiedAt: "2026-09-25T11:00:00.000Z",
        documentType: "specification",
        status: "pending_review",
        metadataText: "especificación materiales torre fachada",
        preview: {
          kind: "docx",
          title: "Especificación de materiales · vista de ficha",
          content:
            "ESPECIFICACIÓN DE MATERIALES\n\nFachada\nUtilizar panel compuesto color grafito, con fijaciones ocultas y junta vertical de 10 mm.\n\nControl de calidad\nPresentar muestra aprobada antes del inicio del montaje.",
          reason:
            "Ficha registrada para la demo cuando el archivo original no está montado.",
        },
      },
    ],
    relations: [
      { from: "torre-fachada", to: "torre-bitacora", type: "related to" },
    ],
    findings: [],
  },
  {
    slug: "torre-horizonte",
    name: "Torre Horizonte Residencial",
    story:
      "Una obra completa, con ficha, presupuesto, planos, avance, logística, personal y subcontratistas, expone la trazabilidad entre muchas áreas.",
    dominantIssue: "Trazabilidad integral de la obra",
    recommendedQuery: "presupuesto",
    sourceRoot: "/app/source/torre-horizonte",
    files: [
      {
        id: "th-ficha",
        filename: "ficha_tecnica_proyecto.md",
        sourcePath: base(
          "torre-horizonte",
          "00_FICHA_Y_CONTRATO/ficha_tecnica_proyecto.md",
        ),
        extension: ".md",
        sizeBytes: 14500,
        modifiedAt: "2026-10-02T09:00:00.000Z",
        documentType: "technical",
        status: "approved",
        metadataText:
          "ficha técnica proyecto torre horizonte residencial alcance",
        preview: {
          kind: "markdown",
          title: "Ficha técnica del proyecto",
          content:
            "# Ficha técnica\n\nTorre Horizonte Residencial · 14 pisos · 84 unidades.\nSuperficie 18.200 m² · Plazo 26 meses.",
        },
      },
      {
        id: "th-resumen",
        filename: "resumen_contractual_y_alcance.md",
        sourcePath: base(
          "torre-horizonte",
          "00_FICHA_Y_CONTRATO/resumen_contractual_y_alcance.md",
        ),
        extension: ".md",
        sizeBytes: 9800,
        modifiedAt: "2026-10-02T09:15:00.000Z",
        documentType: "contract",
        status: "approved",
        metadataText: "resumen contractual alcance contrato principal",
        preview: {
          kind: "markdown",
          title: "Resumen contractual y alcance",
          content:
            "## Alcance\n\nEjecución llave en mano de la torre, excluyendo obra gris exterior.\nHitos y garantías referidos al contrato principal.",
        },
      },
      {
        id: "th-presupuesto",
        filename: "presupuesto_desglosado_y_apu.md",
        sourcePath: base(
          "torre-horizonte",
          "01_PRESUPUESTO_Y_FINANZAS/presupuesto_desglosado_y_apu.md",
        ),
        extension: ".md",
        sizeBytes: 21000,
        modifiedAt: "2026-10-03T11:00:00.000Z",
        documentType: "financial",
        status: "pending_review",
        metadataText: "presupuesto desglosado análisis precios unitarios obra",
        preview: {
          kind: "markdown",
          title: "Presupuesto desglosado y APU",
          content:
            "## Presupuesto\n\n- Movimiento de suelo · 8,4 M ARS\n- Estructura de hormigón · 32,1 M ARS\n- Instalaciones · 18,7 M ARS",
        },
      },
      {
        id: "th-flujo",
        filename: "flujo_fondos_y_curva_inversion.md",
        sourcePath: base(
          "torre-horizonte",
          "01_PRESUPUESTO_Y_FINANZAS/flujo_fondos_y_curva_inversion.md",
        ),
        extension: ".md",
        sizeBytes: 7600,
        modifiedAt: "2026-10-03T11:30:00.000Z",
        documentType: "financial",
        status: "approved",
        metadataText: "flujo de fondos curva inversión financiera",
        preview: {
          kind: "markdown",
          title: "Flujo de fondos y curva de inversión",
          content:
            "# Curva de inversión\n\nDesembolsos trimestrales contra hitos de avance certificado.",
        },
      },
      {
        id: "th-matriz",
        filename: "matriz_planos_apc.md",
        sourcePath: base(
          "torre-horizonte",
          "02_DOCUMENTACION_TECNICA/matriz_planos_apc.md",
        ),
        extension: ".md",
        sizeBytes: 11200,
        modifiedAt: "2026-10-04T08:00:00.000Z",
        documentType: "plan",
        status: "approved",
        metadataText: "matriz planos aprobados para construcción revisión",
        preview: {
          kind: "markdown",
          title: "Matriz de planos APC",
          content:
            "## Matriz de planos\n\n- Estructura E-101..E-118 · Rev C\n- Instalaciones I-201..I-240 · Rev B",
        },
      },
      {
        id: "th-rfis",
        filename: "registro_rfis.md",
        sourcePath: base(
          "torre-horizonte",
          "02_DOCUMENTACION_TECNICA/registro_rfis.md",
        ),
        extension: ".md",
        sizeBytes: 6300,
        modifiedAt: "2026-10-04T15:00:00.000Z",
        documentType: "technical",
        status: "missing_metadata",
        metadataText: "registro RFI consultas técnicas sin responsable",
        preview: {
          kind: "markdown",
          title: "Registro de RFIs",
          content:
            "# RFIs abiertas\n\nRFI-018 · Encuentro fachada-estructura · sin responsable asignado.",
        },
      },
      {
        id: "th-curva",
        filename: "curva_s_y_certificaciones.md",
        sourcePath: base(
          "torre-horizonte",
          "03_AVANCE_Y_CALIDAD/curva_s_y_certificaciones.md",
        ),
        extension: ".md",
        sizeBytes: 8400,
        modifiedAt: "2026-10-05T10:00:00.000Z",
        documentType: "technical",
        status: "pending_review",
        metadataText: "curva S avance certificaciones obra",
        preview: {
          kind: "markdown",
          title: "Curva S y certificaciones",
          content:
            "# Avance\n\nMes 4 · avance físico 27% · certificación 3 pendiente de firma.",
        },
      },
      {
        id: "th-bitacora",
        filename: "libro_diario_obra_bitacora.md",
        sourcePath: base(
          "torre-horizonte",
          "03_AVANCE_Y_CALIDAD/libro_diario_obra_bitacora.md",
        ),
        extension: ".md",
        sizeBytes: 18900,
        modifiedAt: "2026-10-05T18:00:00.000Z",
        documentType: "log",
        status: "approved",
        metadataText: "libro diario bitácora obra pendientes clima",
        preview: {
          kind: "markdown",
          title: "Libro diario de obra",
          content:
            "# Bitácora\n\n- 04/10 · lluvias, suspensión de hormigonado en nivel 7.\n- 05/10 · llegada de acero, acopio en playa norte.",
        },
      },
      {
        id: "th-acopios",
        filename: "acopios_y_control_materiales.md",
        sourcePath: base(
          "torre-horizonte",
          "04_LOGISTICA_Y_MATERIALES/acopios_y_control_materiales.md",
        ),
        extension: ".md",
        sizeBytes: 7200,
        modifiedAt: "2026-10-06T09:00:00.000Z",
        documentType: "logistics",
        status: "approved",
        metadataText: "acopios control materiales inventario",
        preview: {
          kind: "markdown",
          title: "Acopios y control de materiales",
          content:
            "# Acopios\n\nAcero ADN-420 · 210 t en playa norte · stock crítico de aditivos.",
        },
      },
      {
        id: "th-maquinaria",
        filename: "maquinaria_y_equipos_asignados.md",
        sourcePath: base(
          "torre-horizonte",
          "04_LOGISTICA_Y_MATERIALES/maquinaria_y_equipos_asignados.md",
        ),
        extension: ".md",
        sizeBytes: 6900,
        modifiedAt: "2026-10-06T10:00:00.000Z",
        documentType: "logistics",
        status: "pending_review",
        metadataText: "maquinaria equipos asignados grúa torre",
        preview: {
          kind: "markdown",
          title: "Maquinaria y equipos asignados",
          content:
            "# Equipos\n\nGrúa torre GT-2 · disponible hasta mes 10 · requiere renovación de certificado.",
        },
      },
      {
        id: "th-dotacion",
        filename: "dotacion_y_partes_asistencia.md",
        sourcePath: base(
          "torre-horizonte",
          "05_PERSONAL_Y_HSE/dotacion_y_partes_asistencia.md",
        ),
        extension: ".md",
        sizeBytes: 8100,
        modifiedAt: "2026-10-07T08:00:00.000Z",
        documentType: "hse",
        status: "approved",
        metadataText: "dotación personal partes asistencia hse",
        preview: {
          kind: "markdown",
          title: "Dotación y partes de asistencia",
          content:
            "# Dotación\n\n126 operarios · 14 subcontratos · asistencia semanal consolidada.",
        },
      },
      {
        id: "th-planseguridad",
        filename: "plan_seguridad_ats.md",
        sourcePath: base(
          "torre-horizonte",
          "05_PERSONAL_Y_HSE/plan_seguridad_ats.md",
        ),
        extension: ".md",
        sizeBytes: 12400,
        modifiedAt: "2026-10-07T09:00:00.000Z",
        documentType: "hse",
        status: "approved",
        metadataText: "plan seguridad análisis trabajo seguro",
        preview: {
          kind: "markdown",
          title: "Plan de seguridad y ATS",
          content:
            "# Seguridad\n\nUso obligatorio de línea de vida en altura · ATS por tarea crítica.",
        },
      },
      {
        id: "th-actas",
        filename: "actas_medicion_y_certificados.md",
        sourcePath: base(
          "torre-horizonte",
          "06_SUBCONTRATISTAS/actas_medicion_y_certificados.md",
        ),
        extension: ".md",
        sizeBytes: 5900,
        modifiedAt: "2026-10-07T14:00:00.000Z",
        documentType: "procurement",
        status: "missing_metadata",
        metadataText: "actas medición certificados subcontratos",
        preview: {
          kind: "markdown",
          title: "Actas de medición y certificados",
          content:
            "# Actas\n\nActa 06 · instalación eléctrica · sin fecha de certificación.",
        },
      },
      {
        id: "th-asignacion",
        filename: "asignacion_gremios_tercerizados.md",
        sourcePath: base(
          "torre-horizonte",
          "06_SUBCONTRATISTAS/asignacion_gremios_tercerizados.md",
        ),
        extension: ".md",
        sizeBytes: 6700,
        modifiedAt: "2026-10-07T15:00:00.000Z",
        documentType: "procurement",
        status: "pending_review",
        metadataText: "asignación gremios tercerizados subcontratistas",
        preview: {
          kind: "markdown",
          title: "Asignación de gremios tercerizados",
          content:
            "# Gremios\n\nElectricidad · Sanitarios · Tabiques · Carpintería metálica.",
        },
      },
    ],
    relations: [
      { from: "th-ficha", to: "th-resumen", type: "related to" },
      { from: "th-resumen", to: "th-presupuesto", type: "related to" },
      { from: "th-presupuesto", to: "th-flujo", type: "related to" },
      { from: "th-ficha", to: "th-matriz", type: "related to" },
      { from: "th-matriz", to: "th-rfis", type: "related to" },
      { from: "th-rfis", to: "th-ficha", type: "awaiting confirmation" },
      { from: "th-presupuesto", to: "th-curva", type: "related to" },
      { from: "th-curva", to: "th-bitacora", type: "related to" },
      { from: "th-bitacora", to: "th-planseguridad", type: "related to" },
      { from: "th-planseguridad", to: "th-dotacion", type: "related to" },
      { from: "th-curva", to: "th-acopios", type: "related to" },
      { from: "th-acopios", to: "th-maquinaria", type: "related to" },
      { from: "th-maquinaria", to: "th-actas", type: "awaiting confirmation" },
      { from: "th-actas", to: "th-asignacion", type: "related to" },
      {
        from: "th-asignacion",
        to: "th-presupuesto",
        type: "awaiting confirmation",
      },
      { from: "th-resumen", to: "th-actas", type: "related to" },
    ],
    findings: [
      {
        id: "finding-th-rfis",
        fileId: "th-rfis",
        type: "missing_metadata",
        reason: "Falta responsable y fecha de emisión del registro de RFIs.",
        evidence:
          "El archivo lista consultas técnicas pero no identifica quién las gestiona.",
        confidence: 0.93,
      },
      {
        id: "finding-th-actas",
        fileId: "th-actas",
        type: "missing_metadata",
        reason: "El acta de medición no registra la fecha de certificación.",
        evidence: "Acta 06 sin fecha ni firma del inspector de obra.",
        confidence: 0.88,
      },
      {
        id: "finding-th-relation",
        fileId: "th-asignacion",
        type: "uncertain_relation",
        reason:
          "La asignación de gremios parece depender del presupuesto, pero falta confirmación.",
        evidence:
          "Los gremios tercerizados referencian partidas del presupuesto sin vínculo formal.",
        confidence: 0.71,
      },
    ],
  },
];
export function getScenario(slug: string): ScenarioDefinition | undefined {
  return scenarioRegistry.find((scenario) => scenario.slug === slug);
}
