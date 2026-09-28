/*
 * The hero's backdrop: a grid of dots, like the dashboard's grid of repositories against machines.
 * As in the dashboard, amber dots have uncommitted changes and violet ones have commits to push or
 * pull, and ripples through the pond tidy them back to green. The frog's landing sends a ripple
 * across the whole pond, a click or tap in the hero sends another, and smaller ones start on their
 * own now and then while new changes turn up. Dots fade behind the text, so it stays easy to read.
 */

/** The distance between neighbouring dots, in CSS pixels. */
const spacing = 28;
/** How far a ripple's crest travels each millisecond, in CSS pixels. */
const rippleSpeed = 0.3;
/** How wide a ripple's crest is, in CSS pixels. */
const crestWidth = 56;
/** How long a dot takes to fade from one status to the next, in milliseconds. */
const fadeDuration = 700;
/** The share of dots that start untidy, and the most that become untidy again. */
const untidyShare = 0.07;
/** How far a ripple has to lift an untidy dot to tidy it. */
const tidyingLift = 0.35;
/** How far dots fade in beside the text, in CSS pixels. */
const quietMargin = 48;

type Status = "clean" | "changes" | "sync";

interface Dot {
  readonly x: number;
  readonly y: number;
  /** How visible the dot is, from 1 in open water down to a trace behind the text. */
  readonly presence: number;
  status: Status;
  /** The status before the last change, which fades out as the current one fades in. */
  previous: Status;
  changedAt: number;
}

interface Ripple {
  readonly x: number;
  readonly y: number;
  readonly startedAt: number;
  /** How far the ripple travels before it has faded completely, in CSS pixels. */
  readonly reach: number;
}

function randomBetween(low: number, high: number): number {
  return low + Math.random() * (high - low);
}

function untidyStatus(): Status {
  return Math.random() < 0.65 ? "changes" : "sync";
}

/** How far a ripple lifts a dot: 1 on the crest as the ripple starts, fading as it spreads. */
function lift(ripple: Ripple, dot: Dot, now: number): number {
  const radius = (now - ripple.startedAt) * rippleSpeed;
  const strength = 1 - radius / ripple.reach;

  if (strength <= 0) {
    return 0;
  }

  const offset = (Math.hypot(dot.x - ripple.x, dot.y - ripple.y) - radius) / crestWidth;

  return strength * Math.exp(-offset * offset);
}

/** How visible a dot at a point is, given the boxes of text it has to stay out of the way of. */
function presenceAt(x: number, y: number, quiet: readonly DOMRect[]): number {
  let nearest = Infinity;

  for (const box of quiet) {
    const outside = Math.hypot(
      Math.max(box.left - x, 0, x - box.right),
      Math.max(box.top - y, 0, y - box.bottom),
    );

    nearest = Math.min(nearest, outside);
  }

  return 0.2 + 0.8 * Math.min(nearest / quietMargin, 1);
}

function change(dot: Dot, status: Status, now: number): void {
  dot.previous = dot.status;
  dot.status = status;
  dot.changedAt = now;
}

export function startPond(
  hero: HTMLElement,
  context: CanvasRenderingContext2D,
  frog: Element,
  text: readonly Element[],
): void {
  const canvas = context.canvas;
  const style = getComputedStyle(canvas);
  const colours = {
    clean: style.getPropertyValue("--frog"),
    changes: style.getPropertyValue("--changes"),
    sync: style.getPropertyValue("--sync"),
  } satisfies Record<Status, string>;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  // The frog lands as its entrance animation ends.
  const landsAt = performance.now() + 400;
  let landed = false;
  let width = 0;
  let height = 0;
  let dots: Dot[] = [];
  let ripples: Ripple[] = [];
  let frame = 0;
  let onScreen = false;
  let nextUntidyAt = 0;
  let nextRippleAt = landsAt + 6000;

  function frogCentre() {
    const pond = canvas.getBoundingClientRect();
    const box = frog.getBoundingClientRect();

    return { x: box.x + box.width / 2 - pond.x, y: box.y + box.height / 2 - pond.y };
  }

  function paint(dot: Dot, status: Status, weight: number, raised: number): void {
    const untidy = status !== "clean";
    const lifted = Math.min(raised, 1) * dot.presence;

    context.globalAlpha = weight * dot.presence * (untidy ? 0.85 : 0.26 + lifted * 0.6);
    context.fillStyle = colours[status];
    context.beginPath();
    context.arc(dot.x, dot.y, (untidy ? 1.9 : 1.2) + lifted * 1.3, 0, Math.PI * 2);
    context.fill();
  }

  function draw(now: number): void {
    ripples = ripples.filter((ripple) => (now - ripple.startedAt) * rippleSpeed < ripple.reach);
    context.clearRect(0, 0, width, height);

    for (const dot of dots) {
      let raised = 0;

      for (const ripple of ripples) {
        raised += lift(ripple, dot, now);
      }

      if (raised > tidyingLift && dot.status !== "clean") {
        change(dot, "clean", now);
      }

      const progress = Math.min(1, (now - dot.changedAt) / fadeDuration);

      if (progress < 1) {
        paint(dot, dot.previous, 1 - progress, raised);
      }

      paint(dot, dot.status, progress, raised);
    }
  }

  function layout(): void {
    const box = canvas.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio, 2);
    // Line the grid up with the frog, so it sits on a column and a row.
    const centre = frogCentre();
    const quiet = text.map((element) => {
      const bounds = element.getBoundingClientRect();

      return new DOMRect(bounds.x - box.x, bounds.y - box.y, bounds.width, bounds.height);
    });

    width = box.width;
    height = box.height;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    dots = [];

    for (let y = centre.y % spacing; y < height; y += spacing) {
      for (let x = centre.x % spacing; x < width; x += spacing) {
        const status = Math.random() < untidyShare ? untidyStatus() : "clean";

        dots.push({
          x,
          y,
          presence: presenceAt(x, y, quiet),
          status,
          previous: status,
          changedAt: -Infinity,
        });
      }
    }

    draw(performance.now());
  }

  function untidyOne(now: number): void {
    const untidy = dots.filter((dot) => dot.status !== "clean").length;
    const dot = dots[Math.floor(Math.random() * dots.length)];

    if (untidy < dots.length * untidyShare && dot?.status === "clean") {
      change(dot, untidyStatus(), now);
    }
  }

  function tick(now: number): void {
    if (!landed && now >= landsAt) {
      landed = true;
      ripples.push({ ...frogCentre(), startedAt: now, reach: Math.hypot(width, height) * 1.5 });
    }

    if (landed && now >= nextUntidyAt) {
      untidyOne(now);
      nextUntidyAt = now + randomBetween(200, 600);
    }

    if (now >= nextRippleAt) {
      ripples.push({
        x: randomBetween(0, width),
        y: randomBetween(0, height),
        startedAt: now,
        reach: randomBetween(200, 340),
      });
      nextRippleAt = now + randomBetween(4000, 8000);
    }

    draw(now);
    frame = requestAnimationFrame(tick);
  }

  function start(): void {
    if (frame === 0 && onScreen && !reducedMotion.matches) {
      frame = requestAnimationFrame(tick);
    }
  }

  function stop(): void {
    cancelAnimationFrame(frame);
    frame = 0;
  }

  new ResizeObserver(layout).observe(canvas);

  new IntersectionObserver(([entry]) => {
    onScreen = entry?.isIntersecting ?? false;

    if (onScreen) {
      start();
    } else {
      stop();
    }
  }).observe(hero);

  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) {
      stop();
      ripples = [];
      draw(performance.now());
    } else {
      start();
    }
  });

  hero.addEventListener("pointerdown", (event) => {
    const onControl = event.target instanceof Element && event.target.closest("a, button") !== null;

    if (event.button !== 0 || onControl || reducedMotion.matches) {
      return;
    }

    const pond = canvas.getBoundingClientRect();

    ripples.push({
      x: event.clientX - pond.x,
      y: event.clientY - pond.y,
      startedAt: performance.now(),
      reach: 420,
    });
  });
}
