import Schema from '@deepseek-ai/schemastery'

/** Host polling configuration; monitored accounts are stored through DSH storage. */
export interface Config {
  intervalMinutes: number
  requestTimeoutMs: number
  maxConcurrent: number
  alertPercent: number
  lowBalance: number
}

export const Config: Schema<Config> = Schema.object({
  intervalMinutes: Schema.number().step(1).min(1).max(1440).default(5),
  requestTimeoutMs: Schema.number().step(1).min(1000).max(120000).default(15000),
  maxConcurrent: Schema.number().step(1).min(1).max(16).default(4),
  alertPercent: Schema.number().step(1).min(1).max(100).default(80),
  lowBalance: Schema.number().min(0).default(5),
})
