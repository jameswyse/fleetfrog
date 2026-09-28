import { enableCopyButtons } from "./copyButtons.ts";
import { startPond } from "./pond.ts";

function find<T extends Element>(selector: string, kind: abstract new () => T): T {
  const found = document.querySelector(selector);

  if (!(found instanceof kind)) {
    throw new Error(`The page has no ${kind.name} matching ${selector}.`);
  }

  return found;
}

const pond = find("[data-pond]", HTMLCanvasElement).getContext("2d");

if (pond !== null) {
  startPond(find("[data-hero]", HTMLElement), pond, find("[data-frog]", SVGSVGElement), [
    ...document.querySelectorAll("[data-pond-text]"),
  ]);
}

enableCopyButtons(find("[data-copy-status]", HTMLElement));
