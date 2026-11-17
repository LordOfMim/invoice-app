'use strict';
// Pure helpers shared by the window, the main process and the tests: no Node, Electron or browser APIs.
//
// Attachments, logos and the signature image are files in "attachments/" beside the data file. The JSON keeps only
// a reference { id, type, size }; id is the SHA-256 of the bytes, so equal files are stored once. Data written by
// older versions carries the bytes as base64 data URLs in the same records; these helpers find them and swap them
// for references once the files are safely stored.

const FILE_ID = /^[a-f0-9]{64}$/;
// A media type as it may stand in a data URL: printable ASCII without spaces and commas.
const FILE_TYPE = /^[\x21-\x2b\x2d-\x7e]{1,255}$/;
const DATA_URL_PREFIX = /^data:([^,]*?);base64,/;
const DEFAULT_TYPE = 'application/octet-stream';

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isFileRef(value) {
  return isRecord(value) && typeof value.id === 'string' && FILE_ID.test(value.id)
    && typeof value.type === 'string' && FILE_TYPE.test(value.type)
    && Number.isSafeInteger(value.size) && value.size >= 0;
}

/** True for a base64 data URL that carries content. Anything else stays in the JSON as it is. */
function isEmbeddedFile(value) {
  if (typeof value !== 'string' || !value.startsWith('data:')) return false;
  const prefix = DATA_URL_PREFIX.exec(value);
  return !!prefix && value.length > prefix[0].length;
}

/** Split a base64 data URL into its media type and base64 text; null when it is not one. */
function splitDataUrl(value) {
  if (!isEmbeddedFile(value)) return null;
  const prefix = DATA_URL_PREFIX.exec(value);
  const type = FILE_TYPE.test(prefix[1]) ? prefix[1] : DEFAULT_TYPE;
  return { type, base64: value.slice(prefix[0].length) };
}

function documentsOf(data) {
  return [
    ...(Array.isArray(data.invoices) ? data.invoices : []),
    ...(Array.isArray(data.quotes) ? data.quotes : []),
  ].filter(isRecord);
}

/** Every distinct base64 data URL in the places where the app stores files. */
function embeddedFiles(data) {
  const found = new Set();
  if (!isRecord(data)) return [];
  if (isRecord(data.settings) && isEmbeddedFile(data.settings.defaultLogoDataUrl)) found.add(data.settings.defaultLogoDataUrl);
  for (const document of documentsOf(data)) {
    if (isEmbeddedFile(document.logoDataUrl)) found.add(document.logoDataUrl);
    for (const attachment of Array.isArray(document.attachments) ? document.attachments : []) {
      if (isRecord(attachment) && isEmbeddedFile(attachment.dataUrl)) found.add(attachment.dataUrl);
    }
  }
  return [...found];
}

function without(record, key) {
  const copy = { ...record };
  delete copy[key];
  return copy;
}

function externalizeDocument(document, refs) {
  if (!isRecord(document)) return document;
  let next = document;
  const logo = refs.get(document.logoDataUrl);
  if (logo) next = { ...without(next, 'logoDataUrl'), logoFile: logo };
  if (Array.isArray(document.attachments)) {
    let changed = false;
    const attachments = document.attachments.map((attachment) => {
      const ref = isRecord(attachment) ? refs.get(attachment.dataUrl) : undefined;
      if (!ref) return attachment;
      changed = true;
      return { ...without(attachment, 'dataUrl'), file: ref };
    });
    if (changed) next = { ...next, attachments };
  }
  return next;
}

function externalizeList(list, refs) {
  if (!Array.isArray(list)) return list;
  let changed = false;
  const next = list.map((document) => {
    const result = externalizeDocument(document, refs);
    if (result !== document) changed = true;
    return result;
  });
  return changed ? next : list;
}

/**
 * Replace stored data URLs by their references. `refs` maps a data URL to the reference of its stored file; a data
 * URL without an entry stays embedded. Untouched records keep their identity, so the change is saved as a small
 * patch. Returns the same object when nothing changed.
 */
function externalizeFiles(data, refs) {
  if (!isRecord(data) || !refs || refs.size === 0) return data;
  let next = data;
  const logo = isRecord(data.settings) ? refs.get(data.settings.defaultLogoDataUrl) : undefined;
  if (logo) next = { ...next, settings: { ...without(data.settings, 'defaultLogoDataUrl'), defaultLogoFile: logo } };
  for (const key of ['invoices', 'quotes']) {
    const list = externalizeList(data[key], refs);
    if (list !== data[key]) next = { ...next, [key]: list };
  }
  return next;
}

/** The ids of all files the data refers to, each once. */
function referencedFileIds(data) {
  const ids = new Set();
  if (!isRecord(data)) return [];
  if (isRecord(data.settings) && isFileRef(data.settings.defaultLogoFile)) ids.add(data.settings.defaultLogoFile.id);
  for (const document of documentsOf(data)) {
    if (isFileRef(document.logoFile)) ids.add(document.logoFile.id);
    for (const attachment of Array.isArray(document.attachments) ? document.attachments : []) {
      if (isRecord(attachment) && isFileRef(attachment.file)) ids.add(attachment.file.id);
    }
  }
  return [...ids];
}

module.exports = { DEFAULT_TYPE, FILE_ID, FILE_TYPE, embeddedFiles, externalizeFiles, isEmbeddedFile, isFileRef, referencedFileIds, splitDataUrl };
