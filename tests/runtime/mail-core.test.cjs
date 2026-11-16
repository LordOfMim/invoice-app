'use strict';
process.env.TZ = 'Europe/Berlin';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../electron/mail-core.cjs');
const { createLoader } = require('./helpers/load-typescript.cjs');

const mail = createLoader()('src/lib/mail.ts');
const fieldOf = (run) => { try { run(); } catch (error) { return error.field; } return 'no error'; };

// ── Provider suggestion ────────────────────────────────────────────────────────────────────────────────────────

test('suggestServers: a known provider gets its preset, whatever the spelling of the address', () => {
  const gmx = core.suggestServers(' Max.Mustermann@GMX.de ');
  assert.deepEqual({ ...gmx, note: '' }, { provider: 'gmx', name: 'GMX', known: true, unsupported: false, note: '', imap: { host: 'imap.gmx.net', port: 993, secure: true }, smtp: { host: 'mail.gmx.net', port: 587, secure: false } });
  assert.match(gmx.note, /IMAP/);
  assert.equal(core.suggestServers('a@googlemail.com').provider, 'gmail');
  assert.deepEqual(core.suggestServers('a@t-online.de').smtp, { host: 'securesmtp.t-online.de', port: 465, secure: true });
});

test('suggestServers: every preset uses an encrypted port the account form accepts', () => {
  for (const provider of core.PROVIDERS) {
    if (provider.unsupported) continue;
    const account = core.normalizeAccount({ email: 'a@example.org', imap: provider.imap, smtp: provider.smtp });
    assert.deepEqual([account.imap, account.smtp], [provider.imap, provider.smtp], provider.id);
    for (const domain of provider.domains) assert.equal(core.suggestServers(`a@${domain}`).provider, provider.id, domain);
  }
  const domains = core.PROVIDERS.flatMap((provider) => provider.domains);
  assert.equal(new Set(domains).size, domains.length, 'a domain belongs to one provider');
});

test('suggestServers: an unknown domain gets a correctable guess with implicit TLS', () => {
  assert.deepEqual(core.suggestServers('info@Maler-Schmidt.de'), {
    provider: '', name: '', known: false, unsupported: false, note: '',
    imap: { host: 'imap.maler-schmidt.de', port: 993, secure: true }, smtp: { host: 'smtp.maler-schmidt.de', port: 465, secure: true },
  });
  // A subdomain of a provider is not that provider.
  assert.equal(core.suggestServers('a@mail.gmx.de').known, false);
});

test('suggestServers: Microsoft mailboxes are recognised as unsupported, without servers', () => {
  for (const address of ['a@outlook.com', 'a@hotmail.de', 'A@LIVE.DE']) {
    const suggestion = core.suggestServers(address);
    assert.deepEqual([suggestion.provider, suggestion.known, suggestion.unsupported, suggestion.imap, suggestion.smtp], ['microsoft', true, true, null, null], address);
    assert.match(suggestion.note, /Microsoft/);
  }
});

test('suggestServers: no suggestion for something that is not an address', () => {
  for (const value of ['', 'max', 'max@', '@gmx.de', 'max@gmx', 'max@gmx.d', 'max mustermann@gmx.de', 'a@b@gmx.de', 'Max <max@gmx.de>', 'max@gmx.de, b@gmx.de', null, undefined, 42, {}, `${'a'.repeat(250)}@gmx.de`]) {
    assert.equal(core.suggestServers(value), null, String(value));
  }
});

// ── Account ────────────────────────────────────────────────────────────────────────────────────────────────────

const account = (overrides = {}) => ({ email: 'Max@Firma.de', name: 'Max Mustermann', user: '', imap: { host: 'IMAP.Firma.de', port: 993 }, smtp: { host: ' smtp.firma.de ', port: '587' }, signature: 'Gruß\r\nMax', ...overrides });

test('normalizeAccount: normalises spelling, defaults the user to the address and derives TLS from the port', () => {
  assert.deepEqual(core.normalizeAccount(account()), {
    email: 'max@firma.de', name: 'Max Mustermann', user: 'max@firma.de',
    imap: { host: 'imap.firma.de', port: 993, secure: true }, smtp: { host: 'smtp.firma.de', port: 587, secure: false }, signature: 'Gruß\r\nMax',
  });
  assert.equal(core.normalizeAccount(account({ user: ' m.mustermann ' })).user, 'm.mustermann');
  assert.equal(core.normalizeAccount(account({ smtp: { host: 'smtp.firma.de', port: 465 } })).smtp.secure, true);
  assert.equal('password' in core.normalizeAccount(account({ password: 'geheim' })), false);
});

test('normalizeAccount: the window cannot switch off encryption on an implicit-TLS port', () => {
  const result = core.normalizeAccount(account({ imap: { host: 'imap.firma.de', port: 993, secure: false }, smtp: { host: 'smtp.firma.de', port: 465, secure: false } }));
  assert.deepEqual([result.imap.secure, result.smtp.secure], [true, true]);
});

test('normalizeAccount: rejects addresses that are not one', () => {
  for (const email of ['', 'max', 'max@firma', 'max@firma.de\r\nBcc: x@y.de', 'max@firma.de x', 'Max <max@firma.de>', undefined, null, {}]) {
    assert.equal(fieldOf(() => core.normalizeAccount(account({ email }))), 'email', String(email));
  }
  assert.equal(fieldOf(() => core.normalizeAccount(null)), 'email');
  assert.equal(fieldOf(() => core.normalizeAccount(undefined)), 'email');
});

test('normalizeAccount: rejects host names that are not plain host names', () => {
  const bad = ['', ' ', 'imap_firma.de', 'imap.firma.de:993', 'imap.firma.de/x', 'user@imap.firma.de', 'imap..firma.de', '-imap.firma.de', 'imap.firma.de.', 'imap firma.de', 'imap.firma.de\r\nX', 'imap.firma.de\0x', 'ïmap.firma.de', `${'a'.repeat(64)}.de`, undefined, null];
  for (const host of bad) {
    assert.equal(fieldOf(() => core.normalizeAccount(account({ imap: { host, port: 993 } }))), 'imapHost', JSON.stringify(host));
    assert.equal(fieldOf(() => core.normalizeAccount(account({ smtp: { host, port: 465 } }))), 'smtpHost', JSON.stringify(host));
  }
  assert.equal(fieldOf(() => core.normalizeAccount(account({ imap: undefined }))), 'imapHost');
  assert.equal(fieldOf(() => core.normalizeAccount(account({ smtp: null }))), 'smtpHost');
  // Control characters at the end are dropped like surrounding spaces; the stored name is clean.
  assert.equal(core.normalizeAccount(account({ imap: { host: 'imap.firma.de\0\r\n', port: 993 } })).imap.host, 'imap.firma.de');
  for (const host of ['localhost', '192.168.1.10', 'mx.a-b.example', 'A1.DE']) {
    assert.equal(core.normalizeAccount(account({ imap: { host, port: 993 } })).imap.host, host.toLowerCase());
  }
});

test('normalizeAccount: a host name longer than 253 characters is rejected, not shortened into a different one', () => {
  // Labels of 49 characters, so only the total length decides.
  const hostOf = (length) => `${Array.from({ length: length - 3 }, (_, index) => (index % 50 === 49 && index < length - 4 ? '.' : 'a')).join('')}.de`;
  assert.equal(hostOf(254).length, 254);
  const longest = hostOf(253);
  assert.equal(core.normalizeAccount(account({ imap: { host: longest, port: 993 } })).imap.host, longest);
  assert.equal(core.normalizeAccount(account({ smtp: { host: longest, port: 465 } })).smtp.host, longest);
  for (const length of [254, 255, 299, 300, 301, 400, 1000]) {
    const host = hostOf(length);
    assert.equal(fieldOf(() => core.normalizeAccount(account({ imap: { host, port: 993 } }))), 'imapHost', `imap ${length}`);
    assert.equal(fieldOf(() => core.normalizeAccount(account({ smtp: { host, port: 465 } }))), 'smtpHost', `smtp ${length}`);
    assert.equal(fieldOf(() => core.normalizeAccount(account({ imap: { host, port: 1143 } }), { anyPort: true })), 'imapHost', `any port ${length}`);
  }
});

test('normalizeAccount: only the ports of encrypted mail access are accepted', () => {
  for (const port of [110, 995, 80, 443, 0, -993, 993.5, 65536, NaN, '', 'abc', undefined, null, '993 ; x']) {
    assert.equal(fieldOf(() => core.normalizeAccount(account({ imap: { host: 'imap.firma.de', port } }))), 'imapPort', `imap ${port}`);
  }
  for (const port of [993, 143, 110, 2525, 80, 0, 587.5, NaN, undefined]) {
    assert.equal(fieldOf(() => core.normalizeAccount(account({ smtp: { host: 'smtp.firma.de', port } }))), 'smtpPort', `smtp ${port}`);
  }
  // The STARTTLS ports are allowed and marked as "not implicit TLS"; the service then insists on STARTTLS.
  assert.deepEqual(core.normalizeAccount(account({ imap: { host: 'imap.firma.de', port: 143 } })).imap, { host: 'imap.firma.de', port: 143, secure: false });
  assert.deepEqual(core.normalizeAccount(account({ smtp: { host: 'smtp.firma.de', port: 25 } })).smtp, { host: 'smtp.firma.de', port: 25, secure: false });
  const error = (() => { try { core.normalizeAccount(account({ imap: { host: 'imap.firma.de', port: 110 } })); } catch (caught) { return caught; } })();
  assert.match(error.message, /993 oder 143/);
  assert.equal(error.userMessage, error.message);
});

test('normalizeAccount: arbitrary ports only for the test switch the app never passes', () => {
  const local = { imap: { host: '127.0.0.1', port: 1143, secure: false }, smtp: { host: '127.0.0.1', port: 1025 } };
  assert.equal(fieldOf(() => core.normalizeAccount(account(local))), 'imapPort');
  const result = core.normalizeAccount(account(local), { anyPort: true });
  assert.deepEqual([result.imap, result.smtp], [{ host: '127.0.0.1', port: 1143, secure: false }, { host: '127.0.0.1', port: 1025, secure: true }]);
  assert.equal(fieldOf(() => core.normalizeAccount(account({ imap: { host: 'bad host', port: 1143 } }), { anyPort: true })), 'imapHost');
  assert.equal(fieldOf(() => core.normalizeAccount(account({ imap: { host: '127.0.0.1', port: 70000 } }), { anyPort: true })), 'imapPort');
});

test('normalizeAccount: line breaks cannot smuggle headers or commands through name, user or host', () => {
  const result = core.normalizeAccount(account({ name: 'Max\r\nBcc: evil@x.de\0', user: 'max\r\nA1 LOGOUT\n', email: 'max@firma.de\r\n' }));
  assert.deepEqual([result.name, result.user, result.email], ['Max Bcc: evil@x.de', 'max A1 LOGOUT', 'max@firma.de']);
  for (const key of ['email', 'name', 'user']) assert.doesNotMatch(result[key], /[\r\n\0]/, key);
  assert.doesNotMatch(result.imap.host + result.smtp.host, /[\r\n\0]/);
});

test('normalizeAccount: bounded lengths, signature keeps its lines but no NUL', () => {
  const result = core.normalizeAccount(account({ name: 'x'.repeat(500), user: 'u'.repeat(500), signature: `a\0b\n${'s'.repeat(5000)}` }));
  assert.equal(result.name.length, 120);
  assert.equal(result.user.length, 254);
  assert.equal(result.signature.length, 2000);
  assert.ok(result.signature.startsWith('ab\nsss'));
  assert.equal(core.normalizeAccount(account({ signature: undefined })).signature, '');
  assert.equal(core.normalizeAccount(account({ name: undefined })).name, '');
});

// ── Outgoing message ───────────────────────────────────────────────────────────────────────────────────────────

const outgoing = (overrides = {}) => ({ to: 'kunde@example.de', subject: 'Rechnung', text: 'Guten Tag', ...overrides });

test('normalizeOutgoing: a plain message', () => {
  assert.deepEqual(core.normalizeOutgoing(outgoing()), { to: ['kunde@example.de'], cc: [], subject: 'Rechnung', text: 'Guten Tag', attachmentIds: [], replyToId: '' });
});

test('normalizeOutgoing: address lists with names, any separator, as text or array; duplicates collapse', () => {
  const list = 'Max Müller <Max@B.de>; "Erika" <e@c.de>, a@b.de\nmax@b.de ,, <z@y.de>';
  assert.deepEqual(core.normalizeOutgoing(outgoing({ to: list })).to, ['max@b.de', 'e@c.de', 'a@b.de', 'z@y.de']);
  assert.deepEqual(core.normalizeOutgoing(outgoing({ to: ['A <a@b.de>', 'A@B.DE', ' c@d.de '] })).to, ['a@b.de', 'c@d.de']);
  assert.deepEqual(core.normalizeOutgoing(outgoing({ cc: 'chef@b.de; CHEF@b.de' })).cc, ['chef@b.de']);
  assert.deepEqual(core.normalizeAddressList('a@b.de', 'An'), ['a@b.de']);
  assert.deepEqual(core.normalizeAddressList(undefined, 'An'), []);
});

test('normalizeOutgoing: a comma or semicolon inside a quoted name does not separate recipients', () => {
  assert.deepEqual(core.normalizeAddressList('"Müller, Hans" <h@x.de>, b@y.de', 'An'), ['h@x.de', 'b@y.de']);
  assert.deepEqual(core.normalizeOutgoing(outgoing({ to: '"Müller, Hans" <h@x.de>, b@y.de' })).to, ['h@x.de', 'b@y.de']);
  assert.deepEqual(core.normalizeOutgoing(outgoing({ cc: '"Müller, Hans" <h@x.de>, b@y.de' })).cc, ['h@x.de', 'b@y.de']);
  assert.deepEqual(core.normalizeAddressList('"Bau; Söhne, GmbH" <bau@x.de>; "Schmidt, Eva" <eva@y.de>\n"A, B" <c@z.de>', 'An'), ['bau@x.de', 'eva@y.de', 'c@z.de']);
  assert.deepEqual(core.normalizeAddressList('a@b.de,"Müller, Hans" <h@x.de>', 'An'), ['a@b.de', 'h@x.de']);
  // Outside quotes a comma still separates, so the name part alone is refused as an address.
  assert.equal(fieldOf(() => core.normalizeOutgoing(outgoing({ to: 'Müller, Hans <h@x.de>' }))), 'to');
  assert.equal(fieldOf(() => core.normalizeOutgoing(outgoing({ cc: 'Müller, Hans <h@x.de>' }))), 'cc');
  // A quote that is never closed does not swallow the recipients behind it.
  assert.equal(fieldOf(() => core.normalizeOutgoing(outgoing({ to: '"Müller, Hans <h@x.de>, b@y.de' }))), 'to');
});

test('normalizeOutgoing: an address in both An and Kopie is kept only in An', () => {
  const result = core.normalizeOutgoing(outgoing({ to: 'kunde@example.de; chef@b.de', cc: 'Chef <CHEF@b.de>, buero@b.de, Kunde@Example.de' }));
  assert.deepEqual([result.to, result.cc], [['kunde@example.de', 'chef@b.de'], ['buero@b.de']]);
  assert.deepEqual(core.normalizeOutgoing(outgoing({ to: 'a@b.de', cc: 'a@b.de' })).cc, []);
  assert.deepEqual(core.normalizeOutgoing(outgoing({ to: ['a@b.de'], cc: ['"B, A" <A@B.de>', 'c@d.de'] })).cc, ['c@d.de']);
  // Such an address counts once towards the limit of 50.
  const addresses = Array.from({ length: 50 }, (_, index) => `u${index}@example.de`);
  const full = core.normalizeOutgoing(outgoing({ to: addresses, cc: addresses }));
  assert.deepEqual([full.to.length, full.cc.length], [50, 0]);
  // The list helper on its own knows nothing about the other field.
  assert.deepEqual(core.normalizeAddressList('a@b.de', 'Kopie'), ['a@b.de']);
});

test('normalizeOutgoing: an invalid address names the field it came from', () => {
  for (const to of ['kunde', 'kunde@example', 'a@b.de, nope', 'a b@c.de', 'Max <kein-at>', ['a@b.de', 'x'], `${'a'.repeat(250)}@example.de`]) {
    assert.equal(fieldOf(() => core.normalizeOutgoing(outgoing({ to }))), 'to', String(to));
  }
  assert.equal(fieldOf(() => core.normalizeOutgoing(outgoing({ cc: 'nope' }))), 'cc');
  const error = (() => { try { core.normalizeOutgoing(outgoing({ cc: 'a@b.de; nope' })); } catch (caught) { return caught; } })();
  assert.match(error.message, /^Kopie: „nope“/);
});

test('normalizeOutgoing: at least one recipient in "An"', () => {
  for (const to of ['', ' ; , \n', [], undefined, null, ['', ' ']]) {
    assert.equal(fieldOf(() => core.normalizeOutgoing(outgoing({ to }))), 'to', JSON.stringify(to));
  }
  assert.equal(fieldOf(() => core.normalizeOutgoing(outgoing({ to: '', cc: 'a@b.de' }))), 'to');
  assert.equal(fieldOf(() => core.normalizeOutgoing(null)), 'to');
});

test('normalizeOutgoing: at most 50 recipients across An and Kopie, counted after removing duplicates', () => {
  const addresses = (count, prefix = 'u') => Array.from({ length: count }, (_, index) => `${prefix}${index}@example.de`);
  assert.equal(core.normalizeOutgoing(outgoing({ to: addresses(50) })).to.length, 50);
  assert.equal(core.normalizeOutgoing(outgoing({ to: addresses(30), cc: addresses(20, 'c') })).cc.length, 20);
  assert.equal(fieldOf(() => core.normalizeOutgoing(outgoing({ to: addresses(51) }))), 'to');
  assert.equal(fieldOf(() => core.normalizeOutgoing(outgoing({ to: addresses(50), cc: 'chef@example.de' }))), 'to');
  assert.equal(fieldOf(() => core.normalizeOutgoing(outgoing({ to: addresses(1), cc: addresses(50, 'c') }))), 'to');
  assert.equal(core.normalizeOutgoing(outgoing({ to: [...addresses(50), ...addresses(50)] })).to.length, 50);
});

test('normalizeOutgoing: line breaks in addresses never produce an extra recipient or header', () => {
  const attempts = [
    'kunde@example.de\r\nBcc: evil@x.de',
    'kunde@example.de\nBcc:evil@x.de',
    ['kunde@example.de\r\nBcc: evil@x.de'],
    ['Kunde\r\nBcc: evil@x.de <kunde@example.de>\r\nX-A: b'],
    'kunde@example.de\0\r\n.\r\nMAIL FROM:<evil@x.de>',
  ];
  for (const to of attempts) {
    let result;
    try { result = core.normalizeOutgoing(outgoing({ to })); } catch (error) { assert.equal(error.field, 'to'); continue; }
    assert.deepEqual(result.to, ['kunde@example.de'], JSON.stringify(to));
  }
  for (const cc of attempts) {
    let result;
    try { result = core.normalizeOutgoing(outgoing({ cc })); } catch (error) { assert.equal(error.field, 'cc'); continue; }
    assert.deepEqual(result.cc, ['kunde@example.de'], JSON.stringify(cc));
  }
  // A harmless trailing line break is not an error.
  assert.deepEqual(core.normalizeOutgoing(outgoing({ to: 'kunde@example.de\r\n' })).to, ['kunde@example.de']);
});

test('normalizeOutgoing: the subject is one bounded line', () => {
  const result = core.normalizeOutgoing(outgoing({ subject: '  Rechnung 12\r\nBcc: evil@x.de\n\0X-Spam: no  ' }));
  assert.equal(result.subject, 'Rechnung 12 Bcc: evil@x.de X-Spam: no');
  assert.equal(core.normalizeOutgoing(outgoing({ subject: 'ä'.repeat(400) })).subject.length, 300);
  assert.equal(core.normalizeOutgoing(outgoing({ subject: undefined })).subject, '');
});

test('normalizeOutgoing: body text keeps its lines with uniform line ends, is bounded, and one of subject or text is required', () => {
  assert.equal(core.normalizeOutgoing(outgoing({ text: 'a\r\nb\rc\nd\0' })).text, 'a\nb\nc\nd');
  assert.equal(core.normalizeOutgoing(outgoing({ subject: '', text: 'nur Text' })).subject, '');
  assert.equal(core.normalizeOutgoing(outgoing({ subject: 'nur Betreff', text: undefined })).text, '');
  assert.equal(fieldOf(() => core.normalizeOutgoing(outgoing({ subject: ' \r\n ', text: ' \n\t ' }))), 'subject');
  assert.equal(core.normalizeOutgoing(outgoing({ text: 'x'.repeat(core.MAX_BODY_CHARS) })).text.length, core.MAX_BODY_CHARS);
  assert.equal(fieldOf(() => core.normalizeOutgoing(outgoing({ text: 'x'.repeat(core.MAX_BODY_CHARS + 1) }))), 'text');
});

test('normalizeOutgoing: attachments are never dropped silently; reply references are reduced to well-formed ids', () => {
  const id = '123e4567-e89b-12d3-a456-426614174000';
  const numbered = index => `123e4567-e89b-12d3-a456-4266141740${String(index).padStart(2, '0')}`;
  const result = core.normalizeOutgoing(outgoing({ attachmentIds: [id, id], replyToId: 'inbox:12' }));
  assert.deepEqual(result.attachmentIds, [id], 'the same file twice is one attachment');
  // An id that cannot be a held file means the mail would go out without something the user sees in the draft.
  for (const bad of ['../../etc/passwd', 5, null, `${id}/x`, id.toUpperCase()]) {
    assert.throws(() => core.normalizeOutgoing(outgoing({ attachmentIds: [id, bad] })), error => error.field === 'attachments' && /nicht mehr vorhanden/.test(error.userMessage), String(bad));
  }
  assert.throws(() => core.normalizeOutgoing(outgoing({ attachmentIds: id })), error => error.field === 'attachments');
  assert.deepEqual(core.normalizeOutgoing(outgoing({ attachmentIds: undefined })).attachmentIds, []);
  assert.deepEqual(core.normalizeOutgoing(outgoing({ attachmentIds: null })).attachmentIds, []);
  // Twenty go through unchanged, twenty-one are an error instead of a mail with twenty.
  assert.equal(core.MAX_ATTACHMENTS, 20);
  assert.equal(core.normalizeOutgoing(outgoing({ attachmentIds: Array.from({ length: 20 }, (_, index) => numbered(index)) })).attachmentIds.length, 20);
  assert.throws(() => core.normalizeOutgoing(outgoing({ attachmentIds: Array.from({ length: 21 }, (_, index) => numbered(index)) })),
    error => error.field === 'attachments' && error.userMessage === 'Es lassen sich höchstens 20 Dateien anhängen.');
  assert.equal(result.replyToId, 'inbox:12');
  assert.equal(core.normalizeOutgoing(outgoing({ replyToId: 'sent:7' })).replyToId, 'sent:7');
  for (const replyToId of ['trash:1', 'inbox:', 'inbox:1 OR 1', 'inbox:-1', 'INBOX:1', 'inbox:1234567890123', 12, null, { toString: () => 'inbox:1' }]) {
    assert.equal(core.normalizeOutgoing(outgoing({ replyToId })).replyToId, '', String(replyToId));
  }
});

test('checkAttachmentBudget: number and total size count together with what the draft already has', () => {
  const MB = 1024 * 1024;
  const file = (size, name = 'foto.jpg') => ({ name, size });
  const message = (held, added) => { try { core.checkAttachmentBudget(held, added); } catch (error) { assert.equal(error.field, 'attachments'); return error.userMessage; } return ''; };
  assert.equal(message([], [file(1)]), '');
  assert.equal(message(Array(19).fill(1), [file(1)]), '', 'the twentieth file');
  assert.equal(message([], Array.from({ length: 20 }, () => file(MB))), '', 'exactly 20 files and 20 MB');
  // 15 photos at once used to become 10 without a word.
  assert.equal(message([], Array.from({ length: 15 }, () => file(1))), '');
  assert.match(message([], Array.from({ length: 21 }, () => file(1))), /^Es lassen sich höchstens 20 Dateien anhängen\. Gewählt wurden 21\. Es wurde keine davon hinzugefügt\.$/);
  assert.match(message(Array(8).fill(1), Array.from({ length: 15 }, () => file(1))), /höchstens 20 Dateien anhängen\. 8 Dateien sind schon angehängt, 15 weitere wurden gewählt\. Es wurde keine davon hinzugefügt\./);
  assert.match(message(Array(20).fill(1), [file(1)]), /höchstens 20 Dateien anhängen\. 20 Dateien sind schon angehängt, eine weitere wurde gewählt\.$/);
  assert.match(message([], [file(20 * MB + 1, 'Video\r\nvom Bad.mp4')]), /^„Video vom Bad\.mp4“ ist größer als 20 MB \(20,0 MB\)/);
  assert.equal(message([], [file(20 * MB)]), '');
  assert.match(message([12 * MB], [file(9 * MB)]), /^Zusammen wären die Anhänge 21,0 MB groß\. Eine E-Mail darf höchstens 20 MB Anhang haben.* Die Datei wurde nicht hinzugefügt\.$/);
  assert.match(message([], [file(11 * MB), file(11 * MB)]), /22,0 MB groß.*Es wurde keine der gewählten Dateien hinzugefügt\.$/);
});

test('the window and the desktop app agree on what one e-mail may carry', () => {
  assert.deepEqual([mail.MAIL_MAX_ATTACHMENTS, mail.MAIL_MAX_ATTACHMENT_BYTES], [core.MAX_ATTACHMENTS, core.MAX_ATTACHMENT_BYTES]);
  // The staging area holds at least one full draft, so a draft within its limits is never refused for lack of room.
  assert.ok(core.MAX_STAGED_ATTACHMENTS >= core.MAX_ATTACHMENTS + 1 && core.MAX_STAGED_BYTES >= 2 * core.MAX_ATTACHMENT_BYTES);
});

// ── Message list ───────────────────────────────────────────────────────────────────────────────────────────────

const fetched = (overrides = {}) => ({
  uid: 42,
  envelope: {
    messageId: '<m3@example.de>', inReplyTo: '<m2@example.de>', subject: 'AW: Angebot', date: new Date('2026-11-03T13:05:00.000Z'),
    from: [{ name: 'Erika Musterfrau', address: 'Erika@Example.de' }], to: [{ name: '', address: 'max@firma.de' }], cc: [{ name: 'Chef', address: 'chef@firma.de' }],
  },
  flags: new Set(['\\Seen']),
  headers: Buffer.from('References: <m1@example.de>\r\n <m2@example.de>\r\n\t<m1@example.de>\r\nIn-Reply-To: <m2@example.de>\r\n\r\n', 'latin1'),
  bodyStructure: { type: 'multipart/mixed', childNodes: [{ type: 'text/plain' }, { type: 'application/pdf', disposition: 'attachment' }] },
  size: 12345,
  internalDate: new Date('2026-11-03T13:06:00.000Z'),
  ...overrides,
});

test('summarize: a complete message', () => {
  assert.deepEqual(core.summarize('inbox', fetched()), {
    id: 'inbox:42', folder: 'inbox', uid: 42, messageId: '<m3@example.de>', inReplyTo: '<m2@example.de>', references: ['<m1@example.de>', '<m2@example.de>'],
    subject: 'AW: Angebot', from: { name: 'Erika Musterfrau', address: 'erika@example.de' }, to: [{ name: '', address: 'max@firma.de' }], cc: [{ name: 'Chef', address: 'chef@firma.de' }], replyTo: [],
    date: '2026-11-03T13:05:00.000Z', seen: true, answered: false, hasAttachments: true, size: 12345,
  });
});

test('summarize: References folded over several lines, any header case, text or buffer', () => {
  const folded = 'Subject: x\nreferences: <a@x>\n\t<b@x>\n   <c@x> garbage <d@x>\nX-Other: <not@a.reference>\n';
  assert.deepEqual(core.summarize('inbox', fetched({ headers: folded })).references, ['<a@x>', '<b@x>', '<c@x>', '<d@x>']);
  assert.deepEqual(core.summarize('inbox', fetched({ headers: 'X-References: <no@x>\r\n' })).references, []);
  assert.deepEqual(core.summarize('inbox', fetched({ headers: undefined })).references, []);
  // Only the most recent 30 ancestors are kept.
  const many = Array.from({ length: 40 }, (_, index) => `<r${index}@x>`);
  const kept = core.summarize('inbox', fetched({ headers: `References: ${many.join('\r\n ')}\r\n` })).references;
  assert.deepEqual(kept, many.slice(10));
});

test('summarize: In-Reply-To comes from the envelope, then from the header', () => {
  const noEnvelope = fetched();
  noEnvelope.envelope = { ...noEnvelope.envelope, inReplyTo: undefined };
  assert.equal(core.summarize('inbox', noEnvelope).inReplyTo, '<m2@example.de>');
  noEnvelope.headers = 'References: <m1@example.de>\r\n';
  assert.equal(core.summarize('inbox', noEnvelope).inReplyTo, '');
  noEnvelope.envelope.inReplyTo = 'Your message of Monday <first@x> <second@x>';
  assert.equal(core.summarize('inbox', noEnvelope).inReplyTo, '<first@x>');
});

test('summarize: flags as Set, array or missing', () => {
  assert.deepEqual([core.summarize('inbox', fetched({ flags: new Set(['\\Answered', '\\Seen']) }))].map((item) => [item.seen, item.answered]), [[true, true]]);
  assert.deepEqual([core.summarize('inbox', fetched({ flags: ['\\Answered'] }))].map((item) => [item.seen, item.answered]), [[false, true]]);
  assert.deepEqual([core.summarize('inbox', fetched({ flags: undefined }))].map((item) => [item.seen, item.answered]), [[false, false]]);
  assert.equal(core.summarize('inbox', fetched({ flags: new Set(['Seen', '\\seen ']) })).seen, false);
});

test('summarize: a message with nearly nothing in it still gives a complete entry', () => {
  assert.deepEqual(core.summarize('sent', { uid: 7 }), {
    id: 'sent:7', folder: 'sent', uid: 7, messageId: '', inReplyTo: '', references: [], subject: '', from: { name: '', address: '' }, to: [], cc: [], replyTo: [],
    date: '', seen: false, answered: false, hasAttachments: false, size: 0,
  });
  const sparse = core.summarize('inbox', fetched({ envelope: { from: [null, { name: 'Nur Name' }], to: 'kein Array', cc: [{}, { address: 'A@B.DE' }] }, size: '12', bodyStructure: null }));
  assert.deepEqual([sparse.from, sparse.to, sparse.cc, sparse.size], [{ name: 'Nur Name', address: '' }, [], [{ name: '', address: 'a@b.de' }], 0]);
});

test('summarize: an unusable date falls back to the arrival time, then to none', () => {
  const invalid = new Date('kein Datum');
  assert.equal(core.summarize('inbox', fetched({ envelope: { date: invalid } })).date, '2026-11-03T13:06:00.000Z');
  assert.equal(core.summarize('inbox', fetched({ envelope: { date: '2026-11-03' } })).date, '2026-11-03T13:06:00.000Z');
  assert.equal(core.summarize('inbox', fetched({ envelope: { date: invalid }, internalDate: invalid })).date, '');
  assert.equal(core.summarize('inbox', fetched({ envelope: {}, internalDate: undefined })).date, '');
});

test('summarize: header text from the server is reduced to single bounded lines', () => {
  const hostile = core.summarize('inbox', fetched({ envelope: { subject: `Betreff\r\nX: y\0${'s'.repeat(600)}`, messageId: ' <id@x>\r\n', from: [{ name: `N\nN${'n'.repeat(300)}`, address: 'A@B.de\r\n' }], to: Array.from({ length: 150 }, (_, index) => ({ address: `u${index}@x.de` })) } }));
  assert.equal(hostile.subject.length, 500);
  assert.ok(hostile.subject.startsWith('Betreff X: y sss'));
  assert.equal(hostile.messageId, '<id@x>');
  assert.equal(hostile.from.name.length, 200);
  assert.equal(hostile.from.address, 'a@b.de');
  assert.equal(hostile.to.length, 100);
  assert.doesNotMatch(JSON.stringify(hostile), /\\r|\\n|\\u0000/);
});

test('summarize: attachments are told apart from inline pictures and text parts', () => {
  const structure = (bodyStructure) => core.summarize('inbox', fetched({ bodyStructure })).hasAttachments;
  assert.equal(structure({ type: 'text/plain' }), false);
  assert.equal(structure({ type: 'multipart/alternative', childNodes: [{ type: 'text/plain' }, { type: 'text/html' }] }), false);
  assert.equal(structure({ type: 'multipart/related', childNodes: [{ type: 'text/html' }, { type: 'image/png', disposition: 'inline', id: '<logo>' }] }), false);
  assert.equal(structure({ type: 'multipart/related', childNodes: [{ type: 'text/html' }, { type: 'image/png', id: '<logo>' }] }), false);
  assert.equal(structure({ type: 'multipart/mixed', childNodes: [{ type: 'multipart/alternative', childNodes: [{ type: 'text/plain' }] }, { type: 'APPLICATION/PDF' }] }), true);
  assert.equal(structure({ type: 'multipart/mixed', childNodes: [{ type: 'text/plain', disposition: 'attachment' }] }), true);
});

const entry = (uid, overrides = {}) => ({ id: `inbox:${uid}`, folder: 'inbox', uid, seen: false, answered: false, subject: `m${uid}`, ...overrides });
const state = (...items) => new Map(items.map(([uid, seen = false, answered = false]) => [uid, { seen, answered }]));

test('mergeFolder: new messages join the list, newest first', () => {
  const previous = [entry(5), entry(3)];
  const result = core.mergeFolder(previous, [entry(9), entry(7)], state([3], [5], [7], [9]));
  assert.deepEqual(result.map((item) => item.uid), [9, 7, 5, 3]);
  assert.deepEqual(core.mergeFolder(undefined, [entry(2), entry(4)], state([2], [4])).map((item) => item.uid), [4, 2]);
  assert.deepEqual(core.mergeFolder(null, [], new Map()), []);
  assert.deepEqual(previous.map((item) => item.uid), [5, 3]);
});

test('mergeFolder: unchanged entries keep their identity, changed flags give a new entry', () => {
  const read = entry(1, { seen: true }), unread = entry(2), answered = entry(3, { seen: true });
  const result = core.mergeFolder([answered, unread, read], [], state([1, true], [2, true], [3, true, true]));
  assert.equal(result[2], read);
  assert.notEqual(result[1], unread);
  assert.deepEqual(result[1], { ...unread, seen: true });
  assert.deepEqual(result[0], { ...answered, answered: true });
  // The previous entries themselves are never edited (the window may still render them).
  assert.deepEqual([unread.seen, answered.answered], [false, false]);
  // Marked unread again on another device.
  assert.equal(core.mergeFolder([read], [], state([1, false]))[0].seen, false);
});

test('mergeFolder: messages the server no longer lists disappear, even freshly fetched ones', () => {
  const result = core.mergeFolder([entry(1), entry(2), entry(3)], [entry(4), entry(5)], state([1], [3], [5]));
  assert.deepEqual(result.map((item) => item.uid), [5, 3, 1]);
  assert.deepEqual(core.mergeFolder([entry(1)], [], new Map()), []);
  // Flags for a message nobody has an entry for do not invent one.
  assert.deepEqual(core.mergeFolder([entry(1)], [], state([1], [99])).map((item) => item.uid), [1]);
});

test('mergeFolder: a re-fetched message replaces the cached entry', () => {
  const result = core.mergeFolder([entry(1, { subject: 'alt' })], [entry(1, { subject: 'neu' })], state([1]));
  assert.deepEqual(result.map((item) => item.subject), ['neu']);
});

test('mergeFolder: the list is capped at the newest 500 messages', () => {
  const previous = Array.from({ length: 480 }, (_, index) => entry(index + 1));
  const incoming = Array.from({ length: 60 }, (_, index) => entry(481 + index));
  const flags = state(...[...previous, ...incoming].map((item) => [item.uid]));
  const result = core.mergeFolder(previous, incoming, flags);
  assert.equal(core.MAX_MESSAGES_PER_FOLDER, 500);
  assert.equal(result.length, 500);
  assert.deepEqual([result[0].uid, result[499].uid], [540, 41]);
  for (let index = 1; index < result.length; index += 1) assert.ok(result[index - 1].uid > result[index].uid);
});

const box = (path, overrides = {}) => ({ path, name: path.split('/').pop(), delimiter: '/', flags: new Set(), ...overrides });

test('findSpecialFolder: the marking of the server beats well-known names', () => {
  const boxes = [box('INBOX'), box('Sent'), box('Archiv/Ausgang', { specialUse: '\\Sent' }), box('Trash'), box('Müll', { specialUse: '\\Trash' })];
  assert.equal(core.findSpecialFolder(boxes, 'sent'), 'Archiv/Ausgang');
  assert.equal(core.findSpecialFolder(boxes, 'trash'), 'Müll');
  assert.equal(core.findSpecialFolder([box('Sent', { specialUse: '\\Trash' }), box('Papierkorb', { specialUse: '\\Sent' })], 'sent'), 'Papierkorb');
});

test('findSpecialFolder: German and English names, whatever the case and nesting', () => {
  for (const name of ['Sent', 'SENT', 'Sent Items', 'Sent Messages', 'Sent Mail', 'Gesendet', 'gesendete objekte', 'Gesendete Elemente', 'Gesendete Nachrichten']) {
    assert.equal(core.findSpecialFolder([box('INBOX'), box('Entwürfe'), box(name)], 'sent'), name, name);
  }
  for (const name of ['Trash', 'Deleted', 'Deleted Items', 'Deleted Messages', 'Papierkorb', 'Gelöscht', 'Gelöschte Objekte', 'GELÖSCHTE ELEMENTE']) {
    assert.equal(core.findSpecialFolder([box('INBOX'), box(name)], 'trash'), name, name);
  }
  assert.equal(core.findSpecialFolder([box('INBOX'), box('INBOX.Gesendet', { delimiter: '.', name: undefined })], 'sent'), 'INBOX.Gesendet');
  assert.equal(core.findSpecialFolder([box('[Gmail]/Gesendet')], 'sent'), '[Gmail]/Gesendet');
});

test('findSpecialFolder: look-alikes and unselectable folders are not taken', () => {
  assert.equal(core.findSpecialFolder([box('INBOX'), box('Gesendet 2019'), box('Nicht gesendet'), box('Sent/Kunden'), box('Papierkorb'), box('Entwürfe')], 'sent'), '');
  assert.equal(core.findSpecialFolder([box('Sent'), box('Gesendet')], 'trash'), '');
  const noselect = box('Sent', { specialUse: '\\Sent', flags: new Set(['\\Noselect']) });
  assert.equal(core.findSpecialFolder([noselect], 'sent'), '');
  assert.equal(core.findSpecialFolder([noselect, box('Gesendet')], 'sent'), 'Gesendet');
  assert.equal(core.findSpecialFolder([noselect, box('Sent/Gesendete Objekte')], 'sent'), 'Sent/Gesendete Objekte');
});

test('findSpecialFolder: tolerates an empty or damaged folder list', () => {
  assert.equal(core.findSpecialFolder(undefined, 'sent'), '');
  assert.equal(core.findSpecialFolder([], 'trash'), '');
  assert.equal(core.findSpecialFolder([null, {}, { path: 5, name: 'Sent' }, { name: 'Sent' }, { path: 'Gesendet' }], 'sent'), 'Gesendet');
});

test('describeError: prepared messages pass through, the stage names the direction', () => {
  assert.equal(core.describeError(core.fieldError('Bitte eine gültige E-Mail-Adresse eingeben.', 'email'), 'imap'), 'Bitte eine gültige E-Mail-Adresse eingeben.');
  assert.match(core.describeError({ code: 'ECONNREFUSED' }, 'imap'), /^Posteingang \(IMAP\): Der Server nimmt auf diesem Port keine Verbindung an/);
  assert.match(core.describeError({ code: 'ECONNREFUSED' }, 'smtp'), /^Postausgang \(SMTP\): /);
  assert.match(core.describeError({ code: 'ECONNREFUSED' }), /^E-Mail: /);
});

test('describeError: numbers inside durations, addresses and host names are not mistaken for SMTP codes or TLS trouble', () => {
  const timeout = /^Postausgang \(SMTP\): Keine Antwort vom Server\. Bitte Internetverbindung, Servernamen und Port prüfen\.$/;
  // "535 ms" is a duration, not "535 authentication failed".
  assert.match(core.describeError({ message: 'Connection timed out after 535 ms' }, 'smtp'), timeout);
  assert.match(core.describeError({ message: 'Connection timed out after 552 ms' }, 'smtp'), timeout);
  // A port or an IP address that happens to read 535 says nothing about the login.
  assert.match(core.describeError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 1.2.3.4:535' }, 'smtp'), /^Postausgang \(SMTP\): Der Server nimmt auf diesem Port keine Verbindung an\. Bitte Port prüfen\.$/);
  // "ssl0.ovh.net" is a host name, not an SSL error.
  assert.match(core.describeError({ code: 'ETIMEDOUT', message: 'connect ETIMEDOUT ssl0.ovh.net' }, 'smtp'), timeout);
  assert.doesNotMatch(core.describeError({ code: 'ETIMEDOUT', message: 'connect ETIMEDOUT ssl0.ovh.net' }, 'smtp'), /Zertifikat/);
  // A full mailbox is reported as such although the server words it as a rejected recipient.
  assert.match(core.describeError({ responseText: '552 5.2.2 <kunde@example.de>: Recipient address rejected: Mailbox full' }, 'smtp'), /^Postausgang \(SMTP\): Die E-Mail ist zu groß oder das Postfach ist voll\.$/);
  // The numeric reply code alone is enough for the login message.
  assert.match(core.describeError({ responseCode: 535, message: 'x' }, 'smtp'), /^Postausgang \(SMTP\): Anmeldung abgelehnt\. Bitte Benutzername und Passwort prüfen\./);
  assert.match(core.describeError({ responseCode: 552, message: 'x' }, 'smtp'), /zu groß oder das Postfach ist voll/);
});

test('describeError: the usual failures get a German explanation', () => {
  const cases = [
    [{ authenticationFailed: true, message: 'Command failed' }, /Anmeldung abgelehnt/],
    [{ code: 'EAUTH', message: 'Invalid login: 535-5.7.8 Username and Password not accepted' }, /Anmeldung abgelehnt/],
    [{ message: 'Command failed', responseText: 'NO [AUTHENTICATIONFAILED] Authentication failed.' }, /Anmeldung abgelehnt/],
    [{ response: '535 5.7.0 Invalid credentials' }, /Anmeldung abgelehnt/],
    [{ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND imap.firma.de' }, /Server wurde nicht gefunden/],
    [{ code: 'EAI_AGAIN' }, /Server wurde nicht gefunden/],
    [{ code: 'EDNS' }, /Server wurde nicht gefunden/],
    [{ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:993' }, /keine Verbindung an/],
    [{ code: 'ETIMEDOUT' }, /Keine Antwort vom Server/],
    [{ code: 'ECONNRESET' }, /Keine Antwort vom Server/],
    [{ message: 'Greeting never received, connection timed out' }, /Keine Antwort vom Server/],
    [{ code: 'DEPTH_ZERO_SELF_SIGNED_CERT', message: 'self-signed certificate' }, /verschlüsselte Verbindung kam nicht zustande/],
    [{ code: 'ERR_TLS_CERT_ALTNAME_INVALID', message: "Hostname/IP does not match certificate's altnames" }, /verschlüsselte Verbindung kam nicht zustande/],
    [{ code: 'ERR_SSL_WRONG_VERSION_NUMBER', message: 'wrong version number' }, /verschlüsselte Verbindung kam nicht zustande/],
    [{ code: 'EENVELOPE', message: 'No recipients defined' }, /Empfänger abgelehnt/],
    [{ code: 'EMESSAGE', responseText: '550 5.1.1 User unknown' }, /Empfänger abgelehnt/],
    [{ code: 'EMESSAGE', responseText: '552 5.3.4 Message size exceeds fixed limit' }, /zu groß oder das Postfach ist voll/],
    [{ message: 'Mailbox quota exceeded' }, /zu groß oder das Postfach ist voll/],
  ];
  for (const [error, expected] of cases) assert.match(core.describeError(error, 'smtp'), expected, JSON.stringify(error));
});

test('describeError: nodemailer socket errors are explained by their original cause', () => {
  const refused = { code: 'ESOCKET', originalCode: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:465' };
  assert.equal(core.describeError(refused, 'smtp'), 'Postausgang (SMTP): Der Server nimmt auf diesem Port keine Verbindung an. Bitte Port prüfen.');
  assert.match(core.describeError({ code: 'ESOCKET', originalCode: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND smtp.firma.de' }, 'smtp'), /Server wurde nicht gefunden/);
  assert.match(core.describeError({ code: 'ESOCKET', originalCode: 'ETIMEDOUT' }, 'smtp'), /Keine Antwort vom Server/);
  assert.match(core.describeError({ code: 'ESOCKET', originalCode: 'DEPTH_ZERO_SELF_SIGNED_CERT', message: 'self-signed certificate' }, 'smtp'), /verschlüsselte Verbindung kam nicht zustande/);
  // Without a known cause a socket error still reads as "no answer".
  assert.match(core.describeError({ code: 'ESOCKET', message: 'socket hang up' }, 'smtp'), /Keine Antwort vom Server/);
  assert.match(core.describeError({ code: 'ESOCKET', originalCode: '' }, 'smtp'), /Keine Antwort vom Server/);
  // `originalCode` only speaks for ESOCKET.
  assert.match(core.describeError({ code: 'ETIMEDOUT', originalCode: 'ECONNREFUSED' }, 'smtp'), /Keine Antwort vom Server/);
});

test('describeError: a certificate problem wins over the generic "no answer" message', () => {
  const cases = [
    { code: 'ESOCKET', message: 'self-signed certificate' },
    { code: 'ESOCKET', message: 'unable to verify the first certificate' },
    { code: 'ESOCKET', originalCode: 'ERR_TLS_CERT_ALTNAME_INVALID', message: "Hostname/IP does not match certificate's altnames" },
    { code: 'ECONNECTION', message: 'certificate has expired' },
    { code: 'ETIMEDOUT', message: 'TLS handshake timeout: CERT_HAS_EXPIRED' },
    { code: 'ECONNRESET', message: 'write EPROTO ... SSL routines:ssl3_get_record:wrong version number' },
    { message: 'Connection timed out while checking the certificate' },
  ];
  for (const error of cases) assert.match(core.describeError(error, 'imap'), /^Posteingang \(IMAP\): Die verschlüsselte Verbindung kam nicht zustande/, JSON.stringify(error));
  // A refused connection or an unknown server is still named as such.
  assert.match(core.describeError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED (STARTTLS)' }, 'imap'), /Bitte Port prüfen/);
});

test('describeError: 535 and 552 only count as status codes, not as digits inside another number', () => {
  const timeout = /Keine Antwort vom Server/;
  assert.match(core.describeError({ message: 'Connection timed out after 5350 ms' }, 'smtp'), timeout);
  assert.match(core.describeError({ message: 'Connection timed out after 15352 ms' }, 'smtp'), timeout);
  assert.match(core.describeError({ code: 'ETIMEDOUT', message: 'timed out after 5520 ms' }, 'smtp'), timeout);
  assert.match(core.describeError({ code: 'ETIMEDOUT', message: 'timed out after 15525 ms' }, 'smtp'), timeout);
  // Neither message is claimed for an unrelated error that happens to carry such a number.
  assert.equal(core.describeError({ message: 'Fehler 15350 im Protokoll' }, 'smtp'), 'Postausgang (SMTP): Fehler 15350 im Protokoll');
  assert.equal(core.describeError({ message: 'Fehler 55200 im Protokoll' }, 'smtp'), 'Postausgang (SMTP): Fehler 55200 im Protokoll');
  // The real status codes still do, wherever they stand in the text.
  for (const error of [
    { message: '535 5.7.8 Authentication failed' },
    { responseText: '535 5.7.8 Error: authentication failed' },
    { response: '535-5.7.8 Username and Password not accepted' },
    { message: 'Command failed: 535' },
    { message: 'SMTP error (535): rejected' },
  ]) assert.match(core.describeError(error, 'smtp'), /Anmeldung abgelehnt/, JSON.stringify(error));
  for (const error of [
    { responseText: '552 5.2.2 Mailbox full' },
    { message: 'Message failed: 552 5.2.2 Over quota' },
    { response: '552-5.2.2 The email account is over its limit' },
    { message: 'Data command failed: 552' },
    { responseText: '452 4.2.2 5.2.2 mailbox full' },
  ]) assert.match(core.describeError(error, 'smtp'), /zu groß oder das Postfach ist voll/, JSON.stringify(error));
});

test('describeError: anything else is shown as one bounded line, never empty', () => {
  assert.equal(core.describeError({ message: 'Mailbox\r\ndoes not exist\0' }, 'imap'), 'Posteingang (IMAP): Mailbox does not exist');
  assert.equal(core.describeError({ message: 'intern', responseText: 'NO Mailbox is locked' }, 'imap'), 'Posteingang (IMAP): NO Mailbox is locked');
  assert.equal(core.describeError(null), 'E-Mail: Unbekannter Fehler');
  assert.equal(core.describeError(undefined, 'smtp'), 'Postausgang (SMTP): Unbekannter Fehler');
  assert.equal(core.describeError({}, 'imap'), 'Posteingang (IMAP): Unbekannter Fehler');
  assert.equal(core.describeError({ message: 'x'.repeat(1000) }, 'imap').length, 'Posteingang (IMAP): '.length + 300);
});

// ── Window helpers (src/lib/mail.ts) ───────────────────────────────────────────────────────────────────────────

test('normalizeSubject strips reply and forward markers in any language, case and nesting', () => {
  assert.equal(mail.normalizeSubject('Re: AW: Fwd: Angebot'), 'angebot');
  assert.equal(mail.normalizeSubject('RE[2]: Angebot'), 'angebot');
  assert.equal(mail.normalizeSubject('  Aw:Angebot   Nr 5 '), 'angebot nr 5');
  assert.equal(mail.normalizeSubject('WG: Fw: Antwort: Antw: TR: Weitergeleitet: ANGEBOT'), 'angebot');
  assert.equal(mail.normalizeSubject('re : re: x'), 'x');
  assert.equal(mail.normalizeSubject('Re:'), '');
  assert.equal(mail.normalizeSubject(''), '');
});

test('normalizeSubject leaves words alone that only begin like a marker', () => {
  assert.equal(mail.normalizeSubject('Regal liefern'), 'regal liefern');
  assert.equal(mail.normalizeSubject('Retoure: Fliesen'), 'retoure: fliesen');
  assert.equal(mail.normalizeSubject('Angebot Re: Bad'), 'angebot re: bad');
  assert.equal(mail.normalizeSubject('Fwdx: y'), 'fwdx: y');
  assert.equal(mail.normalizeSubject('ÄNDERUNG Straße'), 'änderung straße');
});

test('replySubject adds one reply marker and never stacks them', () => {
  assert.equal(mail.replySubject('Angebot'), 'AW: Angebot');
  assert.equal(mail.replySubject('  Angebot '), 'AW: Angebot');
  assert.equal(mail.replySubject('Re: Angebot'), 'Re: Angebot');
  assert.equal(mail.replySubject('AW: Angebot'), 'AW: Angebot');
  assert.equal(mail.replySubject('aw : Angebot'), 'aw : Angebot');
  assert.equal(mail.replySubject('Antw: Angebot'), 'Antw: Angebot');
  assert.equal(mail.replySubject('Fwd: Angebot'), 'AW: Fwd: Angebot');
  assert.equal(mail.replySubject('Regal'), 'AW: Regal');
  assert.equal(mail.replySubject(''), 'AW:');
  assert.equal(mail.replySubject(mail.replySubject(mail.replySubject('Angebot'))), 'AW: Angebot');
});

let uid = 0;
function message(folder, overrides = {}) {
  uid += 1;
  const me = { name: 'Max', address: 'max@firma.de' };
  const other = overrides.other ?? { name: 'Erika', address: 'erika@example.de' };
  return {
    id: `${folder}:${uid}`, folder, uid, messageId: `<auto-${uid}@x>`, inReplyTo: '', references: [], subject: 'Angebot',
    from: folder === 'inbox' ? other : me, to: folder === 'inbox' ? [me] : [other], cc: [],
    date: '2026-11-01T10:00:00.000Z', seen: true, answered: false, hasAttachments: false, size: 100, ...overrides, other: undefined,
  };
}
const ids = (conversation) => conversation.messages.map((item) => item.id);

test('counterpart: the sender of received mail, the first recipient of sent mail', () => {
  const received = message('inbox'), sent = message('sent');
  assert.equal(mail.counterpart(received).address, 'erika@example.de');
  assert.equal(mail.counterpart(sent).address, 'erika@example.de');
  assert.deepEqual(mail.counterpart({ ...sent, to: [], cc: [{ name: 'Chef', address: 'chef@firma.de' }] }), { name: 'Chef', address: 'chef@firma.de' });
  assert.deepEqual(mail.counterpart({ ...sent, to: [], cc: [] }), { name: '', address: '' });
});

test('unreadCount counts unread inbox messages only', () => {
  assert.equal(mail.unreadCount({ inbox: [] }), 0);
  assert.equal(mail.unreadCount({ inbox: [message('inbox', { seen: false }), message('inbox'), message('inbox', { seen: false })], sent: [message('sent', { seen: false })] }), 2);
});

test('buildConversations: a reply chain across inbox and sent is one conversation, oldest first', () => {
  const p1 = { name: 'Erika', address: 'erika@example.de' };
  const first = message('inbox', { messageId: '<1@x>', subject: 'Anfrage Bad', date: '2026-11-01T08:00:00.000Z', other: p1 });
  const reply = message('sent', { messageId: '<2@x>', inReplyTo: '<1@x>', references: ['<1@x>'], subject: 'Ihr Angebot', date: '2026-11-01T09:00:00.000Z', other: p1 });
  const answer = message('inbox', { messageId: '<3@x>', references: ['<1@x>', '<2@x>'], subject: 'Noch eine Frage', date: '2026-11-02T09:00:00.000Z', other: p1 });
  const lateReply = message('sent', { messageId: '<4@x>', inReplyTo: '<3@x>', subject: 'Termin', date: '2026-11-03T09:00:00.000Z', other: p1 });
  const [conversation, ...rest] = mail.buildConversations([answer, first], [lateReply, reply]);
  assert.deepEqual(rest, []);
  assert.deepEqual(ids(conversation), [first.id, reply.id, answer.id, lateReply.id]);
  assert.equal(conversation.subject, 'Anfrage Bad');
  assert.equal(conversation.lastDate, '2026-11-03T09:00:00.000Z');
  assert.deepEqual(conversation.people, [p1]);
});

test('buildConversations: a reply links to a message that is not in the list any more', () => {
  const a = message('inbox', { messageId: '<a@x>', references: ['<gone@x>'], subject: 'Eins', other: { name: 'A', address: 'a@x.de' } });
  const b = message('inbox', { messageId: '<b@x>', inReplyTo: '<gone@x>', subject: 'Zwei', other: { name: 'B', address: 'b@x.de' } });
  const c = message('inbox', { messageId: '<c@x>', subject: 'Drei', other: { name: 'C', address: 'c@x.de' } });
  const conversations = mail.buildConversations([a, b, c], []);
  assert.equal(conversations.length, 2);
  assert.deepEqual(conversations.map((item) => item.messages.length).sort(), [1, 2]);
});

test('buildConversations: without reference headers the same person and subject keep an exchange together', () => {
  const p1 = { name: 'Erika', address: 'erika@example.de' };
  const first = message('inbox', { subject: 'Angebot Bad', date: '2026-11-01T08:00:00.000Z', other: p1 });
  const reply = message('sent', { subject: 'AW: Angebot Bad', date: '2026-11-01T09:00:00.000Z', other: p1 });
  const answer = message('inbox', { subject: 'Re: AW:  angebot   BAD', date: '2026-11-02T09:00:00.000Z', other: p1 });
  const conversations = mail.buildConversations([first, answer], [reply]);
  assert.equal(conversations.length, 1);
  assert.deepEqual(ids(conversations[0]), [first.id, reply.id, answer.id]);
});

test('buildConversations: two people writing under the same subject stay separate', () => {
  const erika = { name: 'Erika', address: 'erika@example.de' }, otto = { name: 'Otto', address: 'otto@example.de' };
  const fromErika = message('inbox', { subject: 'Rechnung', other: erika, date: '2026-11-01T08:00:00.000Z' });
  const fromOtto = message('inbox', { subject: 'Rechnung', other: otto, date: '2026-11-02T08:00:00.000Z' });
  const toOtto = message('sent', { subject: 'AW: Rechnung', other: otto, date: '2026-11-03T08:00:00.000Z' });
  const toErika = message('sent', { subject: 'Re: Rechnung', other: erika, date: '2026-11-04T08:00:00.000Z' });
  const conversations = mail.buildConversations([fromErika, fromOtto], [toOtto, toErika]);
  assert.deepEqual(conversations.map(ids), [[fromErika.id, toErika.id], [fromOtto.id, toOtto.id]]);
  assert.deepEqual(conversations.map((item) => item.people), [[erika], [otto]]);
});

test('buildConversations: the same person with different subjects, and messages without subject, are separate', () => {
  const p1 = { name: 'Erika', address: 'erika@example.de' };
  const conversations = mail.buildConversations([
    message('inbox', { subject: 'Angebot Bad', other: p1 }), message('inbox', { subject: 'Angebot Küche', other: p1 }),
    message('inbox', { subject: '', other: p1 }), message('inbox', { subject: 'Re: ', other: p1 }),
  ], []);
  assert.equal(conversations.length, 4);
  assert.deepEqual(conversations.map((item) => item.subject).sort(), ['(ohne Betreff)', 'Angebot Bad', 'Angebot Küche', 'Re:']);
});

test('buildConversations: unread counts inbox messages only', () => {
  const p1 = { name: 'Erika', address: 'erika@example.de' };
  const conversations = mail.buildConversations(
    [message('inbox', { seen: false, other: p1 }), message('inbox', { seen: false, other: p1 }), message('inbox', { seen: true, other: p1 })],
    [message('sent', { seen: false, other: p1 })],
  );
  assert.equal(conversations.length, 1);
  assert.equal(conversations[0].unread, 2);
  assert.equal(conversations[0].messages.length, 4);
});

test('buildConversations: conversations are ordered by their newest message', () => {
  const person = (name) => ({ name, address: `${name}@example.de` });
  const old = message('inbox', { subject: 'Alt', other: person('a'), date: '2026-10-01T08:00:00.000Z' });
  const middle = message('inbox', { subject: 'Mitte', other: person('b'), date: '2026-10-15T08:00:00.000Z' });
  const recent = message('inbox', { subject: 'Neu', other: person('c'), date: '2026-11-01T08:00:00.000Z' });
  const revived = message('sent', { subject: 'AW: Alt', other: person('a'), date: '2026-11-05T08:00:00.000Z' });
  assert.deepEqual(mail.buildConversations([old, middle, recent], []).map((item) => item.subject), ['Neu', 'Mitte', 'Alt']);
  assert.deepEqual(mail.buildConversations([middle, recent, old], [revived]).map((item) => item.subject), ['Alt', 'Neu', 'Mitte']);
});

test('buildConversations: messages without a date do not break grouping or order', () => {
  const p1 = { name: 'Erika', address: 'erika@example.de' }, p2 = { name: 'Otto', address: 'otto@example.de' };
  const undated = message('inbox', { subject: 'Ohne Datum', other: p2, date: '' });
  const dated = message('inbox', { messageId: '<d@x>', subject: 'Frage', other: p1, date: '2026-11-01T08:00:00.000Z' });
  const undatedReply = message('sent', { inReplyTo: '<d@x>', subject: 'AW: Frage', other: p1, date: '' });
  const conversations = mail.buildConversations([undated, dated], [undatedReply]);
  assert.deepEqual(conversations.map((item) => item.messages.length), [2, 1]);
  assert.equal(conversations[0].lastDate, '2026-11-01T08:00:00.000Z');
  assert.equal(conversations[1].lastDate, '');
  assert.deepEqual(new Set(conversations.flatMap(ids)), new Set([undated.id, dated.id, undatedReply.id]));
});

test('buildConversations: people are everyone on the other side, most recent first, each once', () => {
  const erika = { name: 'Erika', address: 'erika@example.de' }, otto = { name: 'Otto', address: 'otto@example.de' };
  const first = message('inbox', { messageId: '<1@x>', other: erika, date: '2026-11-01T08:00:00.000Z' });
  const second = message('inbox', { references: ['<1@x>'], other: otto, date: '2026-11-02T08:00:00.000Z' });
  const third = message('sent', { references: ['<1@x>'], other: erika, date: '2026-11-03T08:00:00.000Z' });
  const [conversation] = mail.buildConversations([first, second], [third]);
  assert.deepEqual(conversation.people, [erika, otto]);
});

test('buildConversations: every message appears exactly once, the inputs stay untouched, keys are unique', () => {
  const people = ['a', 'b', 'c'].map((name) => ({ name, address: `${name}@example.de` }));
  const inbox = [], sent = [];
  for (let index = 0; index < 60; index += 1) {
    const folder = index % 3 === 0 ? 'sent' : 'inbox';
    (folder === 'inbox' ? inbox : sent).push(message(folder, {
      messageId: `<n${index}@x>`, references: index % 5 === 0 && index > 0 ? [`<n${index - 5}@x>`] : [], subject: `Thema ${index % 7}`,
      other: people[index % 3], date: new Date(Date.UTC(2026, 9, 1 + (index * 7) % 30, index % 24)).toISOString(),
    }));
  }
  Object.freeze(inbox); Object.freeze(sent);
  const before = JSON.stringify([inbox, sent]);
  const conversations = mail.buildConversations(inbox, sent);
  assert.equal(JSON.stringify([inbox, sent]), before);
  const listed = conversations.flatMap(ids);
  assert.equal(listed.length, 60);
  assert.equal(new Set(listed).size, 60);
  assert.equal(new Set(conversations.map((item) => item.key)).size, conversations.length);
  for (const conversation of conversations) {
    const dates = conversation.messages.map((item) => item.date);
    assert.deepEqual(dates, [...dates].sort());
    assert.equal(conversation.lastDate, dates.at(-1));
  }
  const lastDates = conversations.map((item) => item.lastDate);
  assert.deepEqual(lastDates, [...lastDates].sort().reverse());
  assert.deepEqual(mail.buildConversations([], []), []);
});

test('matchesMail searches subject, sender and recipients without case', () => {
  const received = message('inbox', { subject: 'Angebot Straßenbau', other: { name: 'Erika Müller', address: 'e.mueller@example.de' } });
  for (const query of ['', '   ', 'angebot', 'STRASSENBAU'.replace('SS', 'ß'), 'müller', 'MÜLLER', 'e.mueller@', 'max@firma.de', ' Max ']) {
    assert.equal(mail.matchesMail(received, query), true, query);
  }
  for (const query of ['rechnung', 'otto', 'angebot  straßenbau']) assert.equal(mail.matchesMail(received, query), false, query);
});

test('formatMailDate: time for today, "Gestern", otherwise the date', () => {
  const now = new Date(2026, 10, 16, 15, 30);
  assert.equal(mail.formatMailDate(new Date(2026, 10, 16, 14, 5).toISOString(), now), '14:05');
  assert.equal(mail.formatMailDate(new Date(2026, 10, 16, 0, 0).toISOString(), now), '00:00');
  assert.equal(mail.formatMailDate(new Date(2026, 10, 15, 23, 59).toISOString(), now), 'Gestern');
  assert.equal(mail.formatMailDate(new Date(2026, 10, 15, 0, 0).toISOString(), now), 'Gestern');
  assert.equal(mail.formatMailDate(new Date(2026, 10, 14, 23, 59).toISOString(), now), '14.11.2026');
  assert.equal(mail.formatMailDate(new Date(2026, 10, 3, 9, 0).toISOString(), now), '03.11.2026');
  assert.equal(mail.formatMailDate(new Date(2025, 10, 16, 9, 0).toISOString(), now), '16.11.2025');
  assert.equal(mail.formatMailDate('', now), '');
  assert.equal(mail.formatMailDate('kein Datum', now), '');
});

test('formatMailDate: "Gestern" holds across clock changes and the year end', () => {
  // 29 March 2026 has 23 hours, 25 October 2026 has 25 hours.
  assert.equal(mail.formatMailDate(new Date(2026, 2, 28, 12, 0).toISOString(), new Date(2026, 2, 29, 12, 0)), 'Gestern');
  assert.equal(mail.formatMailDate(new Date(2026, 2, 29, 1, 0).toISOString(), new Date(2026, 2, 30, 23, 0)), 'Gestern');
  assert.equal(mail.formatMailDate(new Date(2026, 9, 24, 23, 0).toISOString(), new Date(2026, 9, 25, 1, 0)), 'Gestern');
  assert.equal(mail.formatMailDate(new Date(2026, 9, 25, 2, 30).toISOString(), new Date(2026, 9, 26, 0, 30)), 'Gestern');
  assert.equal(mail.formatMailDate(new Date(2026, 9, 24, 12, 0).toISOString(), new Date(2026, 9, 26, 0, 30)), '24.10.2026');
  assert.equal(mail.formatMailDate(new Date(2026, 11, 31, 23, 0).toISOString(), new Date(2027, 0, 1, 0, 30)), 'Gestern');
  // The stored UTC timestamp is shown in local time.
  assert.equal(mail.formatMailDate('2026-11-15T23:30:00.000Z', new Date(2026, 10, 16, 15, 30)), '00:30');
});

test('formatBytes: German units', () => {
  assert.deepEqual([0, -5, NaN, Infinity].map(mail.formatBytes), ['', '', '', '']);
  assert.equal(mail.formatBytes(1), '1 B');
  assert.equal(mail.formatBytes(1023), '1023 B');
  assert.equal(mail.formatBytes(1024), '1 KB');
  assert.equal(mail.formatBytes(1536), '2 KB');
  assert.equal(mail.formatBytes(250 * 1024), '250 KB');
  // From 1 024 000 bytes on the size is shown in MB, so "1024 KB" never appears next to "1,0 MB".
  assert.equal(mail.formatBytes(999 * 1024), '999 KB');
  assert.equal(mail.formatBytes(1024 * 1000 - 1), '1000 KB');
  assert.equal(mail.formatBytes(1024 * 1000), '1,0 MB');
  assert.equal(mail.formatBytes(1048575), '1,0 MB');
  for (let size = 1024; size < 3 * 1024 * 1024; size += 4099) assert.doesNotMatch(mail.formatBytes(size), /^(\d{5,}|10[0-9][1-9]|10[1-9]\d|1[1-9]\d\d|[2-9]\d{3}) KB$/, String(size));
  assert.equal(mail.formatBytes(1024 * 1024), '1,0 MB');
  assert.equal(mail.formatBytes(1.5 * 1024 * 1024), '1,5 MB');
  assert.equal(mail.formatBytes(20 * 1024 * 1024), '20,0 MB');
});

test('quoteForReply: attribution line and quoted original, bounded', () => {
  const original = message('inbox', { date: new Date(2026, 10, 3, 14, 5).toISOString() });
  assert.equal(mail.quoteForReply(original, 'Guten Tag,\r\n\r\nbitte um Angebot.  \n> schon zitiert'),
    '\n\n\nAm Di., 03.11.2026, 14:05 Uhr schrieb Erika:\n> Guten Tag,\n>\n> bitte um Angebot.\n> > schon zitiert');
  const anonymous = { ...original, from: { name: '', address: 'erika@example.de' } };
  assert.match(mail.quoteForReply(anonymous, 'x'), /schrieb erika@example\.de:\n> x$/);
  assert.match(mail.quoteForReply({ ...original, from: { name: '', address: '' } }, 'x'), /schrieb Unbekannt:/);
  const long = Array.from({ length: 500 }, (_, index) => `Zeile ${index}`).join('\n');
  const quoted = mail.quoteForReply(original, long).split('\n').filter((line) => line.startsWith('>'));
  assert.equal(quoted.length, 200);
  assert.equal(quoted.at(-1), '> Zeile 199');
});

test('withSignature appends the signature only when there is one', () => {
  assert.equal(mail.withSignature('Hallo', 'Gruß\nMax'), 'Hallo\n\nGruß\nMax');
  assert.equal(mail.withSignature('Hallo', '  \nGruß\n  '), 'Hallo\n\nGruß');
  assert.equal(mail.withSignature('', 'Gruß'), '\n\nGruß');
  assert.equal(mail.withSignature('Hallo', ''), 'Hallo');
  assert.equal(mail.withSignature('Hallo', '   '), 'Hallo');
  assert.equal(mail.withSignature('Hallo', undefined), 'Hallo');
});

// ── Review fixes: Reply-To, refused logins, stored password, damaged cache, staged attachments, download mark ────
{
  const form = { name: 'Kontaktformular', address: 'noreply@meine-seite.de' };
  const anna = { name: 'Anna Kundin', address: 'anna@example.de' };
  const bernd = { name: '', address: 'bernd@example.de' };

  test('summarize keeps Reply-To: valid addresses only, lower case, at most five', () => {
    const summary = core.summarize('inbox', fetched({ envelope: { from: [form], replyTo: [{ name: 'Anna\r\nKundin', address: 'Anna@Example.de' }, { name: 'kaputt', address: 'keine adresse' }, null, {}] } }));
    assert.deepEqual(summary.replyTo, [{ name: 'Anna Kundin', address: 'anna@example.de' }]);
    assert.deepEqual(core.summarize('inbox', fetched({ envelope: { replyTo: 'kein Array' } })).replyTo, []);
    const many = Array.from({ length: 9 }, (_, index) => ({ address: `r${index}@x.de` }));
    assert.equal(core.summarize('inbox', fetched({ envelope: { replyTo: many } })).replyTo.length, 5);
  });

  test('replyTarget: Reply-To wins over the sender, unless it is missing, the sender itself or the own mailbox', () => {
    const viaForm = message('inbox', { other: form, replyTo: [anna] });
    assert.deepEqual(mail.replyTarget(viaForm, 'max@firma.de'), anna);
    assert.deepEqual(mail.replyTarget(viaForm), anna);
    assert.deepEqual(mail.replyTarget(message('inbox', { other: form, replyTo: [] })), form);
    assert.deepEqual(mail.replyTarget(message('inbox', { other: form, replyTo: [{ name: 'leer', address: '' }, anna] })), anna);
    assert.deepEqual(mail.replyTarget(message('inbox', { other: anna, replyTo: [{ name: '', address: 'anna@example.de' }] })), anna, 'the sender keeps its name');
    assert.deepEqual(mail.replyTarget(message('inbox', { other: form, replyTo: [{ name: 'Max', address: 'max@firma.de' }] }), ' Max@Firma.de '), form);
    // A list stored by an older version has no replyTo at all.
    const legacy = message('inbox', { other: form });
    delete legacy.replyTo;
    assert.deepEqual(mail.replyTarget(legacy, 'max@firma.de'), form);
    assert.deepEqual(mail.counterpart(legacy, 'max@firma.de'), form);
  });

  test('counterpart of a form mail is the customer named in Reply-To; sent mail is unaffected', () => {
    assert.deepEqual(mail.counterpart(message('inbox', { other: form, replyTo: [anna] }), 'max@firma.de'), anna);
    assert.deepEqual(mail.counterpart(message('sent', { other: anna, replyTo: [form] }), 'max@firma.de'), anna);
  });

  test('buildConversations: form mails of different customers under one subject stay separate, each with its own answer', () => {
    const subject = 'Neue Anfrage über das Kontaktformular';
    const fromAnna = message('inbox', { other: form, replyTo: [anna], subject, date: '2026-11-01T08:00:00.000Z' });
    const fromBernd = message('inbox', { other: form, replyTo: [bernd], subject, date: '2026-11-01T09:00:00.000Z' });
    const toAnna = message('sent', { other: anna, subject: `AW: ${subject}`, date: '2026-11-01T10:00:00.000Z' });
    const conversations = mail.buildConversations([fromBernd, fromAnna], [toAnna], 'max@firma.de');
    assert.equal(conversations.length, 2);
    const withAnna = conversations.find((item) => item.messages.includes(fromAnna));
    assert.deepEqual(withAnna.messages.map((item) => item.id), [fromAnna.id, toAnna.id]);
    assert.deepEqual(withAnna.people, [anna]);
    assert.deepEqual(conversations.find((item) => item.messages.includes(fromBernd)).people, [bernd]);
  });

  test('buildConversations: mail from an address nobody reads is not joined by subject alone, only by references', () => {
    const subject = 'Neue Anfrage';
    const one = message('inbox', { other: form, subject, messageId: '<one@x>' });
    const two = message('inbox', { other: { name: '', address: 'do-not-reply+shop@portal.de' }, subject });
    const three = message('inbox', { other: { name: '', address: 'do-not-reply+shop@portal.de' }, subject });
    assert.equal(mail.buildConversations([one, two, three], []).length, 3);
    const followUp = message('inbox', { other: form, subject, inReplyTo: '<one@x>' });
    assert.equal(mail.buildConversations([one, followUp], []).length, 1);
    // An ordinary address that merely starts similarly still counts as a person.
    const person = { name: '', address: 'noreplyfan@example.de' };
    assert.equal(mail.buildConversations([message('inbox', { other: person, subject }), message('inbox', { other: person, subject })], []).length, 1);
  });

  test('matchesMail also finds a message by its Reply-To', () => {
    const viaForm = message('inbox', { other: form, replyTo: [anna], subject: 'Anfrage' });
    assert.equal(mail.matchesMail(viaForm, 'ANNA@example'), true);
    assert.equal(mail.matchesMail(viaForm, 'kundin'), true);
    assert.equal(mail.matchesMail(viaForm, 'bernd'), false);
  });

  test('isAuthError tells a refused login from a connection that failed', () => {
    for (const error of [{ authenticationFailed: true }, { code: 'EAUTH' }, { responseCode: 535 }, { message: 'Command failed', response: 'NO [AUTHENTICATIONFAILED] Invalid credentials' }, { message: 'Invalid login: 535 5.7.8 Error' }]) {
      assert.equal(core.isAuthError(error), true, JSON.stringify(error));
    }
    for (const error of [null, undefined, {}, { code: 'ETIMEDOUT' }, { code: 'ECONNREFUSED' }, { code: 'ENOTFOUND' }, { message: 'Timeout after 535 ms' }, { message: 'self-signed certificate' }, core.fieldError('Das Passwort des Postfachs fehlt.')]) {
      assert.equal(core.isAuthError(error), false, JSON.stringify(error));
    }
  });

  test('keepsStoredPassword: only when address, user and both servers with port and encryption are unchanged', () => {
    const account = () => core.normalizeAccount({ email: 'max@firma.de', name: 'Max', imap: { host: 'imap.firma.de', port: 993 }, smtp: { host: 'smtp.firma.de', port: 465 }, signature: 'Gruß' });
    const stored = account();
    assert.equal(core.keepsStoredPassword(stored, account()), true);
    assert.equal(core.keepsStoredPassword(stored, { ...account(), name: 'Anderer Name', signature: '' }), true, 'name and signature do not matter');
    const changes = {
      'IMAP host': { imap: { host: 'imap.boese.example', port: 993, secure: true } },
      'IMAP port and security': { imap: { host: 'imap.firma.de', port: 143, secure: false } },
      'IMAP security alone': { imap: { host: 'imap.firma.de', port: 993, secure: false } },
      'SMTP host': { smtp: { host: 'smtp.boese.example', port: 465, secure: true } },
      'SMTP port': { smtp: { host: 'smtp.firma.de', port: 587, secure: false } },
      'SMTP security alone': { smtp: { host: 'smtp.firma.de', port: 465, secure: false } },
      'user': { user: 'jemand-anders' },
      'address': { email: 'anders@firma.de' },
    };
    for (const [what, change] of Object.entries(changes)) assert.equal(core.keepsStoredPassword(stored, { ...account(), ...change }), false, what);
    assert.equal(core.keepsStoredPassword(null, account()), false);
    assert.equal(core.keepsStoredPassword(undefined, account()), false);
    assert.equal(core.keepsStoredPassword(stored, null), false);
    assert.equal(core.keepsStoredPassword({ ...stored, smtp: undefined }, { ...account(), smtp: undefined }), false, 'a half-stored account never keeps the password');
  });

  const cacheEntry = (folder, id, overrides = {}) => ({ ...core.summarize(folder, fetched({ uid: id })), ...overrides });
  const goodCache = () => ({ ...core.emptyCache('max@firma.de'), lastSync: '2026-11-03T13:06:00.000Z', paths: { sent: 'Gesendet', trash: 'Papierkorb' },
    folders: { inbox: { path: 'INBOX', uidValidity: '7', messages: [cacheEntry('inbox', 9), cacheEntry('inbox', 4)] }, sent: { path: 'Gesendet', uidValidity: '3', messages: [cacheEntry('sent', 2)] } } });

  test('sanitizeCache returns a sound list unchanged, also after a round trip through the file', () => {
    assert.deepEqual(core.sanitizeCache(goodCache(), 'max@firma.de'), goodCache());
    assert.deepEqual(core.sanitizeCache(JSON.parse(JSON.stringify(goodCache())), 'max@firma.de'), goodCache());
    assert.deepEqual(core.sanitizeCache(core.emptyCache('max@firma.de'), 'max@firma.de'), core.emptyCache('max@firma.de'));
  });

  test('sanitizeCache: entries stored before Reply-To was kept stay usable and stay recognisable as old', () => {
    const cache = goodCache();
    delete cache.folders.inbox.messages[0].replyTo;
    const result = core.sanitizeCache(cache, 'max@firma.de');
    assert.equal('replyTo' in result.folders.inbox.messages[0], false);
    assert.deepEqual(result.folders.inbox.messages[1].replyTo, []);
    assert.deepEqual(mail.replyTarget(result.folders.inbox.messages[0]), result.folders.inbox.messages[0].from);
  });

  test('sanitizeCache rejects a list that is not this mailbox\'s list at all', () => {
    const broken = [null, undefined, 'text', 5, [], {}, { ...goodCache(), version: 2 }, { ...goodCache(), email: 'anders@firma.de' }, { ...goodCache(), folders: null }, { ...goodCache(), folders: [] },
      { ...goodCache(), folders: { inbox: goodCache().folders.inbox } }, { ...goodCache(), folders: { ...goodCache().folders, sent: {} } },
      { ...goodCache(), folders: { ...goodCache().folders, inbox: { path: 'INBOX', uidValidity: '7', messages: 'viele' } } }, { ...goodCache(), folders: { inbox: true, sent: true } }];
    for (const cache of broken) assert.equal(core.sanitizeCache(cache, 'max@firma.de'), null, JSON.stringify(cache)?.slice(0, 80));
  });

  test('sanitizeCache drops unsound entries and repairs fields of the wrong kind instead of failing', () => {
    const cache = goodCache();
    cache.paths = 'kaputt';
    cache.lastSync = 12;
    cache.folders.sent.path = { toString: () => 'x' };
    cache.folders.sent.uidValidity = 3;
    cache.folders.inbox.messages = [
      null, 'text', [], { uid: '9' }, { uid: 0 }, { uid: -1 }, { uid: 1.5 }, { uid: Number.MAX_SAFE_INTEGER + 2 },
      cacheEntry('inbox', 9), cacheEntry('inbox', 9, { subject: 'doppelt' }),
      { uid: 12, id: 'sent:99', folder: 'trash', from: 'nobody', to: 'x', cc: null, replyTo: [null, { address: 'A@B.de' }], references: ['<a@x>', 5, null], subject: 7, date: 'gestern', seen: 'ja', answered: 1, hasAttachments: null, size: -4, extra: 'weg' },
    ];
    const result = core.sanitizeCache(cache, 'max@firma.de');
    assert.deepEqual(result.paths, { sent: '', trash: '' });
    assert.equal(result.lastSync, '');
    assert.deepEqual([result.folders.sent.path, result.folders.sent.uidValidity, result.folders.sent.messages.length], ['', '', 1]);
    assert.deepEqual(result.folders.inbox.messages.map((item) => item.uid), [12, 9]);
    assert.equal(result.folders.inbox.messages[1].subject, 'AW: Angebot', 'the first of two entries with one uid is kept');
    assert.deepEqual(result.folders.inbox.messages[0], {
      id: 'inbox:12', folder: 'inbox', uid: 12, messageId: '', inReplyTo: '', references: ['<a@x>'], subject: '', from: { name: '', address: '' }, to: [], cc: [],
      replyTo: [{ name: '', address: 'a@b.de' }], date: '', seen: false, answered: false, hasAttachments: false, size: 0,
    });
    // Whatever comes out can be merged and grouped without throwing.
    assert.doesNotThrow(() => mail.buildConversations(result.folders.inbox.messages, result.folders.sent.messages, 'max@firma.de'));
    assert.doesNotThrow(() => core.mergeFolder(result.folders.inbox.messages, [], new Map([[12, { seen: true, answered: false }]])));
  });

  const stageOf = (options = {}) => {
    let next = 0;
    const stage = core.createAttachmentStage({ newId: () => `id-${++next}`, ...options });
    const add = (size, keep) => stage.add({ filename: 'datei.pdf', contentType: 'application/pdf', bytes: Buffer.alloc(size) }, keep ? { keep } : undefined);
    const refused = (size, keep) => { try { add(size, keep); } catch (error) { assert.equal(error.field, 'attachments'); return error.userMessage; } return ''; };
    return { stage, add, refused, ticks: (count) => { let dropped = 0; for (let index = 0; index < count; index += 1) dropped += stage.tick(); return dropped; } };
  };

  test('staged attachments: room for two full drafts, a sweep every five minutes, six missed sweeps until a file goes', () => {
    assert.deepEqual([core.MAX_STAGED_ATTACHMENTS, core.MAX_STAGED_BYTES, core.STAGED_SWEEP_MS, core.STAGED_IDLE_TICKS], [40, 60 * 1024 * 1024, 5 * 60 * 1000, 6]);
    assert.equal(core.STAGED_LIFETIME_MS, undefined, 'no expiry by the clock any more');
  });

  test('staged attachments of an open draft never expire, however long the computer slept', () => {
    // The clock is not even asked: jumping it forward by a day must change nothing.
    const realNow = Date.now;
    const { stage, add, ticks } = stageOf();
    const invoice = add(10); const photo = add(20);
    try {
      Date.now = () => realNow() + 24 * 60 * 60 * 1000;
      // Waking up is one late sweep, then the open dialog reports in again.
      assert.equal(ticks(1), 0);
      stage.claim([invoice, photo]);
      assert.deepEqual([stage.get(invoice)?.bytes.length, stage.get(photo)?.bytes.length], [10, 20]);
      // A whole working day of sweeps with the dialog open.
      for (let sweep = 0; sweep < 200; sweep += 1) { stage.tick(); if (sweep % 2 === 0) stage.claim([invoice, photo, 'unbekannt']); }
      assert.deepEqual([stage.size, stage.bytes], [2, 30]);
      // Reading a file for sending does not sweep either.
      assert.equal(stage.get(invoice).filename, 'datei.pdf');
    } finally { Date.now = realNow; }
  });

  test('staged attachments nobody claims go after six sweeps in a row, and one claim starts the count again', () => {
    const { stage, add, ticks } = stageOf();
    const abandoned = add(10); const kept = add(20);
    // The first sweep only ends the claim a new file starts with.
    assert.equal(ticks(6), 0, 'five sweeps without a claim are not enough');
    stage.claim([kept]);
    assert.equal(ticks(1), 1);
    assert.deepEqual([stage.get(abandoned), stage.get(kept)?.bytes.length, stage.size, stage.bytes], [undefined, 20, 1, 20]);
    assert.equal(ticks(5), 0);
    stage.claim([kept]);
    assert.equal(ticks(6), 0, 'the claim started the count again');
    assert.equal(ticks(1), 1);
    assert.deepEqual([stage.size, stage.bytes], [0, 0]);
    stage.claim([kept]);
    assert.equal(stage.size, 0, 'a file that is gone does not come back');
    assert.equal(stageOf({ idleTicks: 2 }).ticks(3), 0, 'nothing to sweep is fine');
  });

  test('staged attachments: a cap refuses the new file with a message and never pushes out a file a draft may need', () => {
    const { stage, add, refused } = stageOf({ maxBytes: 100 });
    const a = add(40); const b = add(40);
    assert.match(refused(40, [a, b]), /zu viele Anhänge.*Die Datei wurde nicht hinzugefügt\.$/);
    assert.deepEqual([stage.size, stage.bytes, !!stage.get(a), !!stage.get(b)], [2, 80, true, true], 'nothing changed');
    assert.match(refused(40), /zu viele Anhänge/, 'fresh files are protected even when the caller names no draft');
    assert.equal(stage.get(add(20, [a, b])).bytes.length, 20, 'exactly at the cap is allowed');
    assert.match(refused(500), /zu viele Anhänge/, 'a file larger than the whole cap is refused as well');
    assert.deepEqual([stage.size, stage.bytes], [3, 100]);

    const counted = stageOf({ maxCount: 3 });
    const ids = [counted.add(1), counted.add(1), counted.add(1)];
    assert.match(counted.refused(1, ids), /zu viele Anhänge/);
    assert.deepEqual(ids.map((id) => !!counted.stage.get(id)), [true, true, true]);
    assert.deepEqual([counted.stage.size, counted.stage.bytes], [3, 3]);
  });

  test('staged attachments: room is made only from files no draft has claimed since the last sweep', () => {
    const { stage, add, refused, ticks } = stageOf({ maxBytes: 100 });
    const left = add(60);      // a draft whose window went away without a word
    const mine = add(30);      // the draft on screen
    ticks(1);
    stage.claim([mine]);
    assert.match(refused(40, [mine]), /zu viele Anhänge/, 'one sweep is not yet proof that the other draft is gone');
    ticks(1);
    stage.claim([mine]);
    const added = add(40, [mine]);
    assert.deepEqual([stage.get(left), !!stage.get(mine), !!stage.get(added), stage.bytes], [undefined, true, true, 70]);
    // Files named as the open draft are never the ones that make room, even if their last claim is long ago.
    ticks(3);
    assert.match(refused(40, [mine, added]), /zu viele Anhänge/);
    assert.deepEqual([!!stage.get(mine), !!stage.get(added)], [true, true]);
  });

  test('staged attachments: discarding and clearing keep the byte count right', () => {
    const { stage, add } = stageOf();
    const a = add(10); const b = add(5);
    assert.equal(stage.delete(a), true);
    assert.equal(stage.delete(a), false);
    assert.equal(stage.delete('unbekannt'), false);
    assert.deepEqual([stage.size, stage.bytes], [1, 5]);
    assert.deepEqual(Object.keys(stage.get(b)).sort(), ['bytes', 'claimed', 'contentType', 'filename', 'idle']);
    stage.clear();
    assert.deepEqual([stage.size, stage.bytes, stage.get(b)], [0, 0, undefined]);
  });

  test('downloadMark: Zone.Identifier stream on Windows, quarantine attribute on macOS, nothing elsewhere', () => {
    assert.deepEqual(core.downloadMark('win32', 'C:\\Users\\Max\\Downloads\\Rechnung.pdf'), { kind: 'stream', path: 'C:\\Users\\Max\\Downloads\\Rechnung.pdf:Zone.Identifier', content: '[ZoneTransfer]\r\nZoneId=3\r\n' });
    const mac = core.downloadMark('darwin', '/Users/max/Downloads/$(rm -rf ~); "x".pdf', new Date('2026-11-16T12:00:00.000Z'));
    assert.equal(mac.kind, 'xattr');
    assert.equal(mac.command, '/usr/bin/xattr');
    // The file name is one argument of its own, never part of a command line.
    assert.deepEqual(mac.args, ['-w', 'com.apple.quarantine', `0081;${(Date.UTC(2026, 10, 16, 12) / 1000).toString(16)};Helferlein;`, '/Users/max/Downloads/$(rm -rf ~); "x".pdf']);
    assert.match(mac.args[2], /^[0-9a-f]{4};[0-9a-f]{8};[^;]+;$/);
    assert.equal(core.downloadMark('linux', '/home/max/x.pdf'), null);
  });
}

// ── Second review: real sender in lists, unusable mailbox, HTML → text, attachment hand-over ────────────────────
{
  const html = require('../../electron/mail-html-worker.cjs');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const vm = require('node:vm');

  test('sender: a message is listed under who really sent it, whatever Reply-To says', () => {
    const shop = { name: 'Amazon.de', address: 'versand@amazon.de' };
    const order = message('inbox', { other: shop, replyTo: [{ name: '', address: 'no-reply@amazon.de' }] });
    assert.deepEqual(mail.sender(order), shop);
    assert.equal(mail.personLabel(mail.sender(order)), 'Amazon.de');
    // Answering and grouping still follow Reply-To.
    assert.equal(mail.replyTarget(order, 'max@firma.de').address, 'no-reply@amazon.de');
    assert.equal(mail.counterpart(order, 'max@firma.de').address, 'no-reply@amazon.de');
    // A Reply-To that happens to be a customer's address does not turn someone else's mail into the customer's.
    const stranger = { name: 'Fremde Firma', address: 'info@fremd.de' };
    assert.deepEqual(mail.sender(message('inbox', { other: stranger, replyTo: [{ name: 'Anna Kundin', address: 'anna@example.de' }] })), stranger);
    const sent = message('sent', { other: { name: 'Erika', address: 'erika@example.de' }, replyTo: [shop] });
    assert.equal(mail.sender(sent).address, 'erika@example.de');
    assert.deepEqual(mail.sender({ ...sent, to: [], cc: [] }), { name: '', address: '' });
  });

  test('buildConversations: titles come from the real senders, grouping from who answers go to', () => {
    const form = { name: 'Kontaktformular', address: 'noreply@meine-seite.de' };
    const anna = { name: 'Anna Kundin', address: 'anna@example.de' };
    const subject = 'Neue Anfrage';
    const request = message('inbox', { other: form, replyTo: [anna], subject, date: '2026-11-01T08:00:00.000Z' });
    const answer = message('sent', { other: anna, subject: `AW: ${subject}`, date: '2026-11-01T10:00:00.000Z' });
    const [conversation, ...rest] = mail.buildConversations([request], [answer], 'max@firma.de');
    assert.equal(rest.length, 0, 'still one conversation');
    assert.deepEqual(conversation.people, [anna]);
    assert.deepEqual(conversation.senders, [anna, form], 'most recent first: the recipient of the answer, then the form that sent the request');
    const shop = { name: 'Amazon.de', address: 'versand@amazon.de' };
    const [order] = mail.buildConversations([message('inbox', { other: shop, replyTo: [{ name: '', address: 'no-reply@amazon.de' }], subject: 'Ihre Bestellung' })], []);
    assert.deepEqual(order.senders, [shop]);
    // A sender without an address still has a name to show, once.
    const nameless = { name: 'Unbekannte Firma', address: '' };
    const [odd] = mail.buildConversations([message('inbox', { other: nameless, messageId: '<o1@x>' }), message('inbox', { other: nameless, inReplyTo: '<o1@x>' })], []);
    assert.deepEqual(odd.senders, [nameless]);
  });

  test('buildConversations stays quick with two full folders of hostile headers', () => {
    const references = Array.from({ length: 30 }, (_, index) => `<ref-${index}@x>`);
    const many = (folder) => Array.from({ length: 500 }, (_, index) => message(folder, { other: { name: '', address: `p${index}@x.de` }, subject: 'Re: '.repeat(100) + 'x', references, messageId: `<${folder}-${index}@x>` }));
    const started = Date.now();
    const conversations = mail.buildConversations(many('inbox'), many('sent'), 'max@firma.de');
    assert.equal(conversations.length, 1);
    assert.equal(conversations[0].senders.length, 500);
    assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`);
  });

  test('mailboxUsable: a mailbox that cannot send right now is not offered for documents', () => {
    const ok = { ready: true, configured: true, needsPassword: false, authFailed: false, sendRefused: false };
    assert.equal(mail.mailboxUsable(ok), true);
    assert.equal(mail.mailboxUsable({ ...ok, sendRefused: undefined }), true, 'a list from an older desktop app');
    for (const change of [{ ready: false }, { configured: false }, { needsPassword: true }, { authFailed: true }, { sendRefused: true }]) {
      assert.equal(mail.mailboxUsable({ ...ok, ...change }), false, JSON.stringify(change));
    }
  });

  test('summarize: a header block far larger than asked for is cut off before any text work', () => {
    const huge = Buffer.from(`References: ${'<a@x> '.repeat(2_000_000)}\r\nIn-Reply-To: <late@x>\r\n\r\n`, 'latin1');
    const started = Date.now();
    const summary = core.summarize('inbox', fetched({ headers: huge, envelope: { ...fetched().envelope, inReplyTo: '' } }));
    assert.ok(Date.now() - started < 500, `took ${Date.now() - started} ms`);
    assert.deepEqual(summary.references, ['<a@x>']);
    assert.equal(summary.inReplyTo, '', 'what lies beyond the bound is not read');
  });

  test('htmlToText: links, images, tables and headings become readable text', () => {
    const { text, skipped } = html.htmlToText('<html><head><title>Titel der Seite</title><style>p{color:red}</style></head><body>'
      + '<h1>Angebot für Fliesen</h1>'
      + '<p>Bitte <a href="https://shop.example/angebot?id=7">hier klicken</a> oder <a href="https://shop.example">https://shop.example</a> öffnen.</p>'
      + '<p>Fragen an <a href="mailto:info@shop.example">info@shop.example</a>, <a href="mailto:chef@shop.example">den Chef</a> oder <a href="#oben">nach oben</a>.</p>'
      + '<img src="https://tracker.example/pixel.gif?u=42" alt="Zählpixel" width="1" height="1"><script>alert(1)</script>'
      + '<table><tr><th>Pos</th><th>Preis</th></tr><tr><td>Fliesen</td><td>120&nbsp;€</td></tr><tr><td>&nbsp;</td><td><img src="https://shop.example/leer.gif"></td></tr></table>'
      + '<table><tr><td><table><tr><td><p>Linke Spalte</p><p>Zweiter Absatz</p></td><td><div>Rechte Spalte</div></td></tr></table></td></tr></table>'
      + '<ul><li>eins</li><li>zwei</li></ul></body></html>');
    assert.equal(skipped, '');
    assert.equal(text, [
      'Angebot für Fliesen', '',
      'Bitte hier klicken [https://shop.example/angebot?id=7] oder https://shop.example öffnen.', '',
      'Fragen an info@shop.example, den Chef [chef@shop.example] oder nach oben.', '',
      'Pos | Preis', 'Fliesen | 120 €', '',
      'Linke Spalte', '', 'Zweiter Absatz', '', 'Rechte Spalte', '',
      ' * eins', ' * zwei',
    ].join('\n'));
    assert.doesNotMatch(text, /tracker|pixel|Zählpixel|leer\.gif|alert|color:red|Titel der Seite|mailto:|#oben|ANGEBOT/);
  });

  test('htmlToText: text is not re-wrapped, entities are decoded, nothing of the markup stays', () => {
    const long = 'Wort '.repeat(60).trim();
    const { text } = html.htmlToText(`<div onclick="evil()"><p>${long}</p><p>M&uuml;ller &amp; S&ouml;hne &lt;GmbH&gt;</p><br><iframe src="https://x.example/f"></iframe></div>`);
    assert.equal(text.split('\n')[0], long);
    assert.match(text, /Müller & Söhne <GmbH>/);
    assert.doesNotMatch(text, /onclick|iframe|x\.example/);
  });

  test('htmlToText and convertHtml refuse oversized and absurdly nested HTML at once, without parsing it', async () => {
    const chain = '<b>'.repeat(700_000);                       // 2.1 MB: the fallback of the old code froze for minutes here
    const deep = '<b>'.repeat(300_000);                        // 0.9 MB, below the size limit: 9 s in the parser
    const tricky = `<div>${'<span>'.repeat(4000)}tief${'</span>'.repeat(4000)}</div>`;
    assert.ok(chain.length > html.MAX_HTML_CHARS && deep.length < html.MAX_HTML_CHARS);
    for (const [input, reason] of [[chain, 'size'], [deep, 'nesting'], [tricky, 'nesting'], [`<p>${'x'.repeat(html.MAX_HTML_CHARS)}</p>`, 'size']]) {
      let started = Date.now();
      assert.deepEqual(html.htmlToText(input), { text: '', skipped: reason });
      assert.ok(Date.now() - started < 300, `${reason}: sync guard took ${Date.now() - started} ms`);
      started = Date.now();
      assert.deepEqual(await html.convertHtml(input), { text: '', skipped: reason });
      assert.ok(Date.now() - started < 300, `${reason}: guard took ${Date.now() - started} ms`);
    }
    // Elements that close by themselves are not nesting: a long mail of paragraphs and table cells is converted.
    const longMail = `<table>${'<tr><td>Zeile<td>Wert'.repeat(3000)}</table>${'<p>Absatz<br>'.repeat(5000)}`;
    assert.ok(html.nestingDepth(longMail) < 10);
    assert.equal(html.nestingDepth('<b>'.repeat(50) + '</b>'.repeat(50) + '<i><u>x'), 50);
    const converted = html.htmlToText(longMail);
    assert.equal(converted.skipped, '');
    assert.ok(converted.text.startsWith('Zeile | Wert\nZeile | Wert\n'), converted.text.slice(0, 60));
    assert.equal(converted.text.split('Zeile | Wert').length - 1, 3000);
    assert.equal(converted.text.split('Absatz').length - 1, 5000);
    // Deep, but below the guard: bounded by the converter's own depth limit instead of overflowing the stack.
    assert.deepEqual(html.htmlToText(`${'<div>'.repeat(2500)}ganz innen`), { text: '…', skipped: '' });
  });

  test('convertHtml runs in a worker thread: the caller stays responsive and a slow conversion is ended', async () => {
    // Legitimate but large: about 1.4 MB of paragraphs.
    const big = '<p>Hallo Welt, dies ist ein Absatz mit <a href="https://x.example/y">Link</a>.</p>'.repeat(17_000);
    assert.ok(big.length > 1_300_000 && big.length < html.MAX_HTML_CHARS);
    let beats = 0;
    const heart = setInterval(() => { beats += 1; }, 5);
    const result = await html.convertHtml(big);
    // Counted over the whole conversion (hundreds of ms), so a busy machine cannot starve the count.
    assert.ok(beats >= 3, `the event loop kept running during the conversion (${beats} beats)`);
    assert.equal(result.skipped, '');
    assert.equal(result.text.split('\n\n').length, 17_000);
    assert.ok(result.text.startsWith('Hallo Welt, dies ist ein Absatz mit Link [https://x.example/y].'));
    assert.deepEqual(await html.convertHtml(''), { text: '', skipped: '' });
    assert.deepEqual(await html.convertHtml('<p>kurz</p>'), { text: 'kurz', skipped: '' });

    // The same work with a time limit it cannot meet: ended and reported.
    const started = Date.now();
    assert.deepEqual(await html.convertHtml(big, { timeoutMs: 15 }), { text: '', skipped: 'timeout' });
    const elapsed = Date.now() - started;
    clearInterval(heart);
    assert.ok(elapsed < 1000, `ended after ${elapsed} ms`);
    assert.equal(html.TIMEOUT_MS, 4000);
  });

  // ── The handlers in electron/main.js, loaded the way the other IPC tests load it ─────────────────────────────
  function mainProcess(t, { pick = [] } = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'helferlein-mail-ipc-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const handlers = new Map(); const timers = [];
    const frame = { url: 'http://127.0.0.1:3456/mail' };
    const contents = { mainFrame: frame, getURL: () => frame.url, printToPDF: async () => Buffer.from('%PDF-1.7 DEMO') };
    const win = { webContents: contents, isDestroyed: () => false };
    const state = { pick, sent: [] };
    const context = {
      require: name => {
        if (name === 'electron') return {
          app: { isPackaged: false, on() {}, requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }), getPath: () => directory },
          BrowserWindow: { fromWebContents: () => win },
          ipcMain: { handle: (channel, callback) => handlers.set(channel, callback), on() {} },
          shell: {}, safeStorage: { isEncryptionAvailable: () => false },
          dialog: { showOpenDialog: async () => ({ canceled: state.pick.length === 0, filePaths: state.pick }) },
        };
        return require(name);
      },
      process, console, URL, Buffer, setTimeout, clearTimeout,
      setInterval: (callback, ms) => { const timer = { callback, ms, unref() {} }; timers.push(timer); return timer; },
      __dirname: path.resolve(__dirname, '../../electron'),
    };
    const source = fs.readFileSync(path.resolve(__dirname, '../../electron/main.js'), 'utf8');
    vm.runInNewContext(`${source}\nglobalThis.installTestWindow = (win) => { mainWindow = win; appOrigin = "http://127.0.0.1:3456"; }; globalThis.testMail = { stage: stagedMailAttachments, service: () => mail() };`, context);
    context.installTestWindow(win);
    const event = { sender: contents, senderFrame: frame };
    // Results come from another realm (vm): a round trip through JSON is also what IPC does to them.
    const call = async (channel, payload) => JSON.parse(JSON.stringify(await handlers.get(channel)(event, payload)));
    const files = (count, size = 10) => Array.from({ length: count }, (_, index) => { const file = path.join(directory, `foto-${index + 1}.jpg`); fs.writeFileSync(file, Buffer.alloc(size, 1)); return file; });
    return { call, handlers, timers, state, files, directory, stage: context.testMail.stage, service: context.testMail.service };
  }

  test('main process: loading it starts no timer, and every mail handler refuses an untrusted sender', async t => {
    const main = mainProcess(t);
    assert.equal(main.timers.length, 0);
    const channels = [...main.handlers.keys()].filter(channel => channel.startsWith('mail-'));
    assert.ok(channels.length >= 15);
    for (const channel of channels) await assert.rejects(main.handlers.get(channel)({ sender: {}, senderFrame: {} }, {}), /untrusted/i, channel);
  });

  test('main process: 15 chosen files are 15 attachments, and a selection over a limit adds nothing and says why', async t => {
    const main = mainProcess(t);
    main.state.pick = main.files(15);
    const first = await main.call('mail-attach-files', { held: [] });
    assert.equal(first.ok, true);
    assert.deepEqual(first.attachments.map(item => item.name), main.state.pick.map(file => path.basename(file)), 'none left out');
    assert.equal(main.stage.size, 15);
    assert.deepEqual(main.timers.map(timer => timer.ms), [core.STAGED_SWEEP_MS], 'one sweep, started with the first file');

    // Six more would be 21: nothing is added, and the message counts both.
    const held = first.attachments.map(item => item.id);
    main.state.pick = main.files(6);
    const tooMany = await main.call('mail-attach-files', { held });
    assert.deepEqual([tooMany.ok, tooMany.field], [false, 'attachments']);
    assert.match(tooMany.error, /höchstens 20 Dateien anhängen\. 15 Dateien sind schon angehängt, 6 weitere wurden gewählt\. Es wurde keine davon hinzugefügt\./);
    assert.equal(main.stage.size, 15);
    main.state.pick = main.files(5);
    assert.equal((await main.call('mail-attach-files', { held })).attachments.length, 5);
    assert.equal(main.stage.size, 20);

    // The total size counts together with what the draft holds.
    const other = mainProcess(t);
    other.state.pick = [other.files(1, 12 * 1024 * 1024)[0]];
    const big = await other.call('mail-attach-files', { held: [] });
    assert.equal(big.ok, true);
    const second = path.join(other.directory, 'zweites.jpg');
    fs.writeFileSync(second, Buffer.alloc(9 * 1024 * 1024, 1));
    other.state.pick = [second];
    const tooLarge = await other.call('mail-attach-files', { held: [big.attachments[0].id] });
    assert.deepEqual([tooLarge.ok, tooLarge.field], [false, 'attachments']);
    assert.match(tooLarge.error, /Zusammen wären die Anhänge 21,0 MB groß/);
    assert.equal(other.stage.size, 1);
    // An empty file is named instead of being skipped.
    const empty = path.join(other.directory, 'leer.txt');
    fs.writeFileSync(empty, '');
    other.state.pick = [empty];
    assert.match((await other.call('mail-attach-files', { held: [] })).error, /„leer\.txt“ ist leer/);
    // Ids the window invents are not files of a draft.
    other.state.pick = [];
    assert.deepEqual(await other.call('mail-attach-files', { held: ['../x', 7, null] }), { ok: false, canceled: true });
    assert.deepEqual(await other.call('mail-attach-files', undefined), { ok: false, canceled: true });
  });

  test('main process: an open draft keeps its files through any number of sweeps; a missing file stops the send and is named', async t => {
    const main = mainProcess(t);
    main.state.pick = main.files(2);
    const { attachments } = await main.call('mail-attach-files', { held: [] });
    const ids = attachments.map(item => item.id);
    const [sweep] = main.timers;
    for (let round = 0; round < 50; round += 1) {
      sweep.callback();
      assert.deepEqual(await main.call('mail-attach-keep', { ids }), { ok: true, missing: [] });
    }
    assert.equal(main.stage.size, 2);
    // Without the dialog reporting in (window gone) the files go after a few sweeps, and the window would be told.
    for (let round = 0; round <= core.STAGED_IDLE_TICKS; round += 1) sweep.callback();
    assert.equal(main.stage.size, 0);
    assert.deepEqual(await main.call('mail-attach-keep', { ids }), { ok: true, missing: ids });

    const service = main.service();
    let sends = 0;
    service.send = async () => { sends += 1; return { ok: true, warning: '' }; };
    const gone = await main.call('mail-send', { to: 'kunde@example.de', subject: 'Rechnung', text: 'x', attachmentIds: ids });
    assert.deepEqual(gone, { ok: false, error: 'Ein Anhang ist nicht mehr vorhanden. Bitte den Anhang erneut hinzufügen.', field: 'attachments', missing: ids });
    assert.equal(sends, 0, 'never sent without a file the draft shows');
    const tooMany = await main.call('mail-send', { to: 'kunde@example.de', subject: 'x', text: 'x', attachmentIds: Array.from({ length: 21 }, (_, index) => `123e4567-e89b-12d3-a456-4266141740${String(index).padStart(2, '0')}`) });
    assert.deepEqual([tooMany.ok, tooMany.error, tooMany.field], [false, 'Es lassen sich höchstens 20 Dateien anhängen.', 'attachments']);

    main.state.pick = main.files(3);
    const again = await main.call('mail-attach-files', { held: [] });
    let received = null;
    service.send = async (outgoing, files) => { received = { outgoing, files }; return { ok: true, warning: '' }; };
    assert.deepEqual(await main.call('mail-send', { to: 'kunde@example.de', subject: 'Fotos', text: 'x', attachmentIds: again.attachments.map(item => item.id) }), { ok: true, warning: '' });
    assert.deepEqual(Array.from(received.files, file => file.filename), ['foto-1.jpg', 'foto-2.jpg', 'foto-3.jpg']);
    assert.equal(main.stage.size, 0, 'sent files are let go');
    // A failed send keeps the files for the next try.
    main.state.pick = main.files(1);
    const kept = await main.call('mail-attach-files', { held: [] });
    service.send = async () => { throw Object.assign(new Error('x'), { userMessage: 'Postausgang (SMTP): Anmeldung abgelehnt.', field: 'auth' }); };
    assert.deepEqual(await main.call('mail-send', { to: 'kunde@example.de', subject: 'x', text: 'x', attachmentIds: [kept.attachments[0].id] }), { ok: false, error: 'Postausgang (SMTP): Anmeldung abgelehnt.', field: 'auth' });
    assert.equal(main.stage.size, 1);
    // Removing the account lets go of everything that was waiting.
    service.removeAccount = async () => ({ ok: true });
    await main.call('mail-account-remove');
    assert.equal(main.stage.size, 0);
  });
}

test('HTML to text: links show their real target, picture links never a bare address, embedded pictures do not count as size', () => {
  const { htmlToText } = require('../../electron/mail-html-worker.cjs');
  assert.equal(htmlToText('<p><a href="https://pay.example/r/1">hier klicken</a> / <a href="https://www.x.de/">www.x.de</a> / <a href="mailto:a@b.de?subject=x">a@b.de</a> / <a href="javascript:alert(1)">weiter</a></p>').text,
    'hier klicken [https://pay.example/r/1] / www.x.de / a@b.de / weiter');
  // A text that looks like one address while the link leads to another: both are shown.
  assert.equal(htmlToText('<a href="http://evil.example/login">https://www.sparkasse.de/login</a>').text, 'https://www.sparkasse.de/login [http://evil.example/login]');
  assert.equal(htmlToText('<a href="https://track.example/abc"><img src="x.png" alt="Angebote der Woche"></a><a href="https://t.example/1"><img src="y.png"></a>').text, 'Angebote der Woche');
  const embedded = `<p>Hallo</p><img src="data:image/png;base64,${'A'.repeat(1_700_000)}"><p>Welt</p>`;
  assert.deepEqual(htmlToText(embedded), { text: 'Hallo\n\nWelt', skipped: '' });
  // Rows whose cells hold several lines stay apart from each other.
  assert.equal(htmlToText('<table><tr><td>Kleber<br>Art. 1</td><td>4</td></tr><tr><td>Fuge<br>Art. 2</td><td>2</td></tr></table>').text, 'Kleber\nArt. 1\n4\n\nFuge\nArt. 2\n2');
});

test('quoteForReply is bounded in characters as well as in lines', () => {
  const quoted = mail.quoteForReply({ date: '2026-11-01T10:00:00Z', from: { name: 'A', address: 'a@b.de' } }, 'x'.repeat(400_000));
  assert.ok(quoted.length < 21_000, String(quoted.length));
});
