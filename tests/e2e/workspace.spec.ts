import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/file/torre-del-parque");
  await page.getByRole("button", { name: "Resetear datos de demo" }).click();
});

test("catalog renders all three scenario stories", async ({ page }) => {
  await page.goto("/file");
  await expect(
    page.getByRole("heading", { name: /Tres historias/ }),
  ).toBeVisible();
  await expect(page.getByText("Obra Costa Norte")).toBeVisible();
  await expect(page.getByText("Parque Industrial")).toBeVisible();
  await expect(page.getByText("Torre del Parque")).toBeVisible();
  await expect(page.locator('a[href="/file/costa-norte"]')).toHaveCount(1);
  await expect(page.locator('a[href="/file/parque-industrial"]')).toHaveCount(
    1,
  );
  await expect(page.locator('a[href="/file/torre-del-parque"]')).toHaveCount(1);
});

test("each project route keeps its own story and files", async ({ page }) => {
  for (const scenario of [
    ["costa-norte", "Obra Costa Norte", "Plano general - Rev C.pdf"],
    ["parque-industrial", "Parque Industrial", "Memoria técnica nave A.md"],
    ["torre-del-parque", "Torre del Parque", "Fachada principal.pdf"],
  ] as const) {
    await page.goto(`/file/${scenario[0]}`);
    await expect(
      page.getByRole("heading", { name: scenario[1] }),
    ).toBeVisible();
    await expect(page.getByText(scenario[2])).toBeVisible();
  }
});

test("selector switching updates URL, heading and selected file", async ({
  page,
}) => {
  await page.goto("/file/costa-norte");
  await page
    .getByRole("link", { name: "Parque Industrial", exact: true })
    .click();
  await expect(page).toHaveURL(/\/file\/parque-industrial$/);
  await expect(
    page.getByRole("heading", { name: "Parque Industrial" }),
  ).toBeVisible();
  await expect(page.getByText("Memoria técnica nave A.md")).toBeVisible();
  await expect(page.getByText("Plano general - Rev C.pdf")).toHaveCount(0);
});

test("global search identifies projects and scoped search excludes them", async ({
  page,
}) => {
  await page.goto("/file/costa-norte");
  await page.getByLabel("Buscar documentos").fill("plano");
  await page.getByLabel("Alcance de búsqueda").selectOption("all");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page.getByText("Proyecto: Obra Costa Norte")).toBeVisible();
  await expect(page.getByText("Proyecto: Parque Industrial")).toBeVisible();
  await page.getByLabel("Alcance de búsqueda").selectOption("project");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page.getByText("Proyecto: Parque Industrial")).toHaveCount(0);
});

test("relation graph renders nodes, typed edges and legend by default", async ({
  page,
}) => {
  await page.goto("/file/parque-industrial");
  const graph = page.getByTestId("relation-graph");
  await expect(graph).toBeVisible();
  await expect(graph.getByText("relacionado con")).toBeVisible();
  await expect(graph.getByText("requiere confirmación")).toBeVisible();
  await expect(graph.locator("canvas.relation-canvas")).toBeVisible();
  await expect(graph.locator(".graph-legend")).toBeVisible();
});

test("relation graph node selection updates the selected file", async ({
  page,
}) => {
  await page.goto("/file/parque-industrial");
  const nodeLink = page
    .getByTestId("relation-graph")
    .getByRole("link", { name: /Contrato proveedor/ })
    .first();
  await nodeLink.focus();
  await nodeLink.press("Enter");
  await expect(page).toHaveURL(/selected=parque-contract/);
  await expect(
    page.getByRole("heading", { name: "Contrato proveedor.md" }),
  ).toBeVisible();
});

test("relation list exposes raw relation labels as accessible fallback", async ({
  page,
}) => {
  await page.goto("/file/parque-industrial");
  await expect(page.getByText("awaiting confirmation")).toBeVisible();
  await expect(page.getByText("related to")).toBeVisible();
});

test("preview states cover PDF embed, Markdown HTML and DOCX limitation", async ({
  page,
}) => {
  await page.goto("/file/costa-norte?selected=costa-plan-current");
  await expect(page.locator("embed.pdf-embed")).toHaveAttribute(
    "src",
    /plano-rev-c\.pdf/,
  );
  await expect(
    page.getByText("Vista previa real del PDF en el navegador"),
  ).toBeVisible();
  await page.goto("/file/torre-del-parque?selected=torre-bitacora");
  await expect(page.locator(".markdown-body")).toBeVisible();
  await expect(
    page.locator(".markdown-body h1", { hasText: "Bitácora" }),
  ).toBeVisible();
  await page.goto("/file/torre-del-parque?selected=torre-especificacion");
  await expect(page.getByText("DOCX sin visor", { exact: true })).toBeVisible();
  await expect(page.getByText(/no se convierte el DOCX/)).toBeVisible();
});

test("open findings surface as badges and a project summary", async ({
  page,
}) => {
  await page.goto("/file/parque-industrial");
  await expect(page.getByTestId("findings-summary")).toBeVisible();
  await expect(page.locator(".finding-badge").first()).toBeVisible();
  await expect(page.getByText("⚠ 2 hallazgo(s)")).toBeVisible();
});

test("findings are reviewable and resettable", async ({ page }) => {
  await page.goto("/file/parque-industrial");
  await expect(page.getByText("Metadatos faltantes")).toBeVisible();
  await page.getByRole("button", { name: "Descartar" }).first().click();
  await expect(page.getByText("Estado: dismissed")).toBeVisible();
  await page.getByRole("button", { name: "Resetear datos de demo" }).click();
  await expect(page.getByText("Estado: open")).toHaveCount(3);
});

test("mock upload progresses and reset removes it", async ({ page }) => {
  await page.goto("/file/torre-del-parque");
  await page
    .getByPlaceholder("o escribe un nombre de fixture.pdf")
    .fill("acta-simulada.pdf");
  await page.getByRole("button", { name: "Crear Pending ingestion" }).click();
  await expect(page.getByText("acta-simulada.pdf")).toBeVisible();
  await expect(page.getByText("Pendiente de ingestión")).toBeVisible();
  await page
    .getByRole("button", { name: "Confirmar → Pending review" })
    .click();
  await expect(page.getByText("Pendiente de revisión")).toBeVisible();
  await page.getByRole("button", { name: "Resetear datos de demo" }).click();
  await expect(page.getByText("acta-simulada.pdf")).toHaveCount(0);
});

test("unknown scenario recovers to the catalog", async ({ page }) => {
  await page.goto("/file/no-existe");
  await expect(page).toHaveURL(/\/file$/);
  await expect(
    page.getByRole("heading", { name: /Tres historias/ }),
  ).toBeVisible();
});

test("governed inbox lets a reviewer complete a high-risk classification", async ({
  page,
}) => {
  await page.goto("/file/review?view=mine&actor=document-controller");
  await expect(
    page.getByRole("heading", { name: "Decisiones pendientes" }),
  ).toBeVisible();
  await expect(page.getByText("Aviso de obra 18.docx")).toBeVisible();
  await page.getByRole("link", { name: "Ver evidencia" }).first().click();
  await expect(page.getByText("Historial de decisiones")).toBeVisible();
  await page.getByRole("button", { name: "Aprobar clasificación" }).click();
  await page.getByRole("link", { name: "Completados" }).click();
  await expect(page.getByText("Aviso de obra 18.docx")).toBeVisible();
});

test("governed inbox validates reasons, exposes overdue work, and resets", async ({
  page,
}) => {
  await page.goto("/file/review?view=unassigned&actor=document-controller");
  await page.getByRole("link", { name: "Ver evidencia" }).first().click();
  await page.getByRole("button", { name: "Escalar" }).click();
  await expect(page.getByRole("alert")).toContainText("reason");
  await page.getByRole("link", { name: "Vencidos" }).click();
  await expect(page.getByText("Plano instalaciones Rev A.pdf")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Decisiones pendientes" }),
  ).toBeVisible();
});
