import { LammpsClient } from "lammps.js/client";
import { createScene } from "./scene";
import { createSpeedControl } from "./ui";

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const USE_WRAPPED = false;
const speedInput = document.getElementById("speed") as HTMLInputElement | null;
const speedValue = document.getElementById("speed-value") as HTMLElement | null;

const MIN_SPEED = 1;
const MAX_SPEED = 30;
const DEFAULT_SPEED = 2;
const SPEED_MULTIPLIER = 10;
const FIX_EVERY = 1;
const FIX_ID = "jsasync";
const COMPUTE_SCALARS = ["ctemp", "cke"] as const;
const MAX_CALLBACK_DELAY_MS = 120;

const tempMetric = document.getElementById("compute-temp") as HTMLElement | null;
const keMetric = document.getElementById("compute-ke") as HTMLElement | null;

const formatMetric = (value: number | null | undefined, digits = 4) =>
  typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "--";

let pendingSleepTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSleepResolve: (() => void) | null = null;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    pendingSleepResolve = () => {
      pendingSleepResolve = null;
      pendingSleepTimer = null;
      resolve();
    };
    pendingSleepTimer = setTimeout(() => {
      pendingSleepResolve?.();
    }, ms);
  });

const cancelSleep = () => {
  if (pendingSleepTimer !== null) {
    clearTimeout(pendingSleepTimer);
    pendingSleepTimer = null;
  }
  pendingSleepResolve?.();
};

const delayForSpeed = (speed: number) => {
  const clamped = Math.min(Math.max(speed, MIN_SPEED), MAX_SPEED);
  const effectiveSpeed = clamped * SPEED_MULTIPLIER;
  return Math.max(0, Math.round(MAX_CALLBACK_DELAY_MS / effectiveSpeed));
};

const fetchInput = async () => {
  const res = await fetch("/in.lj");
  if (!res.ok) throw new Error("Failed to fetch LAMMPS input script");
  return res.text();
};

(async () => {
  const [script, client] = await Promise.all([fetchInput(), LammpsClient.create()]);
  client.start();

  const scene = createScene(canvas);
  let isShuttingDown = false;
  let speed = DEFAULT_SPEED;
  const speedControl = createSpeedControl({
    input: speedInput,
    label: speedValue,
    min: MIN_SPEED,
    max: MAX_SPEED,
    defaultValue: DEFAULT_SPEED,
    onChange: (value) => {
      speed = value;
    },
  });

  void client.runScriptAsync(
    script,
    async (data) => {
      if (isShuttingDown) {
        return;
      }
      const particles = data.particles;
      const bondsSnap = data.bonds;
      const boxSnap = data.box;

      scene.update({ particles, bonds: bondsSnap, box: boxSnap });

      if (tempMetric && keMetric) {
        const temp = data.computeScalars?.ctemp;
        const ke = data.computeScalars?.cke;
        tempMetric.textContent = formatMetric(temp);
        keMetric.textContent = formatMetric(ke);
      }

      scene.render();
      await sleep(delayForSpeed(speed));
    },
    { every: FIX_EVERY, fixId: FIX_ID, computeScalars: [...COMPUTE_SCALARS] }
  ).catch((error) => {
    if (!isShuttingDown) {
      console.error(error);
    }
  });

  window.addEventListener("beforeunload", () => {
    isShuttingDown = true;
    cancelSleep();
    scene.dispose();
    speedControl.dispose();
  });
})();
