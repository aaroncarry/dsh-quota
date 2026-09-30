import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

const source = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('record'), key: z.string().min(1) }),
  z.strictObject({ type: z.literal('reference'), ref: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/) }),
])

/** Persistent, secret-free monitor configuration. */
export const accountSchema = z.strictObject({
  id: z.string().min(1).max(120),
  providerId: z.string().min(1).max(80),
  label: z.string().min(1).max(80),
  kind: z.enum(['subscription', 'api', 'relay']),
  source,
  enabled: z.boolean(),
  baseUrl: z.url().optional(),
  region: z.enum(['global', 'cn', 'auto']).optional(),
  alertPercent: z.number().int().min(1).max(100).optional(),
  lowBalance: z.number().min(0).optional(),
}).superRefine((account, context) => {
  if (account.kind === 'relay' && !account.baseUrl) {
    context.addIssue({ code: 'custom', path: ['baseUrl'], message: '中转站必须填写服务地址' })
  }
})

export const quotaDomain = defineDomain({
  name: 'dsh_quota',
  version: 1,
  tables: { accounts: domainTable(accountSchema) },
})
