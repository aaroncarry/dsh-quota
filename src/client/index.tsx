/** Browser plugin: sidebar page and composer quick view. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { IconGaugeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { QuotaStore } from './store.ts'
import { QuotaPage, QuotaPill } from './QuotaView.tsx'
import { en, zh } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    dshQuota: keyof typeof zh
  }
}

const PANEL_ID = 'dsh-quota' as MainPanelId
export const inject = ['slots', 'layout', 'locale']

/** Register all visible surfaces as reversible Cordis effects. */
export function apply(ctx: Context): void {
  const store = new QuotaStore()
  ctx.effect(() => () => store.dispose(), 'dsh-quota: client store')
  ctx.effect(() => ctx.locale.register('dshQuota', { zh, en }), 'dsh-quota: dictionaries')
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: PANEL_ID, locale: 'dshQuota', inject: () => ({ store }),
  }, QuotaPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: PANEL_ID, order: 65,
    label: () => ctx.locale.bind('dshQuota')('title'),
  }, function QuotaSidebarIcon(_props: PropsRuntime<'sidebar.panellist'>) { return <IconGaugeOutlineRegular /> }))
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock', id: 'dsh-quota', order: 30, locale: 'dshQuota',
    inject: () => ({ store, openPage: () => ctx.layout.selectPanel(PANEL_ID) }),
  }, QuotaPill))
}
