import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BedDouble, Compass, Pencil, Settings2, Ticket, Trees } from 'lucide-react'
import { get } from '@/shared/services/api'
import { toAssetUrl } from '@/shared/utils'
import { priceLabel, type OwnerOffering } from '../../services/resort-offerings'
import { splitActivities } from '../../services/business-profile-kind'

/**
 * The type-specific parts of the Business Gallery page for resorts and tourist
 * attractions (restaurants keep Signature Dishes and Menu in the page itself).
 * Each reads the business's own data and links to the page that edits it.
 */

const card = 'bg-white rounded-2xl border border-[#E5E7EB] shadow-[0_1px_3px_rgba(0,0,0,0.1)] p-6'
const chip = 'inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-1.5 rounded-lg text-sm'
const editLink = 'inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#F3F8F4] border border-[#D7E8DB] text-[#16803C] text-sm font-semibold hover:bg-[#EAF6ED] transition'

export interface ResortProfile {
  types: { id: number; slug: string; name: string }[]
  facilities: { id: number; slug: string; name: string }[]
  custom_facilities: string[]
}

export function useResortProfile(businessId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: ['bo-resort-profile', businessId],
    queryFn: () => get<ResortProfile>(`/business-owner/businesses/${businessId}/resort-profile`),
    enabled: enabled && businessId !== null,
  })
}

export function useResortOfferings(businessId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: ['bo-resort-offerings', businessId],
    queryFn: () => get<{ offerings: OwnerOffering[] }>(`/business-owner/businesses/${businessId}/resort-offerings`),
    enabled: enabled && businessId !== null,
  })
}

/** Resort type and facilities (edited on Resort Types & Facilities). */
export function ResortHighlights({ businessId, editable }: { businessId: number | null; editable: boolean }) {
  const { data, isLoading } = useResortProfile(businessId, true)
  const facilities = [...(data?.facilities.map((f) => f.name) ?? []), ...(data?.custom_facilities ?? [])]

  return (
    <div className={card} data-testid="resort-highlights">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h2 className="text-lg font-semibold text-[#111827] flex items-center gap-2"><Trees className="w-5 h-5 text-[#16803C]" /> Resort Highlights</h2>
        {editable && <Link to="/business-owner/resort/profile" className={editLink}><Settings2 className="w-4 h-4" /> Edit type &amp; facilities</Link>}
      </div>
      {isLoading ? <p className="text-sm text-[#6B7280]">Loading…</p> : (
        <div className="space-y-3">
          {data && data.types.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {data.types.map((t) => <span key={t.id} className="inline-flex items-center rounded-lg bg-[#0F4D2B] px-3 py-1.5 text-sm font-semibold text-white">{t.name}</span>)}
            </div>
          )}
          {facilities.length > 0 ? (
            <div className="flex flex-wrap gap-2">{facilities.map((f) => <span key={f} className={chip}>{f}</span>)}</div>
          ) : (
            <p className="text-sm text-[#6B7280]">No facilities yet{editable ? ' — add what your resort offers, such as cottages, a pool or beach access.' : '.'}</p>
          )}
        </div>
      )}
    </div>
  )
}

/** Cottages, rooms and other bookable offerings (edited on Cottages & Offerings). */
export function ResortOfferingsTab({ businessId, editable }: { businessId: number | null; editable: boolean }) {
  const { data, isLoading } = useResortOfferings(businessId, true)
  const offerings = data?.offerings ?? []

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[#111827]">Cottages, Rooms &amp; Offerings</h3>
        {editable && <Link to="/business-owner/resort/offerings" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#16803C] hover:bg-[#126B32] text-white text-sm font-semibold transition"><Pencil className="w-4 h-4" /> Manage offerings</Link>}
      </div>
      {isLoading ? <p className="py-10 text-center text-sm text-[#6B7280]">Loading…</p> : offerings.length === 0 ? (
        <div className="text-center py-10">
          <BedDouble className="w-10 h-10 text-[#9CA3AF] mx-auto mb-3" />
          <p className="text-sm text-[#6B7280]">No cottages or rooms yet. Add them in Cottages &amp; Offerings.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {offerings.map((o) => (
            <div key={o.id} className="bg-white rounded-xl border border-[#E5E7EB] overflow-hidden">
              <div className="aspect-[4/3] bg-[#F3F4F6] overflow-hidden relative">
                {o.images[0] ? <img src={toAssetUrl(o.images[0].path)} alt={o.name} className="w-full h-full object-cover" /> : (
                  <div className="w-full h-full flex items-center justify-center"><BedDouble className="w-8 h-8 text-[#9CA3AF]" /></div>
                )}
                {!o.is_published && <span className="absolute top-2 left-2 rounded-md bg-[#374151] px-2 py-0.5 text-[10px] font-semibold text-white">Hidden</span>}
              </div>
              <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold text-[#111827]">{o.name}</span>
                  <span className="text-sm font-bold text-[#16803C] flex-shrink-0">{priceLabel(o)}</span>
                </div>
                <p className="text-xs text-[#6B7280] mt-0.5">{o.category_label}</p>
                {o.description && <p className="text-xs text-[#6B7280] mt-1 line-clamp-2">{o.description}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export type AttractionDetails = Record<string, string | null | undefined>

const entranceLabel = (fee: string | null | undefined) => {
  const n = Number(fee ?? 0)
  return !fee || !Number.isFinite(n) || n <= 0 ? 'Free' : `₱${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

/** Activities and the attraction type (edited on the attraction's edit page). */
export function AttractionHighlights({ businessId, details, editable }: { businessId: number | null; details: AttractionDetails; editable: boolean }) {
  const activities = splitActivities(details.activities)

  return (
    <div className={card} data-testid="attraction-highlights">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h2 className="text-lg font-semibold text-[#111827] flex items-center gap-2"><Compass className="w-5 h-5 text-[#16803C]" /> Things to Do</h2>
        {editable && businessId !== null && <Link to={`/business-owner/businesses/${businessId}/tourist-attraction-edit`} className={editLink}><Pencil className="w-4 h-4" /> Edit details</Link>}
      </div>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {details.attraction_type && <span className="inline-flex items-center rounded-lg bg-[#0F4D2B] px-3 py-1.5 text-sm font-semibold text-white">{details.attraction_type}</span>}
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-1.5 text-sm text-[#374151]"><Ticket className="w-4 h-4" /> Entrance: {entranceLabel(details.entrance_fee)}</span>
        </div>
        {activities.length > 0 ? (
          <div className="flex flex-wrap gap-2">{activities.map((a) => <span key={a} className={chip}>{a}</span>)}</div>
        ) : (
          <p className="text-sm text-[#6B7280]">No activities yet{editable ? ' — list what visitors can do, such as swimming, hiking or picnics.' : '.'}</p>
        )}
      </div>
    </div>
  )
}

/** Visit information for tourists: type, fee, best time and activities. */
export function AttractionVisitInfo({ details }: { details: AttractionDetails }) {
  const rows = [
    ['Attraction type', details.attraction_type || 'Not set'],
    ['Entrance fee', entranceLabel(details.entrance_fee)],
    ['Best time to visit', details.best_time_to_visit || 'Not set'],
    ['Activities', splitActivities(details.activities).join(', ') || 'Not set'],
  ]

  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-testid="attraction-visit-info">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-sm font-semibold text-[#111827] mb-1">{label}</dt>
          <dd className="text-sm text-[#4B5563]">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
