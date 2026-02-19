type SpeedControl = {
  getValue: () => number;
  dispose: () => void;
};

type SpeedControlOptions = {
  input: HTMLInputElement | null;
  label: HTMLElement | null;
  min: number;
  max: number;
  defaultValue: number;
  onChange: (value: number) => void;
};

const clampValue = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const createSpeedControl = (options: SpeedControlOptions): SpeedControl => {
  const { input, label, min, max, defaultValue, onChange } = options;
  let current = clampValue(defaultValue, min, max);

  const apply = (value: number) => {
    current = clampValue(value, min, max);
    if (label) label.textContent = String(current);
    if (input) input.value = String(current);
    onChange(current);
  };

  const onInput = () => {
    if (!input) return;
    const nextValue = Number(input.value);
    apply(Number.isFinite(nextValue) ? nextValue : defaultValue);
  };

  input?.addEventListener("input", onInput);
  apply(current);

  return {
    getValue: () => current,
    dispose: () => {
      input?.removeEventListener("input", onInput);
    },
  };
};
