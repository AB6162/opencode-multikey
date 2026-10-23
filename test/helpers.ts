import type { Schema } from "effect"
import type { StorageDomain } from "@opencode/plugin/promise/storage"

export class MemoryStorage implements StorageDomain {
  private readonly data = new Map<string, Schema.Json>()

  async get(key: string): Promise<Schema.Json | undefined> {
    return this.data.get(key)
  }

  async set(key: string, value: Schema.Json): Promise<void> {
    this.data.set(key, value)
  }

  async remove(key: string): Promise<void> {
    this.data.delete(key)
  }

  async scan(options: {
    prefix: string
    after?: string
    limit?: number
  }): Promise<{
    entries: readonly { key: string; value: Schema.Json }[]
    next?: string
  }> {
    const limit = options.limit ?? 100
    const keys = [...this.data.keys()]
      .filter((key) => key.startsWith(options.prefix))
      .filter((key) => (options.after === undefined ? true : key > options.after))
      .sort()
    const entries = keys.slice(0, limit).map((key) => ({
      key,
      value: this.data.get(key) as Schema.Json,
    }))
    return keys.length > limit
      ? { entries, next: entries[entries.length - 1]?.key }
      : { entries }
  }

  has(key: string): boolean {
    return this.data.has(key)
  }

  dump(): Record<string, Schema.Json> {
    return Object.fromEntries(this.data)
  }
}
