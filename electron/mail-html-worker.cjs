'use strict';
/*
 * HTML of a received mail → readable plain text. This is the only place where mail HTML is converted.
 *
 * Mail HTML comes from strangers and converting it is synchronous, so the work never runs in the main process:
 * `convertHtml` starts this same file as a worker thread and ends it after a few seconds. A mail that is too large,
 * nested absurdly deep or that takes too long is not converted at all; the reader then says that it cannot be
 * shown as text. Nothing here renders HTML, follows links or loads images.
 */
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');

/** Larger HTML parts are not converted (characters). Newsletters stay well below; the list of a mail is 400 000. */
const MAX_HTML_CHARS = 1_500_000;
/** Open elements inside each other before the HTML counts as hostile: the parser gets quadratic far beyond this. */
const MAX_NESTING = 3000;
const TIMEOUT_MS = 4000;
const TASK = 'mail-html-to-text';

// Elements that never contain others, and elements a following sibling closes without an end tag.
const NEVER_NESTED = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr', 'p', 'li', 'td', 'th', 'tr', 'dt', 'dd', 'option', 'tbody', 'thead', 'tfoot']);

/** A cheap upper estimate of how deep elements are nested; stops counting at `stopAt`. One pass, no parsing. */
function nestingDepth(html, stopAt = Infinity) {
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)/g;
  let depth = 0, deepest = 0;
  for (let match = tag.exec(html); match; match = tag.exec(html)) {
    if (NEVER_NESTED.has(match[2].toLowerCase())) continue;
    if (match[1]) { if (depth > 0) depth -= 1; continue; }
    depth += 1;
    if (depth > deepest) { deepest = depth; if (deepest >= stopAt) break; }
  }
  return deepest;
}

/** Pictures embedded as data are never shown; taken out first, they do not count against the size limit. */
function slim(html) {
  return html.length > 100_000 ? html.replace(/\b(src|background)\s*=\s*(["'])data:[^"']*\2/gi, '$1=""') : html;
}

/** Why this HTML is not converted at all: 'size', 'nesting' or '' when it may be. */
function refusal(html) {
  if (html.length > MAX_HTML_CHARS) return 'size';
  if (nestingDepth(html, MAX_NESTING + 1) > MAX_NESTING) return 'nesting';
  return '';
}

const BLOCKS = new Set(['address', 'article', 'aside', 'blockquote', 'div', 'dl', 'fieldset', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul']);
const isCell = node => node.type === 'tag' && (node.name === 'td' || node.name === 'th');

/** Looks at up to `budget` nodes below `root` (no recursion: the tree may be deep). */
function scan(root, budget, visit) {
  const stack = [...(root.children || [])];
  for (let seen = 0; stack.length && seen < budget; seen += 1) {
    const node = stack.pop();
    const verdict = visit(node);
    if (verdict !== undefined) return verdict;
    if (node.children) for (const child of node.children) stack.push(child);
  }
  return stack.length ? null : false;
}
// Undecided (too much to look at) counts as layout: separate lines are always readable.
const holdsBlocks = cell => scan(cell, 400, node => (node.type === 'tag' && (BLOCKS.has(node.name) || node.name === 'br') ? true : undefined)) !== false;
const holdsText = cell => scan(cell, 400, node => (node.type === 'text' && /[^\s ​‌﻿]/.test(node.data) ? true : undefined)) !== false;

/**
 * One table row. Mail tables are of two kinds, and nothing in the markup tells them apart: the layout grid of a
 * designed mail (cells hold whole paragraphs) and a real table (positions and prices). Cells with short text go on
 * one line, separated by " | "; cells that hold paragraphs each get lines of their own. Empty cells are left out.
 */
function formatRow(elem, walk, builder) {
  const cells = (elem.children || []).filter(isCell).filter(holdsText);
  if (!cells.length) return;
  if (cells.length === 1 || cells.some(holdsBlocks)) {
    cells.forEach((cell, index) => {
      // A row of several stacked cells is set apart from the next one, or positions run into each other.
      builder.openBlock({ leadingLineBreaks: index === 0 && cells.length > 1 ? 2 : 1 });
      walk(cell.children, builder);
      builder.closeBlock({ trailingLineBreaks: 1 });
    });
    return;
  }
  builder.openBlock({ leadingLineBreaks: 1 });
  cells.forEach((cell, index) => {
    if (index) builder.addLiteral(' | ');
    walk(cell.children, builder);
  });
  builder.closeBlock({ trailingLineBreaks: 1 });
}

/** A lone cell outside a row (broken markup) still gets its own line. */
function formatLooseCell(elem, walk, builder) {
  builder.openBlock({ leadingLineBreaks: 1 });
  walk(elem.children, builder);
  builder.closeBlock({ trailingLineBreaks: 1 });
}

/**
 * A link: "Text [https://ziel]", the target only when it says more than the text and only for web and mail
 * addresses. A link around nothing but a picture shows the picture's description, never a bare tracking address.
 */
function formatLink(elem, walk, builder) {
  const raw = String(elem.attribs?.href || '').trim();
  const href = /^https?:\/\//i.test(raw) ? raw : /^mailto:/i.test(raw) ? raw.slice(7).split('?')[0] : '';
  if (!holdsText(elem)) {
    const alt = scan(elem, 50, node => (node.type === 'tag' && node.name === 'img' && String(node.attribs?.alt || '').trim() ? String(node.attribs.alt).trim().slice(0, 200) : undefined));
    if (typeof alt === 'string') builder.addInline(alt);
    return;
  }
  let text = '';
  builder.pushWordTransform(word => { if (word) text += word; return word; });
  walk(elem.children, builder);
  builder.popWordTransform();
  const plain = value => value.replace(/\s+/g, '').replace(/^https?:\/\//i, '').replace(/\/$/, '').toLowerCase();
  if (href && plain(href) !== plain(text)) builder.addInline(` [${href.slice(0, 500)}]`, { noWordTransform: true });
}

const OPTIONS = {
  wordwrap: false,
  // The walk is recursive: bound it far below the call stack. Deeper content is replaced by the ellipsis.
  limits: { maxInputLength: MAX_HTML_CHARS, maxDepth: 200, maxChildNodes: 20_000, ellipsis: '…' },
  formatters: { mailRow: formatRow, mailCell: formatLooseCell, mailLink: formatLink },
  selectors: [
    // Pictures are never loaded and their addresses (tracking pixels) are no text.
    { selector: 'img', format: 'skip' },
    ...['style', 'script', 'head', 'title', 'noscript', 'template', 'svg', 'object', 'iframe'].map(selector => ({ selector, format: 'skip' })),
    // "Text [https://ziel]"; the target only when it says more than the text, and never a jump inside the mail.
    { selector: 'a', format: 'mailLink' },
    { selector: 'table', format: 'block', options: { leadingLineBreaks: 2, trailingLineBreaks: 2 } },
    { selector: 'tr', format: 'mailRow' },
    { selector: 'td', format: 'mailCell' },
    { selector: 'th', format: 'mailCell' },
    ...['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map(selector => ({ selector, options: { uppercase: false } })),
  ],
};

/**
 * Converts in the calling thread. Only for the worker below and for tests: it blocks until it is done.
 * @returns {{ text: string, skipped: '' | 'size' | 'nesting' | 'error' }}
 */
function htmlToText(html) {
  const source = slim(String(html ?? ''));
  const skipped = refusal(source);
  if (skipped) return { text: '', skipped };
  try { return { text: require('html-to-text').convert(source, OPTIONS), skipped: '' }; }
  catch { return { text: '', skipped: 'error' }; }
}

/**
 * Converts in a worker thread that is ended after `timeoutMs`, so the caller's thread never blocks on a mail.
 * Never rejects: `skipped` says why there is no text ('size', 'nesting', 'timeout' or 'error').
 * @returns {Promise<{ text: string, skipped: '' | 'size' | 'nesting' | 'timeout' | 'error' }>}
 */
function convertHtml(html, { timeoutMs = TIMEOUT_MS } = {}) {
  const source = slim(String(html ?? ''));
  const skipped = refusal(source);
  if (skipped) return Promise.resolve({ text: '', skipped });
  if (!source.trim()) return Promise.resolve({ text: '', skipped: '' });
  return new Promise(resolve => {
    let worker;
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Ending it is what stops a conversion that is still running.
      if (worker) void worker.terminate().catch(() => {});
      resolve(result);
    };
    const timer = setTimeout(() => finish({ text: '', skipped: 'timeout' }), timeoutMs);
    try {
      worker = new Worker(__filename, { workerData: { task: TASK, html: source }, resourceLimits: { maxOldGenerationSizeMb: 256, stackSizeMb: 4 }, stdout: true, stderr: true });
    } catch { finish({ text: '', skipped: 'error' }); return; }
    worker.once('message', message => finish(message && typeof message.text === 'string' && !message.skipped ? { text: message.text, skipped: '' } : { text: '', skipped: 'error' }));
    worker.once('error', () => finish({ text: '', skipped: 'error' }));
    worker.once('exit', () => finish({ text: '', skipped: 'error' }));
  });
}

if (!isMainThread && workerData && workerData.task === TASK) parentPort.postMessage(htmlToText(workerData.html));

module.exports = { MAX_HTML_CHARS, MAX_NESTING, TIMEOUT_MS, nestingDepth, htmlToText, convertHtml };
