import { expect, test, type Page } from "@playwright/test";

async function useProfile(page: Page, id: string) {
  await page.goto("/file");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.getByLabel("Perfil simulado").selectOption(id),
  ]);
  await expect(page.getByLabel("Perfil simulado")).toHaveValue(id);
  await expect(page.locator(".restored-showcase")).toBeVisible();
}

test("panel-only URL keeps the showcase, supports keyboard close, and fits mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/file?panel=agent");
  await expect(page.locator(".restored-showcase")).toBeVisible();
  await expect(page.locator(".library-shell")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Agente", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Entrada por voz: próximamente" })).toBeDisabled();
  await expect(page.getByText("Actividad de ejemplo (datos ilustrativos).")).toBeVisible();
  await expect(page.locator(".agent-history-list")).toHaveCSS("max-height", "240px");
  await expect(page.locator(".agent-history-list")).toHaveCSS("overflow-y", "auto");
  await page.screenshot({ path: "test-results/agent-panel-390.png", fullPage: true });
  const sizes = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.width);
  await page.keyboard.press("Escape");
  await expect(page.locator(".agent-panel")).toHaveCount(0);
  await expect(page.locator(".agent-launcher button").first()).toBeFocused();
  await expect(page).toHaveURL(/\/file$/);
});

test("opening and closing a panel preserves browser filters and selection", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await useProfile(page, "manager");
  await page.goto("/file?browse=1&view=grid&q=memoria&selected=parque-memoria");
  await expect(page.locator(".library-shell")).toBeVisible();
  await page.screenshot({ path: "test-results/agent-panel-1440-before.png", fullPage: true });
  await page.getByRole("button", { name: "Agente" }).first().click();
  await expect(page.locator(".agent-panel")).toBeVisible();
  expect(await page.locator(".agent-panel").evaluate((panel) => panel.getBoundingClientRect().width)).toBeGreaterThan(430);
  await expect(page.getByRole("tab")).toHaveCount(0);
  await page.screenshot({ path: "test-results/agent-panel-1440.png", fullPage: true });
  await page.goBack();
  await expect(page.locator(".agent-panel")).toHaveCount(0);
  await expect(page).toHaveURL(/browse=1.*view=grid.*q=memoria.*selected=parque-memoria/);
});

test("agent panel stays mounted while moving from showcase to project files", async ({ page }) => {
  await page.goto("/file?panel=agent");
  await page.locator(".project-card").first().click();
  await expect(page).toHaveURL(/\/file\/[^?]+\?panel=agent/);
  await expect(page.locator(".library-shell")).toBeVisible();
  await expect(page.locator(".agent-panel")).toBeVisible();
  await page.locator(".library-file").first().click();
  await expect(page).toHaveURL(/panel=agent/);
  await expect(page.locator(".agent-panel")).toBeVisible();
});

test("non-administrator agent cannot configure collection rules", async ({ page }) => {
  await useProfile(page, "manager");
  await page.goto("/file/costa-norte?panel=agent");
  await page.getByLabel("¿Qué necesitás hacer?").fill("Preparar una regla para empleado de Obra Costa Norte");
  await page.getByRole("button", { name: "Interpretar" }).click();
  await expect(page.getByText(/configuración del calendario requiere el perfil Administrador del sistema/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Preparar plan" })).toHaveCount(0);
});

test("employee can attach a real file from the agent before interpreting any request", async ({ page }) => {
  await useProfile(page, "employee");
  await page.goto("/file/costa-norte?panel=agent");
  await expect(page.getByLabel("¿Qué necesitás hacer?")).toHaveValue("");
  await page.locator("#agent-upload-file").setInputFiles({
    name: "entrega-directa.txt", mimeType: "text/plain", buffer: Buffer.from("Entrega directa de prueba."),
  });
  await expect(page.getByRole("button", { name: "Subir y organizar" })).toBeEnabled();
  const [upload] = await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/files/upload")),
    page.locator("form.agent-upload-form").evaluate((form: HTMLFormElement) => form.requestSubmit()),
  ]);
  expect(upload.status()).toBe(201);
  await expect(page.getByRole("link", { name: "Abrir archivo cargado" })).toBeVisible();
  await expect(page.locator(".agent-history")).toContainText("upload");
  await expect(page.getByLabel("¿Qué necesitás hacer?")).toHaveValue("");
});

test("the sample delivery calendar lives on the calendar settings page", async ({ page }) => {
  await useProfile(page, "system-administrator");
  await page.goto("/settings/calendar");
  await expect(page.getByRole("heading", { name: "Calendario de entregas" })).toBeVisible();
  await expect(page.getByText("Datos de ejemplo")).toBeVisible();
  await expect(page.getByRole("list", { name: "Entregas de ejemplo" }).getByText("Entrega de planos")).toBeVisible();
  await expect(page.locator(".agent-panel")).toHaveCount(0);
});

test("main file view no longer embeds the sample calendar", async ({ page }) => {
  await page.goto("/file");
  await expect(page.getByRole("heading", { name: "Calendario de entregas" })).toHaveCount(0);
  await page.getByLabel("¿Qué necesitas hacer? Pídeselo al agente").fill("Resumir los documentos de Costa Norte");
  await page.getByRole("button", { name: "Abrir agente" }).click();
  await expect(page).toHaveURL(/panel=agent.*intent=/);
  await expect(page.getByLabel("¿Qué necesitás hacer?")).toHaveValue("Resumir los documentos de Costa Norte");
});

test("calendar settings are reachable only to the system administrator; legacy rules links fail safely", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await useProfile(page, "system-administrator");
  await page.goto("/file?browse=1");
  await expect(page.locator(".showcase-topbar a[href='/settings/calendar']")).toBeVisible();
  await page.getByRole("link", { name: "Configuración del calendario" }).click();
  await expect(page).toHaveURL(/\/settings\/calendar$/);
  await expect(page.getByRole("heading", { name: "Configuración · Calendario" })).toBeVisible();
  await expect(page.getByLabel("Destinatario autorizado")).toBeVisible();
  await expect(page.locator(".calendar-settings-view")).toBeVisible();
  await expect(page.locator(".agent-panel")).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/file\?browse=1$/);
  await page.goto("/file/costa-norte");
  await expect(page.locator(".showcase-topbar a[href='/settings/calendar']")).toBeVisible();
  const controlPositions = await page.evaluate(() => [
    document.querySelector(".showcase-topbar .back-link")!.getBoundingClientRect().x,
    document.querySelector(".showcase-profile select")!.getBoundingClientRect().x,
    document.querySelector(".showcase-topbar .settings-nav-link")!.getBoundingClientRect().x,
    document.querySelector(".theme-toggle")!.getBoundingClientRect().x,
  ]);
  expect(controlPositions[0]).toBeLessThan(controlPositions[1]);
  expect(controlPositions[1]).toBeLessThan(controlPositions[2]);
  expect(controlPositions[2]).toBeLessThan(controlPositions[3]);
  await page.goto("/file?panel=rules");
  await expect(page).toHaveURL(/\/settings\/calendar$/);
  await expect(page.getByRole("heading", { name: "Configuración · Calendario" })).toBeVisible();
  await expect(page.getByLabel("Destinatario autorizado")).toBeVisible();
  await useProfile(page, "manager");
  await expect(page.locator(".showcase-topbar a[href='/settings/calendar']")).toHaveCount(0);
  await page.goto("/settings/calendar");
  await expect(page).toHaveURL(/\/file\?settingsDenied=1$/);
  await expect(page.getByRole("heading", { name: "Configuración · Calendario" })).toHaveCount(0);
  await page.goto("/file?panel=rules");
  await expect(page.getByText(/disponible solo para Administrador del sistema/)).toBeVisible();
  await expect(page.locator(".agent-panel")).toHaveCount(0);
});
