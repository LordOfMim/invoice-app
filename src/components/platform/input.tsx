"use client";

import * as React from "react";
import { SentIcon } from "@hugeicons/core-free-icons";

import { cn } from "./lib/cn";
import { HugeiconsIcon } from "./icon";

/*
 * Source: flow page — trigger/result prose fields (radius 10, #DFE3E9 hairline,
 * 15px/22 medium ink text, faint resize glyph bottom-right) and the inspector
 * message input (radius 8, 12.5px, disabled-ink placeholder, send icon).
 */

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** lg = 36px auth-screen scale-up (formalized sign-in deviation). */
  size?: "md" | "lg";
}

export function Input({ className, size = "md", ...props }: InputProps) {
  return (
    <input
      data-slot="input"
      className={cn(
        "w-full rounded-md border border-line-input bg-surface px-3 font-sans font-medium text-ink outline-none transition-colors placeholder:font-normal placeholder:text-ink-disabled focus-visible:border-line-strong focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50",
        size === "lg" ? "h-9 text-base" : "h-8 text-md",
        className,
      )}
      {...props}
    />
  );
}

/*
 * Prose field — the large trigger/result textarea. The corner glyph is a real
 * drag handle: vertical drag resizes the field (min = natural rows height).
 * Direct manipulation — the height follows the pointer 1:1, no transition.
 */
export interface ProseFieldProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /**
   * Type voice of the textarea. `prose` is the flow-page original (15px/22
   * medium); `label` matches the `Input` recipe (12.5px medium) so the field
   * sits quietly next to regular inputs in forms (workspace-create sheet).
   */
  text?: "prose" | "label";
  /**
   * Inline marks for the text (e.g. `{{key}}` references). Rendered as an
   * aria-hidden mirror behind a transparent-text textarea with the same
   * font, padding and wrapping; the marks may only paint (background,
   * underline, outline) — never change metrics, or the caret drifts.
   */
  highlight?: (text: string) => React.ReactNode;
  ref?: React.Ref<HTMLTextAreaElement>;
}

const proseFieldText = {
  prose: "pt-3.5 pr-6 pb-3 pl-4 text-xl font-medium tracking-snug",
  label: "pt-2.5 pr-6 pb-2.25 pl-3 text-md font-medium",
};

export function ProseField({
  className,
  rows = 2,
  text = "prose",
  highlight,
  ref,
  onChange,
  onScroll,
  ...props
}: ProseFieldProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const mirrorRef = React.useRef<HTMLDivElement>(null);
  const minHeightRef = React.useRef<number | null>(null);
  const stopDragRef = React.useRef<(() => void) | null>(null);
  // The mirror needs the text also when the field is uncontrolled.
  const [ownText, setOwnText] = React.useState(String(props.defaultValue ?? ""));
  const shownText = props.value === undefined ? ownText : String(props.value);
  const setRefs = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      textareaRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  // Natural height at `rows` is the resize floor; re-measured when `rows`
  // changes (clearing any drag override — the new natural height wins).
  React.useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "";
    minHeightRef.current = textarea.offsetHeight;
  }, [rows]);

  // End a drag if the field unmounts mid-drag.
  React.useEffect(() => () => stopDragRef.current?.(), []);

  /*
   * Window-scoped drag: move/up listeners exist only between pointerdown and
   * release. Listening on the handle itself is buggy — a pointerup outside
   * the window is missed, the drag stays "armed", and plain hovering resizes.
   */
  const onHandlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const textarea = textareaRef.current;
    if (event.button !== 0 || stopDragRef.current || !textarea) return;
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = textarea.offsetHeight;

    const onMove = (e: PointerEvent) => {
      const next = startHeight + e.clientY - startY;
      textarea.style.height = `${Math.max(minHeightRef.current ?? 0, next)}px`;
    };
    const stop = () => {
      stopDragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
    };
    stopDragRef.current = stop;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("blur", stop);
  };

  return (
    <div
      data-slot="prose-field"
      className={cn(
        "relative flex w-full rounded-lg border border-line-input bg-surface transition-colors focus-within:border-line-strong focus-within:ring-2 focus-within:ring-ring/30",
        className,
      )}
    >
      {highlight && (
        <div
          ref={mirrorRef}
          aria-hidden
          data-slot="prose-field-highlight"
          className={cn(
            "pointer-events-none absolute inset-0 overflow-hidden font-sans break-words whitespace-pre-wrap text-ink [scrollbar-gutter:stable]",
            proseFieldText[text],
            props.disabled && "opacity-50",
          )}
        >
          {highlight(shownText)}
          {/* A trailing line break still gets its line, as in the textarea. */}
          {" "}
        </div>
      )}
      <textarea
        ref={setRefs}
        rows={rows}
        className={cn(
          "w-full resize-none bg-transparent font-sans text-ink outline-none placeholder:font-normal placeholder:text-ink-disabled",
          proseFieldText[text],
          // The mirror paints the text; the textarea keeps caret, selection and editing.
          highlight && "relative text-transparent caret-ink [scrollbar-gutter:stable]",
        )}
        onChange={(event) => {
          if (props.value === undefined) setOwnText(event.target.value);
          onChange?.(event);
        }}
        onScroll={(event) => {
          if (mirrorRef.current) mirrorRef.current.scrollTop = event.currentTarget.scrollTop;
          onScroll?.(event);
        }}
        {...props}
      />
      <div
        aria-hidden
        data-slot="prose-field-resize-handle"
        onPointerDown={onHandlePointerDown}
        className="absolute right-1.5 bottom-1.5 cursor-ns-resize touch-none p-1.5"
      >
        <svg width="8" height="8" viewBox="0 0 8 8">
          <path
            d="M7 2.6 L2.6 7 M7 5.8 L5.8 7"
            fill="none"
            stroke="var(--color-line-strong)"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
}

/*
 * Message input — single-line comment composer with send action.
 */
export interface MessageInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onSubmit"> {
  onSend?: () => void;
}

export function MessageInput({
  className,
  onSend,
  onKeyDown,
  placeholder = "Write a message …",
  ...props
}: MessageInputProps) {
  return (
    <div
      data-slot="message-input"
      className={cn(
        "flex items-center justify-between gap-2 rounded-md border border-line bg-surface py-2.25 pr-3 pl-3 transition-colors focus-within:border-line-strong focus-within:ring-2 focus-within:ring-ring/30",
        className,
      )}
    >
      <input
        placeholder={placeholder}
        className="w-full min-w-0 bg-transparent font-sans text-md text-ink outline-none placeholder:text-ink-disabled"
        {...props}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.key === "Enter" && !event.defaultPrevented) {
            // Sending owns Enter — keep an enclosing form from submitting too.
            event.preventDefault();
            onSend?.();
          }
        }}
      />
      <button
        type="button"
        aria-label="Send message"
        onClick={onSend}
        className="shrink-0 cursor-pointer text-ink-faint outline-none transition-colors hover:text-ink-secondary focus-visible:text-ink-secondary"
      >
        <HugeiconsIcon icon={SentIcon} size={13} />
      </button>
    </div>
  );
}
