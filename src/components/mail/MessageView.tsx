"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { StatusNote } from "@/components/ui/Layout";
import { acceptMailList, formatBytes, formatMailDateTime, mailApi, personLabel, replyTarget, type MailBody, type MailSummary } from "@/lib/mail";
import { cn } from "@/components/platform/lib/cn";

/** Texts already read in this session; the desktop app keeps its own copy on disk for the next start. */
const bodies = new Map<string, MailBody>();
export const cachedMailText = (id: string) => bodies.get(id)?.text;

type BodyState = { id: string; body?: MailBody; error?: string };

function useMailBody(message: MailSummary, enabled: boolean): { body?: MailBody; error?: string; loading: boolean; retry: () => void } {
  const [state, setState] = useState<BodyState>({ id: message.id, body: bodies.get(message.id) });
  const [attempt, setAttempt] = useState(0);
  const current = state.id === message.id ? state : { id: message.id, body: bodies.get(message.id) };
  const needsLoad = enabled && !current.body && !current.error;

  useEffect(() => {
    if (!needsLoad) return;
    const api = mailApi();
    if (!api) return;
    let active = true;
    void api.body(message.id).then((result) => {
      // A conversion that ran out of time may succeed at the next try; only readable results are kept.
      if (result.ok && !result.body.unreadable) bodies.set(message.id, result.body);
      if (active) setState(result.ok ? { id: message.id, body: result.body } : { id: message.id, error: result.error || "Die E-Mail konnte nicht geladen werden." });
    }).catch((cause: unknown) => {
      if (active) setState({ id: message.id, error: cause instanceof Error ? cause.message : "Die E-Mail konnte nicht geladen werden." });
    });
    return () => { active = false; };
  }, [message.id, needsLoad, attempt]);

  return { body: current.body, error: current.error, loading: needsLoad, retry: () => { setState({ id: message.id }); setAttempt((value) => value + 1); } };
}

type Props = {
  message: MailSummary;
  /** In a conversation older messages start folded to one line. */
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** The customer the sender's address belongs to (for an own message: the recipient's). */
  customer?: { id: string; name: string };
  /** The customer answers go to, when the message names another address for answers (contact form). */
  replyCustomer?: { id: string; name: string };
  /** Address of the connected mailbox. */
  ownAddress?: string;
  onReply: (message: MailSummary, text: string) => void;
  onDelete: (message: MailSummary) => void;
  onNotice: (notice: { tone: "ok" | "error"; text: string }) => void;
};

/** One message: who, when, the text and its attachments. Opening an unread message marks it as read. */
export function MessageView({ message, collapsible = false, defaultOpen = true, customer, replyCustomer, ownAddress = "", onReply, onDelete, onNotice }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const expanded = !collapsible || open;
  const { body, error, loading, retry } = useMailBody(message, expanded);
  const [saving, setSaving] = useState<number | null>(null);
  const own = message.folder === "sent";
  const unread = message.folder === "inbox" && !message.seen;

  // Once per opened message: afterwards "Als ungelesen markieren" has the last word while the message stays open.
  const autoMarked = useRef<string | null>(null);
  useEffect(() => {
    if (!body || !unread || autoMarked.current === message.id) return;
    const api = mailApi();
    if (!api) return;
    autoMarked.current = message.id;
    // The list is shared by the whole window, so the answer counts even when this view is gone by then.
    void api.setSeen(message.id, true).then((result) => { if (result.ok) acceptMailList(result); }).catch(() => { /* stays unread; the next fetch corrects it */ });
  }, [body, unread, message.id]);

  const toggleUnread = async () => {
    const api = mailApi();
    if (!api) return;
    const result = await api.setSeen(message.id, false);
    if (result.ok) acceptMailList(result);
    else onNotice({ tone: "error", text: result.error || "Die E-Mail konnte nicht als ungelesen markiert werden." });
  };

  const saveAttachment = async (index: number) => {
    const api = mailApi();
    if (!api || saving !== null) return;
    setSaving(index);
    try {
      const result = await api.saveAttachment(message.id, index);
      if (result.ok) onNotice({ tone: "ok", text: `Anhang gespeichert: ${result.file}. Der Ordner wurde geöffnet.` });
      else if (!result.canceled) onNotice({ tone: "error", text: result.error || "Der Anhang konnte nicht gespeichert werden." });
    } finally { setSaving(null); }
  };

  const recipients = message.to.map(personLabel).join(", ");
  // A contact form or portal sent this for someone else: say who the answer goes to.
  const answerTo = own ? message.from : replyTarget(message, ownAddress);
  const viaOther = !own && answerTo.address !== message.from.address;
  const linkedCustomer = customer ?? replyCustomer;
  const heading = (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
      <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className={cn("min-w-0 break-words font-sans text-lg tracking-snug text-ink", unread ? "font-semibold" : "font-medium")}>
          {own ? "Sie" : customer?.name || personLabel(message.from)}
          {!own && message.from.address && <span className="ml-2 font-normal text-ink-muted">{message.from.address}</span>}
        </span>
        <span className="shrink-0 font-sans text-base tabular-nums tracking-snug text-ink-muted">{formatMailDateTime(message.date)}</span>
      </span>
      <span className="break-words font-sans text-base tracking-snug text-ink-muted">An: {recipients || "(kein Empfänger)"}{message.cc.length > 0 && `, Kopie: ${message.cc.map(personLabel).join(", ")}`}</span>
      {viaOther && <span className="break-words font-sans text-base tracking-snug text-ink-muted">Antwort an: {replyCustomer?.name || answerTo.name ? `${replyCustomer?.name || answerTo.name} <${answerTo.address}>` : answerTo.address}</span>}
    </span>
  );

  return (
    <article className={cn("flex min-w-0 flex-col gap-3 rounded-card-sm shadow-medium bg-surface p-4", own && "bg-surface-muted")} aria-label={`E-Mail von ${own ? "Ihnen" : personLabel(message.from)} vom ${formatMailDateTime(message.date)}`}>
      {collapsible ? (
        <button type="button" aria-expanded={expanded} onClick={() => setOpen((value) => !value)} className="flex min-w-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{heading}</button>
      ) : heading}

      {expanded && (
        <>
          {loading && <p role="status" className="font-sans text-lg tracking-snug text-ink-muted">Nachricht wird geladen …</p>}
          {error && <StatusNote tone="error" role="alert" action={<Button size="sm" onClick={retry}>Erneut versuchen</Button>}>{error}</StatusNote>}
          {body && (
            <>
              {body.htmlOnly && !!body.text && <p className="font-sans text-base tracking-snug text-ink-muted">Diese E-Mail wurde gestaltet verschickt und wird hier als reiner Text gezeigt.</p>}
              {body.unreadable && !body.text
                ? <StatusNote tone="attention" action={<Button size="sm" onClick={retry}>Erneut versuchen</Button>}>Diese E-Mail lässt sich nicht als Text darstellen. Bitte im Webmail des Anbieters öffnen.</StatusNote>
                : <div className="max-w-[80ch] whitespace-pre-wrap wrap-anywhere font-sans text-lg/6 tracking-snug text-ink">{body.text || <span className="text-ink-muted">(kein Text)</span>}</div>}
              {body.truncated && <p className="font-sans text-base tracking-snug text-ink-muted">Der Text ist sehr lang und wurde gekürzt.</p>}
              {body.attachments.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="font-sans text-base font-medium tracking-snug text-ink-secondary">{body.attachments.length === 1 ? "1 Anhang" : `${body.attachments.length} Anhänge`}</span>
                  <ul className="flex flex-wrap gap-2">
                    {body.attachments.map((item) => (
                      <li key={item.index}>
                        <Button size="sm" loading={saving === item.index} disabled={saving !== null} onClick={() => { void saveAttachment(item.index); }} title="Anhang speichern">
                          {item.filename}{item.size > 0 && <span className="ml-1.5 font-normal text-ink-muted">{formatBytes(item.size)}</span>}
                        </Button>
                      </li>
                    ))}
                  </ul>
                  {!own && <p className="font-sans text-base tracking-snug text-ink-muted">Anhänge werden nur gespeichert, nicht geöffnet. Öffnen Sie nur Dateien von Absendern, die Sie kennen.</p>}
                </div>
              )}
            </>
          )}
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <Button size="sm" variant={own ? "secondary" : "primary"} disabled={!body && !error} onClick={() => onReply(message, body?.text ?? "")}>{own ? "Erneut schreiben" : "Antworten"}</Button>
            {message.folder === "inbox" && message.seen && <Button size="sm" variant="ghost" onClick={() => { void toggleUnread(); }}>Als ungelesen markieren</Button>}
            {linkedCustomer && <Link href={`/customers/${linkedCustomer.id}`} className="inline-flex min-h-8 items-center rounded-sm px-1 font-sans text-base font-medium tracking-snug text-ink-secondary underline underline-offset-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50">Kunde öffnen</Link>}
            <Button size="sm" variant="ghost" className="ml-auto text-danger-ink" onClick={() => onDelete(message)}>Löschen</Button>
          </div>
        </>
      )}
    </article>
  );
}
