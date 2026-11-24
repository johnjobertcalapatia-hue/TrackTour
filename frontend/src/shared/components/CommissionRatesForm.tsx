import type { ReactNode } from 'react'
import { Car, Landmark, UtensilsCrossed, Wallet, Zap, type LucideIcon } from 'lucide-react'
import {
  FIELD_META,
  fastSplit,
  foodSplit,
  formatRange,
  formatRate,
  outsideLimit,
  peso,
  rideSplit,
  type Limit,
  type Limits,
  type RateField,
  type Rates,
  type TownField,
} from '@/shared/finance/commission-rates'

/**
 * Commission rates form (Earnings Stage 1, §R2).
 *  - mode "district": the Bansud defaults; every field required, plus the
 *    district-only TrackTour share and Fast Delivery amounts.
 *  - mode "town": a municipality's own rates; a blank field uses the
 *    district default (shown as the placeholder).
 * Each card shows a worked peso example with the rates on screen. With
 * `limits`, every town rate shows Bansud's allowed range and is marked when
 * the value typed is outside it (the server refuses it on save).
 */
export type RateDraft = Partial<Record<RateField, string>>

interface Props {
  mode: 'district' | 'town'
  draft: RateDraft
  onChange: (field: RateField, value: string) => void
  /** What a blank town field falls back to (the district defaults). */
  fallback: Rates
  /** District mode: the Fast Delivery amounts, comma-separated. */
  fastOptions?: string
  onFastOptionsChange?: (value: string) => void
  /** Town mode: the district-only values, shown read-only. */
  districtInfo?: { platformNetPercent: number; fastOptions: number[] }
  /** Bansud's allowed range for each town rate. */
  limits?: Limits
  disabled?: boolean
}

const inputClass =
  'w-full h-9 rounded-lg border border-[#D6DED8] bg-white text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/30 focus:border-[#16803C] disabled:bg-[#F4F7F2]'

export default function CommissionRatesForm({ mode, draft, onChange, fallback, fastOptions, onFastOptionsChange, districtInfo, limits, disabled }: Props) {
  const value = (field: RateField): number => {
    const raw = draft[field]
    return raw === undefined || raw === '' || Number.isNaN(Number(raw)) ? fallback[field] : Number(raw)
  }

  const ride200 = rideSplit(200, value('ride_driver_percent'), value('ride_driver_minimum'))
  const ride40 = rideSplit(40, value('ride_driver_percent'), value('ride_driver_minimum'))
  const food = foodSplit(100, value('food_system_fee_percent'), value('food_office_percent'))
  const fast = fastSplit(50, value('fast_platform_percent'), value('fast_rider_percent'))
  const fastTotal = value('fast_platform_percent') + value('fast_rider_percent') + value('fast_office_percent')
  const fastOk = Math.abs(fastTotal - 100) < 0.001

  const field = (name: RateField) => (
    <RateInput
      key={name}
      name={name}
      mode={mode}
      raw={draft[name] ?? ''}
      fallback={fallback[name]}
      limit={limits?.[name as TownField]}
      onChange={onChange}
      disabled={disabled}
    />
  )

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <RateCard icon={Car} title="Ride hailing" subtitle="Driver earnings; the office gets the rest of the fare">
        <div className="grid grid-cols-2 gap-3">{(['ride_driver_percent', 'ride_driver_minimum'] as TownField[]).map(field)}</div>
        <Example>
          {peso(200)} fare → driver {peso(ride200.driver)}, office {peso(ride200.office)}. {peso(40)} fare → driver {peso(ride40.driver)}, office {peso(ride40.office)}.
        </Example>
      </RateCard>

      <RateCard icon={UtensilsCrossed} title="Food orders" subtitle="Cash and GCash; the rider keeps the whole delivery fee">
        <div className="grid grid-cols-2 gap-3">{(['food_system_fee_percent', 'food_office_percent'] as TownField[]).map(field)}</div>
        <Example>
          {peso(100)} food + {peso(food.fee)} fee → restaurant {peso(food.restaurant)}, office {peso(food.office)}.
        </Example>
      </RateCard>

      <RateCard icon={Zap} title="Fast Delivery split" subtitle="How a Fast Delivery fee is shared">
        <div className="grid grid-cols-3 gap-3">{(['fast_platform_percent', 'fast_rider_percent', 'fast_office_percent'] as TownField[]).map(field)}</div>
        <p data-testid="fast-split-total" className={`mt-2 text-xs font-semibold ${fastOk ? 'text-[#16803C]' : 'text-[#B91C1C]'}`}>
          Total {Number(fastTotal.toFixed(2))}% {fastOk ? '' : '— must be exactly 100%'}
        </p>
        <Example>
          {peso(50)} fee → TrackTour {peso(fast.platform)}, rider {peso(fast.rider)}, office {peso(fast.office)}.
        </Example>
      </RateCard>

      <RateCard icon={Wallet} title="Rider cash-out" subtitle="Online cash-outs only; cash earnings are not affected">
        <div className="grid grid-cols-2 gap-3">{field('cashout_fee_percent')}</div>
        <Example>
          {peso(1000)} cash-out → fee {peso(Math.round(1000 * value('cashout_fee_percent')) / 100)}, rider receives {peso(1000 - Math.round(1000 * value('cashout_fee_percent')) / 100)}.
        </Example>
      </RateCard>

      {mode === 'district' ? (
        <RateCard icon={Landmark} title="District-wide (Bansud only)" subtitle="Towns cannot change these" wide>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {field('platform_net_percent')}
            {field('fast_amount_minimum')}
            {field('fast_amount_maximum')}
          </div>
          <label className="mt-3 block text-xs font-medium text-[#17201A]">
            Fast Delivery amounts the tourist can pick (₱, comma-separated)
            <input
              type="text"
              inputMode="decimal"
              value={fastOptions ?? ''}
              onChange={(e) => onFastOptionsChange?.(e.target.value)}
              disabled={disabled}
              aria-label="Fast Delivery amounts"
              className={`${inputClass} mt-1 px-2.5`}
            />
          </label>
          <Example>
            A town with {peso(50000)} commissions and {peso(20000)} expenses → TrackTour {peso(Math.round(30000 * value('platform_net_percent')) / 100)}.
          </Example>
        </RateCard>
      ) : districtInfo ? (
        <RateCard icon={Landmark} title="Set by Bansud for the whole district" subtitle="Shown for reference" wide>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-xs text-[#6B7280]">{FIELD_META.platform_net_percent.label}</dt>
              <dd className="font-semibold text-[#17201A]">{formatRate('platform_net_percent', districtInfo.platformNetPercent)}</dd>
            </div>
            <div>
              <dt className="text-xs text-[#6B7280]">Fast Delivery amounts</dt>
              <dd className="font-semibold text-[#17201A]">{districtInfo.fastOptions.map((n) => peso(n)).join(' · ')}</dd>
            </div>
          </dl>
        </RateCard>
      ) : null}
    </div>
  )
}

function RateInput({ name, mode, raw, fallback, limit, onChange, disabled }: {
  name: RateField
  mode: 'district' | 'town'
  raw: string
  fallback: number
  limit?: Limit
  onChange: (field: RateField, value: string) => void
  disabled?: boolean
}) {
  const meta = FIELD_META[name]
  const own = mode === 'town' && raw !== ''
  const outside = outsideLimit(raw, limit)
  return (
    <div title={meta.hint}>
      <div className="mb-1 flex items-center justify-between gap-1">
        <label htmlFor={`rate-${name}`} className="text-xs font-medium text-[#17201A]">{meta.label}</label>
        {mode === 'town' && (
          own ? (
            <button
              type="button"
              onClick={() => onChange(name, '')}
              disabled={disabled}
              className="text-[10px] font-semibold text-[#16803C] hover:underline"
              aria-label={`Use the district default for ${meta.label}`}
            >
              Use default
            </button>
          ) : (
            <span className="text-[10px] text-[#6B7280]">Default</span>
          )
        )}
      </div>
      <div className="relative">
        {meta.unit === '₱' && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-[#6B7280]">₱</span>}
        <input
          id={`rate-${name}`}
          type="number"
          min={limit?.min ?? 0}
          max={limit?.max ?? (meta.unit === '%' ? 100 : undefined)}
          aria-invalid={outside || undefined}
          aria-describedby={limit ? `rate-${name}-range` : undefined}
          step="0.01"
          value={raw}
          placeholder={mode === 'town' ? String(fallback) : undefined}
          onChange={(e) => onChange(name, e.target.value)}
          disabled={disabled}
          className={`${inputClass} ${meta.unit === '₱' ? 'pl-6' : 'pl-2.5'} ${meta.unit === '%' ? 'pr-7' : 'pr-2'} ${outside ? 'border-[#B91C1C] bg-[#FEF2F2]' : own ? 'border-[#16803C] bg-[#F3FAF5]' : ''}`}
        />
        {meta.unit === '%' && <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[#6B7280]">%</span>}
      </div>
      {limit && (
        <p id={`rate-${name}-range`} className={`mt-1 text-[10px] ${outside ? 'font-semibold text-[#B91C1C]' : 'text-[#6B7280]'}`}>
          {outside ? 'Outside the allowed range ' : 'Allowed '}{formatRange(name, limit)}
        </p>
      )}
    </div>
  )
}

function RateCard({ icon: Icon, title, subtitle, children, wide }: { icon: LucideIcon; title: string; subtitle: string; children: ReactNode; wide?: boolean }) {
  return (
    <section aria-label={title} className={`flex flex-col rounded-2xl border border-[#E2E8E3] bg-white p-4 ${wide ? 'lg:col-span-2' : ''}`}>
      <div className="mb-3 flex items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#EAF6ED]">
          <Icon className="h-4 w-4 text-[#16803C]" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[#17201A]">{title}</h3>
          <p className="truncate text-xs text-[#6B7280]">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

function Example({ children }: { children: ReactNode }) {
  return <p className="mt-auto pt-3 text-xs text-[#4B5563]"><span className="font-semibold text-[#8A6A00]">Example: </span>{children}</p>
}
