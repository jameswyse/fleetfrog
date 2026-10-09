import { frameMargin } from "./browserFrame.ts";

export const socialPreviewSize = { width: 1200, height: 630 };

const windowWidth = 1056;
const windowTop = 236;

export const paintPond = `(() => {
  const spacing = 28;
  const quietMargin = 20;
  const canvas = document.querySelector(".pond");
  const context = canvas.getContext("2d");
  const ratio = window.devicePixelRatio;
  const quiet = Array.from(document.querySelectorAll("[data-quiet]"), (element) => element.getBoundingClientRect());
  const frog = document.querySelector(".frog").getBoundingClientRect();
  const centre = { x: frog.x + frog.width / 2, y: frog.y + frog.height / 2 };
  let seed = 0x5eed;

  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };

  const isQuiet = (x, y) =>
    quiet.some(
      (box) =>
        x > box.left - quietMargin &&
        x < box.right + quietMargin &&
        y > box.top - quietMargin &&
        y < box.bottom + quietMargin,
    );

  canvas.width = canvas.clientWidth * ratio;
  canvas.height = canvas.clientHeight * ratio;
  context.scale(ratio, ratio);

  for (let y = centre.y % spacing; y < canvas.clientHeight; y += spacing) {
    for (let x = centre.x % spacing; x < canvas.clientWidth; x += spacing) {
      const roll = random();
      const untidy = roll < 0.07;

      if (isQuiet(x, y)) {
        continue;
      }

      context.globalAlpha = untidy ? 0.85 : 0.26;
      context.fillStyle = untidy ? (roll < 0.035 ? "#e8b04f" : "#bca1ed") : "#78df3e";
      context.beginPath();
      context.arc(x, y, untidy ? 1.9 : 1.2, 0, Math.PI * 2);
      context.fill();
    }
  }
})()`;

export function socialPreview(options: {
  readonly screenshot: string;
  readonly screenshotWidth: number;
  readonly frog: string;
  readonly fonts: string;
}): string {
  const scale = windowWidth / (options.screenshotWidth - frameMargin * 2);
  const width = options.screenshotWidth * scale;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      ${options.fonts}
      * { box-sizing: border-box; margin: 0; }
      html, body {
        width: ${socialPreviewSize.width}px;
        height: ${socialPreviewSize.height}px;
        overflow: hidden;
        background: #05170f;
      }
      body {
        position: relative;
        color: #e7f2ea;
        font-family: "Fraunces Variable", serif;
        -webkit-font-smoothing: antialiased;
      }
      .pond {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        mask-image: radial-gradient(ellipse 75% 70% at 50% 30%, black 35%, transparent 100%);
      }
      .frog {
        position: absolute;
        top: 34px;
        left: 50%;
        width: 92px;
        translate: -50% 0;
      }
      .frog::before {
        content: "";
        position: absolute;
        inset: -60%;
        background: radial-gradient(closest-side, rgb(120 223 62 / 0.22), transparent);
      }
      .frog img {
        position: relative;
        display: block;
        width: 100%;
        filter: drop-shadow(0 10px 20px rgb(120 223 62 / 0.3));
      }
      h1 {
        position: absolute;
        top: 142px;
        left: 50%;
        translate: -50% 0;
        white-space: nowrap;
        font-size: 54px;
        font-weight: 600;
        line-height: 1.04;
        letter-spacing: -0.03em;
        font-variation-settings: "SOFT" 100;
      }
      em {
        color: #78df3e;
        font-weight: 500;
      }
      .screenshot {
        position: absolute;
        top: ${windowTop - frameMargin * scale}px;
        left: ${(socialPreviewSize.width - width) / 2}px;
        width: ${width}px;
      }
      .screenshot::before {
        content: "";
        position: absolute;
        inset: 8% 6% -4%;
        background: radial-gradient(closest-side, rgb(120 223 62 / 0.16), transparent);
      }
      .screenshot img {
        position: relative;
        display: block;
        width: 100%;
      }
    </style>
  </head>
  <body>
    <canvas class="pond"></canvas>
    <div class="frog" data-quiet><img src="${options.frog}" alt="" /></div>
    <h1 data-quiet>See every repository on <em>every machine</em>.</h1>
    <div class="screenshot"><img src="${options.screenshot}" alt="" /></div>
  </body>
</html>`;
}
