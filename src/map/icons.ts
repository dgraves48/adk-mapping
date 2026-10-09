import type { Map } from "maplibre-gl";
import { COLORS } from "./style";

/** Small map icons drawn on a canvas, so no sprite sheet has to ship. */
function draw(size: number, paint: (ctx: CanvasRenderingContext2D, s: number) => void) {
  const ratio = 2;
  const c = document.createElement("canvas");
  c.width = c.height = size * ratio;
  const ctx = c.getContext("2d")!;
  ctx.scale(ratio, ratio);
  paint(ctx, size);
  return { image: ctx.getImageData(0, 0, c.width, c.height), pixelRatio: ratio };
}

function triangle(fill: string, size: number) {
  return draw(size, (ctx, s) => {
    ctx.beginPath();
    ctx.moveTo(s / 2, 1.5);
    ctx.lineTo(s - 1.5, s - 2);
    ctx.lineTo(1.5, s - 2);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
  });
}

/** Climbed: solid green triangle with a white check. */
function peakDone() {
  return draw(24, (ctx, s) => {
    ctx.beginPath();
    ctx.moveTo(s / 2, 1);
    ctx.lineTo(s - 1, s - 1.5);
    ctx.lineTo(1, s - 1.5);
    ctx.closePath();
    ctx.fillStyle = COLORS.peakDone;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s * 0.33, s * 0.64);
    ctx.lineTo(s * 0.46, s * 0.77);
    ctx.lineTo(s * 0.69, s * 0.48);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  });
}

/** Not yet climbed: hollow outline (white fill so it reads on any background). */
function peakTodo() {
  return draw(18, (ctx, s) => {
    ctx.beginPath();
    ctx.moveTo(s / 2, 2);
    ctx.lineTo(s - 2, s - 2.5);
    ctx.lineTo(2, s - 2.5);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.strokeStyle = COLORS.peakTodo;
    ctx.lineWidth = 2.2;
    ctx.lineJoin = "round";
    ctx.fill();
    ctx.stroke();
  });
}

function campsite(fill: string) {
  return draw(14, (ctx, s) => {
    ctx.fillStyle = fill;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2 - 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(s / 2, 3.5);
    ctx.lineTo(s - 3.5, s - 4);
    ctx.lineTo(3.5, s - 4);
    ctx.closePath();
    ctx.fill();
  });
}

function leanto(fill: string) {
  return draw(14, (ctx, s) => {
    ctx.fillStyle = fill;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(1.5, s - 1.5);
    ctx.lineTo(1.5, 5);
    ctx.lineTo(s - 1.5, 1.5);
    ctx.lineTo(s - 1.5, s - 1.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  });
}

export function addIcons(map: Map) {
  const icons: Record<string, ReturnType<typeof draw>> = {
    "peak-done": peakDone(),
    "peak-todo": peakTodo(),
    "peak-other": triangle("#8a8a8a", 10),
    campsite: campsite("#e07b00"),
    leanto: leanto("#6d4c41"),
    "campsite-mine": campsite(COLORS.mine),
    "leanto-mine": leanto(COLORS.mine),
    trailhead: draw(14, (ctx, s) => {
      ctx.fillStyle = "#1a5fb4";
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(1, 1, s - 2, s - 2, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("P", s / 2, s / 2 + 0.5);
    }),
  };
  for (const [name, { image, pixelRatio }] of Object.entries(icons)) {
    if (!map.hasImage(name)) map.addImage(name, image, { pixelRatio });
  }
}
