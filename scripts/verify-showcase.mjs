import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

// Read-only smoke check of the actual local deployment, with an isolated browser.
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
});
try {
  const page = await browser.newPage();
  for (const host of ["localhost", "127.0.0.1"]) {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      await page.goto(`http://${host}:3000/file`, { waitUntil: "networkidle" });
      await page
        .getByTestId("project-showcase")
        .waitFor({ timeout: 10000 })
        .catch(async (error) => {
          await page.screenshot({
            path: `.test-data/live-${host}-unexpected.png`,
            fullPage: true,
          });
          console.error(
            `${host}: ${page.url()} ${(await page.locator("body").innerText()).slice(0, 1200)}`,
          );
          throw error;
        });
      assert.equal(
        await page.getByRole("heading", { level: 1 }).innerText(),
        "La obra avanza con el documento correcto",
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.screenshot({
        path: `.test-data/live-${host}-showcase-${width}.png`,
        fullPage: true,
      });
      await page.locator(".scenario-card").first().click();
      await page
        .getByRole("navigation", { name: "Vista de archivos" })
        .waitFor();
      await page.locator("[data-file-id]").first().click();
      await page
        .getByRole("complementary", { name: "Detalles del archivo" })
        .waitFor();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.screenshot({
        path: `.test-data/live-${host}-workspace-${width}.png`,
        fullPage: true,
      });
      if (width < 800)
        await page.getByRole("link", { name: "Volver a resultados" }).click();
      await page
        .getByText("Mapa de documentos y relaciones", { exact: true })
        .click();
      const brain = page.getByTestId("relation-graph");
      await brain.getByRole("button", { name: "Pausar animación" }).click();
      assert.equal(
        await brain
          .getByRole("button", { name: "Reanudar animación" })
          .getAttribute("aria-pressed"),
        "true",
      );
      await brain.screenshot({
        path: `.test-data/live-${host}-brain-${width}.png`,
      });
      const canvas = brain.locator("canvas");
      const frozen = await canvas.evaluate((el) => el.toDataURL());
      await page.waitForTimeout(150);
      assert.equal(await canvas.evaluate((el) => el.toDataURL()), frozen);
      await brain
        .getByRole("list", { name: "Nodos del mapa de relaciones" })
        .getByRole("link")
        .first()
        .click();
      await page
        .getByRole("complementary", { name: "Detalles del archivo" })
        .waitFor();
      console.log(
        `${host}:3000 ${width}px: restored showcase, workspace, brain graph, pause, file navigation and no horizontal overflow verified`,
      );
    }
  }
} finally {
  await browser.close();
}
