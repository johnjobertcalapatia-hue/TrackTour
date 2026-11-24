import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Info, Loader2, Save } from 'lucide-react'
import { apiErrorMessage, get, put } from '@/shared/services/api'
import { Alert } from '@/shared/components/Alert'
import CommissionRatesForm, { type RateDraft } from '@/shared/components/CommissionRatesForm'
import {
  DISTRICT_FIELDS,
  FIELD_META,
  STAGE_ONE_NOTICE,
  TOWN_FIELDS,
  formatRate,
  limitDraft,
  limitPayload,
  limitsFromDraft,
  townDraft,
  townPayload,
  type DistrictRates,
  type EffectiveRates,
  type LimitDraft,
  type RateField,
  type TownField,
  type TownOverrides,
} from '@/shared/finance/commission-rates'

interface TownRow {
  id: number
  name: string
  is_home: boolean
  can_edit: boolean
  effective: EffectiveRates
  overrides: TownOverrides
  has_own_rates: boolean
}

interface RatesResponse {
  district: DistrictRates
  municipalities: TownRow[]
}

const QUERY_KEY = ['admin-commission-rates']

function districtDraft(d: DistrictRates): RateDraft {
  const draft: RateDraft = {}
  for (const f of [...TOWN_FIELDS, ...DISTRICT_FIELDS] as RateField[]) draft[f] = String(d.rates[f])
  return draft
}

/**
 * Bansud super admin — commission rates (Earnings Stage 1, §R2): district
 * defaults, Bansud's own rates, and a read-only view of every town.
 */
export default function AdminCommissionRates() {
  const queryClient = useQueryClient()
  const { data, isLoading, isError } = useQuery({ queryKey: QUERY_KEY, queryFn: () => get<RatesResponse>('/admin/commission-rates') })
  const home = useMemo(() => data?.municipalities.find((m) => m.is_home), [data])

  const [district, setDistrict] = useState<RateDraft>({})
  const [options, setOptions] = useState('')
  const [limits, setLimits] = useState<LimitDraft | null>(null)
  const [own, setOwn] = useState<RateDraft>({})
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    if (!data) return
    setDistrict(districtDraft(data.district))
    setOptions(data.district.fast_amount_options.join(', '))
    setLimits(limitDraft(data.district.limits))
    if (home) setOwn(townDraft(home.overrides))
  }, [data, home])

  const done = (message: string) => {
    setNotice({ type: 'success', message })
    queryClient.invalidateQueries({ queryKey: QUERY_KEY })
  }
  const failed = (error: unknown) => setNotice({ type: 'error', message: apiErrorMessage(error, 'The rates could not be saved.') })

  const saveDistrict = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {}
      for (const f of [...TOWN_FIELDS, ...DISTRICT_FIELDS] as RateField[]) payload[f] = district[f] === '' || district[f] === undefined ? null : Number(district[f])
      payload.fast_amount_options = options.split(',').map((s) => s.trim()).filter(Boolean).map(Number)
      if (limits) payload.limits = limitPayload(limits)
      return put('/admin/commission-rates', payload)
    },
    onSuccess: () => done('District defaults saved.'),
    onError: failed,
  })
  const saveOwn = useMutation({
    mutationFn: () => put(`/admin/commission-rates/municipalities/${home!.id}`, townPayload(own)),
    onSuccess: () => done(`${home?.name ?? 'Bansud'} rates saved.`),
    onError: failed,
  })

  if (isLoading) return <p className="text-sm text-[#6B7280]">Loading commission rates…</p>
  if (isError || !data) return <Alert type="error" message="Commission rates could not be loaded." />

  // The ranges being edited, for the live hints on the district form (the Bansud form uses the saved ones).
  const draftLimits = limits ? limitsFromDraft(limits, data.district.limits) : data.district.limits

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">Commission rates</h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          District defaults for every municipality. Each town&apos;s office may set its own rates; new orders and rides keep the rates they were booked with.
        </p>
      </div>

      <div className="flex gap-2 rounded-xl border border-[#F3D88A] bg-[#FFF8E1] px-3 py-2 text-xs text-[#7C5A00]" role="note">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>{STAGE_ONE_NOTICE}</p>
      </div>

      {notice && <Alert type={notice.type} message={notice.message} onDismiss={() => setNotice(null)} />}

      <section aria-label="District defaults" className="space-y-3">
        <SectionHeader
          title="District defaults"
          subtitle="Used by every municipality that has not set its own value."
          busy={saveDistrict.isPending}
          onSave={() => { setNotice(null); saveDistrict.mutate() }}
          label="Save district defaults"
        />
        <CommissionRatesForm
          mode="district"
          draft={district}
          onChange={(f, v) => setDistrict((d) => ({ ...d, [f]: v }))}
          fallback={data.district.rates}
          fastOptions={options}
          onFastOptionsChange={setOptions}
          limits={draftLimits}
          disabled={saveDistrict.isPending}
        />
        {limits && (
          <LimitsEditor
            draft={limits}
            onChange={(field, end, value) => setLimits((d) => (d ? { ...d, [field]: { ...d[field], [end]: value } } : d))}
            disabled={saveDistrict.isPending}
          />
        )}
      </section>

      {home && (
        <section aria-label={`${home.name} own rates`} className="space-y-3">
          <SectionHeader
            title={`${home.name}'s own rates`}
            subtitle="Leave a field blank to use the district default."
            busy={saveOwn.isPending}
            onSave={() => { setNotice(null); saveOwn.mutate() }}
            label={`Save ${home.name} rates`}
          />
          <CommissionRatesForm
            mode="town"
            draft={own}
            onChange={(f, v) => setOwn((d) => ({ ...d, [f]: v }))}
            fallback={data.district.rates}
            limits={data.district.limits}
            disabled={saveOwn.isPending}
          />
        </section>
      )}

      <section aria-label="Rates by municipality" className="rounded-2xl border border-[#E2E8E3] bg-white">
        <div className="border-b border-[#E2E8E3] px-4 py-3">
          <h2 className="text-base font-semibold text-[#17201A]">Rates by municipality</h2>
          <p className="text-xs text-[#6B7280]">
            What applies in each town now. Green values are the town&apos;s own; the rest are district defaults. Each office changes its own.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#F7F9F7] text-left text-xs text-[#6B7280]">
              <tr>
                <th className="px-4 py-2 font-medium">Municipality</th>
                <th className="px-3 py-2 font-medium">Driver share</th>
                <th className="px-3 py-2 font-medium">Driver min.</th>
                <th className="px-3 py-2 font-medium">Food fee</th>
                <th className="px-3 py-2 font-medium">Office food share</th>
                <th className="px-3 py-2 font-medium">Fast split</th>
                <th className="px-3 py-2 font-medium">Cash-out fee</th>
              </tr>
            </thead>
            <tbody>
              {data.municipalities.map((town) => (
                <tr key={town.id} className="border-t border-[#EEF2EE]" data-testid={`rates-row-${town.id}`}>
                  <td className="px-4 py-2">
                    <span className="font-medium text-[#17201A]">{town.name}</span>
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${town.has_own_rates ? 'bg-[#EAF6ED] text-[#16803C]' : 'bg-[#F1F3F1] text-[#6B7280]'}`}>
                      {town.has_own_rates ? 'Own rates' : 'Defaults'}
                    </span>
                  </td>
                  {(['ride_driver_percent', 'ride_driver_minimum', 'food_system_fee_percent', 'food_office_percent'] as RateField[]).map((f) => (
                    <Cell key={f} town={town} field={f} />
                  ))}
                  <td className="px-3 py-2 tabular-nums">
                    {(['fast_platform_percent', 'fast_rider_percent', 'fast_office_percent'] as RateField[])
                      .map((f) => Number(town.effective.rates[f].toFixed(2)))
                      .join(' / ')}
                  </td>
                  <Cell town={town} field="cashout_fee_percent" />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

/**
 * Bansud's limits for each town rate (§R5). Saved with the district
 * defaults; the defaults and every town's own value must sit inside them.
 */
function LimitsEditor({ draft, onChange, disabled }: {
  draft: LimitDraft
  onChange: (field: TownField, end: 'min' | 'max', value: string) => void
  disabled?: boolean
}) {
  const input = 'h-8 w-24 rounded-lg border border-[#D6DED8] bg-white px-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-[#16803C]/30 focus:border-[#16803C] disabled:bg-[#F4F7F2]'
  return (
    <section aria-label="Limits for municipalities" className="rounded-2xl border border-[#E2E8E3] bg-white">
      <div className="border-b border-[#E2E8E3] px-4 py-3">
        <h3 className="text-sm font-semibold text-[#17201A]">Limits for municipalities</h3>
        <p className="text-xs text-[#6B7280]">
          The lowest and highest value a town may set. The district defaults must sit inside them. Saved with the district defaults.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[#F7F9F7] text-left text-xs text-[#6B7280]">
            <tr>
              <th className="px-4 py-2 font-medium">Rate</th>
              <th className="px-3 py-2 font-medium">Lowest</th>
              <th className="px-3 py-2 font-medium">Highest</th>
            </tr>
          </thead>
          <tbody>
            {TOWN_FIELDS.map((field) => {
              const meta = FIELD_META[field]
              const label = field.startsWith('fast_') ? `Fast Delivery ${meta.label}` : meta.label
              const inverted = draft[field].min !== '' && draft[field].max !== '' && Number(draft[field].min) > Number(draft[field].max)
              return (
                <tr key={field} className="border-t border-[#EEF2EE]">
                  <td className="px-4 py-2 text-[#17201A]">
                    {label} <span className="text-xs text-[#6B7280]">({meta.unit})</span>
                    {inverted && <span className="ml-2 text-xs font-semibold text-[#B91C1C]">Lowest is above highest</span>}
                  </td>
                  {(['min', 'max'] as const).map((end) => (
                    <td key={end} className="px-3 py-2">
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        value={draft[field][end]}
                        onChange={(e) => onChange(field, end, e.target.value)}
                        disabled={disabled}
                        aria-label={`${end === 'min' ? 'Lowest' : 'Highest'} ${label}`}
                        className={`${input} ${inverted ? 'border-[#B91C1C]' : ''}`}
                      />
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Cell({ town, field }: { town: TownRow; field: RateField }) {
  const own = town.effective.sources[field] === 'town'
  return (
    <td className={`px-3 py-2 tabular-nums ${own ? 'font-semibold text-[#16803C]' : 'text-[#17201A]'}`}>
      {formatRate(field, town.effective.rates[field])}
    </td>
  )
}

function SectionHeader({ title, subtitle, busy, onSave, label }: { title: string; subtitle: string; busy: boolean; onSave: () => void; label: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-[#17201A]">{title}</h2>
        <p className="text-xs text-[#6B7280]">{subtitle}</p>
      </div>
      <button
        type="button"
        onClick={onSave}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-xl bg-[#16803C] px-4 py-2 text-sm font-medium text-white hover:bg-[#126B32] disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {label}
      </button>
    </div>
  )
}
