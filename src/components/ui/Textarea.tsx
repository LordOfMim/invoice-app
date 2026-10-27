import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/components/platform/lib/cn";
import { controlClasses } from "./Input";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement>;

/** Textarea in the Platform Input recipe (Overwatch `ui/forms.tsx`), at the readability size. */
export function Textarea({ className, rows = 3, ...props }: Props) {
  return <textarea rows={rows} className={cn(controlClasses, "resize-y py-2 text-lg/6 touch:text-2xl", className)} {...props} />;
}
