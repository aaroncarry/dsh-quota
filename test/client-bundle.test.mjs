import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const nodeRequire = createRequire(import.meta.url)

test('browser artifact registers the DSH module and its three UI slots', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  let registration
  runInNewContext(source, { window: { __ModuleLoader__: { load(value) { registration = value } } } })
  assert.equal(registration?.id, 'dsh-quota')
  const module = registration.factory(specifier => specifier === '@deepseek-ai/dsh-client-ui-primitives'
    ? new Proxy({}, { get: () => () => null })
    : nodeRequire(specifier))
  assert.equal(typeof module.apply, 'function')
  assert.equal('default' in module, false)
  const slots = []
  const context = {
    effect(register) { register() },
    locale: { register() { return () => {} }, bind() { return key => key } },
    slots: { inject(_name, register) { register() }, register(options, component) { slots.push({ options, component }); return () => {} } },
    layout: { selectPanel() {} },
  }
  module.apply(context)
  assert.deepEqual(slots.map(slot => slot.options.name), ['main', 'sidebar.panellist', 'conversation.composer.dock'])
  assert.deepEqual(slots.map(slot => typeof slot.component), ['function', 'function', 'function'])
  const React = nodeRequire('react')
  const { renderToStaticMarkup } = nodeRequire('react-dom/server')
  const balance = {
    accounts: [{ account: { id: 'record:deepseek', providerId: 'deepseek', label: 'DeepSeek', kind: 'api', source: { type: 'record', key: 'llm-pi-ai/deepseek' }, enabled: true },
      state: 'ok', result: { providerId: 'deepseek', label: 'DeepSeek', windows: [], balance: { amount: 12.5, currency: 'CNY' }, notes: [], fetchedAt: Date.now() }, attemptedAt: Date.now() }],
    providers: [{ id: 'deepseek', label: 'DeepSeek', kind: 'api' }], defaults: { alertPercent: 80, lowBalance: 5 },
    refreshing: false, intervalMinutes: 5,
  }
  const page = slots.find(slot => slot.options.name === 'main')
  const pageProps = page.options.inject()
  pageProps.store.value = balance
  const pageMarkup = renderToStaticMarkup(React.createElement(page.component, { ...pageProps, t: key => key }))
  assert.match(pageMarkup, /dshq-page/)
  assert.match(pageMarkup, /DeepSeek/)
  assert.match(pageMarkup, /12\.50/)
  const pill = slots.find(slot => slot.options.name === 'conversation.composer.dock')
  const pillProps = pill.options.inject()
  pillProps.store.value = balance
  const pillMarkup = renderToStaticMarkup(React.createElement(pill.component, { ...pillProps, t: key => key,
    useProjection: () => ({ next: { provider: 'deepseek', model: 'deepseek-chat' } }) }))
  assert.match(pillMarkup, /dshq-pill/)
  assert.match(pillMarkup, /12\.50/)
})
