import assert from 'node:assert/strict'
import { test } from 'node:test'
import { accountSchema } from '../src/domain.ts'
import { accountState } from '../src/monitor.ts'
import { codexAdapter } from '../src/providers/codex.ts'
import { anthropicAdapter } from '../src/providers/anthropic.ts'
import { deepseekAdapter } from '../src/providers/deepseek.ts'
import { createAutoDetectAdapter } from '../src/providers/auto-detect.ts'
import type { Config } from '../src/config.ts'
import type { AccountBalance, MonitoredAccount, ProviderFetchArgs } from '../src/types.ts'

const config: Config = { intervalMinutes: 5, requestTimeoutMs: 15000, maxConcurrent: 4, alertPercent: 80, lowBalance: 5 }
const account: MonitoredAccount = { id: 'record:deepseek', providerId: 'deepseek', label: 'DeepSeek', kind: 'api', source: { type: 'record', key: 'llm-pi-ai/deepseek' }, enabled: true }

function args(reply: (url: string, init?: RequestInit) => Response | Promise<Response>): ProviderFetchArgs {
  return { token: 'secret-example', options: {}, fetchImpl: async (url, init) => reply(url, init) }
}

test('DeepSeek displays the returned prepaid balance and sends the key only in Host fetch headers', async () => {
  const result = await deepseekAdapter.fetch(args((url, init) => {
    assert.equal(url, 'https://api.deepseek.com/user/balance')
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer secret-example')
    return Response.json({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '12.50', granted_balance: '2.00' }] })
  }))
  assert.deepEqual(result.balance, { amount: 12.5, currency: 'CNY' })
  assert.equal(JSON.stringify(result).includes('secret-example'), false)
  assert.equal(accountState(account, result, undefined, config), 'ok')
  assert.equal(accountState(account, { ...result, balance: { amount: 3, currency: 'CNY' } }, undefined, config), 'low')
})

test('subscription windows remain usable when a provider omits the aggregate bucket', async () => {
  const claude = await anthropicAdapter.fetch(args(() => Response.json({ seven_day: null, seven_day_sonnet: { utilization: 83, resets_at: '2026-10-01T00:00:00Z' } })))
  assert.equal(claude.windows[0]?.label, 'weekly-sonnet')
  assert.equal(claude.windows[0]?.usedPercent, 83)
  assert.equal(accountState({ ...account, kind: 'subscription' }, claude, undefined, config), 'low')
  const codex = await codexAdapter.fetch(args(() => Response.json({ plan_type: 'plus', rate_limit: { primary_window: { used_percent: 35, limit_window_seconds: 18000, reset_at: 1790812800 } } })))
  assert.equal(codex.plan, 'Plus')
  assert.equal(codex.windows[0]?.label, '5h')
  assert.equal(codex.windows[0]?.usedPercent, 35)
})

test('gateway auto-detection reads a New API balance and retains its selected endpoint', async () => {
  const seen: string[] = []
  const adapter = createAutoDetectAdapter('my-relay')
  const query = args(url => {
    seen.push(url)
    if (url.endsWith('/dashboard/billing/subscription')) return Response.json({ hard_limit_usd: 20 })
    if (url.endsWith('/dashboard/billing/usage')) return Response.json({ total_usage: 500 })
    return new Response('', { status: 404 })
  })
  query.baseUrl = 'https://relay.example.com/v1'
  const result = await adapter.fetch(query)
  assert.equal(result.balance?.amount, 15)
  assert.equal(result.balance?.currency, 'USD')
  assert.equal(seen.some(url => url.endsWith('/dashboard/billing/subscription')), true)
  seen.length = 0
  await adapter.fetch(query)
  assert.equal(seen[0]?.endsWith('/dashboard/billing/subscription'), true)
})

test('monitor configuration rejects secret values and preserves the last result as stale', () => {
  assert.equal(accountSchema.safeParse({ ...account, source: { type: 'reference', ref: 'MY_API_KEY' } }).success, true)
  assert.equal(accountSchema.safeParse({ ...account, source: { type: 'reference', ref: 'MY_API_KEY', key: 'secret' } }).success, false)
  assert.equal(accountSchema.safeParse({ ...account, source: { type: 'reference', ref: 'bad ref' } }).success, false)
  const result: AccountBalance = { providerId: 'deepseek', label: 'DeepSeek', windows: [], balance: { amount: 10, currency: 'CNY' }, notes: [], fetchedAt: Date.now() }
  assert.equal(accountState(account, result, 'HTTP 503', config), 'stale')
  assert.equal(accountState(account, result, 'HTTP 401', config), 'auth')
  assert.equal(accountState({ ...account, enabled: false }, result, undefined, config), 'paused')
})
