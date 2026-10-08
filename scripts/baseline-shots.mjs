import { chromium } from "@playwright/test";

const shots = [
  ["http://localhost:3000/file/costa-norte?view=graph", "graph-costa"],
  ["http://localhost:3000/file/costa-norte?selected=costa-plan-current&view=preview", "pdf-embed"],
  ["http://localhost:3000/file/parque-industrial?view=graph", "graph-parque"],
  ["http://localhost:3000/file/torre-del-parque?selected=torre-bitacora&view=preview", "md-preview"],
];

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROME ?? undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
for (const [url, name] of shots) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.screenshot({ path: `test-results/shot-${name}.png`, fullPage: true });
  console.log(`shot ${name}`);
}
await page.setViewportSize({ width: 390, height: 844 });
await page.goto("http://localhost:3000/file/parque-industrial?view=graph", { waitUntil: "networkidle" });
await page.screenshot({ path: "test-results/shot-mobile-graph.png", fullPage: true });
console.log("shot mobile");
await browser.close();
