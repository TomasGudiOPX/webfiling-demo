import { expect, test } from "@playwright/test";

test("restored showcase leads to the project workspace, integrated views and protected relationship map", async ({
  page,
}, info) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.goto("/file");
    await expect(page.getByTestId("project-showcase")).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "La obra avanza con el documento correcto",
      }),
    ).toBeVisible();
    const costaCard = page
      .locator(".scenario-card")
      .filter({ hasText: "Costa Norte" });
    await expect(costaCard).toHaveCount(1);
    await expect(page.locator("main")).not.toContainText(
      /Cola de revisión|Decisiones|Aprobación|Por decidir/,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`showcase-${width}.png`),
      fullPage: true,
    });
    await costaCard.click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Costa Norte",
    );
    await expect(
      page.getByRole("link", { name: "Volver a proyectos" }),
    ).toBeVisible();
    await page
      .locator(".library-results")
      .getByRole("button", { name: "Ampliar vista" })
      .click();
    const initialIds = await page
      .locator(".library-files [data-file-id]")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-file-id")).sort(),
      );
    for (const view of ["Tabla", "Carpetas", "Lista"]) {
      const viewNavigation = page.getByRole("navigation", {
        name: "Vista de archivos",
      });
      if (!(await viewNavigation.isVisible()))
        await page
          .locator(".library-results")
          .getByRole("button", { name: "Ampliar vista" })
          .click();
      await page
        .getByRole("navigation", { name: "Vista de archivos" })
        .getByRole("link", { name: view, exact: true })
        .click();
      await expect(
        page
          .getByRole("navigation", { name: "Vista de archivos" })
          .getByRole("link", { name: view, exact: true }),
      ).toHaveAttribute("aria-current", "page");
      expect(
        await page
          .locator("[data-file-id]")
          .evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute("data-file-id")).sort(),
          ),
      ).toEqual(initialIds);
    }
    await page
      .locator(".library-results")
      .getByRole("button", { name: "Cerrar vista ampliada" })
      .click();
    await expect(page.getByTestId("relation-graph")).toBeVisible();
    await expect(page.getByTestId("relation-graph")).not.toContainText(
      /Pendiente de revisión|Aprobado/,
    );
    const graphIds = await page
      .locator(".relation-sr-links [data-graph-file-id]")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-graph-file-id")),
      );
    expect(graphIds).toEqual(expect.arrayContaining(initialIds));
    await page
      .getByTestId("relation-graph")
      .screenshot({ path: info.outputPath(`brain-${width}.png`) });
    const graphNode = page
      .getByRole("list", { name: "Nodos del mapa de relaciones" })
      .getByRole("button")
      .first();
    const graphFileId = await graphNode.getAttribute("data-graph-file-id");
    await graphNode.evaluate((element) =>
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })),
    );
    await expect(page).toHaveURL(new RegExp(`selected=${graphFileId}`));
    await expect(page.locator(".library-detail > h2")).toContainText((await graphNode.textContent())!.trim());
    await graphNode.evaluate((element) =>
      element.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 })),
    );
    const graphPreview = page.getByRole("dialog", { name: /Vista ampliada:/ });
    await expect(graphPreview).toBeVisible();
    await expect(graphPreview.locator(".preview-dialog-content.has-details")).toBeVisible();
    await expect(graphPreview.locator(".preview-dialog-details")).toBeVisible();
    await graphPreview.getByRole("button", { name: "Cerrar" }).click();
    await expect(graphPreview).toHaveCount(0);
    await expect(
      page.getByRole("complementary", { name: "Detalles del archivo" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Descargar archivo" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`workspace-${width}.png`),
      fullPage: true,
    });
  }
});

test("brain respects reduced motion and supports keyboard file navigation", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/file");
  await page
    .locator(".scenario-card")
    .filter({ hasText: "Costa Norte" })
    .click();
  const canvas = page.locator(".relation-canvas");
  await canvas.scrollIntoViewIfNeeded();
  const firstFrame = await canvas.evaluate((el) =>
    (el as HTMLCanvasElement).toDataURL(),
  );
  await page.waitForTimeout(200);
  expect(
    await canvas.evaluate((el) => (el as HTMLCanvasElement).toDataURL()),
  ).toEqual(firstFrame);
  const link = page.locator(".relation-sr-links button").first();
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(
      page.getByRole("dialog", { name: /Vista ampliada:/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
      page.getByRole("dialog", { name: /Vista ampliada:/ }),
  ).toHaveCount(0);
});

test("relation graph searches, clamps zoom, pans, resets focus and keeps modal state", async ({
  page,
}) => {
  await page.goto("/file?browse=1");
  const graph = page.getByTestId("relation-graph");
  const firstNode = graph
    .getByRole("list", { name: "Nodos del mapa de relaciones" })
    .getByRole("button")
    .first();
  const label = (await firstNode.textContent())!.trim();
  await graph.getByLabel("Buscar archivos del gráfico").fill(label);
  await expect(graph.locator(".relation-search-status")).toContainText("coincidencia");
  await graph
    .getByLabel("Buscar archivos del gráfico")
    .fill("sin-coincidencias-xyz");
  await expect(graph.locator(".relation-search-status")).toHaveText(
    "No se encontraron archivos",
  );
  await graph.getByLabel("Buscar archivos del gráfico").fill("");
  await firstNode.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: /Vista ampliada:/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: /Vista ampliada:/ }),
  ).toHaveCount(0);
  const canvas = graph.locator("canvas");
   const groupControl = graph.locator(".relation-obra-controls button:not(.relation-group-reset)").first();
  const graphNodes = graph.getByRole("list", { name: "Nodos del mapa de relaciones" }).getByRole("button");
  const graphNodeCount = await graphNodes.count();
  if (await groupControl.count()) {
    await groupControl.click();
    await expect(canvas).toHaveAttribute("data-group-value", /.+/);
    await expect(canvas).toHaveAttribute("data-group-node-count", /[1-9]/);
    const groupedCount = Number(await canvas.getAttribute("data-group-node-count"));
    expect(groupedCount).toBeLessThanOrEqual(graphNodeCount);
    expect(await graphNodes.count()).toBe(graphNodeCount);
    await groupControl.click();
    await expect(canvas).toHaveAttribute("data-group-value", "");
    await expect(canvas).toHaveAttribute("data-group-node-count", "0");
  }
  for (let index = 0; index < 8; index++)
    await graph.getByLabel("Acercar gráfico").click();
  await expect(canvas).toHaveAttribute("data-zoom", "2.50");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Graph canvas is not visible");
  await page.mouse.move(bounds.x + 8, bounds.y + 8);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 38, bounds.y + 28);
  await page.mouse.up();
  await expect(canvas).not.toHaveAttribute("data-pan-x", "0");
  await graph.getByRole("button", { name: "Restablecer vista" }).click();
  await expect(canvas).toHaveAttribute("data-zoom", "1.00");
  await expect(firstNode).toHaveAttribute("aria-pressed", "false");
  await firstNode.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: /Vista ampliada:/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: /Vista ampliada:/ }),
  ).toHaveCount(0);
});

test("showcase cards obey profile access and search opens the shared browser", async ({
  page,
}) => {
  await page.goto("/file");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.getByLabel("Perfil simulado").selectOption("administration-staff"),
  ]);
  await expect(page.getByTestId("project-showcase")).toBeVisible();
  await expect(page.locator(".scenario-card")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("Costa Norte");
  await expect(
    page.getByRole("link", { name: /Administración.*Organizar archivos/ }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: /Administración.*Organizar archivos/ })
    .click();
  await page
    .locator(".library-results")
    .getByRole("button", { name: "Ampliar vista" })
    .click();
  await page.getByRole("searchbox", { name: "Buscar archivos", exact: true }).fill("zzz-empty-showcase");
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(
    page.getByText("No hay archivos en esta selección"),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Limpiar restricciones de búsqueda" })
    .click();
  await expect(page.locator("[data-file-id]").first()).toBeVisible();
  await page.goto("/file");
  await expect(page.getByTestId("project-showcase")).toBeVisible();
});
