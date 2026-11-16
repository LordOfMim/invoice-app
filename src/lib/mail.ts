/*
 * The built-in mailbox as the window sees it: types of the desktop bridge, a small shared store (page, sidebar
 * badge and background fetch read the same list) and the pure logic that turns two folders into conversations.
 */

export type MailPerson = { name: string; address: string };
export type MailFolder = "inbox" | "sent";
export type MailSummary = {
  id: string;
  folder: MailFolder;
  uid: number;
  messageId: string;
  inReplyTo: string;
  references: string[];
  subject: string;
  from: MailPerson;
  to: MailPerson[];
  cc: MailPerson[];
  /** Where the sender wants answers to go (contact forms name the customer here). Missing in lists stored by older versions. */
  replyTo?: MailPerson[];
  /** ISO timestamp, or empty when the message carries no usable date. */
  date: string;
  seen: boolean;
  answered: boolean;
  hasAttachments: boolean;
  size: number;
};
export type MailBody = {
  text: string;
  truncated: boolean;
  htmlOnly: boolean;
  /** The message has no text that can be shown (HTML too large or too tangled to turn into text). Missing in texts stored by older versions. */
  unreadable?: boolean;
  attachments: { index: number; filename: string; contentType: string; size: number }[];
};
export type MailServer = { host: string; port: number; secure: boolean };
export type MailAccount = { email: string; name: string; user: string; imap: MailServer; smtp: MailServer; signature: string };
export type MailSuggestion = { provider: string; name: string; known: boolean; unsupported: boolean; note: string; imap: MailServer | null; smtp: MailServer | null };
export type MailAttachmentRef = { id: string; name: string; size: number };
export type MailList = { configured: boolean; email: string; inbox: MailSummary[]; sent: MailSummary[]; hasSentFolder: boolean; hasTrashFolder: boolean; lastSync: string; syncing: boolean; error: string; needsPassword: boolean; /** The provider refused the login at the last attempt. */ authFailed: boolean; /** The provider refused the login when a mail was to be sent. */ sendRefused?: boolean };
type Failure = { ok: false; error?: string; field?: string; canceled?: boolean; /** Ids of attachments the desktop app no longer holds. */ missing?: string[] };
type Result<T> = ({ ok: true } & T) | Failure;

export type MailApi = {
  status: () => Promise<Result<{ configured: boolean; account: MailAccount | null; canStorePassword: boolean; needsPassword: boolean; authFailed: boolean }>>;
  suggest: (email: string) => Promise<Result<{ suggestion: MailSuggestion | null }>>;
  saveAccount: (account: Omit<MailAccount, "imap" | "smtp"> & { imap: Omit<MailServer, "secure">; smtp: Omit<MailServer, "secure">; password: string }) => Promise<Result<{ passwordStored: boolean }>>;
  removeAccount: () => Promise<Result<object>>;
  list: () => Promise<Result<MailList>>;
  sync: () => Promise<Result<MailList>>;
  body: (id: string) => Promise<Result<{ body: MailBody }>>;
  setSeen: (id: string, seen: boolean) => Promise<Result<MailList>>;
  remove: (id: string) => Promise<Result<MailList>>;
  saveAttachment: (id: string, index: number) => Promise<Result<{ file: string }>>;
  /** Opens the file dialog. `held` are the attachments the draft already has: number and size are checked together with them. */
  attachFiles: (held: string[]) => Promise<Result<{ attachments: MailAttachmentRef[] }>>;
  attachPrint: (filename: string) => Promise<Result<{ attachment: MailAttachmentRef }>>;
  discardAttachments: (ids: string[]) => Promise<Result<object>>;
  /** Tells the desktop app that a draft with these attachments is still open, so it keeps them. `missing` names ids it no longer holds. */
  keepAttachments: (ids: string[]) => Promise<Result<{ missing?: string[] }>>;
  send: (message: { to: string; cc?: string; subject: string; text: string; attachmentIds?: string[]; replyToId?: string }) => Promise<Result<{ warning: string }>>;
};

/** What one e-mail may carry. The desktop app enforces the same numbers (electron/mail-core.cjs). */
export const MAIL_MAX_ATTACHMENTS = 20;
export const MAIL_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export const mailApi = (): MailApi | undefined => (typeof window === "undefined" ? undefined : window.electronAPI?.mail);

// ── Shared store ───────────────────────────────────────────────────────────────────────────────────────────────────

export type MailState = MailList & { ready: boolean };
const EMPTY: MailState = { ready: false, configured: false, email: "", inbox: [], sent: [], hasSentFolder: false, hasTrashFolder: false, lastSync: "", syncing: false, error: "", needsPassword: false, authFailed: false, sendRefused: false };
let state: MailState = EMPTY;
const listeners = new Set<() => void>();
let syncRun: Promise<void> | null = null;
let lastAttempt = 0;
/** When a fetch was last started (milliseconds), whether or not it succeeded; 0 before the first one. */
export const lastMailAttempt = () => lastAttempt;

function publish(next: MailState) {
  state = next;
  for (const listener of listeners) listener();
}
function accept(result: Result<MailList>) {
  if (result.ok) {
    const { ok: _ok, ...list } = result;
    void _ok;
    publish({ ...list, authFailed: !!list.authFailed, sendRefused: !!list.sendRefused, ready: true, syncing: syncRun !== null || list.syncing });
  } else publish({ ...state, ready: true, syncing: syncRun !== null, error: result.error || "Das Postfach konnte nicht gelesen werden." });
}

export const subscribeMail = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getMailState = () => state;
export const getServerMailState = () => EMPTY;
/** Lets other callers (delete, mark as read) hand in the list the desktop app returned. */
export const acceptMailList = accept;

/** Reads the list stored on this computer; no network. */
export async function loadMail(): Promise<void> {
  const api = mailApi();
  if (!api) { publish({ ...EMPTY, ready: true }); return; }
  try { accept(await api.list()); }
  catch (error) { publish({ ...state, ready: true, error: error instanceof Error ? error.message : "Das Postfach konnte nicht gelesen werden." }); }
}

/** Fetches new mail from the provider. Calls while a fetch is running join that fetch. */
export function syncMail(): Promise<void> {
  const api = mailApi();
  if (!api) return loadMail();
  if (syncRun) return syncRun;
  lastAttempt = Date.now();
  publish({ ...state, syncing: true });
  const run = (async () => {
    let result: Result<MailList>;
    try { result = await api.sync(); }
    catch (error) { result = { ok: false, error: error instanceof Error ? error.message : "Der Abruf ist fehlgeschlagen." }; }
    syncRun = null;
    accept(result);
  })();
  syncRun = run;
  return run;
}

/**
 * True when mail can be sent from the connected mailbox right now. A mailbox whose password is missing or was
 * refused by the provider is not usable: documents then go to the computer's mail program as before.
 */
export const mailboxUsable = (list: Pick<MailState, "ready" | "configured" | "needsPassword" | "authFailed" | "sendRefused">) =>
  list.ready && list.configured && !list.needsPassword && !list.authFailed && !list.sendRefused;

export const unreadCount = (list: Pick<MailList, "inbox">) => list.inbox.reduce((count, message) => count + (message.seen ? 0 : 1), 0);

// ── Pure helpers ───────────────────────────────────────────────────────────────────────────────────────────────────

/** "Re: AW: Fwd: Angebot" → "angebot": what two messages of one exchange have in common. */
export function normalizeSubject(subject: string): string {
  let text = subject.trim();
  for (let previous = ""; previous !== text;) {
    previous = text;
    text = text.replace(/^(re|aw|antw|antwort|fwd?|wg|weitergeleitet|tr)\s*(\[\d+\])?\s*:\s*/i, "");
  }
  return text.replace(/\s+/g, " ").toLocaleLowerCase("de-DE");
}

export function replySubject(subject: string): string {
  const text = subject.trim();
  return /^(re|aw|antw)\s*:/i.test(text) ? text : `AW: ${text}`.trim();
}

export const personLabel = (person: MailPerson | undefined) => person?.name || person?.address || "Unbekannt";

/**
 * Who an answer to a received message goes to: the Reply-To address when the sender names one (contact forms and
 * portals send from their own address and put the customer there), otherwise the sender. A Reply-To that is the
 * own mailbox is ignored: answering oneself helps nobody.
 */
export function replyTarget(message: MailSummary, ownAddress = ""): MailPerson {
  const wanted = message.replyTo?.find((person) => person.address);
  if (!wanted || wanted.address === message.from.address || wanted.address === ownAddress.trim().toLowerCase()) return message.from;
  return wanted;
}

/**
 * The other side of a message for answering and grouping: who an answer goes to in the inbox, the first recipient
 * in the sent folder. Not for naming who wrote a message: that is `sender`.
 */
export function counterpart(message: MailSummary, ownAddress = ""): MailPerson {
  return message.folder === "inbox" ? replyTarget(message, ownAddress) : message.to[0] ?? message.cc[0] ?? { name: "", address: "" };
}

/**
 * Who a message is shown under: the person who really sent it (From), or the first recipient of an own message.
 * Reply-To never changes that; a shop that sends from its own name and wants answers elsewhere is still the shop.
 */
export function sender(message: MailSummary): MailPerson {
  return message.folder === "inbox" ? message.from : message.to[0] ?? message.cc[0] ?? { name: "", address: "" };
}

/** Addresses nobody reads: what they send under one subject is not an exchange with one person. */
export const AUTOMATIC_SENDER = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|nicht[-_.]?antworten|keine[-_.]?antwort|mailer-daemon|postmaster)([-_.+][^@]*)?@/i;

export type Conversation = {
  key: string;
  subject: string;
  /** Everyone answers go to, most recent first. */
  people: MailPerson[];
  /** Who really wrote or received the messages (From of received mail, recipient of own mail), most recent first. */
  senders: MailPerson[];
  /** Oldest first, the way a conversation is read. */
  messages: MailSummary[];
  lastDate: string;
  unread: number;
};

/**
 * Groups inbox and sent messages into conversations. Messages belong together when one refers to the other
 * (In-Reply-To / References) or, for mail programs that drop those, when the same person writes under the same
 * subject. That person is whoever an answer goes to, so requests of different customers that arrive through the
 * same contact form stay apart; mail from an address nobody reads is never joined by subject alone.
 */
export function buildConversations(inbox: readonly MailSummary[], sent: readonly MailSummary[], ownAddress = ""): Conversation[] {
  const all = [...inbox, ...sent];
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root)!;
    for (let node = key; node !== root;) { const next = parent.get(node)!; parent.set(node, root); node = next; }
    return root;
  };
  const union = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const rootA = find(a), rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  };
  for (const message of all) {
    const own = `m:${message.id}`;
    parent.set(own, own);
    if (message.messageId) union(own, `id:${message.messageId}`);
    for (const reference of [message.inReplyTo, ...message.references]) if (reference) union(own, `id:${reference}`);
    const subject = normalizeSubject(message.subject);
    const other = counterpart(message, ownAddress).address;
    if (subject && other && !AUTOMATIC_SENDER.test(other)) union(own, `s:${other}\n${subject}`);
  }
  const groups = new Map<string, MailSummary[]>();
  for (const message of all) {
    const root = find(`m:${message.id}`);
    const group = groups.get(root);
    if (group) group.push(message); else groups.set(root, [message]);
  }
  const conversations: Conversation[] = [];
  for (const [key, group] of groups) {
    group.sort((a, b) => a.date.localeCompare(b.date) || a.uid - b.uid);
    const newest = group[group.length - 1];
    const people: MailPerson[] = [], senders: MailPerson[] = [];
    const knownPeople = new Set<string>(), knownSenders = new Set<string>();
    for (let index = group.length - 1; index >= 0; index -= 1) {
      const person = counterpart(group[index], ownAddress);
      if (person.address && !knownPeople.has(person.address)) { knownPeople.add(person.address); people.push(person); }
      const from = sender(group[index]);
      const key = from.address || from.name;
      if (key && !knownSenders.has(key)) { knownSenders.add(key); senders.push(from); }
    }
    conversations.push({
      key,
      subject: group[0].subject.trim() || "(ohne Betreff)",
      people,
      senders,
      messages: group,
      lastDate: newest.date,
      unread: group.reduce((count, message) => count + (message.folder === "inbox" && !message.seen ? 1 : 0), 0),
    });
  }
  return conversations.sort((a, b) => b.lastDate.localeCompare(a.lastDate));
}

/** Text search over what the list knows (not the message bodies). */
export function matchesMail(message: MailSummary, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase("de-DE");
  if (!needle) return true;
  return [message.subject, message.from.name, message.from.address, ...[...message.to, ...(message.replyTo ?? [])].flatMap((person) => [person.name, person.address])].some((value) => value.toLocaleLowerCase("de-DE").includes(needle));
}

/** "14:05" for today, "Gestern", otherwise "03.11.2026". */
export function formatMailDate(iso: string, now = new Date()): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const day = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((day(now) - day(date)) / 86_400_000);
  if (days === 0) return date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  if (days === 1) return "Gestern";
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatMailDateTime(iso: string): string {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return `${date.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })}, ${date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr`;
}

export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1000) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/** The quoted original below a reply. */
export function quoteForReply(message: MailSummary, text: string): string {
  // Bounded by lines and by characters: a converted HTML mail can be one endless line.
  const quoted = text.slice(0, 20_000).split("\n").slice(0, 200).map((line) => `> ${line}`.trimEnd()).join("\n");
  return `\n\n\nAm ${formatMailDateTime(message.date)} schrieb ${personLabel(message.from)}:\n${quoted}`;
}

export type ComposeDraft = { to: string; cc?: string; subject: string; text: string; attachments?: MailAttachmentRef[]; replyToId?: string };

/** Body of a new message with the account's signature below the text. */
export function withSignature(text: string, signature: string | undefined): string {
  const trimmed = (signature ?? "").trim();
  return trimmed ? `${text}\n\n${trimmed}` : text;
}
