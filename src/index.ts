/** Host entry for the DeepSeek Harness balance and quota monitor. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { Config, type Config as QuotaConfig } from './config.ts'
import { quotaDomain } from './domain.ts'
import { QuotaMonitor } from './monitor.ts'

export { Config }
export const name = 'dsh-quota'
export const inject = ['credentials', 'connection', 'storageDomain']

type Mutation =
  | { action: 'refresh'; id?: string }
  | { action: 'save'; account: unknown }
  | { action: 'remove'; id: string }

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store' } })
}

function mutationOf(value: unknown): Mutation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('请求内容必须是对象')
  const record = value as Record<string, unknown>
  if (record.action === 'refresh' && (record.id === undefined || typeof record.id === 'string')) {
    return { action: 'refresh', ...(record.id === undefined ? {} : { id: record.id as string }) }
  }
  if (record.action === 'save') return { action: 'save', account: record.account }
  if (record.action === 'remove' && typeof record.id === 'string') return { action: 'remove', id: record.id }
  throw new Error('不支持的监控操作')
}

/** Mount authenticated Host routes and the background polling lifecycle. */
export async function apply(ctx: Context, config: QuotaConfig): Promise<void> {
  const domain = await ctx.storageDomain.open(quotaDomain)
  const monitor = new QuotaMonitor(ctx.credentials, domain, config)
  ctx.effect(() => async () => { await domain.close() }, 'dsh-quota: storage domain')
  ctx.effect(() => async () => { await monitor.dispose() }, 'dsh-quota: pending queries')
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/quota', methods: ['GET', 'POST'], requestBody: 'buffered',
    async fetch(request) {
      if (request.method === 'GET') return json(await monitor.snapshot())
      if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        return json({ error: '需要 application/json 请求内容' }, 415)
      }
      try {
        const body = await request.text()
        if (body.length > 65536) return json({ error: '请求内容过大' }, 413)
        const mutation = mutationOf(JSON.parse(body))
        switch (mutation.action) {
          case 'refresh': return json(await monitor.refresh(mutation.id))
          case 'save': return json(await monitor.save(mutation.account))
          case 'remove': return json(await monitor.remove(mutation.id))
        }
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, 400)
      }
    },
  }), 'dsh-quota: API route')
  const interval = setInterval(() => { void monitor.refresh().catch(error => ctx.logger.warn('dsh-quota: refresh failed: %s', String(error))) }, config.intervalMinutes * 60_000)
  ctx.effect(() => () => clearInterval(interval), 'dsh-quota: refresh timer')
  ctx.on('credentials/record-updated', key => {
    if (key.startsWith('llm-pi-ai/')) {
      void monitor.refresh(`record:${key.slice('llm-pi-ai/'.length)}`)
        .catch(error => ctx.logger.warn('dsh-quota: credential refresh failed: %s', String(error)))
    }
  })
  ctx.on('credentials/reference-updated', () => {
    void monitor.refresh().catch(error => ctx.logger.warn('dsh-quota: credential refresh failed: %s', String(error)))
  })
  void monitor.refresh().catch(error => ctx.logger.warn('dsh-quota: initial refresh failed: %s', String(error)))
}
