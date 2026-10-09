import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Schema } from "effect";
import { chromium } from "playwright";

import { demoMachines } from "../../apps/hub/src/demo/demoFleetData.ts";
import { runCommand } from "../e2e/environment.ts";
import { browserFrame, frameMargin } from "./browserFrame.ts";
import { repository, startDemoHub } from "./demoHub.ts";

import type { Browser, Page } from "playwright";

import type { ColorScheme } from "./browserFrame.ts";

const viewport = { width: 1920, height: 1136 };
const pixelRatio = 2;
const host = "fleetfrog.lily-pond.ts.net";

const outputs: ReadonlyArray<{
  readonly scheme: ColorScheme;
  readonly file: string;
  readonly scale: number;
}> = [
  { scheme: "light", file: "docs/images/screenshot-light.webp", scale: 0.5 },
  { scheme: "dark", file: "docs/images/screenshot-dark.webp", scale: 0.5 },
  { scheme: "dark", file: "apps/site/src/images/screenshot.webp", scale: 0.5 },
  { scheme: "dark", file: "apps/site/src/images/screenshot@2x.webp", scale: 1 },
];

function fontFace(family: string, file: string): string {
  const data = readFileSync(path.join(repository, "node_modules", file)).toString("base64");

  return `@font-face { font-family: "${family}"; font-weight: 100 900; font-display: block; src: url(data:font/woff2;base64,${data}) format("woff2"); }`;
}

const fonts = [
  fontFace("Inter Variable", "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"),
  fontFace(
    "JetBrains Mono Variable",
    "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
  ),
].join("\n");

const pinnedFonts = `${fonts}
html { font-family: "Inter Variable", sans-serif !important; }
:root { --font-mono: "JetBrains Mono Variable", monospace !important; }`;

const favicon = `data:image/svg+xml;base64,${readFileSync(
  path.join(repository, "apps/web/public/favicon.svg"),
).toString("base64")}`;

const decodeBase64 = Schema.decodeUnknownSync(Schema.String);

const settled =
  "Promise.all([document.fonts.ready, ...Array.from(document.images, (image) => image.decode())])";

const quiet = `new Promise((resolve) => {
  let timer;
  const finish = () => {
    observer.disconnect();
    resolve(true);
  };
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(finish, 750);
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  timer = setTimeout(finish, 750);
})`;

const encoder = `<script>
  async function encodeWebp(source, factor) {
    const image = new Image();

    image.src = source;
    await image.decode();

    const canvas = document.createElement("canvas");

    canvas.width = Math.round(image.naturalWidth * factor);
    canvas.height = Math.round(image.naturalHeight * factor);

    const context = canvas.getContext("2d");

    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL("image/webp", 0.92).split(",")[1];
  }
</script>`;

async function capture(browser: Browser, url: string, scheme: ColorScheme): Promise<Buffer> {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: pixelRatio,
    colorScheme: scheme,
    reducedMotion: "reduce",
    bypassCSP: true,
  });

  try {
    const page = await context.newPage();

    await page.goto(url);
    await page.addStyleTag({ content: pinnedFonts });
    await page
      .getByText(`${demoMachines.length} of ${demoMachines.length} online`)
      .waitFor({ timeout: 30_000 });
    await page.evaluate(quiet);
    await page.evaluate(settled);

    return await page.screenshot({ animations: "disabled", caret: "hide" });
  } finally {
    await context.close();
  }
}

async function frame(browser: Browser, screenshot: Buffer, scheme: ColorScheme): Promise<Buffer> {
  const page = await browser.newPage({
    viewport: { width: viewport.width + frameMargin * 2, height: viewport.height },
    deviceScaleFactor: pixelRatio,
  });

  try {
    await page.setContent(
      browserFrame({
        scheme,
        screenshot: `data:image/png;base64,${screenshot.toString("base64")}`,
        width: viewport.width,
        height: viewport.height,
        host,
        title: "FleetFrog",
        favicon,
        fonts,
      }),
    );
    await page.evaluate(settled);

    return await page.screenshot({ fullPage: true, omitBackground: true });
  } finally {
    await page.close();
  }
}

async function encodeWebp(encoderPage: Page, png: Buffer, scale: number): Promise<Buffer> {
  const source = JSON.stringify(`data:image/png;base64,${png.toString("base64")}`);
  const encoded = decodeBase64(await encoderPage.evaluate(`encodeWebp(${source}, ${scale})`));

  return Buffer.from(encoded, "base64");
}

const pnpmPath = process.env.npm_execpath;

if (pnpmPath === undefined) {
  throw new Error("Run this command through pnpm screenshots.");
}

const controller = new AbortController();
const interrupt = () => controller.abort("SIGINT");

process.once("SIGINT", interrupt);

await runCommand(pnpmPath, ["build", "--filter=@fleetfrog/web"], process.env, controller.signal);

const hub = await startDemoHub({ signal: controller.signal });

try {
  const browser = await chromium.launch();

  try {
    const encoderPage = await browser.newPage();

    await encoderPage.setContent(encoder);

    for (const scheme of ["light", "dark"] as const) {
      const framed = await frame(browser, await capture(browser, hub.url, scheme), scheme);

      for (const output of outputs.filter((candidate) => candidate.scheme === scheme)) {
        const destination = path.join(repository, output.file);

        mkdirSync(path.dirname(destination), { recursive: true });
        writeFileSync(destination, await encodeWebp(encoderPage, framed, output.scale));
        process.stdout.write(`Wrote ${output.file}\n`);
      }
    }
  } finally {
    await browser.close();
  }
} finally {
  process.removeListener("SIGINT", interrupt);
  await hub.close();
}
