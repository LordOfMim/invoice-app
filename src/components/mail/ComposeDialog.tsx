"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/platform/dialog";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { StatusNote } from "@/components/ui/Layout";
import { Textarea } from "@/components/ui/Textarea";
import { formatBytes, loadMail, mailApi, MAIL_MAX_ATTACHMENT_BYTES, MAIL_MAX_ATTACHMENTS, syncMail, type ComposeDraft, type MailAttachmentRef } from "@/lib/mail";

const LIMIT_MB = MAIL_MAX_ATTACHMENT_BYTES / (1024 * 1024);
/** How often an open draft tells the desktop app that its attachments are still needed. */
const KEEP_INTERVAL_MS = 2 * 60 * 1000;

type Props = {
  /** The message to start from; `null` closes the dialog. A new object starts a new message. */
  draft: ComposeDraft | null;
  onClose: () => void;
  /** Called after the provider accepted the message. `warning` is set when only the copy for „Ausgang“ failed. */
  onSent: (result: { warning: string; to: string }) => void;
};

/** Write and send one e-mail from the connected mailbox. */
export function ComposeDialog({ draft, onClose, onSent }: Props) {
  // Escape and the close button ask the form: it may hold unsent text.
  const requestClose = useRef<(() => void) | null>(null);
  return (
    <Dialog open={draft !== null} onOpenChange={(next) => { if (!next) (requestClose.current ?? onClose)(); }}>
      {draft && <ComposeForm draft={draft} onClose={onClose} onSent={onSent} closeRequest={requestClose} />}
    </Dialog>
  );
}

/** What the dialog says when the desktop app no longer holds files the draft listed. */
function lostText(lost: MailAttachmentRef[]): string {
  const names = lost.map((item) => `„${item.name}“`).join(", ");
  return `${lost.length === 1 ? `Der Anhang ${names} ist` : `Die Anhänge ${names} sind`} nicht mehr vorhanden und ${lost.length === 1 ? "wurde" : "wurden"} aus der Liste genommen. Bitte hängen Sie ${lost.length === 1 ? "die Datei" : "die Dateien"} erneut an. Eine PDF, die Helferlein selbst erstellt hat, bekommen Sie wieder, indem Sie diese E-Mail schließen und den Versand beim Dokument noch einmal starten.`;
}

function ComposeForm({ draft, onClose, onSent, closeRequest }: { draft: ComposeDraft; closeRequest: RefObject<(() => void) | null> } & Omit<Props, "draft">) {
  const [to, setTo] = useState(draft.to);
  const [cc, setCc] = useState(draft.cc ?? "");
  const [showCc, setShowCc] = useState(!!draft.cc);
  const [subject, setSubject] = useState(draft.subject);
  const [text, setText] = useState(draft.text);
  const [attachments, setAttachments] = useState<MailAttachmentRef[]>(draft.attachments ?? []);
  const [busy, setBusy] = useState<"send" | "attach" | null>(null);
  const [error, setError] = useState<{ text: string; field: string } | null>(null);
  // The question before unsent text is thrown away: on closing, or on leaving for the account page.
  const [confirmDiscard, setConfirmDiscard] = useState<false | "close" | "account">(false);
  const inFlight = useRef(false);
  const confirmBox = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const focusBeforeConfirm = useRef<HTMLElement | null>(null);
  const confirmTitle = useId();
  const confirmText = useId();

  // The desktop app holds the attached files until the message is sent. However this form goes away without
  // sending (cancel, Escape, the page changing underneath), they are given back.
  const held = useRef<string[]>([]);
  const listed = useRef<MailAttachmentRef[]>([]);
  const mounted = useRef(false);
  // While the draft is open the desktop app keeps its files: it is told so at once, every couple of minutes and
  // whenever the window comes back (after standby). Should a file be gone all the same, the list says so right away
  // instead of the send failing later.
  const keepAlive = useRef(() => {});
  useEffect(() => {
    keepAlive.current = () => {
      const ids = held.current;
      if (!ids.length) return;
      void mailApi()?.keepAttachments(ids).then((result) => {
        if (!mounted.current || !result.ok || !result.missing?.length) return;
        const gone = new Set(result.missing);
        // Only files the draft still lists: after sending or removing, the desktop app has let go of them on purpose.
        const lost = listed.current.filter((item) => gone.has(item.id) && held.current.includes(item.id));
        if (!lost.length) return;
        setError({ text: lostText(lost), field: "attachments" });
        setAttachments((current) => current.filter((item) => !gone.has(item.id)));
      }).catch(() => { /* asked again at the next interval */ });
    };
  });
  useEffect(() => { listed.current = attachments; held.current = attachments.map((item) => item.id); keepAlive.current(); }, [attachments]);
  useEffect(() => {
    mounted.current = true;
    const beat = () => keepAlive.current();
    const visible = () => { if (document.visibilityState === "visible") beat(); };
    const keep = window.setInterval(beat, KEEP_INTERVAL_MS);
    window.addEventListener("focus", beat);
    document.addEventListener("visibilitychange", visible);
    return () => {
      mounted.current = false;
      window.clearInterval(keep);
      window.removeEventListener("focus", beat);
      document.removeEventListener("visibilitychange", visible);
      // Deferred: in development React mounts every component twice, which is not the form going away.
      window.setTimeout(() => {
        if (mounted.current || !held.current.length) return;
        void mailApi()?.discardAttachments(held.current);
        held.current = [];
      }, 0);
    };
  }, []);

  const dirty = to !== draft.to || cc !== (draft.cc ?? "") || subject !== draft.subject || text !== draft.text || attachments.length !== (draft.attachments ?? []).length;
  const totalSize = attachments.reduce((sum, item) => sum + item.size, 0);
  const atFileLimit = attachments.length >= MAIL_MAX_ATTACHMENTS;
  const tooManyFiles = attachments.length > MAIL_MAX_ATTACHMENTS;
  const tooLarge = totalSize > MAIL_MAX_ATTACHMENT_BYTES;
  const attachmentProblem = tooLarge
    ? `Die Anhänge sind zusammen ${formatBytes(totalSize)} groß. Eine E-Mail darf höchstens ${LIMIT_MB} MB Anhang haben, mehr nehmen die meisten Anbieter nicht an. Bitte entfernen Sie Anhänge oder verteilen Sie sie auf mehrere E-Mails.`
    : tooManyFiles ? `Es lassen sich höchstens ${MAIL_MAX_ATTACHMENTS} Dateien anhängen. Bitte entfernen Sie ${attachments.length - MAIL_MAX_ATTACHMENTS === 1 ? "eine Datei" : `${attachments.length - MAIL_MAX_ATTACHMENTS} Dateien`}.` : "";
  const attachHint = useId();

  const discard = () => {
    const ids = attachments.map((item) => item.id);
    if (ids.length) void mailApi()?.discardAttachments(ids);
    held.current = [];
    const leaving = confirmDiscard === "account";
    onClose();
    if (leaving) window.location.assign("/mail/account");
  };
  /** The way to the account page after a refused login. Unsent text is only thrown away after a clear yes. */
  const checkMailbox = () => {
    if (inFlight.current) return;
    focusBeforeConfirm.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirmDiscard("account");
  };
  const resume = () => {
    setConfirmDiscard(false);
    const previous = focusBeforeConfirm.current;
    focusBeforeConfirm.current = null;
    // The question's buttons disappear; put the cursor back where the user was.
    window.setTimeout(() => { (previous?.isConnected ? previous : form.current?.querySelector<HTMLButtonElement>("[data-cancel]"))?.focus(); }, 0);
  };
  const requestClose = () => {
    if (inFlight.current) return;
    // Escape or the close button while the question is showing means "no, keep writing". Only „Verwerfen“ discards.
    if (confirmDiscard) { resume(); return; }
    if (dirty) {
      focusBeforeConfirm.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setConfirmDiscard("close");
      return;
    }
    discard();
  };
  useEffect(() => {
    closeRequest.current = requestClose;
    return () => { closeRequest.current = null; };
  });
  // The question sits in the footer, which never scrolls away, and takes the focus on its safe answer.
  useEffect(() => { if (confirmDiscard) confirmBox.current?.querySelector<HTMLButtonElement>("[data-keep-writing]")?.focus(); }, [confirmDiscard]);

  const attach = async () => {
    const api = mailApi();
    if (!api || inFlight.current || atFileLimit) return;
    inFlight.current = true;
    setBusy("attach");
    setError(null);
    try {
      const result = await api.attachFiles(attachments.map((item) => item.id));
      if (result.ok) setAttachments((current) => [...current, ...result.attachments]);
      else if (!result.canceled) setError({ text: result.error || "Die Datei konnte nicht angehängt werden.", field: "attachments" });
    } catch (cause) {
      setError({ text: cause instanceof Error ? cause.message : "Die Datei konnte nicht angehängt werden.", field: "attachments" });
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const removeAttachment = (id: string) => {
    held.current = held.current.filter((item) => item !== id);
    setAttachments((current) => current.filter((item) => item.id !== id));
    void mailApi()?.discardAttachments([id]);
  };

  const send = async () => {
    const api = mailApi();
    if (!api || inFlight.current || attachmentProblem) return;
    inFlight.current = true;
    setBusy("send");
    setError(null);
    setConfirmDiscard(false);
    try {
      const result = await api.send({ to, cc: showCc ? cc : "", subject, text, attachmentIds: attachments.map((item) => item.id), replyToId: draft.replyToId });
      if (!result.ok) {
        if (result.missing?.length) {
          // The desktop app no longer holds these files: the list must not go on showing them as attached.
          const gone = new Set(result.missing);
          setError({ text: lostText(attachments.filter((item) => gone.has(item.id))), field: "attachments" });
          setAttachments((current) => current.filter((item) => !gone.has(item.id)));
          return;
        }
        setError({ text: result.error || "Die E-Mail konnte nicht gesendet werden.", field: result.field ?? "" });
        // The provider refused the login: the rest of the window learns that the mailbox is not usable right now.
        if (result.field === "auth") void loadMail();
        return;
      }
      held.current = []; // sent: the desktop app has already let go of the files
      void syncMail();
      onSent({ warning: result.warning, to });
    } catch (cause) {
      setError({ text: cause instanceof Error ? cause.message : "Die E-Mail konnte nicht gesendet werden.", field: "" });
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const fieldError = (field: string) => (error?.field === field ? error.text : undefined);
  const generalError = error && !["to", "cc", "subject", "text"].includes(error.field) ? error.text : "";
  const loginRefused = error?.field === "auth";

  return (
    <DialogContent
      className="w-180"
      closeLabel="Schließen"
      onPointerDownOutside={(event) => event.preventDefault()}
      onInteractOutside={(event) => event.preventDefault()}
    >
      <form
        ref={form}
        noValidate
        onSubmit={(event) => { event.preventDefault(); void send(); }}
      >
        <DialogHeader className="pr-14">
          <DialogTitle className="text-2xl">{draft.replyToId ? "Antwort schreiben" : "Neue E-Mail"}</DialogTitle>
          <DialogDescription className="sr-only">E-Mail schreiben und aus dem verbundenen Postfach senden.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex min-h-0 flex-col gap-4 overflow-y-auto">
          <Field label="An" error={fieldError("to")} hint={showCc ? undefined : "Mehrere Adressen mit Komma trennen."}>
            <Input type="text" inputMode="email" autoComplete="off" spellCheck={false} value={to} onChange={(event) => setTo(event.target.value)} placeholder="name@beispiel.de" />
          </Field>
          {showCc ? (
            <Field label="Kopie an" error={fieldError("cc")}>
              <Input type="text" inputMode="email" autoComplete="off" spellCheck={false} value={cc} onChange={(event) => setCc(event.target.value)} />
            </Field>
          ) : (
            <div><Button size="sm" variant="ghost" onClick={() => setShowCc(true)}>Kopie an weitere Empfänger</Button></div>
          )}
          <Field label="Betreff" error={fieldError("subject")}>
            <Input type="text" value={subject} maxLength={300} onChange={(event) => setSubject(event.target.value)} />
          </Field>
          <Field label="Nachricht" error={fieldError("text")}>
            <Textarea rows={11} value={text} onChange={(event) => setText(event.target.value)} className="min-h-40" />
          </Field>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={`font-sans text-base font-medium tracking-snug ${attachmentProblem ? "text-danger-ink" : "text-ink-secondary"}`}>
                {attachments.length === 0 ? "Keine Anhänge" : `${attachments.length} ${attachments.length === 1 ? "Anhang" : "Anhänge"}, ${formatBytes(totalSize) || "0 KB"} von höchstens ${LIMIT_MB} MB`}
              </span>
              <Button size="sm" loading={busy === "attach"} disabled={busy !== null || atFileLimit} aria-describedby={atFileLimit ? attachHint : undefined} onClick={() => { void attach(); }}>Datei anhängen</Button>
            </div>
            {atFileLimit && !tooManyFiles && <p id={attachHint} className="font-sans text-base tracking-snug text-ink-muted">Mehr als {MAIL_MAX_ATTACHMENTS} Dateien lassen sich nicht an eine E-Mail anhängen. Für weitere Dateien schreiben Sie bitte eine zweite E-Mail.</p>}
            {attachmentProblem && <StatusNote tone="error" role="alert">{attachmentProblem}</StatusNote>}
            {attachments.length > 0 && (
              <ul className="flex flex-col divide-y divide-line rounded-card-sm shadow-medium">
                {attachments.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                    <span className="min-w-0 break-words font-sans text-lg tracking-snug text-ink">{item.name} <span className="text-base text-ink-muted">{formatBytes(item.size)}</span></span>
                    <Button size="sm" variant="ghost" disabled={busy !== null} aria-label={`Anhang ${item.name} entfernen`} onClick={() => removeAttachment(item.id)}>Entfernen</Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {generalError && (
            <StatusNote tone="error" role="alert" action={loginRefused ? <Button size="sm" disabled={busy !== null} onClick={checkMailbox}>Postfach prüfen</Button> : undefined}>
              {generalError}
              {loginRefused && " Unter „Postfach prüfen“ geben Sie das Passwort neu ein. Sie können diese E-Mail auch schließen und das Dokument wie früher an das E-Mail-Programm Ihres Computers übergeben."}
            </StatusNote>
          )}
        </DialogBody>
        {confirmDiscard ? (
          <DialogFooter className="pt-4">
            <div ref={confirmBox} role="alertdialog" aria-labelledby={confirmTitle} aria-describedby={confirmText} className="flex flex-col gap-3 rounded-card-sm border border-warn-line bg-warn-tint px-4 py-3 font-sans text-base/5 tracking-snug text-warn-ink">
              <div className="flex flex-col gap-1">
                <p id={confirmTitle} className="font-medium">{confirmDiscard === "account" ? "Diese E-Mail ist noch nicht gesendet. Zur Seite „Postfach“ wechseln?" : "Diese E-Mail ist noch nicht gesendet. Wirklich schließen?"}</p>
                <p id={confirmText}>{confirmDiscard === "account" ? "Beim Wechseln gehen Text und Anhänge dieser E-Mail verloren. Kopieren Sie den Text vorher, wenn Sie ihn noch brauchen." : "Beim Schließen gehen Text und Anhänge verloren."}</p>
              </div>
              <div className="flex flex-row flex-wrap justify-end gap-3 max-sm:[&>button]:flex-1">
                <Button variant="danger" onClick={discard}>{confirmDiscard === "account" ? "Verwerfen und Postfach prüfen" : "Verwerfen"}</Button>
                <Button data-keep-writing variant="secondary" onClick={resume}>Weiter schreiben</Button>
              </div>
            </div>
          </DialogFooter>
        ) : (
          <DialogFooter className="flex-row flex-wrap justify-end pt-4 max-sm:[&>button]:flex-1">
            <Button data-cancel variant="secondary" disabled={busy === "send"} onClick={requestClose}>Abbrechen</Button>
            <Button type="submit" variant="primary" loading={busy === "send"} disabled={busy !== null || !!attachmentProblem}>{busy === "send" ? "Wird gesendet …" : "Senden"}</Button>
          </DialogFooter>
        )}
      </form>
    </DialogContent>
  );
}
