// Tiny canvas particle renderer for the docs examples: orthographic
// projection with a slow turntable rotation, depth-sorted shaded atoms,
// optional bonds, per-atom coloring, and the simulation box wireframe.
// Accepts both the main-thread snapshot shapes (ParticleArrays/BoxArrays)
// and the worker step shapes (WorkerParticleData/WorkerBoxData) — it only
// touches their shared fields.

interface ParticlesLike {
  count: number;
  positions: ArrayLike<number>;
  types?: ArrayLike<number>;
}

interface BoxLike {
  origin: ArrayLike<number>;
  lengths: ArrayLike<number>;
}

interface BondsLike {
  count: number;
  first: ArrayLike<number>;
  second: ArrayLike<number>;
}

export interface DrawData {
  particles?: ParticlesLike | null;
  box?: BoxLike | null;
  bonds?: BondsLike | null;
}

export interface DrawOptions {
  /** One value per atom; colors atoms on a sequential blue ramp. */
  colorBy?: ArrayLike<number>;
  /** Draw data.bonds as lines. Default: draw them when present. */
  bonds?: boolean;
  /** Extra vertical lines (x positions in simulation units), e.g. walls. */
  walls?: { axis: 0 | 1 | 2; position: number }[];
  /** Rotation speed in radians per frame (0 disables the turntable). */
  spin?: number;
}

export type DrawFn = (data: DrawData, opts?: DrawOptions) => void;

const TYPE_COLORS: [number, number, number][] = [
  [0x7d, 0xd3, 0xfc], // type 1: light sky
  [0xfb, 0x92, 0x3c], // type 2: orange
  [0x86, 0xef, 0xac], // type 3: green
  [0xc4, 0xb5, 0xfd] // type 4: violet
];

// sequential ramp endpoints for colorBy (low -> high on dark surface)
const RAMP_LO: [number, number, number] = [0x1c, 0x5c, 0xab];
const RAMP_HI: [number, number, number] = [0xcd, 0xe2, 0xfb];

const SURFACE = "#081020";

function rgb(c: [number, number, number], alpha = 1): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

function lerpColor(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ];
}

export function createDraw(canvas: HTMLCanvasElement): DrawFn {
  const ctx = canvas.getContext("2d")!;
  let angle = 0.6;

  return function draw(data: DrawData, opts: DrawOptions = {}) {
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

    const particles = data.particles;
    const box = data.box;
    if (!particles || particles.count === 0) return;

    angle += opts.spin ?? 0.004;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    // rotate around the box center (or the particle centroid without a box)
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let extent = 1;
    if (box && box.lengths.length >= 3) {
      cx = box.origin[0] + box.lengths[0] / 2;
      cy = box.origin[1] + box.lengths[1] / 2;
      cz = box.origin[2] + box.lengths[2] / 2;
      extent = Math.max(box.lengths[0], box.lengths[1], box.lengths[2]);
    } else {
      for (let i = 0; i < particles.count; i += 1) {
        cx += particles.positions[i * 3];
        cy += particles.positions[i * 3 + 1];
        cz += particles.positions[i * 3 + 2];
      }
      cx /= particles.count;
      cy /= particles.count;
      cz /= particles.count;
      let max = 1;
      for (let i = 0; i < particles.count; i += 1) {
        max = Math.max(
          max,
          Math.abs(particles.positions[i * 3] - cx),
          Math.abs(particles.positions[i * 3 + 1] - cy)
        );
      }
      extent = max * 2;
    }

    const scale = (Math.min(w, h) * 0.82) / (extent * 1.42); // diag headroom for rotation
    const ox = w / 2;
    const oy = h / 2;

    // project: rotate around the y (vertical) axis, then orthographic xy
    const project = (x: number, y: number, z: number): [number, number, number] => {
      const dx = x - cx;
      const dz = z - cz;
      const rx = dx * cos + dz * sin;
      const rz = -dx * sin + dz * cos;
      return [ox + rx * scale, oy - (y - cy) * scale, rz];
    };

    // box wireframe (drawn first, behind everything)
    if (box && box.lengths.length >= 3) {
      const corners: [number, number, number][] = [];
      for (let i = 0; i < 8; i += 1) {
        corners.push(
          project(
            box.origin[0] + (i & 1 ? box.lengths[0] : 0),
            box.origin[1] + (i & 2 ? box.lengths[1] : 0),
            box.origin[2] + (i & 4 ? box.lengths[2] : 0)
          )
        );
      }
      const edges = [
        [0, 1], [2, 3], [4, 5], [6, 7],
        [0, 2], [1, 3], [4, 6], [5, 7],
        [0, 4], [1, 5], [2, 6], [3, 7]
      ];
      ctx.strokeStyle = "rgba(56, 189, 248, 0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const [a, b] of edges) {
        ctx.moveTo(corners[a][0], corners[a][1]);
        ctx.lineTo(corners[b][0], corners[b][1]);
      }
      ctx.stroke();
    }

    // walls: rendered as translucent planes (two projected edges + fill)
    if (opts.walls && box && box.lengths.length >= 3) {
      for (const wall of opts.walls) {
        const lo = [box.origin[0], box.origin[1], box.origin[2]];
        const hi = [
          box.origin[0] + box.lengths[0],
          box.origin[1] + box.lengths[1],
          box.origin[2] + box.lengths[2]
        ];
        const pts: [number, number, number][] = [];
        // plane at wall.position along wall.axis, spanning the two other axes
        const axes = [0, 1, 2].filter((a) => a !== wall.axis) as [number, number];
        for (const [ua, va] of [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1]
        ]) {
          const p = [0, 0, 0];
          p[wall.axis] = wall.position;
          p[axes[0]] = ua ? hi[axes[0]] : lo[axes[0]];
          p[axes[1]] = va ? hi[axes[1]] : lo[axes[1]];
          pts.push(project(p[0], p[1], p[2]));
        }
        ctx.fillStyle = "rgba(251, 191, 36, 0.10)";
        ctx.strokeStyle = "rgba(251, 191, 36, 0.45)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let k = 1; k < 4; k += 1) ctx.lineTo(pts[k][0], pts[k][1]);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    // bonds
    const bonds = data.bonds;
    if (bonds && bonds.count > 0 && opts.bonds !== false) {
      ctx.strokeStyle = "rgba(147, 164, 196, 0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < bonds.count; i += 1) {
        const a = project(bonds.first[i * 3], bonds.first[i * 3 + 1], bonds.first[i * 3 + 2]);
        const b = project(bonds.second[i * 3], bonds.second[i * 3 + 1], bonds.second[i * 3 + 2]);
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
      }
      ctx.stroke();
    }

    // atoms, depth sorted (far first)
    const count = particles.count;
    const order = new Array<number>(count);
    const depth = new Float32Array(count);
    const projected = new Float32Array(count * 2);
    for (let i = 0; i < count; i += 1) {
      const p = project(
        particles.positions[i * 3],
        particles.positions[i * 3 + 1],
        particles.positions[i * 3 + 2]
      );
      projected[i * 2] = p[0];
      projected[i * 2 + 1] = p[1];
      depth[i] = p[2];
      order[i] = i;
    }
    order.sort((a, b) => depth[a] - depth[b]);

    // color scale bounds for colorBy
    let lo = Infinity;
    let hi = -Infinity;
    const colorBy = opts.colorBy;
    if (colorBy) {
      for (let i = 0; i < count; i += 1) {
        const v = colorBy[i];
        if (Number.isFinite(v)) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      if (!(hi > lo)) {
        lo = 0;
        hi = 1;
      }
    }

    const baseRadius = Math.max(1.6, Math.min(7, scale * 0.35));
    const halfSpan = extent * 0.71;
    for (const i of order) {
      const x = projected[i * 2];
      const y = projected[i * 2 + 1];
      // depth in [0, 1]: 0 far, 1 near
      const dz = Math.max(0, Math.min(1, (depth[i] + halfSpan) / (halfSpan * 2)));
      let color: [number, number, number];
      if (colorBy) {
        color = lerpColor(RAMP_LO, RAMP_HI, (colorBy[i] - lo) / (hi - lo));
      } else {
        const type = particles.types ? Number(particles.types[i]) : 1;
        color = TYPE_COLORS[(type - 1 + TYPE_COLORS.length * 8) % TYPE_COLORS.length];
      }
      const radius = baseRadius * (0.75 + dz * 0.45);
      const shade = 0.45 + dz * 0.55;
      ctx.fillStyle = rgb(
        [Math.round(color[0] * shade), Math.round(color[1] * shade), Math.round(color[2] * shade)]
      );
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      // specular hint on near atoms
      if (dz > 0.55 && radius > 2.4) {
        ctx.fillStyle = "rgba(255,255,255,0.28)";
        ctx.beginPath();
        ctx.arc(x - radius * 0.3, y - radius * 0.3, radius * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };
}
