"use client";

import { useState, type ComponentProps } from "react";
import { Input } from "./Input";

export type DecimalInputProps = Omit<
  ComponentProps<typeof Input>,
  "value" | "defaultValue" | "onChange" | "type" | "inputMode"
> & {
  value: number | undefined;
  onValueChange: (value: number | undefined) => void;
  /** Empty input emits undefined. Otherwise an empty draft reverts on blur. */
  allowEmpty?: boolean;
  /** Optional display precision on blur; does not round the stored number. */
  decimalPlaces?: number;
  /** Both separators are accepted while typing, regardless of this preference. */
  decimalSeparator?: "," | ".";
};

function parseDraft(text: string): number | undefined {
  if (!/^-?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(text)) return undefined;
  const number = Number(text.replace(",", "."));
  return Number.isFinite(number) ? number : undefined;
}

/**
 * Keeps an editable text draft so "1," and "-" survive controlled updates.
 * Only numeric drafts (or an allowed empty value) update the parent. Use a key
 * when switching records if an identical numeric value must reset the draft.
 * As a text control, numeric bounds must be validated by the caller.
 */
export function DecimalInput({
  value,
  onValueChange,
  allowEmpty = false,
  decimalPlaces,
  decimalSeparator = ",",
  onBlur,
  ...props
}: DecimalInputProps) {
  function format(number: number | undefined): string {
    if (number === undefined || !Number.isFinite(number)) return "";
    const precision = decimalPlaces === undefined
      ? undefined
      : Math.min(20, Math.max(0, Math.trunc(decimalPlaces)));
    const text = precision === undefined ? String(number) : number.toFixed(precision);
    return decimalSeparator === "," ? text.replace(".", ",") : text;
  }

  const [state, setState] = useState(() => ({
    observedValue: value,
    lastEmittedValue: value,
    draft: format(value),
  }));

  // A parent's echo of our change keeps the exact draft and cursor position.
  // A genuinely different external value replaces it before the next paint.
  if (!Object.is(state.observedValue, value)) {
    setState({
      observedValue: value,
      lastEmittedValue: value,
      draft: Object.is(state.lastEmittedValue, value) ? state.draft : format(value),
    });
  }

  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      value={state.draft}
      onChange={(event) => {
        const draft = event.target.value;
        if (!/^-?\d*(?:[.,]\d*)?$/.test(draft)) return;

        const nextValue = parseDraft(draft);
        const shouldEmit = nextValue !== undefined || (draft === "" && allowEmpty);
        setState((previous) => ({
          ...previous,
          draft,
          lastEmittedValue: shouldEmit ? nextValue : previous.lastEmittedValue,
        }));
        if (shouldEmit) onValueChange(nextValue);
      }}
      onBlur={(event) => {
        const parsed = parseDraft(event.currentTarget.value);
        const nextValue = parsed ?? (allowEmpty ? undefined : value);
        setState({
          observedValue: value,
          lastEmittedValue: nextValue,
          draft: format(nextValue),
        });
        if (!Object.is(nextValue, value)) onValueChange(nextValue);
        onBlur?.(event);
      }}
    />
  );
}
