export type TaskState =
  "queued" | "running" | "completed" | "cancelled" | "expired" | "failed";

export interface RegisteredTask<T> {
  task: T;
  state: TaskState;
}

/** Tracks request lifecycle independently from the queue implementation. */
export class TaskRegistry<T extends { id: string }> {
  private readonly records = new Map<string, RegisteredTask<T>>();

  add(task: T, state: TaskState = "queued"): void {
    if (this.records.has(task.id)) {
      throw new Error(`Task already registered: ${task.id}`);
    }
    this.records.set(task.id, { task, state });
  }

  get(id: string): RegisteredTask<T> | undefined {
    return this.records.get(id);
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  setState(id: string, state: TaskState): void {
    const record = this.records.get(id);
    if (record) {
      record.state = state;
    }
  }

  delete(id: string): void {
    this.records.delete(id);
  }

  clear(): void {
    this.records.clear();
  }

  entries(): IterableIterator<[string, RegisteredTask<T>]> {
    return this.records.entries();
  }
}
