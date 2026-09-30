import assert from 'node:assert/strict'
import { test } from 'node:test'
import { en, zh } from '../src/client/locales.ts'
import { detailText, friendlyError, leftPercent, metricOf, relativeTime, summarize, usageLevel, windowName, type Copy } from '../src/client/view.ts'
import type { AccountView, AlertDefaults, MonitoredAccount } from '../src/types.ts'

const defaults: AlertDefaults = { alertPercent: 80, lowBalance: 5 }
const copy: Copy = key => zh[key]
const account = (over: Partial<MonitoredAccount>): MonitoredAccount => ({ id: 'record:x', providerId: 'x', label: 'X', kind: 'subscription', source: { type: 'record', key: 'llm-pi-ai/x' }, enabled: true, ...over })
const view = (over: Partial<Omit<AccountView, 'account'>> & { account?: Partial<MonitoredAccount> }): AccountView => ({ state: 'ok', ...over, account: account(over.account ?? {}) })
const result = (extra: object) => ({ providerId: 'x', label: 'X', windows: [], notes: [], fetchedAt: 1, ...extra })

test('every locale defines the same keys', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
})

test('usage is graded against the account threshold, with a fixed critical level', () => {
  assert.equal(usageLevel(79, 80), 'ok')
  assert.equal(usageLevel(80, 80), 'warn')
  assert.equal(usageLevel(94, 80), 'warn')
  assert.equal(usageLevel(95, 80), 'danger')
  assert.equal(usageLevel(60, 50), 'warn')
  assert.equal(leftPercent(35), 65)
  assert.equal(leftPercent(120), 0)
})

test('the headline metric is the tightest window, falling back to the balance', () => {
  const claude = view({ result: result({ windows: [{ label: '5h', usedPercent: 91 }, { label: 'weekly', usedPercent: 48 }], balance: { amount: 18.4, currency: 'USD' } }) })
  const metric = metricOf(claude, defaults, copy)
  assert.equal(metric?.value, '9%')
  assert.equal(metric?.short, '5 小时 9%')
  assert.equal(metric?.level, 'warn')
  const custom = view({ account: { alertPercent: 95 }, result: claude.result })
  assert.equal(metricOf(custom, defaults, copy)?.level, 'ok')
  const api = view({ account: { kind: 'api' }, state: 'low', result: result({ balance: { amount: 0, currency: 'CNY' } }) })
  assert.equal(metricOf(api, defaults, copy)?.level, 'danger')
  assert.equal(metricOf(view({}), defaults, copy), undefined)
})

test('known window labels and structured details are localized, unknown ones pass through', () => {
  assert.equal(windowName('weekly-sonnet', copy), '每周 Sonnet')
  assert.equal(windowName('MiniMax-M2 rolling', copy), 'MiniMax-M2 滚动')
  assert.equal(windowName('custom thing', copy), 'custom thing')
  assert.equal(detailText('60 of 100 left', copy), '剩余 60 / 100')
  assert.equal(detailText('unlimited', copy), '不限量')
  assert.equal(detailText('something else', copy), 'something else')
  assert.equal(friendlyError('Kimi Coding usage API returned HTTP 401', copy), '服务商接口返回 HTTP 401')
  assert.equal(friendlyError('no balance endpoint detected (new-api: HTTP 502; sub2api: HTTP 404)', copy), 'no balance endpoint detected (new-api: HTTP 502; sub2api: HTTP 404)')
})

test('relative time picks a readable unit', () => {
  const now = Date.UTC(2026, 9, 1, 12)
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' })
  assert.equal(relativeTime(now + 30 * 60_000, now), formatter.format(30, 'minute'))
  assert.equal(relativeTime(now - 5 * 3_600_000, now), formatter.format(-5, 'hour'))
  assert.equal(relativeTime(now + 72 * 3_600_000, now), formatter.format(3, 'day'))
})

test('the summary aggregates balances per currency and counts attention states', () => {
  const summary = summarize([
    view({ account: { id: 'a', label: 'Claude' }, result: result({ windows: [{ label: '5h', usedPercent: 91 }] }), state: 'low' }),
    view({ account: { id: 'b', label: 'Codex' }, result: result({ windows: [{ label: '5h', usedPercent: 35 }] }) }),
    view({ account: { id: 'c', kind: 'api' }, result: result({ balance: { amount: 10, currency: 'CNY' } }) }),
    view({ account: { id: 'd', kind: 'relay' }, result: result({ balance: { amount: 2.5, currency: 'CNY' } }), state: 'stale' }),
    view({ account: { id: 'e', kind: 'api' }, result: result({ balance: { amount: 7, currency: 'USD' } }) }),
    view({ account: { id: 'f', enabled: false }, state: 'paused' }),
    view({ account: { id: 'g', kind: 'api' }, state: 'unconfigured' }),
  ])
  assert.equal(summary.monitoring, 6)
  assert.equal(summary.paused, 1)
  assert.deepEqual(summary.tightest, { label: 'Claude', left: 9 })
  assert.deepEqual(summary.balances, [{ currency: 'CNY', amount: 12.5 }, { currency: 'USD', amount: 7 }])
  assert.deepEqual(summary.attention, { low: 1, stale: 1, unconfigured: 1 })
  assert.equal(summary.attentionTotal, 3)
})
