/** Extract the optional ChatGPT workspace id from a Codex OAuth JWT. */
export function accountIdFromToken(token: string | undefined): string | undefined {
  if (!token) return undefined
  const parts = token.split('.')
  if (parts.length !== 3) return undefined
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>
    const direct = payload.chatgpt_account_id
    if (typeof direct === 'string' && direct) return direct
    const auth = payload['https://api.openai.com/auth']
    if (typeof auth === 'object' && auth !== null) {
      const nested = (auth as Record<string, unknown>).chatgpt_account_id
      if (typeof nested === 'string' && nested) return nested
    }
  } catch {
    // An opaque token has no readable account id; the endpoint can still accept it.
  }
  return undefined
}
