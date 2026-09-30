import { credentialRef, parseCredentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { createAutoDetectAdapter } from './providers/auto-detect.ts'
import { getBuiltinAdapters } from './providers/index.ts'
import { accountSchema, quotaDomain } from './domain.ts'
import type { Config } from './config.ts'
import type { AccountBalance, AccountState, AccountView, MonitoredAccount, ProviderInfo, QuotaSnapshot } from './types.ts'

type QuotaDomain = Domain<typeof quotaDomain>

const adapters = new Map(getBuiltinAdapters().map(adapter => [adapter.id, adapter]))
const providers: ProviderInfo[] = [...adapters.values()].map(({ id, label, kind }) => ({ id, label, kind }))

/** Errors that mean "no usable credential is configured", not "the credential was rejected". */
const UNCONFIGURED_ERROR = /尚未配置|未包含可用/
/** Errors that mean the provider rejected, or the grant no longer carries, valid authorization. */
const AUTH_ERROR = /授权|令牌|HTTP 40[13]\b|login|expired|unauthori[sz]ed/i

/** Resolve per-provider source without sending secret values to the renderer. */
export async function resolveAccountCredential(credentials: CredentialProvider, account: MonitoredAccount): Promise<{ token: string; accountId?: string }> {
  if (account.source.type === 'reference') {
    const resolved = await credentials.resolve(credentialRef(account.source.ref))
    if (!resolved) throw new Error(`凭据引用 ${account.source.ref} 尚未配置`)
    return { token: resolved.value }
  }
  const record = await credentials.readRecord(parseCredentialKey(account.source.key))
  if (!record) throw new Error('账户凭据已移除，请重新授权')
  if (record.kind === 'api-key') {
    if (!record.key) throw new Error('账户凭据未包含可用的 API Key')
    return { token: record.key }
  }
  const grant = record.payload
  if (typeof grant !== 'object' || grant === null || Array.isArray(grant)) throw new Error('账户授权记录格式不可用')
  const payload = grant as Record<string, unknown>
  const token = payload.access
  if (typeof token !== 'string' || token.length === 0) throw new Error('账户授权缺少访问令牌')
  const expires = payload.expires
  if (typeof expires === 'number' && expires <= Date.now() + 60_000) throw new Error('账户授权已过期，请在 Harness 中重新登录')
  const accountId = payload.accountId ?? payload.account_id
  return { token, ...(typeof accountId === 'string' ? { accountId } : {}) }
}

/** Account health preserves the last successful balance when a refresh fails. */
export function accountState(account: MonitoredAccount, result: AccountBalance | undefined, error: string | undefined, config: Config): AccountState {
  if (!account.enabled) return 'paused'
  if (error) return UNCONFIGURED_ERROR.test(error) ? 'unconfigured' : AUTH_ERROR.test(error) ? 'auth' : 'stale'
  if (!result) return 'loading'
  if (result.windows.some(window => window.usedPercent >= (account.alertPercent ?? config.alertPercent))) return 'low'
  // A balance next to quota windows (Claude extra usage, Kimi booster wallet) is auxiliary and
  // must not flag the whole subscription unless the account sets its own low-balance threshold.
  const balanceIsPrimary = result.windows.length === 0 || account.lowBalance !== undefined
  if (balanceIsPrimary && result.balance !== undefined && result.balance.amount <= (account.lowBalance ?? config.lowBalance)) return 'low'
  return 'ok'
}

/** Host-owned polling state and durable monitor configuration. */
export class QuotaMonitor {
  private readonly views = new Map<string, AccountView>()
  private refreshing = false
  private refreshedAt: number | undefined
  private pending: Promise<void> | undefined
  private pendingIsFull = false
  private readonly detected = new Map<string, ReturnType<typeof createAutoDetectAdapter>>()
  private readonly stop = new AbortController()

  constructor(private readonly credentials: CredentialProvider, private readonly domain: QuotaDomain, private readonly config: Config, private readonly fetchImpl: typeof fetch = fetch) {}

  async listAccounts(): Promise<MonitoredAccount[]> {
    const saved = [...this.domain.table('accounts').entries()].map(([, account]) => account)
    const known = new Set(saved.map(account => account.id))
    const discovered = await this.credentials.listRecords()
    for (const entry of discovered) {
      if (!entry.key.startsWith('llm-pi-ai/')) continue
      const providerId = entry.key.slice('llm-pi-ai/'.length)
      if (!adapters.has(providerId)) continue
      const id = `record:${providerId}`
      if (known.has(id)) continue
      const adapter = adapters.get(providerId)!
      saved.push({ id, providerId, label: adapter.label, kind: adapter.kind,
        source: { type: 'record', key: entry.key }, enabled: true })
    }
    return saved.sort((left, right) => left.label.localeCompare(right.label))
  }

  async snapshot(): Promise<QuotaSnapshot> {
    const accounts = await this.listAccounts()
    const live = new Set(accounts.map(account => account.id))
    for (const id of this.views.keys()) if (!live.has(id)) this.views.delete(id)
    return { accounts: accounts.map(account => {
      const previous = this.views.get(account.id)
      const error = previous?.error
      return { account, state: accountState(account, previous?.result, error, this.config),
        ...(previous?.result ? { result: previous.result } : {}),
        ...(error ? { error } : {}),
        ...(previous?.attemptedAt ? { attemptedAt: previous.attemptedAt } : {}) }
    }), ...(this.refreshedAt ? { refreshedAt: this.refreshedAt } : {}),
    providers, defaults: { alertPercent: this.config.alertPercent, lowBalance: this.config.lowBalance },
    refreshing: this.refreshing, intervalMinutes: this.config.intervalMinutes }
  }

  async refresh(id?: string): Promise<QuotaSnapshot> {
    if (this.stop.signal.aborted) throw new Error('额度监控已停止')
    // A full refresh already in flight covers another full request. Anything else waits its turn
    // so a scoped refresh never swallows a full one (and vice versa).
    if (id === undefined && this.pendingIsFull && this.pending) {
      await this.pending.catch(() => {})
      return this.snapshot()
    }
    while (this.pending) await this.pending.catch(() => {})
    if (this.stop.signal.aborted) throw new Error('额度监控已停止')
    this.pendingIsFull = id === undefined
    this.pending = this.refreshNow(id).finally(() => { this.pending = undefined })
    await this.pending
    return this.snapshot()
  }

  async dispose(): Promise<void> {
    this.stop.abort()
    await this.pending?.catch(() => {})
  }

  private async refreshNow(id?: string): Promise<void> {
    this.refreshing = true
    try {
      const accounts = (await this.listAccounts()).filter(account => account.enabled && (id === undefined || account.id === id))
      let next = 0
      const workers = Array.from({ length: Math.min(this.config.maxConcurrent, accounts.length) }, async () => {
        while (next < accounts.length) {
          const account = accounts[next++]!
          await this.query(account)
        }
      })
      await Promise.all(workers)
      if (id === undefined) this.refreshedAt = Date.now()
    } finally { this.refreshing = false }
  }

  private async query(account: MonitoredAccount): Promise<void> {
    const before = this.views.get(account.id)
    const attemptedAt = Date.now()
    try {
      const credential = await resolveAccountCredential(this.credentials, account)
      const adapter = adapters.get(account.providerId)
        ?? this.detected.get(account.id)
        ?? createAutoDetectAdapter(account.id)
      if (!adapters.has(account.providerId)) this.detected.set(account.id, adapter)
      const result = await adapter.fetch({ token: credential.token, accountId: credential.accountId,
        baseUrl: account.baseUrl, options: { region: account.region },
        signal: AbortSignal.any([AbortSignal.timeout(this.config.requestTimeoutMs), this.stop.signal]), fetchImpl: this.fetchImpl })
      this.views.set(account.id, { account, state: accountState(account, result, undefined, this.config), result, attemptedAt })
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause)
      this.views.set(account.id, { account, state: accountState(account, before?.result, error, this.config),
        ...(before?.result ? { result: before.result } : {}), error, attemptedAt })
    }
  }

  async save(input: unknown): Promise<QuotaSnapshot> {
    const account = accountSchema.parse(input)
    if (account.kind === 'relay' && adapters.has(account.providerId)) {
      throw new Error('中转站请使用自定义服务商 ID，以便探测中转站余额接口')
    }
    if (!adapters.has(account.providerId) && !account.baseUrl) {
      throw new Error('此服务商需要服务地址来探测余额接口')
    }
    if (account.source.type === 'record') {
      if (!adapters.has(account.providerId) || account.source.key !== `llm-pi-ai/${account.providerId}` || account.id !== `record:${account.providerId}`) {
        throw new Error('只能配置该服务商已发现的 Harness 凭据记录')
      }
    } else if (!account.id.startsWith('account:')) {
      throw new Error('自定义连接 ID 必须以 account: 开头')
    }
    await this.domain.table('accounts').put(account.id, account)
    this.detected.delete(account.id)
    if (account.enabled) await this.refresh(account.id)
    return this.snapshot()
  }

  async remove(id: string): Promise<QuotaSnapshot> {
    // Discovered Harness records remain discoverable; an override disables monitoring.
    if (id.startsWith('record:')) {
      const original = (await this.listAccounts()).find(account => account.id === id)
      if (original) await this.domain.table('accounts').put(id, { ...original, enabled: false })
    } else {
      await this.domain.table('accounts').delete(id)
    }
    this.views.delete(id)
    return this.snapshot()
  }
}
