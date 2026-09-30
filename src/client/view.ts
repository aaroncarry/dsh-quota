/** Pure presentation helpers shared by the dashboard page and the composer quick view. */
import type { AccountState, AccountView, AlertDefaults, MonitoredAccount, UsageWindow } from '../types.ts'
import type { zh } from './locales.ts'

export type CopyKey = keyof typeof zh
export type Copy = (key: CopyKey) => string
export type Level = 'ok' | 'warn' | 'danger'

/** Usage at or above this share is shown as critical regardless of the account's alert threshold. */
const DANGER_PERCENT = 95
const ATTENTION_STATES: readonly AccountState[] = ['low', 'auth', 'stale', 'unconfigured']
/** Providers whose endpoint depends on the account's region setting. */
const REGION_PROVIDERS = new Set(['minimax', 'minimax-cn', 'zai'])

export const supportsRegion = (providerId: string): boolean => REGION_PROVIDERS.has(providerId)

export function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export function percentage(value: number): number {
  return Math.max(0, Math.min(100, value))
}

export function leftPercent(usedPercent: number): number {
  return Math.round(100 - percentage(usedPercent))
}

export function alertPercentOf(account: MonitoredAccount, defaults: AlertDefaults): number {
  return account.alertPercent ?? defaults.alertPercent
}

export function usageLevel(usedPercent: number, alertPercent: number): Level {
  return usedPercent >= DANGER_PERCENT ? 'danger' : usedPercent >= alertPercent ? 'warn' : 'ok'
}

export function isAttention(view: AccountView): boolean {
  return ATTENTION_STATES.includes(view.state)
}

/** The window closest to exhaustion; it represents a subscription at a glance. */
export function tightestWindow(view: AccountView): UsageWindow | undefined {
  return view.result?.windows.reduce<UsageWindow | undefined>(
    (worst, window) => (worst === undefined || window.usedPercent > worst.usedPercent ? window : worst), undefined)
}

export function money(amount: number, currency: string): string {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount) }
  catch { return `${currency} ${amount.toFixed(2)}` }
}

/** Absolute local time, used for tooltips and footers. */
export function when(time: number | undefined): string {
  if (time === undefined) return '—'
  return new Intl.DateTimeFormat(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(time)
}

/** "in 3 hours" / "5 hours ago" in the UI locale; minutes below 90 minutes, then hours, then days. */
export function relativeTime(time: number, now = Date.now()): string {
  const diff = time - now
  const minutes = Math.abs(diff) / 60_000
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' })
  if (minutes < 1) return formatter.format(0, 'second')
  if (minutes < 90) return formatter.format(Math.round(diff / 60_000), 'minute')
  if (minutes < 48 * 60) return formatter.format(Math.round(diff / 3_600_000), 'hour')
  return formatter.format(Math.round(diff / 86_400_000), 'day')
}

const WINDOW_KEYS: Record<string, CopyKey> = {
  '5h': 'win5h', weekly: 'winWeekly', monthly: 'winMonthly', daily: 'winDaily', rolling: 'winRolling',
  premium: 'winPremium', chat: 'winChat', plan: 'winPlan', 'AI credits': 'winCredits',
  'weekly-opus': 'winWeeklyOpus', 'weekly-sonnet': 'winWeeklySonnet', 'weekly-oauth-apps': 'winWeeklyApps',
}

/** Adapters emit English window labels; translate the known ones, including "<model> weekly". */
export function windowName(label: string, copy: Copy): string {
  const direct = WINDOW_KEYS[label]
  if (direct) return copy(direct)
  const space = label.lastIndexOf(' ')
  const suffix = space > 0 ? WINDOW_KEYS[label.slice(space + 1)] : undefined
  return suffix ? `${label.slice(0, space)} ${copy(suffix)}` : label
}

/** Replace a bare provider HTTP failure with localized text; anything more specific stays verbatim. */
export function friendlyError(message: string, copy: Copy): string {
  const status = /(?:returned )?HTTP (\d{3})$/.exec(message)
  return status ? `${copy('providerHttp')} ${status[1]}` : message
}

/** Localize the structured remainders adapters emit ("60 of 100 left", "unlimited"); others stay verbatim. */
export function detailText(detail: string, copy: Copy): string {
  const counts = /^(\d+(?:\.\d+)?) of (\d+(?:\.\d+)?) left$/.exec(detail)
  if (counts) return `${copy('left')} ${counts[1]} / ${counts[2]}`
  return detail === 'unlimited' ? copy('unlimited') : detail
}

/** Stable 0-359 hue so each provider keeps its own tint without hard-coded brand colors. */
export function hueOf(id: string): number {
  let hue = 0
  for (const char of id) hue = (hue * 31 + char.charCodeAt(0)) % 360
  return hue
}

export interface Metric {
  /** Headline figure: remaining percentage or money. */
  value: string
  /** What the figure measures. */
  caption: string
  /** Compact form for the composer pill. */
  short: string
  level: Level
}

/** One headline figure per account: the tightest quota window, else the balance. */
export function metricOf(view: AccountView, defaults: AlertDefaults, copy: Copy): Metric | undefined {
  const result = view.result
  const window = tightestWindow(view)
  if (window) {
    const value = `${leftPercent(window.usedPercent)}%`
    const name = windowName(window.label, copy)
    return { value, caption: `${name} ${copy('left')}`, short: `${name} ${value}`, level: usageLevel(window.usedPercent, alertPercentOf(view.account, defaults)) }
  }
  if (result?.balance) {
    const value = money(result.balance.amount, result.balance.currency)
    const level: Level = view.state === 'low' ? (result.balance.amount <= 0 ? 'danger' : 'warn') : 'ok'
    return { value, caption: view.account.kind === 'api' ? copy('keyQuota') : copy('available'), short: value, level }
  }
  return undefined
}

export interface Summary {
  monitoring: number
  paused: number
  subscriptions: number
  gateways: number
  /** The subscription with the least quota left. */
  tightest?: { label: string; left: number }
  /** Summed balance per currency across API keys and gateways. */
  balances: { currency: string; amount: number }[]
  attention: Partial<Record<AccountState, number>>
  attentionTotal: number
}

export function summarize(accounts: AccountView[]): Summary {
  const summary: Summary = { monitoring: 0, paused: 0, subscriptions: 0, gateways: 0, balances: [], attention: {}, attentionTotal: 0 }
  const totals = new Map<string, number>()
  let worst = -1
  for (const view of accounts) {
    if (view.account.enabled) summary.monitoring++
    else summary.paused++
    if (view.account.kind === 'subscription') {
      summary.subscriptions++
      const window = tightestWindow(view)
      if (window && view.account.enabled && window.usedPercent > worst) {
        worst = window.usedPercent
        summary.tightest = { label: view.account.label, left: leftPercent(window.usedPercent) }
      }
    } else {
      summary.gateways++
      const balance = view.result?.balance
      if (balance && view.account.enabled) totals.set(balance.currency, (totals.get(balance.currency) ?? 0) + balance.amount)
    }
    if (isAttention(view)) {
      summary.attention[view.state] = (summary.attention[view.state] ?? 0) + 1
      summary.attentionTotal++
    }
  }
  summary.balances = [...totals].map(([currency, amount]) => ({ currency, amount }))
  return summary
}
