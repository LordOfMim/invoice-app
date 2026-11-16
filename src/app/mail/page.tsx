"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ComposeDialog } from "@/components/mail/ComposeDialog";
import { MessageView } from "@/components/mail/MessageView";
import { cn } from "@/components/platform/lib/cn";
import { UnderlineTabs } from "@/components/platform/underline-tabs";
import { Button, LinkButton } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { SearchInput } from "@/components/ui/Input";
import { EmptyState, Page, PageHeader, StatusNote } from "@/components/ui/Layout";
import {
  acceptMailList, AUTOMATIC_SENDER, buildConversations, formatMailDate, getMailState, getServerMailState, loadMail, mailApi, matchesMail, personLabel,
  quoteForReply, replySubject, replyTarget, sender, subscribeMail, syncMail, unreadCount, withSignature, type ComposeDraft, type Conversation, type MailSummary,
} from "@/lib/mail";
import { usePersistedData } from "@/lib/storage/useStore";

type Tab = "inbox" | "sent" | "threads";
const PAGE_SIZE = 50;
/** Messages of one conversation shown at first, and how many of the newest open by themselves when unread. */
const CONVERSATION_PAGE = 30;
const AUTO_OPEN_UNREAD = 10;

/** True when the keyboard focus sits nowhere useful: on nothing, or on something that is no longer on screen. */
function focusIsLost(): boolean {
  const active = document.activeElement;
  return !(active instanceof HTMLElement) || active === document.body || !active.isConnected || active.getClientRects().length === 0;
}
const noSubscribe = () => () => {};

function initialQuery(name: string): string {
  return typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get(name) ?? "";
}

/** One row of a list: who, when, subject. Unread rows are bold with a dot that is also named for screen readers. */
function Row({ id, selected, unread, person, date, subject, marks, onSelect }: { id: string; selected: boolean; unread: boolean; person: string; date: string; subject: string; marks: string[]; onSelect: () => void }) {
  return (
    <li>
      <button
        type="button"
        data-mail-row={id}
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
        className={cn(
          "flex w-full min-w-0 items-start gap-2.5 px-3 py-2.5 text-left outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
          selected ? "bg-surface-selected" : "hover:bg-surface-muted/60",
        )}
      >
        <span aria-hidden className={cn("mt-2 size-2 shrink-0 rounded-pill", unread ? "bg-ink" : "bg-transparent")} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-baseline justify-between gap-3">
            <span className={cn("min-w-0 truncate font-sans text-lg tracking-snug text-ink", unread ? "font-semibold" : "font-medium")}>{person}</span>
            <span className="shrink-0 font-sans text-base tabular-nums tracking-snug text-ink-muted">{date}</span>
          </span>
          <span className={cn("min-w-0 break-words font-sans text-base tracking-snug", unread ? "text-ink" : "text-ink-muted")}>
            {unread && <span className="sr-only">Ungelesen: </span>}{subject || "(ohne Betreff)"}
          </span>
          {marks.length > 0 && <span className="font-sans text-base tracking-snug text-ink-muted">{marks.join(" · ")}</span>}
        </span>
      </button>
    </li>
  );
}

/** The connected mailbox: inbox, sent messages and both together as conversations. */
export default function MailPage() {
  const desktop = useSyncExternalStore(noSubscribe, () => !!mailApi(), () => false);
  const mail = useSyncExternalStore(subscribeMail, getMailState, getServerMailState);
  const { data } = usePersistedData();
  const [tab, setTab] = useState<Tab>("inbox");
  const [query, setQuery] = useState(() => initialQuery("kontakt"));
  const [selected, setSelected] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [draft, setDraft] = useState<ComposeDraft | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error" | "attention"; text: string } | null>(null);
  const [deleting, setDeleting] = useState<MailSummary | null>(null);
  const [signature, setSignature] = useState("");
  const [conversationLimit, setConversationLimit] = useState(CONVERSATION_PAGE);
  const [focusRepair, setFocusRepair] = useState(0);
  const listSection = useRef<HTMLElement>(null);
  const readerHeading = useRef<HTMLHeadingElement>(null);
  const focusState = useRef<{ selected: string | null; repair: number }>({ selected: null, repair: 0 });

  useEffect(() => {
    const api = mailApi();
    if (!api) return;
    let active = true;
    // A login the provider refused is not tried again just because this page opens.
    void loadMail().then(() => { const now = getMailState(); if (active && now.configured && !now.needsPassword && !now.authFailed) void syncMail(); });
    void api.status().then((status) => {
      if (!active || !status.ok) return;
      const text = status.account?.signature ?? "";
      setSignature(text);
      // A link like /mail?neu=kunde@beispiel.de (from a customer) starts a message right away.
      const recipient = initialQuery("neu");
      if (recipient && status.configured) setDraft({ to: recipient, subject: "", text: withSignature("", text) });
    });
    return () => { active = false; };
  }, []);

  const customers = data?.customers;
  const customerByAddress = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const customer of customers ?? []) {
      const address = customer.email?.trim().toLowerCase();
      if (address && !map.has(address)) map.set(address, { id: customer.id, name: customer.name });
    }
    return map;
  }, [customers]);
  // Who a message is listed under: the real sender (From), never the address answers are meant to go to.
  const nameOf = (message: MailSummary) => {
    const person = sender(message);
    return customerByAddress.get(person.address)?.name || personLabel(person);
  };
  /** The customer answers go to when a message names another address for them (contact form), otherwise none. */
  const replyCustomerOf = (message: MailSummary) => {
    if (message.folder !== "inbox") return undefined;
    const target = replyTarget(message, mail.email);
    return target.address !== message.from.address ? customerByAddress.get(target.address) : undefined;
  };
  const answerMark = (message: MailSummary) => {
    if (message.folder !== "inbox") return "";
    const target = replyTarget(message, mail.email);
    if (target.address === message.from.address || AUTOMATIC_SENDER.test(target.address)) return "";
    return `Antwort an ${customerByAddress.get(target.address)?.name || personLabel(target)}`;
  };

  const conversations = useMemo(() => buildConversations(mail.inbox, mail.sent, mail.email), [mail.inbox, mail.sent, mail.email]);
  const messages = tab === "sent" ? mail.sent : mail.inbox;
  const visibleMessages = useMemo(() => messages.filter((message) => matchesMail(message, query)), [messages, query]);
  const visibleConversations = useMemo(() => conversations.filter((conversation) => conversation.messages.some((message) => matchesMail(message, query))), [conversations, query]);
  const total = tab === "threads" ? visibleConversations.length : visibleMessages.length;

  const openMessage = tab === "threads" ? undefined : messages.find((message) => message.id === selected);
  const openConversation: Conversation | undefined = tab === "threads" ? conversations.find((conversation) => conversation.messages.some((message) => message.id === selected)) : undefined;
  const reading = !!openMessage || !!openConversation;
  const unread = unreadCount(mail);

  // Below the wide layout only the list or the reader is on screen. Whatever had the keyboard focus disappears
  // with the other one, so the focus moves along: to the heading of the opened mail, and back to its row.
  useEffect(() => {
    const before = focusState.current;
    focusState.current = { selected, repair: focusRepair };
    if (before.selected === selected && before.repair === focusRepair) return;
    if (!focusIsLost()) return;
    if (reading) { readerHeading.current?.focus(); return; }
    const list = listSection.current;
    const row = before.selected ? list?.querySelector<HTMLElement>(`[data-mail-row="${before.selected}"]`) : null;
    (row ?? list?.querySelector<HTMLElement>("[data-mail-row]") ?? list)?.focus();
  }, [selected, focusRepair, reading]);
  const select = (id: string) => { setSelected(id); setConversationLimit(CONVERSATION_PAGE); setNotice(null); };

  const compose = () => { setNotice(null); setDraft({ to: "", subject: "", text: withSignature("", signature) }); };
  const reply = (message: MailSummary, text: string) => {
    setNotice(null);
    const own = message.folder === "sent";
    setDraft({
      to: own ? message.to.map((person) => person.address).filter(Boolean).join(", ") : replyTarget(message, mail.email).address,
      subject: own ? message.subject : replySubject(message.subject),
      text: own ? withSignature("", signature) : `${withSignature("", signature)}${quoteForReply(message, text)}`,
      replyToId: own ? undefined : message.id,
    });
  };

  const remove = async (message: MailSummary) => {
    const api = mailApi();
    if (!api) return;
    try {
      const result = await api.remove(message.id);
      if (!result.ok) {
        setNotice({ tone: "error", text: result.error || "Die E-Mail konnte nicht gelöscht werden." });
        // What is known about the mailbox may have changed (no trash folder any more): the next question must say so.
        void loadMail();
        return;
      }
      acceptMailList(result);
      if (selected === message.id) setSelected(null);
      // The button that started this is gone with the message.
      setFocusRepair((value) => value + 1);
      setNotice({ tone: "ok", text: result.hasTrashFolder ? "Die E-Mail liegt jetzt im Papierkorb Ihres Postfachs." : "Die E-Mail wurde gelöscht." });
    } catch (cause) {
      setNotice({ tone: "error", text: cause instanceof Error ? cause.message : "Die E-Mail konnte nicht gelöscht werden." });
    }
  };

  const switchTab = (next: Tab) => { setTab(next); setSelected(null); setLimit(PAGE_SIZE); };

  if (!desktop) {
    return (
      <Page>
        <PageHeader title="E-Mail" description="Rechnungen, Angebote und Mahnungen direkt senden und Antworten lesen." />
        <EmptyState title="Nur in der Desktop-App" description="E-Mails senden und empfangen funktioniert in der installierten Helferlein-App." />
      </Page>
    );
  }

  if (mail.ready && !mail.configured) {
    return (
      <Page>
        <PageHeader title="E-Mail" description="Rechnungen, Angebote und Mahnungen direkt senden und Antworten lesen." />
        <EmptyState
          title="Noch kein Postfach verbunden"
          description="Verbinden Sie Ihr vorhandenes E-Mail-Postfach (zum Beispiel GMX, WEB.DE, Telekom, Gmail oder die Adresse Ihrer Firma). Sie brauchen nur Adresse und Passwort."
          action={<LinkButton variant="primary" href="/mail/account">Postfach einrichten</LinkButton>}
        />
      </Page>
    );
  }

  const lastSync = mail.lastSync ? `Zuletzt abgerufen: ${formatMailDate(mail.lastSync) === "Gestern" ? "gestern" : formatMailDate(mail.lastSync)}` : "Noch nicht abgerufen";
  const emptyText = query.trim()
    ? "Keine E-Mail passt zur Suche."
    : tab === "inbox" ? "Der Eingang ist leer." : tab === "sent" ? "Der Ausgang (gesendete E-Mails) ist leer." : "Noch keine Gespräche.";
  const emptyDescription = query.trim()
    ? "Gesucht wird in Namen, Adressen und Betreffzeilen der neuesten 500 E-Mails."
    : tab === "sent" ? (mail.hasSentFolder ? "Hier erscheinen die E-Mails, die Sie gesendet haben." : "Bei Ihrem Anbieter wurde kein Ordner für gesendete E-Mails gefunden. Gesendete E-Mails erscheinen deshalb hier nicht.") : undefined;
  const shownMessages = openConversation ? openConversation.messages.slice(-conversationLimit) : [];
  const hiddenMessages = openConversation ? openConversation.messages.length - shownMessages.length : 0;
  const readerStatus = openMessage
    ? `E-Mail geöffnet: ${openMessage.subject || "ohne Betreff"}`
    : openConversation ? `Gespräch geöffnet: ${openConversation.subject}, ${openConversation.messages.length === 1 ? "eine Nachricht" : `${openConversation.messages.length} Nachrichten`}` : "";

  return (
    <Page>
      <PageHeader
        title="E-Mail"
        description={mail.email ? `${mail.email} · ${mail.syncing ? "Wird abgerufen …" : lastSync}` : undefined}
        actions={<>
          <Button variant="primary" onClick={compose}>Neue E-Mail</Button>
          <Button loading={mail.syncing} disabled={mail.syncing} onClick={() => { setNotice(null); void syncMail(); }}>Abrufen</Button>
          <LinkButton variant="ghost" href="/mail/account">Postfach ändern</LinkButton>
        </>}
      />

      <div className="flex flex-col gap-4">
        {mail.needsPassword && <StatusNote tone="attention" title="Das Passwort des Postfachs fehlt" action={<LinkButton size="sm" href="/mail/account">Passwort eingeben</LinkButton>}>Ohne Passwort kann Helferlein keine E-Mails abrufen oder senden.</StatusNote>}
        {mail.authFailed && !mail.needsPassword && (
          <StatusNote
            tone="error"
            role="alert"
            title="Die Anmeldung am Postfach wurde abgelehnt"
            action={<>
              <LinkButton size="sm" href="/mail/account">Passwort prüfen</LinkButton>
              <Button size="sm" variant="ghost" loading={mail.syncing} disabled={mail.syncing} onClick={() => { setNotice(null); void syncMail(); }}>Erneut versuchen</Button>
            </>}
          >
            Ihr Anbieter hat Benutzername oder Passwort nicht angenommen. Helferlein ruft deshalb vorerst keine E-Mails mehr von selbst ab. Bitte geben Sie das Passwort unter „Postfach ändern“ neu ein. Viele Anbieter verlangen ein eigenes App-Passwort oder das Freischalten von IMAP. Die Liste zeigt den Stand des letzten Abrufs.
          </StatusNote>
        )}
        {mail.sendRefused && !mail.authFailed && !mail.needsPassword && (
          <StatusNote tone="error" role="alert" title="Ihr Anbieter hat die Anmeldung beim Senden abgelehnt" action={<LinkButton size="sm" href="/mail/account">Postfach prüfen</LinkButton>}>
            Benutzername oder Passwort wurden beim Senden nicht angenommen. Bitte geben Sie das Passwort unter „Postfach ändern“ neu ein und speichern Sie. Bis dahin übergibt Helferlein Rechnungen wie früher an das E-Mail-Programm Ihres Computers.
          </StatusNote>
        )}
        {mail.error && !mail.needsPassword && !mail.authFailed && <StatusNote tone="error" role="alert" title="Der Abruf hat nicht geklappt" action={<Button size="sm" onClick={() => { void syncMail(); }}>Erneut versuchen</Button>}>{mail.error} Die Liste zeigt den Stand des letzten Abrufs.</StatusNote>}
        {notice && <StatusNote tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"} action={<Button size="sm" variant="ghost" onClick={() => setNotice(null)}>Ausblenden</Button>}>{notice.text}</StatusNote>}

        <UnderlineTabs
          size="lg"
          aria-label="Ordner"
          value={tab}
          onValueChange={switchTab}
          items={[
            { value: "inbox", label: "Eingang", count: unread || undefined },
            { value: "sent", label: "Ausgang" },
            { value: "threads", label: "Gespräche" },
          ]}
        />

        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start">
          <section ref={listSection} tabIndex={-1} aria-label={tab === "inbox" ? "Eingang" : tab === "sent" ? "Ausgang (gesendete E-Mails)" : "Gespräche"} className={cn("flex min-w-0 flex-col gap-3 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50", reading && "max-lg:hidden")}>
            <Field label="Suchen" hideLabel>
              <SearchInput value={query} placeholder="Name, Adresse oder Betreff" onChange={(event) => { setQuery(event.target.value); setLimit(PAGE_SIZE); }} />
            </Field>
            {!mail.ready ? (
              <p role="status" className="font-sans text-lg tracking-snug text-ink-muted">Postfach wird geladen …</p>
            ) : total === 0 ? (
              <EmptyState title={emptyText} description={emptyDescription} />
            ) : (
              <>
                <ul className="flex min-w-0 flex-col divide-y divide-line overflow-hidden rounded-card-sm shadow-medium bg-surface">
                  {tab === "threads"
                    ? visibleConversations.slice(0, limit).map((conversation) => {
                      const newest = conversation.messages[conversation.messages.length - 1];
                      const names = conversation.senders.map((person) => customerByAddress.get(person.address)?.name || personLabel(person));
                      return (
                        <Row
                          key={conversation.key}
                          id={newest.id}
                          selected={openConversation?.key === conversation.key}
                          unread={conversation.unread > 0}
                          person={names.slice(0, 2).join(", ") + (names.length > 2 ? ` +${names.length - 2}` : "") || "Unbekannt"}
                          date={formatMailDate(conversation.lastDate)}
                          subject={conversation.subject}
                          marks={[conversation.messages.length === 1 ? "1 Nachricht" : `${conversation.messages.length} Nachrichten`, newest.folder === "sent" ? "zuletzt von Ihnen" : "", conversation.unread > 0 ? `${conversation.unread} ungelesen` : ""].filter(Boolean)}
                          onSelect={() => select(newest.id)}
                        />
                      );
                    })
                    : visibleMessages.slice(0, limit).map((message) => (
                      <Row
                        key={message.id}
                        id={message.id}
                        selected={selected === message.id}
                        unread={message.folder === "inbox" && !message.seen}
                        person={(message.folder === "sent" ? "An: " : "") + nameOf(message)}
                        date={formatMailDate(message.date)}
                        subject={message.subject}
                        marks={[answerMark(message), message.hasAttachments ? "mit Anhang" : "", message.answered ? "beantwortet" : ""].filter(Boolean)}
                        onSelect={() => select(message.id)}
                      />
                    ))}
                </ul>
                {total > limit && <div><Button onClick={() => setLimit((value) => value + PAGE_SIZE)}>Weitere anzeigen ({total - limit})</Button></div>}
              </>
            )}
          </section>

          <section aria-label="Gewählte E-Mail" className={cn("flex min-w-0 flex-col gap-3", !reading && "max-lg:hidden")}>
            {/* Only this one line is announced; the texts of the opened messages are read when the user goes there. */}
            <p role="status" className="sr-only">{readerStatus}</p>
            {reading && <div className="lg:hidden"><Button onClick={() => setSelected(null)}>Zurück zur Liste</Button></div>}
            {openMessage && (
              <>
                <h2 ref={readerHeading} tabIndex={-1} className="break-words rounded-sm font-sans text-2xl font-semibold tracking-snug text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{openMessage.subject || "(ohne Betreff)"}</h2>
                <MessageView key={openMessage.id} message={openMessage} customer={customerByAddress.get(sender(openMessage).address)} replyCustomer={replyCustomerOf(openMessage)} ownAddress={mail.email} onReply={reply} onDelete={setDeleting} onNotice={setNotice} />
              </>
            )}
            {openConversation && (
              <>
                <h2 ref={readerHeading} tabIndex={-1} className="break-words rounded-sm font-sans text-2xl font-semibold tracking-snug text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring/50">{openConversation.subject}</h2>
                {hiddenMessages > 0 && <div><Button onClick={() => { setConversationLimit((value) => value + CONVERSATION_PAGE); readerHeading.current?.focus(); }}>Ältere Nachrichten anzeigen ({hiddenMessages})</Button></div>}
                {shownMessages.map((message, index) => (
                  <MessageView
                    key={message.id}
                    message={message}
                    collapsible={openConversation.messages.length > 1}
                    // Only the newest ones open by themselves: every opened message is fetched from the provider.
                    defaultOpen={index >= shownMessages.length - 2 || (index >= shownMessages.length - AUTO_OPEN_UNREAD && message.folder === "inbox" && !message.seen)}
                    customer={customerByAddress.get(sender(message).address)}
                    replyCustomer={replyCustomerOf(message)}
                    ownAddress={mail.email}
                    onReply={reply}
                    onDelete={setDeleting}
                    onNotice={setNotice}
                  />
                ))}
              </>
            )}
            {!reading && mail.ready && total > 0 && <p className="rounded-card-sm border border-dashed border-line px-4 py-10 text-center font-sans text-lg tracking-snug text-ink-muted">Wählen Sie links eine E-Mail aus.</p>}
          </section>
        </div>
      </div>

      <ComposeDialog
        draft={draft}
        onClose={() => setDraft(null)}
        onSent={({ warning, to }) => { setDraft(null); setNotice(warning ? { tone: "attention", text: warning } : { tone: "ok", text: `Die E-Mail an ${to} wurde gesendet.` }); }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => { if (deleting) void remove(deleting); }}
        title="E-Mail löschen?"
        description={mail.hasTrashFolder
          ? "Die E-Mail wird in den Papierkorb Ihres Postfachs verschoben. Dort lässt sie sich über Ihren Anbieter wiederherstellen, bis der Papierkorb geleert wird."
          : "Dieses Postfach hat keinen Papierkorb. Die E-Mail wird endgültig gelöscht, auch bei Ihrem Anbieter."}
        confirmLabel="Löschen"
        variant="danger"
      />
    </Page>
  );
}
