// Tiny dependency-free line chart for the docs examples.
// Two modes per series: streaming append (add) and replace (set).
// Palette below is CVD- and contrast-validated against the pane surface.

const SERIES_COLORS = ["#3987e5", "#199e70", "#c98500", "#9085e9"];
const SURFACE = "#081020";
const GRID = "#16233c";
const INK = "#93a4c4";
const INK_FAINT = "#5a6b8c";
const FONT = "10px 'IBM Plex Mono', ui-monospace, monospace";

const MAX_POINTS = 2000;

interface Series {
  label: string;
  x: number[];
  y: number[];
}

export interface ChartApi {
  /** Append one sample per labelled series at a shared x (streaming mode). */
  add(x: number, values: Record<string, number | null | undefined>): void;
  /** Replace a series wholesale (histogram-like data, e.g. g(r)). */
  set(label: string, x: ArrayLike<number>, y: ArrayLike<number>): void;
  /** Optional axis titles, e.g. axes("step", "temperature"). */
  axes(xLabel: string, yLabel: string): void;
  clear(): void;
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return [min];
  }
  const span = max - min;
  const step = 10 ** Math.floor(Math.log10(span / count));
  const err = span / count / step;
  const mult = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
  const tick = step * mult;
  const start = Math.ceil(min / tick) * tick;
  const ticks: number[] = [];
  for (let v = start; v <= max + tick * 1e-6; v += tick) {
    ticks.push(v);
  }
  return ticks;
}

function fmt(value: number): string {
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 100000 || abs < 0.001) return value.toExponential(1);
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 1) return value.toFixed(2).replace(/\.?0+$/, "");
  return value.toFixed(3).replace(/\.?0+$/, "");
}

export function createChart(host: HTMLElement): ChartApi {
  const legend = document.createElement("div");
  legend.className = "chart-legend";
  const canvas = document.createElement("canvas");
  const tip = document.createElement("div");
  tip.className = "chart-tip";
  tip.style.display = "none";
  host.append(legend, canvas, tip);

  const ctx = canvas.getContext("2d")!;
  const series = new Map<string, Series>();
  let xLabel = "";
  let yLabel = "";
  let raf = 0;

  const margins = { top: 12, right: 14, bottom: 26, left: 48 };

  function scheduleRender() {
    if (!raf) {
      raf = requestAnimationFrame(() => {
        raf = 0;
        render();
      });
    }
  }

  function ensureSeries(label: string): Series {
    let s = series.get(label);
    if (!s) {
      s = { label, x: [], y: [] };
      series.set(label, s);
      renderLegend();
    }
    return s;
  }

  function renderLegend() {
    legend.textContent = "";
    let i = 0;
    for (const s of series.values()) {
      const item = document.createElement("span");
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = SERIES_COLORS[i % SERIES_COLORS.length];
      item.append(swatch, document.createTextNode(s.label));
      legend.appendChild(item);
      i += 1;
    }
  }

  interface Frame {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
    px: (x: number) => number;
    py: (y: number) => number;
    w: number;
    h: number;
  }

  function computeFrame(): Frame | null {
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const s of series.values()) {
      for (let i = 0; i < s.x.length; i += 1) {
        const x = s.x[i];
        const y = s.y[i];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    }
    if (xMin > xMax || yMin > yMax) return null;
    if (xMin === xMax) {
      xMin -= 1;
      xMax += 1;
    }
    if (yMin === yMax) {
      const pad = Math.abs(yMin) * 0.1 || 1;
      yMin -= pad;
      yMax += pad;
    } else {
      const pad = (yMax - yMin) * 0.08;
      yMin -= pad;
      yMax += pad;
    }
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const px = (x: number) =>
      margins.left + ((x - xMin) / (xMax - xMin)) * (w - margins.left - margins.right);
    const py = (y: number) =>
      h - margins.bottom - ((y - yMin) / (yMax - yMin)) * (h - margins.top - margins.bottom);
    return { xMin, xMax, yMin, yMax, px, py, w, h };
  }

  function render() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = SURFACE;
    ctx.fillRect(0, 0, w, h);

    const frame = computeFrame();
    if (!frame) return;

    ctx.font = FONT;

    // recessive grid + tick labels
    ctx.strokeStyle = GRID;
    ctx.fillStyle = INK_FAINT;
    ctx.lineWidth = 1;
    for (const t of niceTicks(frame.yMin, frame.yMax)) {
      const y = frame.py(t);
      ctx.beginPath();
      ctx.moveTo(margins.left, y);
      ctx.lineTo(w - margins.right, y);
      ctx.stroke();
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(fmt(t), margins.left - 6, y);
    }
    for (const t of niceTicks(frame.xMin, frame.xMax, 5)) {
      const x = frame.px(t);
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(fmt(t), x, h - margins.bottom + 6);
    }

    // axis titles
    ctx.fillStyle = INK;
    if (xLabel) {
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillText(xLabel, w - margins.right, h - margins.bottom + 6);
    }
    if (yLabel) {
      ctx.save();
      ctx.translate(10, margins.top);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(yLabel, 0, 0);
      ctx.restore();
    }

    // series lines
    let i = 0;
    for (const s of series.values()) {
      ctx.strokeStyle = SERIES_COLORS[i % SERIES_COLORS.length];
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.beginPath();
      let started = false;
      for (let k = 0; k < s.x.length; k += 1) {
        if (!Number.isFinite(s.y[k])) continue;
        const x = frame.px(s.x[k]);
        const y = frame.py(s.y[k]);
        if (started) {
          ctx.lineTo(x, y);
        } else {
          ctx.moveTo(x, y);
          started = true;
        }
      }
      ctx.stroke();
      i += 1;
    }
  }

  // hover readout: nearest x across all series
  canvas.addEventListener("mousemove", (event) => {
    const frame = computeFrame();
    if (!frame) return;
    const rect = canvas.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const dataX = frame.xMin + ((mx - margins.left) / (frame.w - margins.left - margins.right)) * (frame.xMax - frame.xMin);
    const lines: string[] = [];
    let xShown: number | null = null;
    for (const s of series.values()) {
      if (s.x.length === 0) continue;
      // binary-ish nearest search (x is monotone for streaming; fine for set too)
      let best = 0;
      let bestDist = Infinity;
      for (let k = 0; k < s.x.length; k += 1) {
        const d = Math.abs(s.x[k] - dataX);
        if (d < bestDist) {
          bestDist = d;
          best = k;
        }
      }
      xShown = s.x[best];
      lines.push(`${s.label}: ${fmt(s.y[best])}`);
    }
    if (lines.length === 0 || xShown === null) {
      tip.style.display = "none";
      return;
    }
    tip.textContent = `${xLabel || "x"} ${fmt(xShown)} · ${lines.join(" · ")}`;
    tip.style.display = "block";
    const tipX = Math.min(mx + 12, frame.w - tip.offsetWidth - 4);
    tip.style.left = `${Math.max(4, tipX)}px`;
    tip.style.top = `${event.clientY - rect.top + 14}px`;
  });
  canvas.addEventListener("mouseleave", () => {
    tip.style.display = "none";
  });

  const observer = new ResizeObserver(scheduleRender);
  observer.observe(canvas);

  return {
    add(x, values) {
      for (const [label, value] of Object.entries(values)) {
        if (value === null || value === undefined) continue;
        const s = ensureSeries(label);
        s.x.push(x);
        s.y.push(value);
        if (s.x.length > MAX_POINTS) {
          s.x.shift();
          s.y.shift();
        }
      }
      scheduleRender();
    },
    set(label, x, y) {
      const s = ensureSeries(label);
      s.x = Array.from(x);
      s.y = Array.from(y);
      scheduleRender();
    },
    axes(xl, yl) {
      xLabel = xl;
      yLabel = yl;
      scheduleRender();
    },
    clear() {
      series.clear();
      renderLegend();
      scheduleRender();
    }
  };
}
