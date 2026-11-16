"use client";

import { useCallback, useState, useSyncExternalStore, type ReactNode } from "react";
import { getMailState, getServerMailState, mailApi, mailboxUsable, subscribeMail, type ComposeDraft, type MailAttachmentRef } from "@/lib/mail";
import { ComposeDialog } from "./ComposeDialog";

type Message = { to: string; subject: string; text: string };
type Sent = { warning: string; to: string };

/**
 * Sending a document from the page that shows it. With a usable mailbox the page that is on screen is attached
 * as PDF and the compose dialog opens. Without one, `available` is false and the caller hands a draft to the mail
 * program of the computer as before. That is also the case while the mailbox cannot send: its password is missing
 * or the provider refused the login (password changed there). The dialog of a draft that is already open stays
 * on screen whatever `available` says.
 */
export function useDocumentMail(onSent: (result: Sent) => void): {
  available: boolean;
  /** Prints the current page to PDF, attaches it and opens the dialog. Throws with a German message on failure. */
  composeWithPrint: (message: Message, filename: string) => Promise<void>;
  /** Opens the dialog with an attachment the desktop app already holds (a validated e-invoice). */
  composeWithAttachment: (message: Message, attachment: MailAttachmentRef) => void;
  dialog: ReactNode;
} {
  const mail = useSyncExternalStore(subscribeMail, getMailState, getServerMailState);
  const [draft, setDraft] = useState<ComposeDraft | null>(null);
  const available = mailboxUsable(mail) && !!mailApi();

  const composeWithPrint = useCallback(async (message: Message, filename: string) => {
    const api = mailApi();
    if (!api) throw new Error("Das Postfach ist in der installierten Desktop-App verfügbar.");
    const result = await api.attachPrint(filename);
    if (!result.ok) throw new Error(result.error || "Die PDF konnte nicht für die E-Mail erstellt werden.");
    setDraft({ ...message, attachments: [result.attachment] });
  }, []);
  const composeWithAttachment = useCallback((message: Message, attachment: MailAttachmentRef) => setDraft({ ...message, attachments: [attachment] }), []);

  return {
    available,
    composeWithPrint,
    composeWithAttachment,
    dialog: <ComposeDialog draft={draft} onClose={() => setDraft(null)} onSent={(result) => { setDraft(null); onSent(result); }} />,
  };
}
