export type ColorScheme = "light" | "dark";

export const frameMargin = 64;

const palettes = {
  light: {
    strip: "#dfe4df",
    toolbar: "#f4f6f4",
    field: "#ffffff",
    fieldLine: "#d1d6d1",
    line: "#d1d6d1",
    ink: "#1b1c1b",
    muted: "#5c605c",
    edge: "rgb(0 0 0 / 0.14)",
    shadow: "0 2px 6px rgb(0 0 0 / 0.08), 0 28px 72px -16px rgb(0 0 0 / 0.32)",
  },
  dark: {
    strip: "#0c0e0c",
    toolbar: "#1e221e",
    field: "#111311",
    fieldLine: "#2c312c",
    line: "#2c312c",
    ink: "#e5e9e5",
    muted: "#9fa89f",
    edge: "rgb(255 255 255 / 0.12)",
    shadow: "0 2px 6px rgb(0 0 0 / 0.3), 0 28px 72px -16px rgb(0 0 0 / 0.6)",
  },
} satisfies Record<ColorScheme, Record<string, string>>;

const icons = {
  back: '<path d="m15 18-6-6 6-6"/>',
  forward: '<path d="m9 18 6-6-6-6"/>',
  reload: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  menu: '<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>',
};

function icon(name: keyof typeof icons, size: number): string {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}

export function browserFrame(options: {
  readonly scheme: ColorScheme;
  readonly screenshot: string;
  readonly width: number;
  readonly height: number;
  readonly host: string;
  readonly title: string;
  readonly favicon: string;
  readonly fonts: string;
}): string {
  const colour = palettes[options.scheme];

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      ${options.fonts}
      * { box-sizing: border-box; margin: 0; }
      html, body { background: transparent; }
      body {
        padding: ${frameMargin}px;
        font-family: "Inter Variable", sans-serif;
        -webkit-font-smoothing: antialiased;
        color: ${colour.ink};
      }
      .window {
        width: ${options.width}px;
        border-radius: 14px;
        overflow: hidden;
        background: ${colour.toolbar};
        box-shadow: 0 0 0 1px ${colour.edge}, ${colour.shadow};
      }
      .strip {
        display: flex;
        align-items: flex-end;
        gap: 6px;
        height: 46px;
        padding: 0 12px 0 20px;
        background: ${colour.strip};
      }
      .lights { display: flex; gap: 8px; align-self: center; margin-right: 18px; }
      .lights span { width: 12px; height: 12px; border-radius: 50%; box-shadow: inset 0 0 0 0.5px rgb(0 0 0 / 0.2); }
      .tab {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 248px;
        height: 36px;
        padding: 0 10px 0 14px;
        border-radius: 10px 10px 0 0;
        background: ${colour.toolbar};
        font-size: 13px;
        font-weight: 500;
      }
      .tab img { width: 16px; height: 16px; }
      .tab .title { flex: 1; }
      .new-tab { display: grid; place-items: center; width: 28px; height: 28px; margin-bottom: 4px; color: ${colour.muted}; }
      .icon { flex: none; color: ${colour.muted}; }
      .toolbar {
        display: flex;
        align-items: center;
        gap: 16px;
        height: 48px;
        padding: 0 18px;
        border-bottom: 1px solid ${colour.line};
      }
      .field {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1;
        height: 32px;
        padding: 0 14px;
        border-radius: 16px;
        border: 1px solid ${colour.fieldLine};
        background: ${colour.field};
        font-size: 14px;
        letter-spacing: -0.005em;
      }
      .page { display: block; width: ${options.width}px; height: ${options.height}px; }
    </style>
  </head>
  <body>
    <div class="window">
      <div class="strip">
        <div class="lights">
          <span style="background: #ff5f57"></span>
          <span style="background: #febc2e"></span>
          <span style="background: #28c840"></span>
        </div>
        <div class="tab">
          <img src="${options.favicon}" alt="" />
          <span class="title">${options.title}</span>
          ${icon("close", 14)}
        </div>
        <div class="new-tab">${icon("plus", 16)}</div>
      </div>
      <div class="toolbar">
        ${icon("back", 18)}
        ${icon("forward", 18)}
        ${icon("reload", 16)}
        <div class="field">${icon("lock", 14)}<span>${options.host}</span></div>
        ${icon("menu", 18)}
      </div>
      <img class="page" src="${options.screenshot}" alt="" />
    </div>
  </body>
</html>`;
}
