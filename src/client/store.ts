import { useEffect, useSyncExternalStore } from 'react'
import type { MonitoredAccount, QuotaSnapshot } from '../types.ts'

const initial: QuotaSnapshot = {
  accounts: [], providers: [], defaults: { alertPercent: 80, lowBalance: 5 }, refreshing: false, intervalMinutes: 5,
}
/** Tolerate a Host that predates newer snapshot fields. */
const normalize = (snapshot: QuotaSnapshot): QuotaSnapshot => ({ ...initial, ...snapshot })
type Mutation = { action: 'refresh'; id?: string } | { action: 'save'; account: MonitoredAccount } | { action: 'remove'; id: string }

/** Browser mirror of Host results; only account metadata and balances cross the route. */
export class QuotaStore {
  private value = initial
  private listeners = new Set<() => void>()
  private interval: number | undefined
  private lastLoaded = 0
  private pending: Promise<void> | undefined
  private error: string | undefined

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    if (this.listeners.size === 1) {
      void this.load()
      this.interval = window.setInterval(() => { void this.load() }, 30_000)
    }
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0 && this.interval !== undefined) {
        clearInterval(this.interval)
        this.interval = undefined
      }
    }
  }

  readonly getSnapshot = (): QuotaSnapshot => this.value
  getError(): string | undefined { return this.error }

  private publish(next: QuotaSnapshot): void {
    this.value = next
    for (const listener of this.listeners) listener()
  }

  async load(force = false): Promise<void> {
    if (this.pending) return this.pending
    if (!force && Date.now() - this.lastLoaded < 5_000) return
    this.pending = (async () => {
      try {
        const response = await fetch('/api/quota', { credentials: 'same-origin', cache: 'no-store' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json() as QuotaSnapshot
        this.lastLoaded = Date.now()
        this.error = undefined
        this.publish(normalize(data))
      } catch (cause) {
        this.error = cause instanceof Error ? cause.message : String(cause)
        this.publish({ ...this.value })
      } finally { this.pending = undefined }
    })()
    return this.pending
  }

  async mutate(action: Mutation): Promise<void> {
    const refreshing = action.action === 'refresh'
    if (refreshing) this.publish({ ...this.value, refreshing: true })
    try {
      const response = await fetch('/api/quota', { method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(action) })
      // A gateway error page is not JSON; keep the HTTP status instead of a parse failure.
      const data = await response.json().catch(() => undefined) as QuotaSnapshot | { error?: string } | undefined
      if (!response.ok) throw new Error(data && 'error' in data && data.error ? data.error : `HTTP ${response.status}`)
      this.lastLoaded = Date.now()
      this.error = undefined
      this.publish(normalize(data as QuotaSnapshot))
    } catch (cause) {
      if (refreshing) this.publish({ ...this.value, refreshing: false })
      throw cause
    }
  }

  dispose(): void {
    if (this.interval !== undefined) clearInterval(this.interval)
    this.interval = undefined
    this.listeners.clear()
  }
}

/** Subscribe to the active Host snapshot and refresh when this surface mounts. */
export function useQuota(store: QuotaStore): QuotaSnapshot {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  useEffect(() => { void store.load() }, [store])
  return snapshot
}
