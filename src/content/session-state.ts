/** Keeps only short-lived, non-identifying content hashes for one tab session. */
export class SessionState {
  private readonly seenHashes = new Set<string>();
  private readonly ignoredElements = new WeakSet<HTMLElement>();

  hasSeen(hash: string): boolean {
    return this.seenHashes.has(hash);
  }

  remember(hash: string): void {
    this.seenHashes.add(hash);
  }

  /** Marks a post so presentation is never re-applied for the rest of the session. */
  ignore(element: HTMLElement): void {
    this.ignoredElements.add(element);
  }

  isIgnored(element: HTMLElement): boolean {
    return this.ignoredElements.has(element);
  }

  clear(): void {
    this.seenHashes.clear();
  }
}
