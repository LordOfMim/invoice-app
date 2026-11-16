"use client";

import * as React from "react";
import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";

import { cn } from "./lib/cn";
import { HugeiconsIcon } from "./icon";
import { IconButton } from "./icon-button";

/*
 * Search box: leading search glyph in ink-soft, edge from `shadow-control`
 * (no border), ink-faint placeholder. Focus follows the input convention
 * (2px ring). Sizes: `md` 42px, `sm` 32px. Optional
 * clear control appears in the trailing lane once the field has content.
 * When `onSearch` is set the leading glyph is a real submit control (click
 * or Enter) so typing never has to remount the field mid-keystroke.
 */
const searchFieldSize = {
  sm: {
    root: "h-8 gap-2 px-3",
    input: "text-sm",
    icon: 14,
  },
  md: {
    root: "h-10.5 gap-2.5 px-3.5",
    input: "text-base",
    icon: 16,
  },
} as const;

export interface SearchFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  /**
   * `md` = 42px standalone toolbar. `sm` = 32px directory / dialog toolbar.
   */
  size?: keyof typeof searchFieldSize;
  /** Trailing slot inside the field, e.g. a pending spinner. */
  trailing?: React.ReactNode;
  /**
   * Accessible label for the clear control. When set, a cancel glyph
   * appears once the field has content and empties it on click.
   */
  clearLabel?: string;
  /**
   * Turns the leading search glyph into a submit control. Called with the
   * current value on click, Enter, and after clear. Leave unset for live
   * filter fields that only need `onChange`.
   */
  onSearch?: (value: string) => void;
  /** Accessible label for the leading search control. Required with `onSearch`. */
  searchLabel?: string;
  /**
   * Emphasize the search control — typically when the draft differs from
   * the committed query and a submit is still pending.
   */
  searchPending?: boolean;
}

export function SearchField({
  className,
  size = "md",
  trailing,
  clearLabel,
  onSearch,
  searchLabel,
  searchPending = false,
  value,
  defaultValue,
  onChange,
  onKeyDown,
  ...props
}: SearchFieldProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const controlled = value !== undefined;
  const [draft, setDraft] = React.useState(() =>
    String(defaultValue ?? value ?? ""),
  );
  const current = controlled ? String(value ?? "") : draft;
  const showClear = clearLabel != null && current.length > 0;
  const scale = searchFieldSize[size];

  React.useEffect(() => {
    if (!controlled) setDraft(String(defaultValue ?? ""));
  }, [controlled, defaultValue]);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!controlled) setDraft(event.target.value);
    onChange?.(event);
  };

  const commit = (next: string) => {
    if (!controlled) setDraft(next);
    const input = inputRef.current;
    if (input && !controlled) input.value = next;
    if (next !== current) {
      onChange?.({
        target: { value: next },
        currentTarget: { value: next },
      } as React.ChangeEvent<HTMLInputElement>);
    }
    onSearch?.(next);
    input?.focus();
  };

  const handleClear = () => {
    commit("");
  };

  const handleSearch = () => {
    onSearch?.(current);
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || onSearch == null) return;
    if (event.key === "Enter") {
      event.preventDefault();
      onSearch(current);
    }
  };

  const searchIcon = (
    <HugeiconsIcon icon={Search01Icon} size={scale.icon} aria-hidden />
  );

  return (
    <div
      data-slot="search-field"
      className={cn(
        "flex w-full items-center rounded-md bg-surface shadow-control transition-[background-color,box-shadow] duration-150 hover:bg-surface-muted focus-within:bg-surface focus-within:ring-2 focus-within:ring-ring/50",
        scale.root,
        className,
      )}
    >
      {onSearch != null ? (
        <IconButton
          type="button"
          variant="ghost"
          size="sm"
          aria-label={searchLabel ?? "Search"}
          className={cn(
            "-ml-1.5 size-6",
            searchPending
              ? "text-ink hover:text-ink"
              : "text-ink-soft hover:text-ink",
          )}
          onClick={handleSearch}
        >
          {searchIcon}
        </IconButton>
      ) : (
        <span className="shrink-0 text-ink-soft" aria-hidden>
          {searchIcon}
        </span>
      )}
      <input
        ref={inputRef}
        type="search"
        className={cn(
          "w-full min-w-0 bg-transparent font-sans text-ink outline-none placeholder:text-ink-faint [&::-webkit-search-cancel-button]:hidden",
          scale.input,
        )}
        {...props}
        value={controlled ? value : undefined}
        defaultValue={controlled ? undefined : defaultValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
      {(showClear || trailing != null) && (
        <span className="flex shrink-0 items-center gap-1">
          {showClear && (
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              aria-label={clearLabel}
              className="-mr-1 size-6 text-ink-soft hover:text-ink"
              onClick={handleClear}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={14} />
            </IconButton>
          )}
          {trailing}
        </span>
      )}
    </div>
  );
}
