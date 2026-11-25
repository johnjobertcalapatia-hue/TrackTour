import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Bike, Car, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, Clock, Flag, MapPin, Phone, Search, ShieldCheck, Store, Users, UtensilsCrossed, X } from 'lucide-react'
import { cn, getInitials, toAssetUrl } from '@/shared/utils'
import { useOfficePortal } from '@/features/admin/office-portal'
import {
  ACTIVITY_META, timeAgo, tripStatusLabel,
  TOURIST_BG, TOURIST_COLOR,
  type BusinessPin, type LiveRider, type LiveTourist, type PanelTab, type RiderActivity, type Selection, type SosPin,
} from './types'

export type RiderFilter = 'all' | RiderActivity

export interface TownRow {
  name: string
  logo: string | null
  count: number
}

interface Props {
  tab: PanelTab
  onTab: (t: PanelTab) => void
  search: string
  onSearch: (s: string) => void
  category: string
  onCategory: (c: string) => void
  /** Business categories with how many match the other filters. */
  categories: { name: string; count: number }[]
  municipality: string
  /** '' = all of Oriental Mindoro. */
  onMunicipality: (m: string) => void
  /** Every town with its count for the current tab. */
  towns: TownRow[]
  riderFilter: RiderFilter
  onRiderFilter: (f: RiderFilter) => void
  businesses: BusinessPin[]
  riders: LiveRider[]
  /** Active SOS alerts: shown as radar markers on the map; the panel only opens one when its marker is clicked. */
  sos: SosPin[]
  tourists: LiveTourist[]
  counts: { businesses: number; riders: number; tourists: number }
  riderCounts: Record<RiderFilter, number>
  selection: Selection
  onSelect: (s: Selection) => void
  loading: boolean
}

const INK = '#14351F'
const GREEN = '#0B5D2E'

const RIDER_FILTERS: { key: RiderFilter; label: string; dot?: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'available', label: 'Online', dot: ACTIVITY_META.available.color },
  { key: 'delivering', label: 'Delivering', dot: ACTIVITY_META.delivering.color },
  { key: 'transporting', label: 'Transporting', dot: ACTIVITY_META.transporting.color },
  { key: 'busy', label: 'Busy', dot: ACTIVITY_META.busy.color },
]

const TABS: { key: PanelTab; label: string; icon: typeof Store }[] = [
  { key: 'businesses', label: 'Places', icon: Store },
  { key: 'riders', label: 'Riders', icon: Bike },
  { key: 'tourists', label: 'Tourists', icon: Users },
]

/**
 * Left panel of the admin live map, in the style of a travel map: a large
 * headline count, an underlined search, pill filters, then "Start with a
 * town" (each town opens and zooms the map to it) and the cards themselves.
 * A click on a card opens its detail here and focuses it on the map.
 */
export default function LiveMapPanel(p: Props) {
  const selectedRider = p.selection?.kind === 'rider' ? p.riders.find((r) => r.id === p.selection!.id) : undefined
  const selectedBusiness = p.selection?.kind === 'business' ? p.businesses.find((b) => b.id === p.selection!.id) : undefined
  const selectedSos = p.selection?.kind === 'sos' ? p.sos.find((s) => s.id === p.selection!.id) : undefined
  const back = () => p.onSelect(null)

  if (selectedRider) return <Shell><RiderDetail rider={selectedRider} sos={riderSosOf(p.sos, selectedRider.id)} onBack={back} /></Shell>
  if (selectedBusiness) return <Shell><BusinessDetail business={selectedBusiness} onBack={back} /></Shell>
  if (selectedSos) return <Shell><SosDetail sos={selectedSos} onBack={back} /></Shell>
  const selectedTourist = p.selection?.kind === 'tourist' ? p.tourists.find((t) => t.id === p.selection!.id) : undefined
  if (selectedTourist) return <Shell><TouristDetail tourist={selectedTourist} onBack={back} /></Shell>

  const town = p.municipality ? p.towns.find((t) => t.name === p.municipality) : undefined
  const townsWithCoverage = p.towns.filter((t) => t.count > 0).length
  const showTownList = !p.municipality && !p.search.trim()
  const placeholder = p.tab === 'businesses' ? 'Search a restaurant, a resort, a spot…' : p.tab === 'riders' ? 'Search a rider, plate or order no.…' : 'Search a tourist by name or phone…'

  const headline = p.tab === 'businesses'
    ? { big: `${p.businesses.length} ${p.businesses.length === 1 ? 'place' : 'places'},`, accent: town ? `in ${town.name}.` : `${townsWithCoverage} ${townsWithCoverage === 1 ? 'town' : 'towns'}.` }
    : p.tab === 'riders'
      ? { big: `${p.riders.length} ${p.riders.length === 1 ? 'rider' : 'riders'},`, accent: `${p.riders.filter((r) => r.trip).length} on trips.` }
      : { big: `${p.tourists.length} ${p.tourists.length === 1 ? 'tourist' : 'tourists'},`, accent: 'sharing live.' }

  return (
    <Shell>
      <div className="px-6 pt-5">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-[11px] text-[#6B7280]" aria-label="Map location">
          <button type="button" onClick={() => p.onMunicipality('')} className={cn('hover:text-[#0B5D2E]', !town && 'font-semibold text-[#0B5D2E]')}>Oriental Mindoro</button>
          {town && <><ChevronRight className="h-3 w-3" /><span className="font-semibold text-[#0B5D2E]">{town.name}</span></>}
        </nav>

        <p className="mt-4 flex items-center gap-3 text-xs font-bold uppercase tracking-wide text-[#E0A800]">
          <span className="h-1.5 w-7 rounded-full bg-[#FFD000]" aria-hidden="true" /> Live map
        </p>
        <h2 className="mt-2 text-[28px] font-bold leading-tight" style={{ color: GREEN }}>
          {headline.big}{' '}
          <span style={{ color: '#3F4B43' }} className="font-semibold">{headline.accent}</span>
        </h2>

        {/* Search */}
        <label className="mt-4 flex items-center gap-2.5 rounded-full bg-white px-4 py-2.5 shadow-[0_8px_24px_rgba(6,40,20,0.08)] ring-1 ring-[#E7E2D6] focus-within:ring-2 focus-within:ring-[#0B5D2E]/40">
          <Search className="h-4 w-4 shrink-0 text-[#0B5D2E]" />
          <input
            value={p.search}
            onChange={(e) => p.onSearch(e.target.value)}
            placeholder={placeholder}
            aria-label="Search the live map"
            className="min-w-0 flex-1 bg-transparent text-sm placeholder-[#9CA3AF] outline-none"
            style={{ color: INK }}
          />
          {p.search && (
            <button type="button" onClick={() => p.onSearch('')} aria-label="Clear search" className="text-[#9CA3AF] hover:text-[#0B5D2E]">
              <X className="h-4 w-4" />
            </button>
          )}
        </label>

        {/* What to show */}
        <div className="mt-4 grid grid-cols-3 gap-1 rounded-full bg-white p-1.5 shadow-[0_8px_24px_rgba(6,40,20,0.08)] ring-1 ring-[#E7E2D6]" role="tablist" aria-label="Show on map">
          {TABS.map((t) => {
            const n = t.key === 'businesses' ? p.counts.businesses : t.key === 'riders' ? p.counts.riders : p.counts.tourists
            const active = p.tab === t.key
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => p.onTab(t.key)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-2 text-xs font-semibold transition-colors',
                  active ? 'bg-[#0B5D2E] text-white shadow' : 'text-[#14351F] hover:bg-[#EAF6ED]',
                )}
              >
                <t.icon className={cn('h-4 w-4', active ? 'text-[#FFD000]' : 'text-[#0B5D2E]')} aria-hidden="true" />
                {t.label}
                <span className={cn('rounded-full px-1.5 text-[10px] font-bold', active ? 'bg-white/20 text-white' : 'bg-[#EAF6ED] text-[#0B5D2E]')}>{n}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Filters */}
      {p.tab === 'businesses' && p.categories.length > 0 && (
        <div className="mt-3 px-6">
          <FilterSelect label="Category" value={p.category} onChange={p.onCategory}>
            <option value="">All categories</option>
            {p.categories.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
          </FilterSelect>
        </div>
      )}
      {p.tab === 'riders' && (
        <div className="mt-3 px-6">
          <FilterSelect label="Rider status" value={p.riderFilter} onChange={(v) => p.onRiderFilter(v as RiderFilter)}>
            {RIDER_FILTERS.map((f) => <option key={f.key} value={f.key}>{f.key === 'all' ? 'All riders' : f.label} ({p.riderCounts[f.key]})</option>)}
          </FilterSelect>
        </div>
      )}

      <div className="mt-4 flex-1 overflow-y-auto border-t border-[#E7E2D6]">
        {showTownList && (
          <>
            <SectionLabel>Start with a town</SectionLabel>
            <ul className="space-y-1.5 px-6">
              {p.towns.map((t) => (
                <li key={t.name}>
                  <button type="button" onClick={() => p.onMunicipality(t.name)} className={cn(plainCard, 'flex items-center gap-3 px-3 py-1.5')}>
                    <TownLogo town={t} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold leading-tight group-hover:text-[#0B5D2E]" style={{ color: INK }}>{t.name}</span>
                      <span className="block text-[11px] text-[#6B7280]">{p.tab === 'riders' ? 'Riders on duty' : p.tab === 'tourists' ? 'Tourists sharing location' : 'Places to see, stay and eat'}</span>
                    </span>
                    <span className={cn('min-w-8 rounded-full px-2 py-0.5 text-center text-xs font-bold', t.count ? 'bg-[#0B5D2E] text-white' : 'bg-white text-[#9CA3AF]')}>{t.count}</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-[#9CA3AF] transition group-hover:translate-x-0.5 group-hover:text-[#0B5D2E]" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <SectionLabel>
          {p.tab === 'businesses' ? (town ? `Places in ${town.name}` : 'All places') : p.tab === 'riders' ? (town ? `Riders in ${town.name}` : 'All riders on duty') : (town ? `Tourists near ${town.name}` : 'Tourists sharing their location')}
        </SectionLabel>
        <div className="space-y-1.5 px-6 pb-6">
          {p.tab === 'businesses' && (p.businesses.length
            ? p.businesses.map((b) => <BusinessCard key={b.id} business={b} onClick={() => p.onSelect({ kind: 'business', id: b.id })} />)
            : <Empty loading={p.loading} text="No places match these filters." />)}
          {p.tab === 'riders' && (p.riders.length
            ? p.riders.map((r) => <RiderCard key={r.id} rider={r} sos={riderSosOf(p.sos, r.id)} onClick={() => p.onSelect({ kind: 'rider', id: r.id })} />)
            : <Empty loading={p.loading} text="No riders on duty match these filters." />)}
          {p.tab === 'tourists' && (p.tourists.length
            ? p.tourists.map((t) => <TouristCard key={t.id} tourist={t} onClick={() => p.onSelect({ kind: 'tourist', id: t.id })} />)
            : <Empty loading={p.loading} text="No tourists are sharing their location right now. Tourists turn this on themselves in their profile." />)}
        </div>
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="flex h-full flex-col bg-[#FAF7F0]" style={{ fontFamily: "'Poppins', ui-sans-serif, system-ui, sans-serif" }}>{children}</div>
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="flex items-center gap-2 px-6 pb-2 pt-5 text-[11px] font-bold uppercase tracking-wide text-[#0B5D2E]"><span className="h-1 w-4 rounded-full bg-[#FFD000]" aria-hidden="true" />{children}</p>
}

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <label className="relative block">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full cursor-pointer appearance-none rounded-full bg-white py-2 pl-4 pr-10 text-sm font-semibold text-[#14351F] shadow-[0_8px_24px_rgba(6,40,20,0.08)] outline-none ring-1 ring-[#E7E2D6] focus:ring-2 focus:ring-[#0B5D2E]/40"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#0B5D2E]" aria-hidden="true" />
    </label>
  )
}

function Empty({ loading, text }: { loading: boolean; text: string }) {
  return <p className="rounded-2xl border border-dashed border-[#E7E2D6] py-10 text-center text-sm text-[#6B7280]">{loading ? 'Loading…' : text}</p>
}

function TownLogo({ town }: { town: TownRow }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#0B5D2E] text-sm font-bold text-white ring-2 ring-[#FFD000]/70">
      {town.logo && !failed ? <img src={toAssetUrl(town.logo)} alt="" onError={() => setFailed(true)} className="h-full w-full bg-white object-contain" /> : town.name.charAt(0)}
    </span>
  )
}

function Avatar({ rider, size = 'h-9 w-9' }: { rider: LiveRider; size?: string }) {
  const meta = ACTIVITY_META[rider.activity]
  const [failed, setFailed] = useState(false)
  return (
    <span className={cn('relative flex shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-bold text-white', size)} style={{ background: meta.color, boxShadow: `0 0 0 3px ${meta.bg}` }}>
      {rider.photo && !failed ? <img src={toAssetUrl(rider.photo)} alt="" onError={() => setFailed(true)} className="h-full w-full object-cover" /> : getInitials(rider.name)}
    </span>
  )
}

function ActivityBadge({ activity }: { activity: LiveRider['activity'] }) {
  const meta = ACTIVITY_META[activity]
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: meta.color, background: meta.bg }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} /> {meta.label}
    </span>
  )
}

/** Every card: a plain rectangle with slightly rounded corners on a soft tint. */
const plainCard = 'group w-full rounded-lg border border-[#D6E2D8] bg-[#EEF4EF] p-2.5 text-left transition-colors hover:border-[#0B5D2E] hover:bg-[#E3EEE5]'

/** Status colour coding: the card is tinted and bordered in its status colour. */
const tintCard = 'group w-full rounded-lg border p-2.5 text-left transition hover:brightness-[0.97]'

const OPEN_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  open: { label: 'Open', color: '#15803D', bg: '#ECFDF3', border: '#A7E3BD' },
  closed: { label: 'Closed', color: '#B91C1C', bg: '#FEF2F2', border: '#FBC5C5' },
  temporarily_closed: { label: 'Temporarily closed', color: '#B91C1C', bg: '#FEF2F2', border: '#FBC5C5' },
  no_hours: { label: 'Hours not set', color: '#6B7280', bg: '#F3F4F6', border: '#D9DCE1' },
}

const RIDER_TINT: Record<LiveRider['activity'], string> = {
  available: '#A7E3BD',
  delivering: '#FDC9A3',
  transporting: '#B8CCF8',
  busy: '#F6D98B',
}

function BusinessCard({ business: b, onClick }: { business: BusinessPin; onClick: () => void }) {
  const open = OPEN_META[b.open_status?.status ?? 'no_hours'] ?? OPEN_META.no_hours!
  return (
    <button type="button" onClick={onClick} className={cn(tintCard, 'flex items-center gap-3 p-2')} style={{ background: open.bg, borderColor: open.border }}>
      <span className="flex h-12 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white text-[#16803C]">
        {b.cover_photo ? <img src={toAssetUrl(b.cover_photo)} alt="" className="h-full w-full object-cover" /> : <Store className="h-5 w-5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold leading-tight" style={{ color: INK }}>{b.name}</span>
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold" style={{ color: open.color }} title={b.open_status?.label}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: open.color }} />{open.label}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-[#6B7280]">
          {b.category && <span className="font-semibold text-[#16803C]">{b.category}</span>}
          {b.category && <span aria-hidden="true">·</span>}
          <MapPin className="h-3 w-3 shrink-0" />{b.municipality ?? b.address ?? '—'}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-[#9CA3AF] transition group-hover:translate-x-0.5 group-hover:text-[#0B5D2E]" />
    </button>
  )
}

/** The open SOS this rider raised, if any. */
function riderSosOf(sos: SosPin[], riderId: number): SosPin | undefined {
  return sos.find((s) => s.raised_by_role === 'rider' && s.rider_id === riderId)
}

function RiderCard({ rider: r, sos, onClick }: { rider: LiveRider; sos?: SosPin; onClick: () => void }) {
  const meta = ACTIVITY_META[r.activity]
  return (
    <button type="button" onClick={onClick} className={tintCard} style={sos ? { background: '#FEF2F2', borderColor: '#F87171' } : { background: meta.bg, borderColor: RIDER_TINT[r.activity] }}>
      {sos && (
        <span className="mb-2 flex items-center gap-1.5 rounded-md bg-red-600 px-2 py-1 text-[11px] font-bold text-white">
          <CircleAlert className="h-3.5 w-3.5" /> SOS {sos.reference} · {timeAgo(sos.raised_at)}
        </span>
      )}
      <span className="flex items-center gap-2.5">
        <Avatar rider={r} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold leading-tight" style={{ color: INK }}>{r.name}</span>
            <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] text-[#6B7280]"><Clock className="h-3 w-3" />{r.location ? timeAgo(r.location.at) : 'no GPS'}</span>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5"><ActivityBadge activity={r.activity} />{r.municipality && <span className="truncate text-[11px] text-[#6B7280]">{r.municipality}</span>}</span>
        </span>
      </span>
      {r.trip && (
        <span className="mt-2 flex items-center gap-1.5 truncate rounded-md bg-white px-2.5 py-1.5 text-[11px] text-[#374151]">
          {r.trip.type === 'ride' ? <Car className="h-3.5 w-3.5 shrink-0 text-[#2563EB]" /> : <UtensilsCrossed className="h-3.5 w-3.5 shrink-0 text-[#EA580C]" />}
          <span className="shrink-0 font-semibold">{tripStatusLabel(r.trip)}</span>
          {r.trip.dropoff.address && <span className="truncate text-[#6B7280]">→ {r.trip.dropoff.address}</span>}
        </span>
      )}
    </button>
  )
}

function TouristAvatar({ tourist, size = 'h-9 w-9' }: { tourist: LiveTourist; size?: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-bold text-white', size)} style={{ background: TOURIST_COLOR, boxShadow: '0 0 0 3px #E4D8FD' }}>
      {tourist.photo && !failed ? <img src={toAssetUrl(tourist.photo)} alt="" onError={() => setFailed(true)} className="h-full w-full object-cover" /> : getInitials(tourist.name ?? undefined)}
    </span>
  )
}

function TouristCard({ tourist: t, onClick }: { tourist: LiveTourist; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn(tintCard, 'flex items-center gap-2.5')} style={{ background: TOURIST_BG, borderColor: '#D9C8FB' }}>
      <TouristAvatar tourist={t} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold leading-tight" style={{ color: INK }}>{t.name ?? 'Tourist'}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] text-[#6B7280]"><Clock className="h-3 w-3" />{timeAgo(t.location.at)}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-[#6B7280]"><MapPin className="h-3 w-3 shrink-0" />{t.municipality ? `Near ${t.municipality}` : 'Location shared'}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-[#9CA3AF] transition group-hover:translate-x-0.5" />
    </button>
  )
}

function TouristDetail({ tourist: t, onBack }: { tourist: LiveTourist; onBack: () => void }) {
  return (
    <>
      <DetailHeader eyebrow="Tourist" onBack={onBack} />
      <div className="flex-1 space-y-4 overflow-y-auto px-6 pb-6">
        <div className="flex items-center gap-4">
          <TouristAvatar tourist={t} size="h-16 w-16" />
          <div className="min-w-0">
            <h2 className="truncate text-2xl font-bold leading-tight" style={{ color: GREEN }}>{t.name ?? 'Tourist'}</h2>
            <span className="mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: TOURIST_COLOR, background: TOURIST_BG }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: TOURIST_COLOR }} /> Sharing live location
            </span>
          </div>
        </div>
        <div className={cn(box, 'space-y-2.5')}>
          {t.phone && <Row icon={Phone}><a href={`tel:${t.phone}`} className="hover:text-[#0B5D2E]">{t.phone}</a></Row>}
          <Row icon={MapPin}>{t.municipality ? `Near ${t.municipality}` : 'Location shared'}</Row>
          <Row icon={Clock}>Updated {timeAgo(t.location.at)}{t.location.accuracy_m ? ` · within about ${Math.round(t.location.accuracy_m)} m` : ''}</Row>
        </div>
        <p className="flex items-start gap-2 rounded-lg bg-[#F3F4F6] p-3 text-xs text-[#4B5563]">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#0B5D2E]" />
          The tourist turned on location sharing themselves. Only their latest position is kept; it disappears when they turn sharing off or close the app.
        </p>
      </div>
    </>
  )
}

function sosHasPoint(s: SosPin) {
  return !!(s.live_location ?? s.location)
}

function DetailHeader({ eyebrow, onBack }: { eyebrow: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-3 px-6 pb-3 pt-5">
      <button type="button" onClick={onBack} className="flex h-9 w-9 items-center justify-center rounded-full border border-[#E7E2D6] bg-white text-[#374151] transition hover:border-[#0B5D2E] hover:text-[#0B5D2E]" aria-label="Back to list">
        <ArrowLeft className="h-4 w-4" />
      </button>
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[#E0A800]"><span className="h-1.5 w-6 rounded-full bg-[#FFD000]" aria-hidden="true" />{eyebrow}</p>
    </div>
  )
}

function Row({ icon: Icon, children }: { icon: typeof Phone; children: ReactNode }) {
  return <p className="flex items-start gap-2.5 text-sm text-[#374151]"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#9CA3AF]" /><span className="min-w-0">{children}</span></p>
}

const box = 'rounded-2xl bg-white p-4 ring-1 ring-[#E7E2D6]'

function RiderDetail({ rider: r, sos, onBack }: { rider: LiveRider; sos?: SosPin; onBack: () => void }) {
  const portal = useOfficePortal()
  const trip = r.trip
  const meta = ACTIVITY_META[r.activity]
  return (
    <>
      <DetailHeader eyebrow="Rider" onBack={onBack} />
      <div className="flex-1 space-y-4 overflow-y-auto px-6 pb-6">
        {sos && (
          <Link to={`${portal.route}/live/sos`} className="flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-red-700">
            <CircleAlert className="h-4 w-4 shrink-0" />
            <span className="flex-1">SOS {sos.reference} raised {timeAgo(sos.raised_at)}</span>
            <span className="text-xs font-semibold underline">Handle</span>
          </Link>
        )}
        <div className="flex items-center gap-4">
          <Avatar rider={r} size="h-16 w-16" />
          <div className="min-w-0">
            <h2 className="truncate text-2xl font-bold leading-tight" style={{ color: GREEN }}>{r.name}</h2>
            <div className="mt-1.5"><ActivityBadge activity={r.activity} /></div>
          </div>
        </div>

        <div className={cn(box, 'space-y-2.5')}>
          {r.phone && <Row icon={Phone}><a href={`tel:${r.phone}`} className="hover:text-[#0B5D2E]">{r.phone}</a></Row>}
          <Row icon={Bike}><span className="capitalize">{[r.vehicle_type, r.plate_number].filter(Boolean).join(' · ') || 'Vehicle not set'}</span></Row>
          {r.municipality && <Row icon={MapPin}>{r.municipality}</Row>}
          <Row icon={Clock}>{r.location ? `Last GPS ${timeAgo(r.location.at)}` : 'No GPS location yet'}</Row>
        </div>

        {trip ? (
          <div className={cn(box, 'space-y-4')}>
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: meta.color }}>
                {trip.type === 'ride' ? <Car className="h-4 w-4" /> : <UtensilsCrossed className="h-4 w-4" />}
                {trip.type === 'ride' ? 'Ride' : 'Food delivery'}
              </p>
              {trip.order_number && <span className="text-xs text-[#6B7280]">{trip.order_number}</span>}
            </div>
            <p className="text-lg font-semibold leading-snug" style={{ color: INK }}>{tripStatusLabel(trip)}</p>

            <ol className="relative space-y-4 border-l-2 border-dashed border-[#E7E2D6] pl-5">
              {trip.pickups.map((stop, i) => (
                <li key={i} className="relative">
                  <span className={cn('absolute -left-[31px] top-0 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white ring-4 ring-white', stop.collected ? 'bg-[#9CA3AF]' : 'bg-[#F59E0B]')}>
                    {stop.collected ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
                  </span>
                  <span className="block text-sm font-semibold" style={{ color: INK }}>
                    {trip.type === 'ride' ? 'Passenger pickup' : stop.name ?? 'Restaurant'}
                    {stop.collected ? <span className="ml-1.5 text-xs font-medium text-[#6B7280]">done</span> : trip.stage === 'to_pickup' ? <span className="ml-1.5 text-xs font-semibold text-[#B45309]">next</span> : null}
                  </span>
                  {stop.address && <span className="block text-xs text-[#6B7280]">{stop.address}</span>}
                </li>
              ))}
              <li className="relative">
                <span className="absolute -left-[31px] top-0 flex h-6 w-6 items-center justify-center rounded-full bg-[#DC2626] text-white ring-4 ring-white"><Flag className="h-3.5 w-3.5" /></span>
                <span className="block text-sm font-semibold" style={{ color: INK }}>
                  {trip.type === 'ride' ? 'Destination' : 'Drop-off'}
                  {trip.stage === 'to_dropoff' && <span className="ml-1.5 text-xs font-semibold text-[#B45309]">heading here</span>}
                </span>
                <span className="block text-xs text-[#6B7280]">{trip.dropoff.address ?? 'Address not set'}</span>
                {trip.customer_name && <span className="block text-xs text-[#6B7280]">{trip.type === 'ride' ? 'Passenger' : 'Customer'}: {trip.customer_name}</span>}
              </li>
            </ol>
            <p className="text-[11px] text-[#9CA3AF]">The route is drawn on the map and follows the rider live.</p>
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-[#E7E2D6] p-4 text-center text-sm text-[#6B7280]">Not on a trip right now, so no route.</p>
        )}
      </div>
    </>
  )
}

function BusinessDetail({ business: b, onBack }: { business: BusinessPin; onBack: () => void }) {
  const portal = useOfficePortal()
  return (
    <>
      <DetailHeader eyebrow="Place" onBack={onBack} />
      <div className="flex-1 space-y-4 overflow-y-auto px-6 pb-6">
        <div className="overflow-hidden rounded-2xl ring-1 ring-[#E7E2D6]">
          <div className="flex h-44 items-center justify-center bg-[#EAF6ED] text-[#16803C]">
            {b.cover_photo ? <img src={toAssetUrl(b.cover_photo)} alt="" className="h-full w-full object-cover" /> : <Store className="h-10 w-10" />}
          </div>
        </div>
        <div>
          {b.category && <p className="text-[10px] font-bold uppercase tracking-wide text-[#16803C]">{b.category}</p>}
          <h2 className="mt-1 text-2xl font-bold leading-tight" style={{ color: GREEN }}>{b.name}</h2>
        </div>
        <div className={cn(box, 'space-y-2.5')}>
          <Row icon={MapPin}>{[b.address, b.municipality].filter(Boolean).join(', ') || 'Address not provided'}</Row>
          {b.open_status && <Row icon={Clock}><span style={{ color: (OPEN_META[b.open_status.status] ?? OPEN_META.no_hours!).color }} className="font-semibold">{b.open_status.label}</span></Row>}
          <Row icon={CheckCircle2}><span className="capitalize">{b.status.replace(/_/g, ' ')}</span></Row>
        </div>
        <Link to={`${portal.route}/businesses`} className="block rounded-full bg-[#FFD000] px-4 py-3 text-center text-sm font-bold text-[#14351F] shadow-[0_10px_24px_rgba(224,168,0,0.35)] hover:bg-[#FFDD33]">Open in Businesses</Link>
      </div>
    </>
  )
}

function SosDetail({ sos: s, onBack }: { sos: SosPin; onBack: () => void }) {
  const portal = useOfficePortal()
  return (
    <>
      <DetailHeader eyebrow="SOS alert" onBack={onBack} />
      <div className="flex-1 space-y-4 overflow-y-auto px-6 pb-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold" style={{ color: GREEN }}>{s.reference}</h2>
          <span className={cn('rounded-full px-2.5 py-1 text-[10px] font-bold uppercase', s.status === 'pending' ? 'bg-red-600 text-white' : 'bg-orange-100 text-orange-700')}>{s.status}</span>
        </div>
        <div className={cn(box, 'space-y-2.5 ring-red-200')}>
          <Row icon={CircleAlert}>{s.reporter.name ?? 'Unknown'} ({s.raised_by_role}){s.service ? ` · ${s.service}` : ''}</Row>
          {s.reporter.phone && <Row icon={Phone}><a href={`tel:${s.reporter.phone}`} className="hover:text-[#0B5D2E]">{s.reporter.phone}</a></Row>}
          <Row icon={Clock}>Raised {timeAgo(s.raised_at)}</Row>
          {s.order?.order_number && <Row icon={Flag}>Trip {s.order.order_number}{s.order.dropoff ? ` → ${s.order.dropoff}` : ''}</Row>}
          {s.message && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">“{s.message}”</p>}
          {!sosHasPoint(s) && <p className="text-xs text-[#6B7280]">No location was shared with this alert.</p>}
        </div>
        <Link to={`${portal.route}/live/sos`} className="block rounded-full bg-red-600 px-4 py-3 text-center text-sm font-bold text-white hover:bg-red-700">Handle in SOS Alerts</Link>
      </div>
    </>
  )
}
