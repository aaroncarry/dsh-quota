import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

const source = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('record'), key: z.string().min(1) }),
  z.strictObject({
    type: z.literal('reference'),
    ref: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, '凭据引用只能包含字母、数字和下划线，且不能以数字开头'),
  }),
])

/** Persistent, secret-free monitor configuration. Messages are shown to the user verbatim. */
export const accountSchema = z.strictObject({
  id: z.string().min(1).max(120),
  providerId: z.string().trim().min(1, '服务商 ID 不能为空').max(80, '服务商 ID 不能超过 80 个字符'),
  label: z.string().trim().min(1, '显示名称不能为空').max(80, '显示名称不能超过 80 个字符'),
  kind: z.enum(['subscription', 'api', 'relay']),
  source,
  enabled: z.boolean(),
  baseUrl: z.url({ protocol: /^https?$/, error: '服务地址必须是有效的 http(s) 地址' }).optional(),
  region: z.enum(['global', 'cn', 'auto']).optional(),
  alertPercent: z.number().int('已用比例提醒必须是整数').min(1, '已用比例提醒至少为 1').max(100, '已用比例提醒不能超过 100').optional(),
  lowBalance: z.number().min(0, '低余额提醒不能为负数').optional(),
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
