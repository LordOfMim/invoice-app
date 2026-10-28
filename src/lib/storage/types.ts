import type { PersistedDataV1 } from "@/lib/domain";

export type StorageAdapter = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  /** Accept an immutable snapshot for background persistence, or throw before publication. */
  persistData?(data: PersistedDataV1, previous: PersistedDataV1 | null): void;
};
