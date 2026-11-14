import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/*
 * tailwind-merge only knows Tailwind's default t-shirt font sizes; our
 * custom scale names (text-3xs … text-display-xl) would otherwise be
 * classified as text COLORS and silently dropped when merged with a real
 * color (e.g. cn("text-display-xl", "text-white") → text-display-xl gone).
 * Register them in the font-size group so merges stay correct.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["3xs", "2xs", "md", "display", "display-xl"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
