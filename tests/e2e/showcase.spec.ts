import { expect, test } from "@playwright/test";

test("restored showcase leads to the project workspace, integrated views and protected relationship map", async ({
  page,
}, info) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.goto("/");
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
    const initialIds = await page
      .locator("[data-file-id]")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-file-id")).sort(),
      );
    for (const view of ["Cuadrícula", "Carpetas", "Lista"]) {
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
      .getByText("Mapa de documentos y relaciones", { exact: true })
      .click();
    await expect(page.getByTestId("relation-graph")).toBeVisible();
    await expect(page.getByTestId("relation-graph")).not.toContainText(
      /Pendiente de revisión|Aprobado/,
    );
    expect(
      await page
        .locator(".relation-sr-links a")
        .evaluateAll((links) =>
          links
            .map((link) =>
              new URL((link as HTMLAnchorElement).href).searchParams.get(
                "selected",
              ),
            )
            .sort(),
        ),
    ).toEqual(initialIds);
    await page.getByRole("button", { name: "Pausar animación" }).click();
    await expect(
      page.getByRole("button", { name: "Reanudar animación" }),
    ).toHaveAttribute("aria-pressed", "true");
    await page
      .getByTestId("relation-graph")
      .screenshot({ path: info.outputPath(`brain-${width}.png`) });
    await page
      .getByRole("list", { name: "Nodos del mapa de relaciones" })
      .getByRole("link")
      .first()
      .click();
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
  await page
    .getByText("Mapa de documentos y relaciones", { exact: true })
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
  const link = page.locator(".relation-sr-links a").first();
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("complementary", { name: "Detalles del archivo" }),
  ).toBeVisible();
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
  await page.getByLabel("Buscar en mis archivos").fill("zzz-empty-showcase");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(
    page.getByText("No hay archivos en esta selección"),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Limpiar restricciones de búsqueda" })
    .click();
  await expect(page.locator("[data-file-id]").first()).toBeVisible();
  await page.getByRole("link", { name: "Volver a proyectos" }).click();
  await expect(page.getByTestId("project-showcase")).toBeVisible();
});
