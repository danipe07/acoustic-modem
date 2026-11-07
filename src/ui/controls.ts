import { h } from './dom.ts';

export interface SliderOptions {
  label: string;
  help?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (value: number) => string;
  onInput: (value: number) => void;
}

/** Labelled range input with a live value read-out. */
export function slider(o: SliderOptions): HTMLElement {
  const output = h('output', {}, o.format(o.value));
  const input = h('input', {
    type: 'range',
    min: o.min,
    max: o.max,
    step: o.step,
    value: o.value,
    'aria-label': o.label,
  });
  input.addEventListener('input', () => {
    const value = Number(input.value);
    output.textContent = o.format(value);
    o.onInput(value);
  });
  return h(
    'label',
    { class: 'control', title: o.help },
    h('span', { class: 'control-head' }, h('span', {}, o.label), output),
    input,
  );
}

export interface SelectOptions<T extends string | number> {
  label: string;
  help?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}

export function select<T extends string | number>(o: SelectOptions<T>): HTMLElement {
  const el = h('select', { 'aria-label': o.label });
  for (const option of o.options) {
    el.append(
      h(
        'option',
        { value: String(option.value), selected: option.value === o.value },
        option.label,
      ),
    );
  }
  el.addEventListener('change', () => {
    const chosen = o.options.find((option) => String(option.value) === el.value);
    if (chosen) o.onChange(chosen.value);
  });
  return h(
    'label',
    { class: 'control', title: o.help },
    h('span', { class: 'control-head' }, h('span', {}, o.label)),
    el,
  );
}
