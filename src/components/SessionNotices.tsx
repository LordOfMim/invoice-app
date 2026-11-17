"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import { StatusNote } from "@/components/ui/Layout";
import { BACKUP_HINT_ID, dismissNotice, getNotices, getServerNotices, subscribeNotices } from "@/lib/sessionTasks";

/**
 * Results of the work the app did by itself (recurring invoices, a failed backup), above every page until dismissed.
 * The plain reminder to make a backup is no result: it stands as one quiet link in the top bar (BackupHint).
 */
export function SessionNotices() {
  const all = useSyncExternalStore(subscribeNotices, getNotices, getServerNotices);
  const notices = all.filter((notice) => notice.id !== BACKUP_HINT_ID);
  if (notices.length === 0) return null;
  return (
    <div className="no-print mb-6 flex flex-col gap-3" role="region" aria-label="Hinweise">
      {notices.map((notice) => (
        <StatusNote
          key={notice.id}
          tone={notice.tone}
          // Announced when it appears; a failed backup interrupts, everything else waits its turn.
          role={notice.id === "backup-failed" ? "alert" : "status"}
          title={notice.title}
          action={<>
            {notice.href && <Link href={notice.href} onClick={() => dismissNotice(notice.id)} className="inline-flex min-h-8 items-center rounded-sm font-sans text-base font-medium tracking-snug underline underline-offset-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{notice.linkLabel ?? "Öffnen"}</Link>}
            <Button size="sm" variant="ghost" onClick={() => dismissNotice(notice.id)}>Ausblenden</Button>
          </>}
        >
          {notice.text}
        </StatusNote>
      ))}
    </div>
  );
}

/** Reminder to make a backup: a small link next to the save state. Following it puts the reminder to rest for a week. */
export function BackupHint() {
  const notices = useSyncExternalStore(subscribeNotices, getNotices, getServerNotices);
  const hint = notices.find((notice) => notice.id === BACKUP_HINT_ID);
  if (!hint) return null;
  return (
    <Link
      href={hint.href ?? "/backup"}
      onClick={() => dismissNotice(hint.id)}
      title={hint.text}
      className="no-print inline-flex h-7 shrink-0 items-center gap-1.5 rounded-pill bg-warn-tint px-2.5 font-sans text-base font-medium tracking-snug text-warn-ink outline-none transition-colors duration-150 hover:bg-warn-line focus-visible:ring-2 focus-visible:ring-ring/50 max-sm:hidden"
    >
      <span aria-hidden className="size-1.5 rounded-pill bg-warn" />
      {hint.title}
    </Link>
  );
}
