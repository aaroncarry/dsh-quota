import assert from 'node:assert/strict'
import { test } from 'node:test'
import { accountSchema } from '../src/domain.ts'
import { describeError } from '../src/errors.ts'
import { accountState, QuotaMonitor } from '../src/monitor.ts'
import { parseTimestamp } from '../src/parse.ts'
import { anthropicAdapter } from '../src/providers/anthropic.ts'
import { createAutoDetectAdapter } from '../src/providers/auto-detect.ts'
import { githubCopilotAdapter } from '../src/providers/github-copilot.ts'
import { kimiCodingAdapter } from '../src/providers/kimi-coding.ts'
import { minimaxAdapter } from '../src/providers/minimax.ts'
import { openrouterAdapter } from '../src/providers/openrouter.ts'
import { zaiAdapter } from '../src/providers/zai.ts'
import type { Config } from '../src/config.ts'
import type { AccountBalance, MonitoredAccount, ProviderFetchArgs } from '../src/types.ts'

const config: Config = { intervalMinutes: 5, requestTimeoutMs: 15000, maxConcurrent: 4, alertPercent: 80, lowBalance: 5 }
const account: MonitoredAccount = { id: 'record:anthropic', providerId: 'anthropic', label: 'Claude', kind: 'subscription', source: { type: 'record', key: 'llm-pi-ai/anthropic' }, enabled: true }

function args(reply: (url: string, init?: RequestInit) => Response | Promise<Response>): ProviderFetchArgs {
  return { token: 'secret-example', options: {}, fetchImpl: async (url, init) => reply(url, init) }
}

test('auto-detected MiniMax derives used percent from the remaining count', async () => {
  const query = args(() => Response.json({ model_remains: [{ model_name: 'MiniMax-M2', current_interval_total_count: 1000, current_interval_remaining: 900 }] }))
  query.baseUrl = 'https://api.minimaxi.com'
  const result = await createAutoDetectAdapter('mm').fetch(query)
  assert.equal(result.windows[0]?.usedPercent, 10)
})

test('credential problems are told apart from provider rejections and transient failures', () => {
  const view = (error: string) => accountState(account, undefined, error, config)
  assert.equal(view('凭据引用 MY_KEY 尚未配置'), 'unconfigured')
  assert.equal(view('账户凭据未包含可用的 API Key'), 'unconfigured')
  assert.equal(view('账户授权已过期，请在 Harness 中重新登录'), 'auth')
  assert.equal(view('账户凭据已移除，请重新授权'), 'auth')
  assert.equal(view('Claude usage API returned HTTP 403'), 'auth')
  assert.equal(view('Claude usage API returned HTTP 4031'), 'stale')
  assert.equal(view('Claude usage API returned HTTP 503'), 'stale')
})

test('a balance next to quota windows only alerts when the account sets its own threshold', () => {
  const result: AccountBalance = {
    providerId: 'anthropic', label: 'Claude', notes: [], fetchedAt: Date.now(),
    windows: [{ label: '5h', usedPercent: 20 }], balance: { amount: 1, currency: 'USD' },
  }
  assert.equal(accountState(account, result, undefined, config), 'ok')
  assert.equal(accountState({ ...account, lowBalance: 2 }, result, undefined, config), 'low')
  const balanceOnly: AccountBalance = { ...result, windows: [] }
  assert.equal(accountState({ ...account, kind: 'api' }, balanceOnly, undefined, config), 'low')
})

test('validation failures are reported as readable Chinese text, not raw Zod JSON', () => {
  const invalid = { ...account, label: '   ', alertPercent: 0, baseUrl: 'file:///etc/passwd' }
  const parsed = accountSchema.safeParse(invalid)
  assert.equal(parsed.success, false)
  if (parsed.success) return
  const message = describeError(parsed.error)
  assert.match(message, /显示名称不能为空/)
  assert.match(message, /已用比例提醒至少为 1/)
  assert.match(message, /http\(s\)/)
  assert.equal(message.includes('"code"'), false)
  assert.match(describeError(new SyntaxError('Unexpected token')), /不是有效的 JSON/)
})

test('numeric-string timestamps are read as epochs', () => {
  assert.equal(parseTimestamp('1790812800'), 1790812800_000)
  assert.equal(parseTimestamp(1790812800_000), 1790812800_000)
  assert.equal(parseTimestamp('2026-10-01T00:00:00Z'), Date.parse('2026-10-01T00:00:00Z'))
  assert.equal(parseTimestamp('soon'), undefined)
})

test('Kimi Coding reports weekly and rolling windows with remaining counts', async () => {
  const result = await kimiCodingAdapter.fetch(args(() => Response.json({
    usage: { limit: '100', used: '40', remaining: '60', resetTime: '2026-10-01T00:00:00Z' },
    limits: [{ window: { duration: 5, timeUnit: 'TIME_UNIT_HOUR' }, detail: { limit: 50, used: 10 } }],
  })))
  assert.deepEqual(result.windows.map(window => [window.label, window.usedPercent]), [['weekly', 40], ['5h', 20]])
  assert.equal(result.windows[0]?.detail, '60 of 100 left')
})

test('MiniMax reads Token Plan quota windows and pay-as-you-go balances', async () => {
  const plan = await minimaxAdapter.fetch({ ...args(url => {
    assert.equal(url, 'https://api.minimax.io/v1/token_plan/remains')
    return Response.json({ base_resp: { status_code: 0 }, model_remains: [{ model_name: 'MiniMax-M2', current_interval_total_count: 100, current_interval_usage_count: 80, current_interval_remaining_percent: 80 }] })
  }), token: 'sk-cp-example' })
  assert.deepEqual(plan.windows.map(window => [window.label, window.usedPercent]), [['MiniMax-M2 rolling', 20]])
  const balance = await minimaxAdapter.fetch({ ...args(url => {
    assert.equal(url, 'https://api.minimax.io/account/query_balance')
    return Response.json({ base_resp: { status_code: 0 }, available_amount: '12.34' })
  }), token: 'sk-api-example' })
  assert.deepEqual(balance.balance, { amount: 12.34, currency: 'USD' })
})

test('Z.AI maps session, token, and MCP limits and survives a missing CN balance', async () => {
  const query = args(url => url.includes('query-customer-account-report')
    ? new Response('', { status: 404 })
    : Response.json({ success: true, data: { planName: 'Pro', limits: [
      { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 30, nextResetTime: 1790812800 },
      { type: 'TOKENS_LIMIT', unit: 6, number: 1, percentage: 10 },
      { type: 'TIME_LIMIT', percentage: 5 },
    ] } }))
  query.options = { region: 'global' }
  const result = await zaiAdapter.fetch(query)
  assert.equal(result.plan, 'Pro')
  assert.deepEqual(result.windows.map(window => [window.label, window.usedPercent]), [['5h', 30], ['weekly', 10], ['MCP', 5]])
  assert.equal(result.windows[0]?.resetsAt, 1790812800_000)
  assert.equal(result.balance, undefined)
})

test('GitHub Copilot turns quota snapshots into windows and formats the plan', async () => {
  const result = await githubCopilotAdapter.fetch(args((url, init) => {
    assert.equal(url, 'https://github.com/copilot_internal/user')
    assert.equal(new Headers(init?.headers).get('authorization'), 'token secret-example')
    return Response.json({ copilot_plan: 'individual_pro', quota_reset_date: '2026-10-01', quota_snapshots: {
      premium_interactions: { entitlement: 300, remaining: 240, percent_remaining: 80 },
      chat: { unlimited: true },
    } })
  }))
  assert.equal(result.plan, 'Individual Pro')
  assert.deepEqual(result.windows.map(window => [window.label, window.usedPercent]), [['premium', 20], ['chat', 0]])
  assert.equal(result.windows[0]?.resetsAt, Date.parse('2026-10-01'))
})

test('OpenRouter shows the key allowance as balance and usage as notes', async () => {
  const result = await openrouterAdapter.fetch(args(() => Response.json({ data: { limit: 50, limit_remaining: 3.12, usage_daily: 0.84 } })))
  assert.deepEqual(result.balance, { amount: 3.12, currency: 'USD', note: 'key limit $50.00' })
  assert.deepEqual(result.notes, ['today $0.84'])
})

test('Claude treats extra usage amounts as cents', async () => {
  const result = await anthropicAdapter.fetch(args(() => Response.json({ five_hour: { utilization: 10 }, extra_usage: { is_enabled: true, monthly_limit: 2000, used_credits: 160, currency: 'USD' } })))
  assert.equal(result.balance?.amount, 18.4)
})

function monitorWith(fetchImpl: typeof fetch, credentials: Partial<Record<string, unknown>> = {}) {
  const accounts = new Map<string, unknown>()
  const domain = { table: () => ({ entries: () => accounts.entries(), put: async (id: string, value: unknown) => { accounts.set(id, value) }, delete: async (id: string) => { accounts.delete(id) } }) }
  const provider = {
    listRecords: async () => [{ key: 'llm-pi-ai/deepseek', kind: 'api-key' }],
    readRecord: async () => ({ kind: 'api-key', key: 'test-key' }),
    resolve: async () => undefined,
    ...credentials,
  }
  return new QuotaMonitor(provider as never, domain as never, config, fetchImpl)
}

test('concurrent full refreshes are coalesced while a scoped refresh never swallows a full one', async () => {
  let calls = 0
  const fetchImpl = (async () => {
    calls++
    await new Promise(resolve => setTimeout(resolve, 20))
    return Response.json({ balance_infos: [{ currency: 'CNY', total_balance: '9.50' }] })
  }) as typeof fetch
  const monitor = monitorWith(fetchImpl)
  await Promise.all([monitor.refresh(), monitor.refresh(), monitor.refresh()])
  assert.equal(calls, 1)
  calls = 0
  await Promise.all([monitor.refresh('record:deepseek'), monitor.refresh()])
  assert.equal(calls, 2)
  await monitor.dispose()
})

test('a missing credential reference is unconfigured, and the snapshot carries provider metadata', async () => {
  const monitor = monitorWith((async () => new Response('', { status: 500 })) as typeof fetch)
  const snapshot = await monitor.save({ id: 'account:mine', providerId: 'deepseek', label: 'Mine', kind: 'api', source: { type: 'reference', ref: 'MISSING_KEY' }, enabled: true })
  const mine = snapshot.accounts.find(view => view.account.id === 'account:mine')
  assert.equal(mine?.state, 'unconfigured')
  assert.match(mine?.error ?? '', /尚未配置/)
  assert.deepEqual(snapshot.defaults, { alertPercent: 80, lowBalance: 5 })
  assert.equal(snapshot.providers.find(provider => provider.id === 'opencode-go')?.label, 'OpenCode Go')
  assert.equal(snapshot.accounts.find(view => view.account.id === 'record:deepseek')?.account.kind, 'api')
  await monitor.dispose()
})
