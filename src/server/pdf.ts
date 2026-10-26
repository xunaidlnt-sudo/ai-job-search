// Render a dashboard to PDF with headless Chromium (Playwright). The web app
// has a print-only report view at #report=<dashboard>&project=<id>&token=…;
// it signals completion by setting document.body.dataset.reportReady.

export async function playwrightRenderer(baseUrl: string, token: () => string): Promise<((dashboardId: string, projectId: string | null) => Promise<Buffer>) | null> {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return null;
  }
  return async (dashboardId, projectId) => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1400, height: 990 } });
      const qs = new URLSearchParams({ report: dashboardId, token: token(), server: baseUrl });
      if (projectId) qs.set("project", projectId);
      await page.goto(`${baseUrl}/#${qs.toString()}`, { waitUntil: "networkidle" });
      await page.waitForFunction(() => document.body.dataset.reportReady === "1" || document.body.dataset.reportReady === "error", null, { timeout: 60_000 });
      if (await page.evaluate(() => document.body.dataset.reportReady === "error")) {
        throw new Error(await page.evaluate(() => document.body.dataset.reportError ?? "Report failed to render"));
      }
      return Buffer.from(await page.pdf({ format: "A4", landscape: true, printBackground: true, margin: { top: "10mm", bottom: "10mm", left: "8mm", right: "8mm" } }));
    } finally {
      await browser.close();
    }
  };
}
