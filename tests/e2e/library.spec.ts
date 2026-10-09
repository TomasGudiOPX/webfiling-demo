import { expect, test, type Page } from "@playwright/test";

async function profile(page: Page, id: string) {
  await page.goto("/file");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.getByLabel("Perfil simulado").selectOption(id),
  ]);
  await expect(page).toHaveURL(/\/file$/);
  await expect(page.getByLabel("Perfil simulado")).toHaveValue(id);
  await page.goto("/file?browse=1");
}
const files = (page: Page) => page.locator("[data-file-id]");

test("four profiles use all three views on desktop and mobile without overflow", async ({
  page,
}, info) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    for (const id of [
      "employee",
      "manager",
      "administration-staff",
      "system-administrator",
    ]) {
      await profile(page, id);
      const ids = await files(page).evaluateAll((elements) =>
        elements.map((e) => e.getAttribute("data-file-id")).sort(),
      );
      expect(ids.length).toBeGreaterThan(0);
      for (const view of ["Lista", "Cuadrícula", "Carpetas"]) {
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
          await files(page).evaluateAll((elements) =>
            elements.map((e) => e.getAttribute("data-file-id")).sort(),
          ),
        ).toEqual(ids);
        const dimensions = await page.evaluate(() => ({
          content: document.documentElement.scrollWidth,
          viewport: document.documentElement.clientWidth,
          overflowing: [...document.body.querySelectorAll("*")]
            .map((element) => ({
              selector: `${element.tagName.toLowerCase()}.${typeof element.className === "string" ? element.className.trim().replaceAll(" ", ".") : ""}`,
              right: Math.round(element.getBoundingClientRect().right),
              left: Math.round(element.getBoundingClientRect().left),
              scrollWidth: element.scrollWidth,
              clientWidth: element.clientWidth,
            }))
            .filter((element) => element.scrollWidth > element.clientWidth + 10 || element.right > document.documentElement.clientWidth + 2 || element.left < -2)
            .slice(0, 5),
        }));
        expect(dimensions.content, JSON.stringify(dimensions.overflowing)).toBeLessThanOrEqual(dimensions.viewport);
        if (width === 1440)
          expect((await files(page).first().boundingBox())!.y).toBeLessThan(
            900,
          );
      }
      await page.screenshot({
        path: info.outputPath(`${id}-${width}.png`),
        fullPage: true,
      });
      await files(page).first().click();
      await expect(
        page.getByRole("complementary", { name: "Detalles del archivo" }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Descargar archivo" }),
      ).toBeVisible();
      await page.getByRole("link", { name: "Volver a resultados" }).click();
      await expect(
        page.getByRole("region", { name: "Resultados" }),
      ).toBeVisible();
    }
  }
});

test("queries, filters, selection, refresh and Back survive view changes", async ({
  page,
}) => {
  await profile(page, "manager");
  await page.goto(
    "/file/torre-horizonte?q=presupuesto&category=finance&discipline=finance&location=whole-site&sort=oldest&evidence=th-presupuesto",
  );
  await expect(page.locator(".library-detail > h2")).toContainText(
    "presupuesto",
  );
  const ids = await files(page).evaluateAll((elements) =>
    elements.map((e) => e.getAttribute("data-file-id")),
  );
  await page
    .getByRole("navigation", { name: "Vista de archivos" })
    .getByRole("link", { name: "Cuadrícula" })
    .click();
  await expect(page).toHaveURL(/category=finance/);
  await expect(page).toHaveURL(/view=grid/);
  await page.reload();
  expect(
    await files(page).evaluateAll((elements) =>
      elements.map((e) => e.getAttribute("data-file-id")),
    ),
  ).toEqual(ids);
  await page
    .getByRole("navigation", { name: "Vista de archivos" })
    .getByRole("link", { name: "Carpetas" })
    .click();
  await expect(page).toHaveURL(/view=folders/);
  await page.goBack();
  await expect(
    page
      .getByRole("navigation", { name: "Vista de archivos" })
      .getByRole("link", { name: "Cuadrícula" }),
  ).toHaveAttribute("aria-current", "page");
  await page.goto("/file?q=no-hay-este-archivo");
  await expect(
    page.getByText("No hay archivos en esta selección"),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Limpiar restricciones de búsqueda" })
    .click();
  await expect(files(page).first()).toBeVisible();
});

test("protected previews, explicit predecessor comparison and no static bypass", async ({
  page,
  request,
}) => {
  await page.goto("/file?selected=costa-plan-current");
  await expect(page.locator("embed.pdf-embed")).toHaveAttribute(
    "src",
    "/api/files/costa-plan-current/preview",
  );
  await page
    .getByRole("button", { name: "Comparar con versión anterior" })
    .click();
  await expect(
    page.locator('embed[src="/api/files/costa-plan-old/preview"]'),
  ).toBeVisible();
  await page.goto("/file?selected=costa-notice");
  await expect(page.locator(".docx-preview pre")).toContainText(
    "canaleta técnica",
  );
  await page.goto("/file?selected=costa-photo");
  await expect(page.locator(".image-preview img")).toBeVisible();
  await profile(page, "manager");
  await page.goto("/file?selected=parque-memoria");
  await expect(page.locator(".markdown-body")).toContainText("Memoria");
  for (const url of [
    "/fixtures/costa-norte/plano-rev-c.pdf",
    "/private-fixtures/costa-norte/plano-rev-c.pdf",
    "/@fs/" +
      process.cwd().replaceAll("\\", "/") +
      "/private-fixtures/costa-norte/plano-rev-c.pdf",
  ]) {
    const response = await request.get(url);
    expect(response.headers()["content-type"] ?? "").not.toContain(
      "application/pdf",
    );
    expect(await response.text()).not.toContain("%PDF-");
  }
  for (const suffix of ["", "/preview", "/download", "/activity"])
    expect(
      (await request.get("/api/files/parque-memoria" + suffix)).status(),
    ).toBe(404);
});

test("real upload, organization, project links, folders, trash, restore and sample reset", async ({
  page,
}, info) => {
  await profile(page, "manager");
  await page.goto("/file?collection=collection-project-project-costa-norte");
  await page.getByText("Nueva carpeta", { exact: true }).click();
  const folderName = "E2E " + Date.now();
  await page.getByLabel("Nombre de carpeta").fill(folderName);
  await page.getByRole("button", { name: "Crear carpeta" }).click();
  await expect(page.getByRole("status")).toContainText("Cambios guardados");
  await page
    .getByRole("button", { name: "Cargar archivo", exact: true })
    .click();
  const name = "carga-" + Date.now() + ".md";
  await page.getByLabel("Archivo", { exact: true }).setInputFiles({
    name,
    mimeType: "text/markdown",
    buffer: Buffer.from("# Contenido real\n\nCarga de prueba persistente."),
  });
  await page
    .getByLabel("Carpeta de destino")
    .selectOption({ label: "Archivos cargados / " + folderName });
  await page.getByRole("button", { name: "Guardar archivo" }).click();
  await expect(page.locator(".library-detail > h2")).toHaveText(name);
  await expect(page.locator(".markdown-body")).toContainText("Contenido real");
  const selected = new URL(page.url()).searchParams.get("selected")!;
  const download = await page.request.get(`/api/files/${selected}/download`);
  expect(await download.text()).toBe(
    "# Contenido real\n\nCarga de prueba persistente.",
  );
  await page.getByText("Organizar archivo", { exact: true }).click();
  await page.getByLabel("Nombre visible").fill("Organizado " + name);
  await page
    .locator(".library-edit")
    .getByRole("combobox", { name: "Categoría", exact: true })
    .selectOption("technical");
  await page
    .locator(".library-edit")
    .getByLabel("Parque Industrial", { exact: true })
    .check();
  await page.getByRole("button", { name: "Guardar organización" }).click();
  await expect(page.locator(".library-detail > h2")).toContainText(
    "Organizado",
  );
  await page.goto("/file/parque-industrial?selected=" + selected);
  await expect(page.locator(".library-detail > h2")).toContainText(
    "Organizado",
  );
  await page.getByRole("button", { name: "Enviar a papelera" }).click();
  await expect(page.locator(".library-detail")).toHaveCount(0);
  expect(
    (await page.request.get(`/api/files/${selected}/download`)).status(),
  ).toBe(404);
  await page.goto("/file?trash=1&selected=" + selected);
  await page.getByRole("button", { name: "Restaurar archivo" }).click();
  await expect(page.getByRole("status")).toContainText("Archivo restaurado");
  expect(
    (await page.request.get(`/api/files/${selected}/download`)).status(),
  ).toBe(200);
  await profile(page, "employee");
  await page.goto("/file?selected=" + selected);
  await expect(
    page.getByText("Organizar archivo", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Enviar a papelera" }),
  ).toHaveCount(0);
  await profile(page, "system-administrator");
  await page.getByText("Datos de ejemplo", { exact: true }).click();
  const resetResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.request().url().includes("/file"),
  );
  await page.getByRole("button", { name: "Restablecer ejemplos" }).click();
  const resetResponse = await resetResponsePromise;
  if (![202, 303].includes(resetResponse.status()))
    throw new Error(
      `Sample reset failed (${resetResponse.status()}): ${await resetResponse.text()}`,
    );
  await page.waitForURL(
    (url) =>
      url.searchParams
        .get("message")
        ?.startsWith("Ejemplos restablecidos") ?? false,
  );
  await expect(page.getByRole("status")).toContainText(
    "Ejemplos restablecidos",
  );
  await page.goto("/file?selected=" + selected);
  await expect(page.locator(".library-detail > h2")).toContainText(
    "Organizado",
  );
  await page.screenshot({
    path: info.outputPath("upload-lifecycle.png"),
    fullPage: true,
  });
});

for (const width of [1440, 390]) {
  for (const id of [
    "employee",
    "manager",
    "administration-staff",
    "system-administrator",
  ]) {
    test(`${id} uploads, searches, organizes and restores at ${width}px`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      await profile(page, id);
      const collection =
        id === "administration-staff"
          ? "collection-administration"
          : "collection-project-project-costa-norte";
      await page.goto(`/file?collection=${collection}`);
      await page
        .getByRole("button", { name: "Cargar archivo", exact: true })
        .click();
      const name = `${id}-${width}-${Date.now()}.txt`;
      await page.getByLabel("Archivo", { exact: true }).setInputFiles({
        name,
        mimeType: "text/plain",
        buffer: Buffer.from("Contenido del perfil " + id),
      });
      await page.getByRole("button", { name: "Guardar archivo" }).click();
      await expect(page.locator(".library-detail > h2")).toHaveText(name);
      const selected = new URL(page.url()).searchParams.get("selected")!;
      expect(
        await (
          await page.request.get(`/api/files/${selected}/download`)
        ).text(),
      ).toBe("Contenido del perfil " + id);
      await page.getByText("Organizar archivo", { exact: true }).click();
      await page.getByLabel("Nombre visible").fill("Nuevo " + name);
      await page
        .locator(".library-edit")
        .getByRole("combobox", { name: "Categoría", exact: true })
        .selectOption("technical");
      await page.getByRole("button", { name: "Guardar organización" }).click();
      await expect(page.locator(".library-detail > h2")).toHaveText(
        "Nuevo " + name,
      );
      await page.getByRole("link", { name: "Volver a resultados" }).click();
      await page.getByLabel("Buscar archivos").fill(name);
      await page.getByRole("button", { name: "Buscar", exact: true }).click();
      await expect(files(page)).toHaveCount(1);
      for (const view of ["Lista", "Cuadrícula", "Carpetas"]) {
        const link = page
          .getByRole("navigation", { name: "Vista de archivos" })
          .getByRole("link", { name: view, exact: true });
        await link.click();
        await expect(link).toHaveAttribute("aria-current", "page");
        await expect(files(page)).toHaveCount(1);
        await expect(files(page)).toHaveAttribute("data-file-id", selected);
      }
      if (await files(page).isVisible()) await files(page).click();
      else await expect(page.locator(".library-detail")).toBeVisible();
      await page.getByRole("button", { name: "Enviar a papelera" }).click();
      await expect(page.locator(".library-detail")).toHaveCount(0);
      expect(
        (await page.request.get(`/api/files/${selected}/download`)).status(),
      ).toBe(404);
      await page.goto(`/file?trash=1&selected=${selected}`);
      await page.getByRole("button", { name: "Restaurar archivo" }).click();
      await expect(page.getByRole("status")).toContainText(
        "Archivo restaurado",
      );
      await page.goto(`/file?selected=${selected}`);
      await expect(page.locator(".library-detail > h2")).toHaveText(
        "Nuevo " + name,
      );
      expect(
        (await page.request.get(`/api/files/${selected}/download`)).status(),
      ).toBe(200);
      await page.screenshot({
        path: info.outputPath("profile-lifecycle.png"),
        fullPage: true,
      });
    });
  }
}

test("profile switch clears selected content and delayed previous-profile Markdown", async ({
  page,
}) => {
  await profile(page, "manager");
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/files/parque-memoria/preview", async (route) => {
    await delayed;
    await route
      .fulfill({ contentType: "text/markdown", body: "# OLD PRIVATE RESPONSE" })
      .catch(() => {});
  });
  await page.goto("/file?selected=parque-memoria");
  await page.getByLabel("Perfil simulado").selectOption("employee");
  await expect(page).toHaveURL(/\/file$/);
  release();
  await expect(page.getByText("OLD PRIVATE RESPONSE")).toHaveCount(0);
  await expect(page.locator(".library-detail")).toHaveCount(0);
  expect(
    (await page.request.get("/api/files/parque-memoria/preview")).status(),
  ).toBe(404);
});

test("profile switch discards a delayed protected DOCX response", async ({
  page,
}) => {
  await profile(page, "manager");
  const response = await page.request.get(
    "/api/files/torre-especificacion/preview",
  );
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  const bytes = await response.body();
  let release!: () => void;
  let requested!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route(
    "**/api/files/torre-especificacion/preview",
    async (route) => {
      requested();
      await delayed;
      await route
        .fulfill({
          contentType: response.headers()["content-type"],
          body: bytes,
        })
        .catch(() => {});
    },
  );
  await page.goto("/file?selected=torre-especificacion");
  await started;
  await page.getByLabel("Perfil simulado").selectOption("employee");
  await expect(page).toHaveURL(/\/file$/);
  release();
  await expect(page.locator(".docx-preview")).toHaveCount(0);
  await expect(page.locator(".library-detail")).toHaveCount(0);
  expect(
    (
      await page.request.get("/api/files/torre-especificacion/preview")
    ).status(),
  ).toBe(404);
});

test("keyboard-only folder navigation, selection, view switching and focus return at 390px", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/file?view=folders");
  const tabUntil = async (selector: string) => {
    for (let i = 0; i < 90; i++) {
      await page.keyboard.press("Tab");
      if (
        await page
          .locator(selector)
          .evaluateAll((nodes) =>
            nodes.some((node) => node === document.activeElement),
          )
      )
        return;
    }
    throw new Error("Keyboard could not reach " + selector);
  };
  await tabUntil(".library-folders a");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/folder=/);
  await tabUntil("[data-file-id]");
  await page.keyboard.press("Enter");
  await expect(page.locator(".library-detail > h2")).toBeFocused();
  await tabUntil(".library-back");
  await page.keyboard.press("Enter");
  await expect(page.locator(".library-results > header h2")).toBeFocused();
  let viewFocused = false;
  for (let i = 0; i < 100; i++) {
    await page.keyboard.press("Shift+Tab");
    if (await page.locator('.library-toolbar nav a[href*="view=grid"]').evaluate((node) => node === document.activeElement)) {
      viewFocused = true;
      break;
    }
  }
  expect(viewFocused).toBe(true);
  await expect(page.locator('.library-toolbar nav a[href*="view=grid"]')).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/view=grid/);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("mobile-keyboard.png"),
    fullPage: true,
  });
});

test("legacy workflow URLs are retired without mutation; old filters display recovery", async ({
  page,
  request,
}) => {
  for (const url of [
    "/api/reviews",
    "/api/reviews/anything",
    "/api/reviews/anything/decision",
    "/api/files/costa-plan-current/review",
    "/api/projects/project-costa-norte/as-of?at=2026-10-04",
  ]) {
    for (const method of ["get", "post"] as const) {
      const response = await request[method](url);
      expect(response.status()).toBe(410);
      expect((await response.json()).error.code).toBe("feature_retired");
    }
  }
  await page.goto("/file/review");
  await expect(page).toHaveURL(/retired=workflow/);
  await page.goto("/file?status=approved&at=2026-10-04");
  await expect(
    page.getByRole("link", { name: "Volver a los archivos actuales" }),
  ).toBeVisible();
  for (const label of [
    "Decisiones pendientes",
    "Gobernanza",
    "Aprobar clasificación",
    "Comparar con Carpetas Windows",
  ])
    await expect(page.getByText(label, { exact: true })).toHaveCount(0);
});
