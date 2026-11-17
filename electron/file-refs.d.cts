/** A file kept in "attachments/" beside the data file: SHA-256 of its bytes, media type and size in bytes. */
export type FileRef = { id: string; type: string; size: number };

export function isFileRef(value: unknown): value is FileRef;
/** True for a base64 data URL that carries content. */
export function isEmbeddedFile(value: unknown): value is string;
export function splitDataUrl(value: unknown): { type: string; base64: string } | null;
/** Every distinct base64 data URL in the places where the app stores files. */
export function embeddedFiles(data: unknown): string[];
/** Replace stored data URLs by their references; returns the same object when nothing changed. */
export function externalizeFiles<T>(data: T, refs: ReadonlyMap<string, FileRef>): T;
/** The ids of all files the data refers to, each once. */
export function referencedFileIds(data: unknown): string[];
