import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter((value): value is string => Boolean(value));

const findChrome = (): string | null => CHROME_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;

export const renderArtboardImage = async (input: {
  html: string;
  width: number;
  height: number;
  scale?: number;
  format?: "png" | "jpeg";
}): Promise<Buffer> => {
  const executablePath = findChrome();
  if (!executablePath) throw new Error("Chrome/Chromium not found for image export");
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: input.width, height: input.height },
      deviceScaleFactor: input.scale ?? 1,
    });
    await page.setContent(input.html, { waitUntil: "domcontentloaded", timeout: 10000 });
    await page.evaluate(async () => {
      try {
        await Promise.race([
          document.fonts.ready,
          new Promise((resolve) => setTimeout(resolve, 1500)),
        ]);
        await Promise.race([
          Promise.all(
            Array.from(document.images).map(
              (image) =>
                image.complete
                  ? Promise.resolve()
                  : new Promise<void>((resolve) => {
                      image.addEventListener("load", () => resolve(), { once: true });
                      image.addEventListener("error", () => resolve(), { once: true });
                    }),
            ),
          ),
          new Promise((resolve) => setTimeout(resolve, 2500)),
        ]);
      } catch (_) {}
    });
    await page.waitForTimeout(250);
    const format = input.format ?? "png";
    const buffer = await page.screenshot({
      type: format,
      quality: format === "jpeg" ? 92 : undefined,
      animations: "disabled",
    });
    return Buffer.from(buffer);
  } finally {
    await browser.close().catch(() => {});
  }
};
