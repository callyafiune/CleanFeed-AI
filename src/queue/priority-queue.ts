interface HeapEntry<T> {
  item: T;
  sequence: number;
}

/** A max-heap whose insertion sequence makes ties deterministic. */
export class PriorityQueue<T> {
  private readonly entries: HeapEntry<T>[] = [];
  private sequence = 0;

  constructor(private readonly compare: (left: T, right: T) => number) {}

  get size(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries.length = 0;
  }

  peek(): T | undefined {
    return this.entries[0]?.item;
  }

  push(item: T): void {
    this.entries.push({ item, sequence: this.sequence++ });
    this.bubbleUp(this.entries.length - 1);
  }

  pop(): T | undefined {
    const first = this.entries[0];
    const last = this.entries.pop();
    if (!first) {
      return undefined;
    }
    if (last && this.entries.length > 0) {
      this.entries[0] = last;
      this.bubbleDown(0);
    }
    return first.item;
  }

  remove(matches: (item: T) => boolean): T | undefined {
    const index = this.entries.findIndex((entry) => matches(entry.item));
    if (index < 0) {
      return undefined;
    }

    const removed = this.entries[index];
    const last = this.entries.pop();
    if (last && index < this.entries.length) {
      this.entries[index] = last;
      this.bubbleUp(index);
      this.bubbleDown(index);
    }
    return removed.item;
  }

  values(): T[] {
    return [...this.entries]
      .sort((left, right) => this.compareEntries(left, right))
      .map((entry) => entry.item);
  }

  private bubbleUp(index: number): void {
    let child = index;
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2);
      if (this.compareEntries(this.entries[child], this.entries[parent]) >= 0) {
        break;
      }
      [this.entries[child], this.entries[parent]] = [
        this.entries[parent],
        this.entries[child],
      ];
      child = parent;
    }
  }

  private bubbleDown(index: number): void {
    let parent = index;
    while (true) {
      const left = parent * 2 + 1;
      const right = left + 1;
      let best = parent;

      if (
        left < this.entries.length &&
        this.compareEntries(this.entries[left], this.entries[best]) < 0
      ) {
        best = left;
      }
      if (
        right < this.entries.length &&
        this.compareEntries(this.entries[right], this.entries[best]) < 0
      ) {
        best = right;
      }
      if (best === parent) {
        return;
      }
      [this.entries[parent], this.entries[best]] = [
        this.entries[best],
        this.entries[parent],
      ];
      parent = best;
    }
  }

  private compareEntries(left: HeapEntry<T>, right: HeapEntry<T>): number {
    const compared = this.compare(left.item, right.item);
    return compared !== 0 ? compared : left.sequence - right.sequence;
  }
}
