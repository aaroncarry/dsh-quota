import assert from 'node:assert/strict'
import { test } from 'node:test'
import { QuotaMonitor } from '../src/monitor.ts'

const config = { intervalMinutes: 5, requestTimeoutMs: 15000, maxConcurrent: 2, alertPercent: 80, lowBalance: 5 }

test('discovery, polling, stale results, and removal never expose credential values', async () => {
  const accounts = new Map()
  const domain = { table(name) {
    assert.equal(name, 'accounts')
    return { entries: () => accounts.entries(), put: async (id, value) => { accounts.set(id, value) }, delete: async id => { accounts.delete(id) } }
  } }
  const credentials = {
    listRecords: async () => [{ key: 'llm-pi-ai/deepseek', kind: 'api-key' }, { key: 'llm-pi-ai/amazon-bedrock', kind: 'api-key' }],
    readRecord: async () => ({ kind: 'api-key', key: 'very-private-test-key' }),
  }
  let fails = false
  const fetchImpl = async (_url, init) => {
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer very-private-test-key')
    return fails ? new Response('', { status: 503 }) : Response.json({ balance_infos: [{ currency: 'CNY', total_balance: '9.50' }] })
  }
  const monitor = new QuotaMonitor(credentials, domain, config, fetchImpl)
  await assert.rejects(monitor.save({ id: 'record:deepseek', providerId: 'deepseek', label: 'Wrong record', kind: 'api', source: { type: 'record', key: 'llm-pi-ai/anthropic' }, enabled: true }), /只能配置/)
  assert.deepEqual((await monitor.snapshot()).accounts.map(view => view.account.providerId), ['deepseek'])
  const good = await monitor.refresh()
  assert.equal(good.accounts[0].result.balance.amount, 9.5)
  assert.equal(JSON.stringify(good).includes('very-private-test-key'), false)
  fails = true
  const stale = await monitor.refresh()
  assert.equal(stale.accounts[0].state, 'stale')
  assert.equal(stale.accounts[0].result.balance.amount, 9.5)
  const removed = await monitor.remove('record:deepseek')
  assert.equal(removed.accounts[0].state, 'paused')
  assert.equal(removed.accounts[0].account.enabled, false)
  await monitor.dispose()
  await assert.rejects(monitor.refresh(), /已停止/)
})
