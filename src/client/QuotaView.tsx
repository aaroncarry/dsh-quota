import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import {
  IconDataOutlineRegular, IconRefreshOutlineRegular, IconWarningOutlineRegular,
  IconSearchOutlineRegular, IconPlusOutlineRegular, IconCloseOutlineRegular,
  IconChevronRightOutlineRegular, IconSettingsOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountView, AlertDefaults, MonitoredAccount, ProviderInfo, UsageWindow } from '../types.ts'
import { useQuota, type QuotaStore } from './store.ts'
import styles from './style.css'
import {
  alertPercentOf, detailText, friendlyError, hueOf, isAttention, leftPercent, messageOf, metricOf, money,
  relativeTime, summarize, supportsRegion, usageLevel, when, windowName, type Copy, type Summary,
} from './view.ts'

type BaseProps = PropsLocale<'dshQuota'> & { store: QuotaStore }
type PageProps = PropsRuntime<'main'> & BaseProps
type PillProps = PropsRuntime<'conversation.composer.dock'> & BaseProps & { openPage: () => void }
const usePopupLayoutEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect

const cx = (...parts: (string | false | undefined)[]): string => parts.filter(Boolean).join(' ')

/** The page and the pill both mount; share one stylesheet tag for as long as either is alive. */
let styleTag: HTMLStyleElement | undefined
let styleUsers = 0
function useStyle(): void {
  useEffect(() => {
    if (styleUsers++ === 0) {
      styleTag = document.createElement('style')
      styleTag.dataset.pluginCss = 'dsh-quota'
      styleTag.textContent = styles
      document.head.appendChild(styleTag)
    }
    return () => {
      if (--styleUsers === 0) { styleTag?.remove(); styleTag = undefined }
    }
  }, [])
}

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

function Time({ at, prefix }: { at: number; prefix?: string }) {
  return <time dateTime={new Date(at).toISOString()} title={when(at)}>{prefix ? `${prefix} ` : ''}{relativeTime(at)}</time>
}

/** When the shown numbers were obtained; after a failed refresh this is the last success, not the last attempt. */
function freshness(view: AccountView): number | undefined {
  return view.result?.fetchedAt ?? view.attemptedAt
}

function SymbolMark({ label, id }: { label: string; id: string }) {
  const initial = Array.from(label.trim())[0]?.toUpperCase() ?? '?'
  return <span className="dshq-mark" aria-hidden="true" style={{ '--h': hueOf(id) } as CSSProperties}>{initial}</span>
}

function QuotaBar({ window, alert, copy }: { window: UsageWindow; alert: number; copy: Copy }) {
  const left = leftPercent(window.usedPercent)
  const level = usageLevel(window.usedPercent, alert)
  return <div className="dshq-bar">
    <div className="dshq-bar-label"><span>{windowName(window.label, copy)}</span><span className={`level-${level}`}>{left}% {copy('left')}</span></div>
    <div className="dshq-track"><i className={level} style={{ width: `${left}%` }} /></div>
    {(window.resetsAt !== undefined || window.detail) && <small>
      {window.resetsAt !== undefined && <Time at={window.resetsAt} prefix={copy('resets')} />}
      {window.resetsAt !== undefined && window.detail && ' · '}
      {window.detail && detailText(window.detail, copy)}
    </small>}
  </div>
}

function AccountRow({ view, defaults, copy, compact, selected, onClick }: {
  view: AccountView; defaults: AlertDefaults; copy: Copy; compact?: boolean; selected?: boolean; onClick: () => void
}) {
  const result = view.result
  const metric = metricOf(view, defaults, copy)
  const alert = alertPercentOf(view.account, defaults)
  const outdated = Boolean(result) && (view.state === 'stale' || view.state === 'auth')
  const at = freshness(view)
  return <button type="button" className={cx('dshq-row', compact && 'compact', selected && 'selected', outdated && 'stale')} onClick={onClick} aria-expanded={selected}>
    <span className="dshq-row-main">
      <SymbolMark label={view.account.label} id={view.account.providerId} />
      <span className="dshq-row-id"><strong>{view.account.label}</strong><small>{result?.plan ?? view.account.providerId}</small></span>
      <span className={`dshq-row-right level-${metric?.level ?? 'ok'}`}>
        <b>{metric?.value ?? '—'}</b>{metric && <small>{metric.caption}</small>}
      </span>
      {!compact && <span className={cx('dshq-state', isAttention(view) && 'attention')}>{stateName(view.state, copy)}</span>}
      {!compact && <IconChevronRightOutlineRegular className="dshq-chevron" />}
    </span>
    {result?.windows.length
      ? <span className="dshq-row-windows">{result.windows.slice(0, 2).map((window, index) => {
        const left = leftPercent(window.usedPercent)
        return <span key={`${window.label}:${index}`} className="dshq-mini-window">
          <span>{windowName(window.label, copy)} <b>{left}%</b></span>
          <i><em className={usageLevel(window.usedPercent, alert)} style={{ width: `${left}%` }} /></i>
        </span>
      })}</span>
      : <span className="dshq-row-sub">
        <span className={cx(view.error && 'level-warn')}>{view.error ? friendlyError(view.error, copy) : kindName(view.account.kind, copy)}</span>
        <span>{at === undefined ? '—' : <Time at={at} />}</span>
      </span>}
  </button>
}

function AccountDetails({ view, defaults, copy, store, configure }: {
  view: AccountView; defaults: AlertDefaults; copy: Copy; store: QuotaStore; configure?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const result = view.result
  const alert = alertPercentOf(view.account, defaults)
  const retry = async () => {
    setBusy(true); setError(undefined)
    try { await store.mutate({ action: 'refresh', id: view.account.id }) } catch (cause) { setError(messageOf(cause)) }
    finally { setBusy(false) }
  }
  return <div className="dshq-details">
    {view.error && <div className="dshq-notice"><IconWarningOutlineRegular /><span>{friendlyError(view.error, copy)}</span>{result && <em>{copy('lastResult')}</em>}</div>}
    {result?.balance && <div className="dshq-detail-money"><strong>{money(result.balance.amount, result.balance.currency)}</strong><span>{view.account.kind === 'api' ? copy('keyQuota') : copy('available')}</span></div>}
    {result?.balance?.note && <p className="dshq-muted">{result.balance.note}</p>}
    {!!result?.windows.length && <div className="dshq-detail-windows">{result.windows.map((window, index) => <QuotaBar key={`${window.label}:${index}`} window={window} alert={alert} copy={copy} />)}</div>}
    {result?.notes.map((note, index) => <p key={`${index}:${note}`} className="dshq-muted">{note}</p>)}
    <div className="dshq-detail-foot">
      <span>{result ? <Time at={result.fetchedAt} prefix={copy('updated')} /> : copy('none')}</span>
      <span>
        <button disabled={busy} onClick={() => void retry()}><IconRefreshOutlineRegular />{copy('retry')}</button>
        {configure && <button onClick={configure}><IconSettingsOutlineRegular />{copy('settings')}</button>}
      </span>
    </div>
    {error && <p className="dshq-error">{copy('errorPrefix')}: {error}</p>}
  </div>
}

function Empty({ copy, add }: { copy: Copy; add?: () => void }) {
  return <div className="dshq-empty"><IconDataOutlineRegular /><strong>{copy('empty')}</strong><p>{copy('emptyHint')}</p>{add && <button className="dshq-primary" onClick={add}><IconPlusOutlineRegular />{copy('add')}</button>}</div>
}

/** Sentinel option value; never a real provider id because ids are lowercase slugs. */
const CUSTOM_PROVIDER = '__custom__'
const FILTERS = ['all', 'subscription', 'api', 'relay'] as const
type Filter = typeof FILTERS[number]
function FilterTabs({ value, onChange, copy }: { value: Filter; onChange: (next: Filter) => void; copy: Copy }) {
  return <div className="dshq-filters" role="tablist" aria-label={copy('kind')}>
    {FILTERS.map(filter => <button role="tab" aria-selected={value === filter} className={value === filter ? 'active' : ''} key={filter} onClick={() => onChange(filter)}>{filter === 'all' ? copy('all') : kindName(filter, copy)}</button>)}
  </div>
}

function AccountForm({ existing, close, store, copy, providers, defaults }: {
  existing?: MonitoredAccount; close: () => void; store: QuotaStore; copy: Copy; providers: ProviderInfo[]; defaults: AlertDefaults
}) {
  const [providerId, setProviderId] = useState(existing?.providerId ?? 'deepseek')
  const [label, setLabel] = useState(existing?.label ?? '')
  const [kind, setKind] = useState<MonitoredAccount['kind']>(existing?.kind ?? 'api')
  const [ref, setRef] = useState(existing?.source.type === 'reference' ? existing.source.ref : '')
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? '')
  const [region, setRegion] = useState<NonNullable<MonitoredAccount['region']>>(existing?.region ?? 'auto')
  const [enabled, setEnabled] = useState(existing?.enabled ?? true)
  // Blank means "inherit the global default"; only a value the user typed is persisted.
  const [alertPercent, setAlertPercent] = useState(existing?.alertPercent === undefined ? '' : String(existing.alertPercent))
  const [lowBalance, setLowBalance] = useState(existing?.lowBalance === undefined ? '' : String(existing.lowBalance))
  const [confirmingRemoval, setConfirmingRemoval] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  // A gateway uses a custom id, so anything outside the built-in list is edited as free text.
  const [custom, setCustom] = useState(existing !== undefined && !providers.some(provider => provider.id === existing.providerId))
  const first = useRef<HTMLSelectElement>(null)
  const known = providers.find(provider => provider.id === providerId.trim())
  useEffect(() => { first.current?.focus() }, [])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [close])
  useEffect(() => {
    if (!confirmingRemoval) return
    const timer = setTimeout(() => setConfirmingRemoval(false), 4000)
    return () => clearTimeout(timer)
  }, [confirmingRemoval])
  const run = async (task: () => Promise<void>) => {
    setBusy(true); setError(undefined)
    try { await task(); close() } catch (cause) { setError(messageOf(cause)) }
    finally { setBusy(false) }
  }
  const save = () => run(() => {
    const id = providerId.trim()
    const account: MonitoredAccount = {
      id: existing?.id ?? `account:${crypto.randomUUID()}`, providerId: id,
      label: label.trim() || known?.label || id, kind,
      source: existing?.source.type === 'record' ? existing.source : { type: 'reference', ref: ref.trim() },
      enabled,
      ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
      ...(supportsRegion(id) ? { region } : {}),
      ...(alertPercent.trim() !== '' ? { alertPercent: Number(alertPercent) } : {}),
      ...(lowBalance.trim() !== '' ? { lowBalance: Number(lowBalance) } : {}),
    }
    return store.mutate({ action: 'save', account })
  })
  const remove = () => {
    if (!existing) return
    if (!confirmingRemoval) { setConfirmingRemoval(true); return }
    void run(() => store.mutate({ action: 'remove', id: existing.id }))
  }
  const changeProvider = (next: string) => {
    if (next === CUSTOM_PROVIDER) {
      setCustom(true); setProviderId(''); setKind('relay')
      return
    }
    setCustom(false); setProviderId(next)
    const info = providers.find(provider => provider.id === next)
    if (info) setKind(info.kind)
  }
  const changeKind = (next: MonitoredAccount['kind']) => {
    setKind(next)
    // A gateway needs a custom id; built-in ids are rejected for gateways.
    if (next === 'relay' && known) { setCustom(true); setProviderId('new-api') }
  }
  return createPortal(<div className="dshq-modal-mask" onPointerDown={event => { if (event.target === event.currentTarget) close() }}>
    <form className="dshq-modal" role="dialog" aria-modal="true" aria-label={existing ? copy('settings') : copy('add')} onSubmit={event => { event.preventDefault(); void save() }}>
      <header><div><h2>{existing ? copy('settings') : copy('add')}</h2><p>{copy('configHint')}</p></div><button type="button" onClick={close} aria-label={copy('cancel')}><IconCloseOutlineRegular /></button></header>
      <div className="dshq-fields">
        <label>{copy('provider')}<select ref={first} value={custom ? CUSTOM_PROVIDER : providerId} onChange={event => changeProvider(event.target.value)} disabled={existing?.source.type === 'record'}>
          {providers.map(provider => <option key={provider.id} value={provider.id}>{provider.label} · {provider.id}</option>)}
          <option value={CUSTOM_PROVIDER}>{copy('customProvider')}</option>
        </select></label>
        {custom && <label>{copy('customProviderId')}<input value={providerId} onChange={event => setProviderId(event.target.value)} required placeholder="new-api" autoFocus /></label>}
        <label>{copy('label')}<input value={label} onChange={event => setLabel(event.target.value)} maxLength={80} placeholder={known?.label ?? providerId} /></label>
        <label>{copy('kind')}<select value={kind} onChange={event => changeKind(event.target.value as MonitoredAccount['kind'])}><option value="subscription">{copy('subscriptions')}</option><option value="api">{copy('api')}</option><option value="relay">{copy('relays')}</option></select></label>
        {kind === 'relay' && <p className="dshq-muted">{copy('relayHint')}</p>}
        {existing?.source.type === 'record' ? <label>{copy('source')}<input value={copy('sourceRecord')} readOnly /></label>
          : <label>{copy('reference')}<input value={ref} onChange={event => setRef(event.target.value)} required pattern="[A-Za-z_][A-Za-z0-9_]*" placeholder="MY_API_KEY" /></label>}
        <label>{copy('baseUrl')}<input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} type="url" required={kind === 'relay'} placeholder="https://gateway.example.com/v1" /></label>
        {supportsRegion(providerId.trim()) && <label>{copy('region')}<select value={region} onChange={event => setRegion(event.target.value as typeof region)}><option value="auto">{copy('regionAuto')}</option><option value="global">{copy('regionGlobal')}</option><option value="cn">{copy('regionCn')}</option></select></label>}
        <div className="dshq-field-pair">
          <label>{copy('alertPercent')}<input type="number" min="1" max="100" step="1" value={alertPercent} placeholder={String(defaults.alertPercent)} onChange={event => setAlertPercent(event.target.value)} /></label>
          <label>{copy('lowBalance')}<input type="number" min="0" step="0.01" value={lowBalance} placeholder={String(defaults.lowBalance)} onChange={event => setLowBalance(event.target.value)} /></label>
        </div>
        <p className="dshq-muted">{copy('inheritHint')}</p>
        <label className="dshq-check"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />{copy('enabled')}</label>
      </div>
      {error && <p className="dshq-error">{copy('errorPrefix')}: {error}</p>}
      <footer>{existing && <button type="button" className={cx('dshq-delete', confirmingRemoval && 'confirming')} disabled={busy} onClick={remove}>{confirmingRemoval ? copy('confirmDelete') : copy('delete')}</button>}<span />
        <button type="button" onClick={close}>{copy('cancel')}</button><button className="dshq-primary" disabled={busy} type="submit">{copy('save')}</button></footer>
    </form>
  </div>, document.body)
}

function attentionBreakdown(summary: Summary, copy: Copy): string {
  const parts = ([['low', 'shortLow'], ['auth', 'shortAuth'], ['stale', 'shortStale'], ['unconfigured', 'shortUnknown']] as const)
    .flatMap(([state, key]) => summary.attention[state] ? [`${summary.attention[state]} ${copy(key)}`] : [])
  return parts.length ? parts.join(' · ') : copy('allHealthy')
}

function SummaryCards({ summary, total, copy, attentionOnly, toggleAttention }: {
  summary: Summary; total: number; copy: Copy; attentionOnly: boolean; toggleAttention: () => void
}) {
  const balances = summary.balances.map(entry => money(entry.amount, entry.currency)).join(' · ')
  return <div className="dshq-summary">
    <div><span>{copy('all')}</span><strong>{total}</strong><small>{summary.monitoring} {copy('monitoring')}{summary.paused > 0 && ` · ${summary.paused} ${copy('paused')}`}</small></div>
    <div><span>{copy('subscriptions')}</span><strong>{summary.subscriptions}</strong><small>{summary.tightest ? `${summary.tightest.label} · ${summary.tightest.left}% ${copy('left')}` : copy('noData')}</small></div>
    <div><span>{copy('apiAndRelays')}</span><strong>{summary.gateways}</strong><small>{balances || copy('noData')}</small></div>
    <button type="button" className={cx('dshq-summary-attention', summary.attentionTotal > 0 && 'attention', attentionOnly && 'active')} aria-pressed={attentionOnly} onClick={toggleAttention}>
      <span>{copy('attention')}</span><strong>{summary.attentionTotal}</strong><small>{attentionBreakdown(summary, copy)}</small>
    </button>
  </div>
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
    (filter === 'all' || view.account.kind === filter) && (!attentionOnly || isAttention(view))
    && (!query || `${view.account.label} ${view.account.providerId}`.toLowerCase().includes(query.toLowerCase()))),
  [snapshot.accounts, filter, query, attentionOnly])
  const summary = useMemo(() => summarize(snapshot.accounts), [snapshot.accounts])
  const refresh = () => { setError(undefined); void store.mutate({ action: 'refresh' }).catch(cause => setError(messageOf(cause))) }
  return <main className="dshq-page"><div className="dshq-page-inner">
    <div className="dshq-heading"><div><span className="dshq-eyebrow"><IconDataOutlineRegular /> DeepSeek Harness</span><h1>{copy('title')}</h1><p>{copy('subtitle')}</p></div>
      <div className="dshq-heading-actions">
        <button className={cx(snapshot.refreshing && 'dshq-spin')} onClick={refresh} disabled={snapshot.refreshing}><IconRefreshOutlineRegular />{snapshot.refreshing ? copy('refreshing') : copy('refresh')}</button>
        <button className="dshq-primary" onClick={() => setForm('new')}><IconPlusOutlineRegular />{copy('add')}</button>
      </div></div>
    <SummaryCards summary={summary} total={snapshot.accounts.length} copy={copy} attentionOnly={attentionOnly} toggleAttention={() => setAttentionOnly(!attentionOnly)} />
    <div className="dshq-toolbar"><FilterTabs value={filter} onChange={setFilter} copy={copy} /><div className="dshq-toolbar-right"><label className="dshq-search"><IconSearchOutlineRegular /><input placeholder={copy('search')} value={query} onChange={event => setQuery(event.target.value)} /></label><label className="dshq-check"><input type="checkbox" checked={attentionOnly} onChange={event => setAttentionOnly(event.target.checked)} />{copy('attention')}</label></div></div>
    {error && <div className="dshq-notice"><IconWarningOutlineRegular /><span>{error}</span></div>}
    {store.getError() && <div className="dshq-notice"><IconWarningOutlineRegular /><span>{copy('errorPrefix')}: {store.getError()}</span></div>}
    {snapshot.accounts.length === 0 ? <Empty copy={copy} add={() => setForm('new')} />
      : filtered.length === 0 ? <div className="dshq-empty">{copy('noMatch')}</div>
        : <div className="dshq-list">{filtered.map(view => <div className="dshq-list-item" key={view.account.id}>
          <AccountRow view={view} defaults={snapshot.defaults} copy={copy} selected={selected === view.account.id} onClick={() => setSelected(selected === view.account.id ? undefined : view.account.id)} />
          {selected === view.account.id && <AccountDetails view={view} defaults={snapshot.defaults} copy={copy} store={store} configure={() => setForm(view.account)} />}
        </div>)}</div>}
    <div className="dshq-page-footer"><span>{copy('refreshed')}: {snapshot.refreshedAt === undefined ? '—' : <Time at={snapshot.refreshedAt} />}</span><span>{copy('interval')}: {snapshot.intervalMinutes} {copy('minute')}</span></div>
    {form && <AccountForm existing={form === 'new' ? undefined : form} close={() => setForm(undefined)} store={store} copy={copy} providers={snapshot.providers} defaults={snapshot.defaults} />}
  </div></main>
}

const POPUP_MAX_HEIGHT = 570
const POPUP_PREFERRED_HEIGHT = 360

function position(panel: HTMLElement, trigger: HTMLElement): void {
  const rect = trigger.getBoundingClientRect()
  const margin = 12; const gap = 8
  const above = Math.max(0, rect.top - margin - gap)
  const below = Math.max(0, innerHeight - rect.bottom - margin - gap)
  const up = above >= POPUP_PREFERRED_HEIGHT || above >= below
  panel.style.maxHeight = `${Math.min(POPUP_MAX_HEIGHT, up ? above : below)}px`
  const box = panel.getBoundingClientRect()
  panel.style.left = `${Math.max(margin, Math.min(innerWidth - box.width - margin, rect.right - box.width))}px`
  panel.style.top = `${Math.max(margin, up ? rect.top - gap - box.height : rect.bottom + gap)}px`
}

/** Composer pill and anchored quick view from the approved compact mockup. */
export function QuotaPill({ store, t, useProjection, openPage }: PillProps) {
  useStyle()
  const copy: Copy = key => t(key)
  const snapshot = useQuota(store)
  const { defaults } = snapshot
  const model = useProjection('modelSelection')?.next
  const modelMatches = snapshot.accounts.filter(view => view.account.providerId === model?.provider)
  const current = modelMatches.find(view => view.account.source.type === 'record') ?? (modelMatches.length === 1 ? modelMatches[0] : undefined)
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [selected, setSelected] = useState<string>()
  const [refreshError, setRefreshError] = useState<string>()
  const anchor = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const others = snapshot.accounts.filter(view => view.account.id !== current?.account.id && (filter === 'all' || view.account.kind === filter) && (!attentionOnly || isAttention(view)))
  const count = snapshot.accounts.filter(isAttention).length
  const metric = current ? metricOf(current, defaults, copy) : undefined
  const summary = metric?.short ?? copy('quota')
  const currentAlert = current ? alertPercentOf(current.account, defaults) : defaults.alertPercent
  usePopupLayoutEffect(() => { if (open && panel.current && anchor.current) position(panel.current, anchor.current) }, [open, snapshot, filter, selected, current, refreshError])
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
  const refresh = () => { setRefreshError(undefined); void store.mutate({ action: 'refresh' }).catch(cause => setRefreshError(messageOf(cause))) }
  return <span className="dshq-pill-wrap"><button ref={anchor} className={cx('dshq-pill', current && isAttention(current) && 'attention')} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setOpen(!open); if (!open) void store.load(true) }} title={current ? `${current.account.label} · ${metric ? `${metric.caption} ${metric.value}` : copy('quota')}` : copy('noCurrent')}>
    <IconDataOutlineRegular /><span>{summary}</span>{count > 0 && <i className="dshq-alert-dot" />}</button>
    {open && createPortal(<div ref={panel} className="dshq-popup" role="dialog" aria-label={copy('title')}>
      <header><strong><IconDataOutlineRegular />{copy('title')}</strong><span>
        <button className={cx(snapshot.refreshing && 'dshq-spin')} title={copy('refresh')} aria-label={copy('refresh')} disabled={snapshot.refreshing} onClick={refresh}><IconRefreshOutlineRegular /></button>
        <button aria-label={copy('cancel')} onClick={() => setOpen(false)}><IconCloseOutlineRegular /></button></span></header>
      {refreshError && <div className="dshq-notice dshq-popup-notice"><IconWarningOutlineRegular /><span>{refreshError}</span></div>}
      {current && <div className="dshq-current"><div className="dshq-current-head"><SymbolMark label={current.account.label} id={current.account.providerId} /><strong>{current.account.label}</strong><small>{copy('current')}</small></div>
        {!!current.result?.windows.length && <div className="dshq-current-bars">{current.result.windows.slice(0, 2).map((window, index) => <QuotaBar key={`${window.label}:${index}`} window={window} alert={currentAlert} copy={copy} />)}</div>}
        {current.result?.balance && <div className={cx('dshq-current-money', current.result.windows.length > 0 && 'aux')}><strong>{money(current.result.balance.amount, current.result.balance.currency)}</strong><span>{copy('available')}</span></div>}
        {current.error && <p className="dshq-current-error"><IconWarningOutlineRegular />{stateName(current.state, copy)}</p>}
        <small className="dshq-muted">{freshness(current) === undefined ? copy('loading') : <Time at={freshness(current)!} prefix={copy('updated')} />}</small>
      </div>}
      <div className="dshq-popup-toolbar"><FilterTabs value={filter} onChange={setFilter} copy={copy} /><button className={attentionOnly ? 'active' : ''} aria-pressed={attentionOnly} onClick={() => setAttentionOnly(!attentionOnly)}><IconWarningOutlineRegular />{count} {copy('attention')}</button></div>
      <div className="dshq-popup-scroll">{snapshot.accounts.length === 0 ? <Empty copy={copy} /> : others.length === 0 ? <div className="dshq-empty">{copy('noMatch')}</div> : (['subscription', 'api', 'relay'] as const).map(kind => {
        const entries = others.filter(view => view.account.kind === kind)
        return entries.length === 0 ? null : <section key={kind}><h3>{kindName(kind, copy)}<span>{entries.length}</span></h3>{entries.map(view => <div key={view.account.id}><AccountRow view={view} defaults={defaults} copy={copy} compact selected={selected === view.account.id} onClick={() => setSelected(selected === view.account.id ? undefined : view.account.id)} />{selected === view.account.id && <AccountDetails view={view} defaults={defaults} copy={copy} store={store} />}</div>)}</section>
      })}</div>
      <footer><span>{copy('automatically')}</span><button onClick={() => { setOpen(false); openPage() }}>{copy('viewAll')} <IconChevronRightOutlineRegular /></button></footer>
    </div>, document.body)}
  </span>
}
