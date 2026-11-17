"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button, LinkButton } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Disclosure } from "@/components/ui/Disclosure";
import { Field } from "@/components/ui/Field";
import { FormPage, FormSection } from "@/components/ui/FormLayout";
import { Input } from "@/components/ui/Input";
import { EmptyState, Page, PageHeader, StatusNote } from "@/components/ui/Layout";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { loadMail, mailApi, syncMail, type MailSuggestion } from "@/lib/mail";
import { usePersistedData } from "@/lib/storage/useStore";

const noSubscribe = () => () => {};
type Form = { name: string; email: string; user: string; password: string; imapHost: string; imapPort: string; smtpHost: string; smtpPort: string; signature: string };
/** The fields that decide where the password is sent. Changing one means the stored password is not reused. */
const loginOf = (form: Form) => [form.email.trim().toLowerCase(), form.user.trim() || form.email.trim().toLowerCase(), form.imapHost.trim().toLowerCase(), form.imapPort, form.smtpHost.trim().toLowerCase(), form.smtpPort].join("\n");
const EMPTY: Form = { name: "", email: "", user: "", password: "", imapHost: "", imapPort: "993", smtpHost: "", smtpPort: "465", signature: "" };

/** Connect one mailbox (IMAP for receiving, SMTP for sending). The details are checked before they are saved. */
export default function MailAccountPage() {
  const desktop = useSyncExternalStore(noSubscribe, () => !!mailApi(), () => false);
  const { data } = usePersistedData();
  const [form, setForm] = useState<Form>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [existing, setExisting] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [canStorePassword, setCanStorePassword] = useState(true);
  const [suggestion, setSuggestion] = useState<MailSuggestion | null>(null);
  const [serversTouched, setServersTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; field: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const inFlight = useRef(false);
  const [authFailed, setAuthFailed] = useState(false);
  const [storedLogin, setStoredLogin] = useState<string | null>(null);
  const passwordField = useRef<HTMLDivElement>(null);
  const senderName = data?.settings.defaultSender?.name ?? "";

  useEffect(() => {
    const api = mailApi();
    if (!api) return;
    let active = true;
    void api.status().then((status) => {
      if (!active) return;
      if (status.ok) {
        setCanStorePassword(status.canStorePassword);
        setNeedsPassword(status.needsPassword);
        setAuthFailed(!!status.authFailed);
        if (status.account) {
          const account = status.account;
          setExisting(true);
          setServersTouched(true);
          const stored: Form = { name: account.name, email: account.email, user: account.user === account.email ? "" : account.user, password: "", imapHost: account.imap.host, imapPort: String(account.imap.port), smtpHost: account.smtp.host, smtpPort: String(account.smtp.port), signature: account.signature };
          setForm(stored);
          setStoredLogin(loginOf(stored));
        }
      }
      setLoaded(true);
    });
    return () => { active = false; };
  }, []);

  const set = (change: Partial<Form>) => { setForm((current) => ({ ...current, ...change })); setError(null); };

  const lookUp = async (email: string) => {
    const api = mailApi();
    if (!api || !email.includes("@")) return;
    const result = await api.suggest(email);
    if (!result.ok) return;
    setSuggestion(result.suggestion);
    const found = result.suggestion;
    // Servers the user typed are theirs; a suggestion only fills what is still untouched.
    if (found?.imap && found.smtp && !serversTouched) {
      const { imap, smtp } = found;
      setForm((current) => ({ ...current, imapHost: imap.host, imapPort: String(imap.port), smtpHost: smtp.host, smtpPort: String(smtp.port) }));
    }
  };

  // The stored password is only used for the servers it was checked with (the desktop app enforces the same).
  const loginChanged = existing && storedLogin !== null && loginOf(form) !== storedLogin;
  const passwordRequired = !existing || needsPassword || loginChanged;
  const askForPassword = (text: string) => {
    setError({ text, field: "password" });
    passwordField.current?.querySelector("input")?.focus();
  };

  const save = async () => {
    const api = mailApi();
    if (!api || inFlight.current) return;
    if (loginChanged && !form.password) {
      askForPassword("Sie haben die Adresse, den Benutzernamen oder einen Server geändert. Bitte geben Sie deshalb das Passwort des Postfachs noch einmal ein.");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api.saveAccount({
        name: form.name.trim() || senderName,
        email: form.email.trim(),
        user: form.user.trim(),
        password: form.password,
        imap: { host: form.imapHost.trim(), port: Number(form.imapPort) },
        smtp: { host: form.smtpHost.trim(), port: Number(form.smtpPort) },
        signature: form.signature,
      });
      if (!result.ok) {
        if (result.field === "password") askForPassword(result.error || "Bitte das Passwort des Postfachs eingeben.");
        else setError({ text: result.error || "Das Postfach konnte nicht verbunden werden.", field: result.field ?? "" });
        return;
      }
      await loadMail();
      void syncMail();
      window.location.assign("/mail");
    } catch (cause) {
      setError({ text: cause instanceof Error ? cause.message : "Das Postfach konnte nicht verbunden werden.", field: "" });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const remove = async () => {
    const api = mailApi();
    if (!api) return;
    const result = await api.removeAccount();
    if (!result.ok) { setError({ text: result.error || "Das Postfach konnte nicht entfernt werden.", field: "" }); return; }
    await loadMail();
    window.location.assign("/mail");
  };

  if (!desktop) {
    return (
      <Page width="narrow">
        <PageHeader title="Postfach einrichten" />
        <EmptyState title="Nur in der Desktop-App" description="E-Mails senden und empfangen funktioniert in der installierten Helferlein-App." />
      </Page>
    );
  }

  const fieldError = (...fields: string[]) => (error && fields.includes(error.field) ? error.text : undefined);
  const general = error && !["email", "password", "imapHost", "imapPort", "smtpHost", "smtpPort"].includes(error.field) ? error.text : "";
  const serverProblem = !!error && ["imapHost", "imapPort", "smtpHost", "smtpPort"].includes(error.field);

  return (
    <Page width="narrow">
      <PageHeader
        title={existing ? "Postfach ändern" : "Postfach einrichten"}
        description="Verbinden Sie Ihr vorhandenes E-Mail-Postfach. Danach senden Sie Rechnungen, Angebote und Mahnungen direkt aus Helferlein und lesen die Antworten hier."
        actions={<LinkButton href="/mail">Zurück zum Postfach</LinkButton>}
      />
      <form noValidate onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <FormPage
          actions={<>
            {existing && <Button variant="danger" disabled={busy} onClick={() => setConfirmRemove(true)}>Postfach entfernen</Button>}
            <Button type="submit" variant="primary" loading={busy} disabled={busy || !loaded || !!suggestion?.unsupported}>{busy ? "Verbindung wird geprüft …" : "Verbindung prüfen und speichern"}</Button>
          </>}
        >
          {needsPassword && (canStorePassword
            ? <StatusNote tone="attention" title="Bitte das Passwort erneut eingeben">Das gespeicherte Passwort ist auf diesem Computer nicht mehr lesbar (zum Beispiel nach einem Umzug auf einen neuen Computer).</StatusNote>
            : <StatusNote tone="attention" title="Bitte das Passwort eingeben">Dieser Computer kann Passwörter nicht sicher speichern. Helferlein merkt sich das Passwort deshalb nur, solange das Programm läuft, und fragt nach jedem Start einmal danach.</StatusNote>)}
          {authFailed && !needsPassword && <StatusNote tone="error" title="Die Anmeldung am Postfach wurde zuletzt abgelehnt">Bitte geben Sie das Passwort neu ein und speichern Sie. Viele Anbieter verlangen ein eigenes App-Passwort oder das Freischalten von IMAP.</StatusNote>}
          <FormSection title="Zugang" columns={2} description="Dieselben Angaben, mit denen Sie sich sonst bei Ihrem E-Mail-Anbieter anmelden.">
            <Field label="E-Mail-Adresse" error={fieldError("email")}>
              <Input type="email" autoComplete="off" spellCheck={false} value={form.email} placeholder="name@beispiel.de" onChange={(event) => set({ email: event.target.value })} onBlur={(event) => { void lookUp(event.target.value.trim()); }} />
            </Field>
            <div ref={passwordField} className="min-w-0">
              <Field label="Passwort" error={fieldError("password")} hint={!passwordRequired ? "Leer lassen, um das gespeicherte Passwort zu behalten." : loginChanged ? "Adresse, Benutzername oder Server wurden geändert. Bitte das Passwort noch einmal eingeben." : undefined}>
                <Input type="password" autoComplete="off" value={form.password} onChange={(event) => set({ password: event.target.value })} />
              </Field>
            </div>
            <Field label="Ihr Name als Absender" hint="So erscheinen Sie beim Empfänger." className="@md:col-span-2">
              <Input type="text" value={form.name} placeholder={senderName || "Max Mustermann"} onChange={(event) => set({ name: event.target.value })} />
            </Field>
            {suggestion?.note && <StatusNote tone={suggestion.unsupported ? "error" : "attention"} className="@md:col-span-2" title={suggestion.name || undefined}>{suggestion.note}</StatusNote>}
            {suggestion && !suggestion.known && <StatusNote tone="info" className="@md:col-span-2">Für diese Adresse sind die Server nicht hinterlegt. Unter „Servereinstellungen“ stehen übliche Werte; die richtigen nennt Ihr Anbieter meist unter dem Stichwort „IMAP“.</StatusNote>}
          </FormSection>

          <Disclosure title="Servereinstellungen" summary={form.imapHost ? `${form.imapHost}, ${form.smtpHost}` : "werden aus der Adresse vorgeschlagen"} defaultOpen={existing} open={serverProblem ? true : undefined}>
            <FormSection title="Posteingang (IMAP)" columns={2}>
              <Field label="Server" error={fieldError("imapHost")}>
                <Input type="text" spellCheck={false} autoComplete="off" value={form.imapHost} placeholder="imap.beispiel.de" onChange={(event) => { setServersTouched(true); set({ imapHost: event.target.value }); }} />
              </Field>
              <Field label="Port" error={fieldError("imapPort")}>
                <Select value={form.imapPort} onChange={(event) => { setServersTouched(true); set({ imapPort: event.target.value }); }}>
                  <option value="993">993 (verschlüsselt, üblich)</option>
                  <option value="143">143 (STARTTLS)</option>
                </Select>
              </Field>
            </FormSection>
            <FormSection title="Postausgang (SMTP)" columns={2}>
              <Field label="Server" error={fieldError("smtpHost")}>
                <Input type="text" spellCheck={false} autoComplete="off" value={form.smtpHost} placeholder="smtp.beispiel.de" onChange={(event) => { setServersTouched(true); set({ smtpHost: event.target.value }); }} />
              </Field>
              <Field label="Port" error={fieldError("smtpPort")}>
                <Select value={form.smtpPort} onChange={(event) => { setServersTouched(true); set({ smtpPort: event.target.value }); }}>
                  <option value="465">465 (verschlüsselt)</option>
                  <option value="587">587 (STARTTLS)</option>
                  <option value="25">25 (STARTTLS, selten)</option>
                </Select>
              </Field>
              <Field label="Benutzername" hint="Nur ausfüllen, wenn er von der E-Mail-Adresse abweicht." className="@md:col-span-2">
                <Input type="text" spellCheck={false} autoComplete="off" value={form.user} placeholder={form.email} onChange={(event) => set({ user: event.target.value })} />
              </Field>
            </FormSection>
          </Disclosure>

          <FormSection title="Signatur" columns={1} description="Steht unter jeder neuen E-Mail und lässt sich vor dem Senden ändern.">
            <Field label="Signatur" hideLabel>
              <Textarea rows={4} value={form.signature} maxLength={2000} placeholder={"Mit freundlichen Grüßen\nMax Mustermann\nTelefon 01234 56789"} onChange={(event) => set({ signature: event.target.value })} />
            </Field>
          </FormSection>

          {general && <StatusNote tone="error" role="alert" title="Das Postfach wurde nicht verbunden">{general}</StatusNote>}
          <StatusNote tone="info" title="Was mit Ihren Daten geschieht">
            Helferlein verbindet sich nur mit dem Server Ihres Anbieters, immer verschlüsselt. {canStorePassword
              ? "Das Passwort wird vom Schlüsselbund des Betriebssystems verschlüsselt auf diesem Computer gespeichert"
              : "Auf diesem Computer gibt es keinen Schlüsselbund; das Passwort wird deshalb nicht gespeichert und nach jedem Programmstart einmal abgefragt"}
            {" "}und ist nicht Teil der Datensicherung. E-Mails bleiben bei Ihrem Anbieter; Helferlein merkt sich eine Liste der neuesten 500 je Ordner und zeigt Nachrichten als reinen Text ohne nachgeladene Bilder.
          </StatusNote>
        </FormPage>
      </form>
      <ConfirmDialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={() => { void remove(); }}
        title="Postfach aus Helferlein entfernen?"
        description="Zugangsdaten und die gemerkte Nachrichtenliste werden von diesem Computer gelöscht. Ihre E-Mails beim Anbieter bleiben unverändert."
        confirmLabel="Entfernen"
        variant="danger"
      />
    </Page>
  );
}
