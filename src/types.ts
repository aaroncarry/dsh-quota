/** Provider output normalized for dashboard and quick view. */
export interface UsageWindow {
  label: string
  usedPercent: number
  resetsAt?: number
  detail?: string
}

export interface MoneyBalance {
  amount: number
  currency: string
  note?: string
}

export interface AccountBalance {
  providerId: string
  label: string
  plan?: string
  windows: UsageWindow[]
  balance?: MoneyBalance
  notes: string[]
  fetchedAt: number
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>
export interface ProviderFetchArgs {
  token: string
  accountId?: string
  baseUrl?: string
  signal?: AbortSignal
  fetchImpl: FetchLike
  options: ProviderConfig
}
export interface ProviderAdapter {
  id: string
  /** Display name, also used for accounts discovered from Harness credentials. */
  label: string
  /** Built-in providers are either subscription quotas or pay-as-you-go balances. */
  kind: Exclude<AccountKind, 'relay'>
  fetch(args: ProviderFetchArgs): Promise<AccountBalance>
}
export interface ProviderConfig { region?: string }

export type AccountKind = 'subscription' | 'api' | 'relay'
export type AccountSource =
  | { type: 'record'; key: string }
  | { type: 'reference'; ref: string }

export interface MonitoredAccount {
  id: string
  providerId: string
  label: string
  kind: AccountKind
  source: AccountSource
  enabled: boolean
  baseUrl?: string
  region?: 'global' | 'cn' | 'auto'
  alertPercent?: number
  lowBalance?: number
}

export type AccountState = 'ok' | 'low' | 'stale' | 'auth' | 'paused' | 'unconfigured' | 'loading'
export interface AccountView {
  account: MonitoredAccount
  state: AccountState
  result?: AccountBalance
  error?: string
  attemptedAt?: number
}
/** Built-in provider metadata sent to the browser for the connection form. */
export interface ProviderInfo {
  id: string
  label: string
  kind: ProviderAdapter['kind']
}
/** Global alert thresholds applied to accounts without their own override. */
export interface AlertDefaults {
  alertPercent: number
  lowBalance: number
}
export interface QuotaSnapshot {
  accounts: AccountView[]
  providers: ProviderInfo[]
  defaults: AlertDefaults
  refreshedAt?: number
  refreshing: boolean
  intervalMinutes: number
}
