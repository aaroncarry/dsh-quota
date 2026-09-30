import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  IconDataOutlineRegular, IconRefreshOutlineRegular, IconWarningOutlineRegular,
  IconSearchOutlineRegular, IconPlusOutlineRegular, IconCloseOutlineRegular,
  IconChevronRightOutlineRegular, IconSettingsOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountView, MonitoredAccount, QuotaSnapshot, UsageWindow } from '../types.ts'
import { useQuota, type QuotaStore } from './store.ts'
import { zh } from './locales.ts'
import styles from './style.css'

type Copy = (key: keyof typeof zh) => string
type BaseProps = PropsLocale<'dshQuota'> & { store: QuotaStore }
type PageProps = PropsRuntime<'main'> & BaseProps
type PillProps = PropsRuntime<'conversation.composer.dock'> & BaseProps & { openPage: () => void }
const usePopupLayoutEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect

function useStyle(): void {
  useEffect(() => {
    const tag = document.createElement('style')
    tag.dataset.pluginCss = 'dsh-quota'
    tag.textContent = styles
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, [])
}

function money(amount: number, currency: string): string {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount) }
  catch { return `${currency} ${amount.toFixed(2)}` }
}

function when(time: number | undefined): string {
  if (time === undefined) return '—'
  return new Intl.DateTimeFormat(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(time)
}

function percentage(value: number): number { return Math.max(0, Math.min(100, value)) }
function attention(view: AccountView): boolean { return ['low', 'auth', 'stale'].includes(view.state) }
function kindName(kind: MonitoredAccount['kind'], copy: Copy): string {
  return kind === 'subscription' ? copy('subscriptions') : kind === 'api' ? copy('api') : copy('relays')
}
function stateName(state: AccountView['state'], copy: Copy): string {
  switch (state) {
    case 'ok': return copy('ok')
    case 'low': return copy('low')
    case 'stale': return copy('stale')
    case 'auth': return copy('auth')
    case 'paused': return copy('paused')
    case 'loading': return copy('loading')
    case 'unconfigured': return copy('unknown')
  }
}

function QuotaBar({ window, copy }: { window: UsageWindow; copy: Copy }) {
  return <div className="dshq-bar"><div className="dshq-bar-label"><span>{window.label}</span><span>{Math.round(window.usedPercent)}% {copy('used')}</span></div>
    <div className="dshq-track"><i className={window.usedPercent >= 80 ? 'warning' : ''} style={{ width: `${percentage(window.usedPercent)}%` }} /></div>
    {window.resetsAt !== undefined && <small>{copy('resetAt')} {when(window.resetsAt)}</small>}
  </div>
}

function SymbolMark({ id }: { id: string }) {
  const letter = id === 'openai-codex' ? '›' : id === 'anthropic' ? '✳' : id === 'github-copilot' ? '⌘' : id === 'deepseek' ? '◈' : id.charAt(0).toUpperCase()
  return <span className={`dshq-mark dshq-mark-${id.replace(/[^a-z0-9-]/gi, '')}`}>{letter}</span>
}

function AccountRow({ view, copy, compact, selected, onClick }: {
  view: AccountView; copy: Copy; compact?: boolean; selected?: boolean; onClick: () => void
}) {
  const result = view.result
  return <button type="button" className={`dshq-row ${compact ? 'compact' : ''} ${selected ? 'selected' : ''}`} onClick={onClick} aria-expanded={selected}>
    <span className="dshq-row-main"><SymbolMark id={view.account.providerId} /><span className="dshq-row-id"><strong>{view.account.label}</strong><small>{result?.plan ?? view.account.providerId}</small></span>
      <span className={`dshq-row-right ${attention(view) ? 'attention' : ''}`}>{result?.balance ? money(result.balance.amount, result.balance.currency) : result?.windows[0] ? `${Math.max(0, 100 - Math.round(result.windows[0].usedPercent))}%` : '—'}</span>
      {!compact && <span className={`dshq-state ${attention(view) ? 'attention' : ''}`}>{stateName(view.state, copy)}</span>}
      {!compact && <IconChevronRightOutlineRegular className="dshq-chevron" />}
    </span>
    {result?.windows.length ? <span className="dshq-row-windows">{result.windows.slice(0, 2).map(window => <span key={window.label} className="dshq-mini-window"><span>{window.label} <b>{Math.round(window.usedPercent)}% {copy('used')}</b></span><i><em style={{ width: `${percentage(window.usedPercent)}%` }} /></i></span>)}</span>
      : <span className="dshq-row-sub"><span>{result?.balance ? (view.account.kind === 'api' ? copy('keyQuota') : copy('available')) : kindName(view.account.kind, copy)}</span><span>{view.attemptedAt ? when(view.attemptedAt) : '—'}</span></span>}
  </button>
}

function AccountDetails({ view, copy, store, configure }: { view: AccountView; copy: Copy; store: QuotaStore; configure?: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const change = async (task: () => Promise<void>) => {
    setBusy(true); setError(undefined)
    try { await task() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  return <div className="dshq-details">
    {view.error && <div className="dshq-notice"><IconWarningOutlineRegular />{view.error}{view.result && <span>{copy('lastResult')}</span>}</div>}
    {view.result?.balance && <div className="dshq-detail-money"><strong>{money(view.result.balance.amount, view.result.balance.currency)}</strong><span>{view.account.kind === 'api' ? copy('keyQuota') : copy('available')}</span></div>}
    {view.result?.balance?.note && <p className="dshq-muted">{view.result.balance.note}</p>}
    {!!view.result?.windows.length && <div className="dshq-detail-windows">{view.result.windows.map(window => <QuotaBar key={window.label} window={window} copy={copy} />)}</div>}
    {view.result?.notes.map(note => <p key={note} className="dshq-muted">{note}</p>)}
    <div className="dshq-detail-foot"><span>{view.attemptedAt ? `${copy('updated')} ${when(view.attemptedAt)}` : copy('none')}</span>
      <span><button disabled={busy} onClick={() => void change(() => store.mutate({ action: 'refresh', id: view.account.id }))}><IconRefreshOutlineRegular />{copy('retry')}</button>
        {configure && <button onClick={configure}><IconSettingsOutlineRegular />{copy('settings')}</button>}</span>
    </div>
    {error && <p className="dshq-error">{copy('errorPrefix')}: {error}</p>}
  </div>
}

function Empty({ copy, add }: { copy: Copy; add?: () => void }) {
  return <div className="dshq-empty"><IconDataOutlineRegular /><strong>{copy('empty')}</strong><p>{copy('emptyHint')}</p>{add && <button className="dshq-primary" onClick={add}><IconPlusOutlineRegular />{copy('add')}</button>}</div>
}

const FILTERS = ['all', 'subscription', 'api', 'relay'] as const
type Filter = typeof FILTERS[number]
function FilterTabs({ value, onChange, copy }: { value: Filter; onChange: (next: Filter) => void; copy: Copy }) {
  return <div className="dshq-filters" role="tablist" aria-label={copy('kind')}>
    {FILTERS.map(filter => <button role="tab" aria-selected={value === filter} className={value === filter ? 'active' : ''} key={filter} onClick={() => onChange(filter)}>{filter === 'all' ? copy('all') : kindName(filter, copy)}</button>)}
  </div>
}

function AccountForm({ existing, close, store, copy }: { existing?: MonitoredAccount; close: () => void; store: QuotaStore; copy: Copy }) {
  const [providerId, setProviderId] = useState(existing?.providerId ?? 'deepseek')
  const [label, setLabel] = useState(existing?.label ?? '')
  const [kind, setKind] = useState<MonitoredAccount['kind']>(existing?.kind ?? 'api')
  const [ref, setRef] = useState(existing?.source.type === 'reference' ? existing.source.ref : '')
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? '')
  const [enabled, setEnabled] = useState(existing?.enabled ?? true)
  const [alertPercent, setAlertPercent] = useState(existing?.alertPercent ?? 80)
  const [lowBalance, setLowBalance] = useState(existing?.lowBalance ?? 5)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => { first.current?.focus() }, [])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [close])
  const save = async () => {
    setBusy(true); setError(undefined)
    try {
      const account: MonitoredAccount = {
        id: existing?.id ?? `account:${crypto.randomUUID()}`, providerId: providerId.trim(),
        label: label.trim(), kind, source: existing?.source.type === 'record' ? existing.source : { type: 'reference', ref: ref.trim() },
        enabled, ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}), alertPercent, lowBalance,
      }
      await store.mutate({ action: 'save', account })
      close()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const remove = async () => {
    if (!existing) return
    setBusy(true); setError(undefined)
    try { await store.mutate({ action: 'remove', id: existing.id }); close() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  return createPortal(<div className="dshq-modal-mask" onPointerDown={event => { if (event.target === event.currentTarget) close() }}>
    <form className="dshq-modal" role="dialog" aria-modal="true" aria-label={existing ? copy('settings') : copy('add')} onSubmit={event => { event.preventDefault(); void save() }}>
      <header><div><h2>{existing ? copy('settings') : copy('add')}</h2><p>{copy('configHint')}</p></div><button type="button" onClick={close} aria-label={copy('cancel')}><IconCloseOutlineRegular /></button></header>
      <div className="dshq-fields">
        <label>{copy('provider')}<input ref={first} value={providerId} onChange={event => setProviderId(event.target.value)} required disabled={existing?.source.type === 'record'} list="dshq-providers" /></label>
        <datalist id="dshq-providers">{['deepseek', 'openai-codex', 'anthropic', 'github-copilot', 'kimi-coding', 'minimax', 'moonshotai', 'openrouter', 'zai'].map(id => <option key={id} value={id} />)}</datalist>
        <label>{copy('label')}<input value={label} onChange={event => setLabel(event.target.value)} required maxLength={80} /></label>
        <label>{copy('kind')}<select value={kind} onChange={event => { const next = event.target.value as MonitoredAccount['kind']; setKind(next); if (next === 'relay' && providerId === 'deepseek') setProviderId('new-api') }}><option value="subscription">{copy('subscriptions')}</option><option value="api">{copy('api')}</option><option value="relay">{copy('relays')}</option></select></label>
        {kind === 'relay' && <p className="dshq-muted">{copy('relayHint')}</p>}
        {existing?.source.type === 'record' ? <label>{copy('source')}<input value={copy('sourceRecord')} readOnly /></label>
          : <label>{copy('reference')}<input value={ref} onChange={event => setRef(event.target.value)} required pattern="[A-Za-z_][A-Za-z0-9_]*" placeholder="MY_API_KEY" /></label>}
        <label>{copy('baseUrl')}<input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} type="url" required={kind === 'relay'} placeholder="https://gateway.example.com/v1" /></label>
        <div className="dshq-field-pair"><label>{copy('alertPercent')}<input type="number" min="1" max="100" value={alertPercent} onChange={event => setAlertPercent(Number(event.target.value))} /></label><label>{copy('lowBalance')}<input type="number" min="0" step="0.01" value={lowBalance} onChange={event => setLowBalance(Number(event.target.value))} /></label></div>
        <label className="dshq-check"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />{copy('enabled')}</label>
      </div>
      {error && <p className="dshq-error">{copy('errorPrefix')}: {error}</p>}
      <footer>{existing && <button type="button" className="dshq-delete" disabled={busy} onClick={() => void remove()}>{copy('delete')}</button>}<span />
        <button type="button" onClick={close}>{copy('cancel')}</button><button className="dshq-primary" disabled={busy} type="submit">{copy('save')}</button></footer>
    </form>
  </div>, document.body)
}

/** Full main-panel presentation, following the approved dashboard layout. */
export function QuotaPage({ store, t }: PageProps) {
  useStyle()
  const copy: Copy = key => t(key)
  const snapshot = useQuota(store)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [selected, setSelected] = useState<string>()
  const [form, setForm] = useState<MonitoredAccount | 'new'>()
  const [error, setError] = useState<string>()
  const filtered = useMemo(() => snapshot.accounts.filter(view =>
    (filter === 'all' || view.account.kind === filter) && (!attentionOnly || attention(view))
    && (!query || `${view.account.label} ${view.account.providerId}`.toLowerCase().includes(query.toLowerCase()))),
  [snapshot, filter, query, attentionOnly])
  const counts = { all: snapshot.accounts.length, subscription: snapshot.accounts.filter(x => x.account.kind === 'subscription').length,
    api: snapshot.accounts.filter(x => x.account.kind === 'api').length, relay: snapshot.accounts.filter(x => x.account.kind === 'relay').length,
    attention: snapshot.accounts.filter(attention).length }
  return <main className="dshq-page"><div className="dshq-page-inner">
    <div className="dshq-heading"><div><span className="dshq-eyebrow"><IconDataOutlineRegular /> DeepSeek Harness</span><h1>{copy('title')}</h1><p>{copy('subtitle')}</p></div>
      <div className="dshq-heading-actions"><button onClick={() => { setError(undefined); void store.mutate({ action: 'refresh' }).catch(cause => setError(String(cause))) }} disabled={snapshot.refreshing}><IconRefreshOutlineRegular />{snapshot.refreshing ? copy('refreshing') : copy('refresh')}</button><button className="dshq-primary" onClick={() => setForm('new')}><IconPlusOutlineRegular />{copy('add')}</button></div></div>
    <div className="dshq-summary"><div><span>{copy('all')}</span><strong>{counts.all}</strong><small>{copy('automatically')}</small></div><div><span>{copy('subscriptions')}</span><strong>{counts.subscription}</strong><small>{copy('quota')}</small></div><div><span>{copy('api')}</span><strong>{counts.api + counts.relay}</strong><small>{copy('balance')}</small></div><div className={counts.attention ? 'attention' : ''}><span>{copy('attention')}</span><strong>{counts.attention}</strong><small>{copy('status')}</small></div></div>
    <div className="dshq-toolbar"><FilterTabs value={filter} onChange={setFilter} copy={copy} /><div className="dshq-toolbar-right"><label className="dshq-search"><IconSearchOutlineRegular /><input placeholder={copy('search')} value={query} onChange={event => setQuery(event.target.value)} /></label><label className="dshq-check"><input type="checkbox" checked={attentionOnly} onChange={event => setAttentionOnly(event.target.checked)} />{copy('attention')}</label></div></div>
    {error && <div className="dshq-notice"><IconWarningOutlineRegular />{error}</div>}
    {store.getError() && <div className="dshq-notice"><IconWarningOutlineRegular />{copy('errorPrefix')}: {store.getError()}</div>}
    {snapshot.accounts.length === 0 ? <Empty copy={copy} add={() => setForm('new')} /> : filtered.length === 0 ? <div className="dshq-empty">{copy('noMatch')}</div> : <div className="dshq-list"><div className="dshq-list-head"><span>{copy('sourceName')}</span><span>{copy('quota')} / {copy('balance')}</span><span>{copy('status')}</span></div>{filtered.map(view => <div className="dshq-list-item" key={view.account.id}><AccountRow view={view} copy={copy} selected={selected === view.account.id} onClick={() => setSelected(selected === view.account.id ? undefined : view.account.id)} />{selected === view.account.id && <AccountDetails view={view} copy={copy} store={store} configure={() => setForm(view.account)} />}</div>)}</div>}
    <div className="dshq-page-footer"><span>{copy('refreshed')}: {when(snapshot.refreshedAt)}</span><span>{copy('interval')}: {snapshot.intervalMinutes} {copy('minute')}</span><button onClick={() => setForm('new')}>{copy('manage')}</button></div>
    {form && <AccountForm existing={form === 'new' ? undefined : form} close={() => setForm(undefined)} store={store} copy={copy} />}
  </div></main>
}

function position(panel: HTMLElement, trigger: HTMLElement): void {
  const rect = trigger.getBoundingClientRect()
  const margin = 12; const gap = 8
  const above = Math.max(0, rect.top - margin - gap)
  const below = Math.max(0, innerHeight - rect.bottom - margin - gap)
  const up = above >= Math.min(570, 360) || above >= below
  panel.style.maxHeight = `${Math.min(570, up ? above : below)}px`
  const box = panel.getBoundingClientRect()
  panel.style.left = `${Math.max(margin, Math.min(innerWidth - box.width - margin, rect.right - box.width))}px`
  panel.style.top = `${Math.max(margin, up ? rect.top - gap - box.height : rect.bottom + gap)}px`
}

/** Composer pill and anchored quick view from the approved compact mockup. */
export function QuotaPill({ store, t, useProjection, openPage }: PillProps) {
  useStyle()
  const copy: Copy = key => t(key)
  const snapshot = useQuota(store)
  const model = useProjection('modelSelection')?.next
  const modelMatches = snapshot.accounts.filter(view => view.account.providerId === model?.provider)
  const current = modelMatches.find(view => view.account.source.type === 'record') ?? (modelMatches.length === 1 ? modelMatches[0] : undefined)
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [selected, setSelected] = useState<string>()
  const anchor = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const others = snapshot.accounts.filter(view => view.account.id !== current?.account.id && (filter === 'all' || view.account.kind === filter) && (!attentionOnly || attention(view)))
  const count = snapshot.accounts.filter(attention).length
  const summary = current?.result?.windows[0] ? `${current.result.windows[0].label} ${Math.max(0, 100 - Math.round(current.result.windows[0].usedPercent))}%`
    : current?.result?.balance ? money(current.result.balance.amount, current.result.balance.currency) : copy('quota')
  usePopupLayoutEffect(() => { if (open && panel.current && anchor.current) position(panel.current, anchor.current) }, [open, snapshot, filter, selected, current])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !anchor.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); anchor.current?.focus() } }
    const resize = () => { if (panel.current && anchor.current) position(panel.current, anchor.current) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    window.addEventListener('resize', resize)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); window.removeEventListener('resize', resize) }
  }, [open])
  return <span className="dshq-pill-wrap"><button ref={anchor} className={`dshq-pill ${current && attention(current) ? 'attention' : ''}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setOpen(!open); if (!open) void store.load(true) }} title={current ? `${current.account.label} · ${summary}` : copy('noCurrent')}>
    <IconDataOutlineRegular /><span>{summary}</span>{count > 0 && <i className="dshq-alert-dot" />}</button>
    {open && createPortal(<div ref={panel} className="dshq-popup" role="dialog" aria-label={copy('title')}>
      <header><strong><IconDataOutlineRegular />{copy('title')}</strong><span><button title={copy('refresh')} aria-label={copy('refresh')} onClick={() => void store.mutate({ action: 'refresh' })}><IconRefreshOutlineRegular /></button><button aria-label={copy('cancel')} onClick={() => setOpen(false)}><IconCloseOutlineRegular /></button></span></header>
      {current && <div className="dshq-current"><div className="dshq-current-head"><SymbolMark id={current.account.providerId} /><strong>{current.account.label}</strong><small>{copy('current')}</small></div>
        {current.result?.balance && <div className="dshq-current-money"><strong>{money(current.result.balance.amount, current.result.balance.currency)}</strong><span>{copy('available')}</span></div>}
        {!!current.result?.windows.length && <div className="dshq-current-bars">{current.result.windows.slice(0, 2).map(window => <QuotaBar key={window.label} window={window} copy={copy} />)}</div>}
        {current.error && <p className="dshq-current-error"><IconWarningOutlineRegular />{stateName(current.state, copy)}</p>}
        <small className="dshq-muted">{current.attemptedAt ? `${copy('updated')} ${when(current.attemptedAt)}` : copy('loading')}</small>
      </div>}
      <div className="dshq-popup-toolbar"><FilterTabs value={filter} onChange={setFilter} copy={copy} /><button className={attentionOnly ? 'active' : ''} onClick={() => setAttentionOnly(!attentionOnly)}><IconWarningOutlineRegular />{count} {copy('attention')}</button></div>
      <div className="dshq-popup-scroll">{snapshot.accounts.length === 0 ? <Empty copy={copy} /> : others.length === 0 ? <div className="dshq-empty">{copy('noMatch')}</div> : (['subscription', 'api', 'relay'] as const).map(kind => {
        const entries = others.filter(view => view.account.kind === kind)
        return entries.length === 0 ? null : <section key={kind}><h3>{kindName(kind, copy)}<span>{entries.length}</span></h3>{entries.map(view => <div key={view.account.id}><AccountRow view={view} copy={copy} compact selected={selected === view.account.id} onClick={() => setSelected(selected === view.account.id ? undefined : view.account.id)} />{selected === view.account.id && <AccountDetails view={view} copy={copy} store={store} />}</div>)}</section>
      })}</div>
      <footer><span>{copy('automatically')}</span><button onClick={() => { setOpen(false); openPage() }}>{copy('viewAll')} <IconChevronRightOutlineRegular /></button></footer>
    </div>, document.body)}
  </span>
}
