/** Keeps only short-lived, non-identifying content hashes for one tab session. */
export class SessionState {
  private readonly seenHashes = new Set<string>();

  hasSeen(hash: string): boolean {
    return this.seenHashes.has(hash);
  }

  remember(hash: string): void {
    this.seenHashes.add(hash);
  }

  clear(): void {
    this.seenHashes.clear();
  }
}
