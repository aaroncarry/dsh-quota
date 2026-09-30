import { ZodError } from 'zod'

/** User-facing text for a rejected mutation; schema issues already carry Chinese messages. */
export function describeError(error: unknown): string {
  if (error instanceof ZodError) return [...new Set(error.issues.map(issue => issue.message))].join('；')
  if (error instanceof SyntaxError) return '请求内容不是有效的 JSON'
  return error instanceof Error ? error.message : String(error)
}
