"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import { StatusNote } from "@/components/ui/Layout";
import { dismissNotice, getNotices, getServerNotices, subscribeNotices } from "@/lib/sessionTasks";

/** Results of the work the app did by itself (recurring invoices, backup), above every page until dismissed. */
export function SessionNotices() {
  const notices = useSyncExternalStore(subscribeNotices, getNotices, getServerNotices);
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
