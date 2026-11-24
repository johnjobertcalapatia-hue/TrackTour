import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import axios from 'axios'
import { Bike, Building2, CalendarDays, HandCoins, Loader2, MapPin, Trash2, Truck, Users, X } from 'lucide-react'
import { apiErrorMessage, del, get, post } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { Modal } from '@/shared/components/Modal'
import { cn } from '@/shared/utils'
import { useOfficeProfile } from '@/features/admin/hooks/use-office-profile'
import {
  ActivitySection, AttentionBar, Delta, FinancialSection, HeroCard, KpiCard, MunicipalitySection, OperationsSection, OpportunitiesSection, PopularitySection,
  SectionHeading, SystemSection,
} from '@/features/admin/components/dashboard/DashboardSections'
import { count, peso, type Analytics, type PeriodKey } from '@/features/admin/components/dashboard/types'
import { DashboardHeader, FilterField, PeriodFilter, filterSelect, todayKey } from '@/features/admin/components/dashboard/DashboardHeader'

const ANALYTICS = '/admin/dashboard/analytics'

/**
 * Bansud Tourism Office — Municipality Management and Business Intelligence
 * Center. Every figure comes from /admin/dashboard/analytics (database
 * records only), for the selected Philippine period, compared with the
 * previous equivalent period; real-time figures refresh every minute.
 */
export default function AdminDashboard() {
  const queryClient = useQueryClient()
  const { data: office } = useOfficeProfile()
  const [period, setPeriod] = useState<PeriodKey>('this_month')
  const [range, setRange] = useState({ from: todayKey(), to: todayKey() })
  const [applied, setApplied] = useState(range)
  const [municipalityId, setMunicipalityId] = useState<number | ''>('')
  const [expenseOpen, setExpenseOpen] = useState(false)

  const params: Record<string, string | number> = { period }
  if (period === 'custom') Object.assign(params, applied)
  if (municipalityId) params.municipality_id = municipalityId

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['admin-analytics', params],
    queryFn: () => get<Analytics>(ANALYTICS, { params }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  })

  if (isLoading) return <DashboardSkeleton />
  if (!data) return <div className="py-20 text-center text-[#66736B]">{apiErrorMessage(error, 'Unable to load dashboard data.')}</div>

  const { overview: o, financial: f } = data
  const periodLabel = data.period.label
  const pending = o.pending_approvals.businesses + o.pending_approvals.business_owners + o.pending_approvals.riders
  const indicators: { label: string; value: string; to: string }[] = [
    { label: 'Active riders', value: count(o.riders.active), to: '/admin/riders' },
    { label: 'Riders online', value: count(o.riders.online_now), to: '/admin/live/map' },
    { label: 'Tourists online', value: count(data.live.tourists_online), to: '/admin/users/tourists' },
    { label: 'Active business owners', value: count(o.business_owners.active), to: '/admin/users?role=business_owner' },
    { label: 'New registrations today', value: count(o.users.new_today), to: '/admin/users' },
    { label: 'Pending approvals', value: count(pending), to: '/admin/users' },
  ]

  return (
    <div className="space-y-6">
      <DashboardHeader
        cover={office?.cover_url}
        logo={office?.logo_url}
        fallbackLogo="/assets/logo/bansud-tourism-office.jpg"
        name={office?.name || 'Bansud Tourism Office'}
        title="Bansud Tourism Dashboard"
        period={data.period}
        onRefresh={() => refetch()}
        refreshing={isFetching}
        filters={
          <>
            <FilterField icon={MapPin} label="Municipality">
              <select value={municipalityId} onChange={(e) => setMunicipalityId(e.target.value ? Number(e.target.value) : '')} className={filterSelect} aria-label="Municipality">
                <option value="">All municipalities</option>
                {data.municipalities.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </FilterField>
            <PeriodFilter period={period} onPeriod={setPeriod} range={range} onRange={setRange} onApply={() => setApplied(range)} />
          </>
        }
      />

      {/* ── Tier 1 · What matters now ─────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="xl:col-span-5">
          <HeroCard financial={f} periodLabel={periodLabel} />
        </div>
        <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:col-span-7" aria-label="Municipality performance">
          <KpiCard label="Tourism Businesses" value={count(o.businesses.total)} icon={Building2} to="/admin/businesses"
            delta={<Delta c={o.businesses.new} />} sub={<>Active {count(o.businesses.active)} · Pending {count(o.businesses.pending)} · Suspended {count(o.businesses.suspended)}</>} />
          <KpiCard label="Registered Users" value={count(o.users.total)} icon={Users} to="/admin/users"
            delta={<Delta c={o.users.new} />} sub={<>Online now: {count(o.users.online_now)} · {count(o.users.new.value)} new</>} />
          <KpiCard label="Deliveries" value={count(o.deliveries.value)} icon={Truck} to="/admin/live/deliveries" delta={<Delta c={o.deliveries} />} sub={periodLabel} />
          <KpiCard label="Ride-hailing" value={count(o.ride_hailing.value)} icon={Bike} to="/admin/live/map" delta={<Delta c={o.ride_hailing} />} sub={periodLabel} />
          <KpiCard label="Bookings & reservations" value={count(o.bookings.value)} icon={CalendarDays} to="/admin/businesses" delta={<Delta c={o.bookings} />} sub={periodLabel} />
          <KpiCard label="Cashout Requests" value={peso(o.cashouts.requested.value)} icon={HandCoins} to="/admin/cashouts" tone="gold"
            delta={<Delta c={o.cashouts.requested} invert />} sub={<>{count(o.cashouts.open_count)} open requests</>} />
        </section>
      </div>

      <AttentionBar alerts={data.alerts} />

      <ul className="flex flex-wrap gap-x-6 gap-y-1 px-1 text-sm" aria-label="Indicators">
        {indicators.map((i) => (
          <li key={i.label}>
            <Link to={i.to} className="text-[#66736B] hover:text-[#1C2B22]">
              {i.label} <span className="font-semibold tabular-nums text-[#1C2B22]">{i.value}</span>
            </Link>
          </li>
        ))}
      </ul>

      {/* ── Tier 2 · Decision sections ───────────────────────────── */}
      <SectionHeading index="1" title="Business popularity & growth" description="Which businesses are gaining visibility, and which need promotional support" />
      <PopularitySection data={data.popularity} />
      <OpportunitiesSection items={data.opportunities} />

      <SectionHeading index="2" title="Finances" description="Earnings, expenses, cashouts and settlements from verified records" />
      <FinancialSection data={f} trend={data.trend} periodLabel={periodLabel} onRecordExpense={() => setExpenseOpen(true)} />

      {/* ── Tier 3 · Supporting detail ───────────────────────────── */}
      <SectionHeading index="3" title="Operations & records" description="Live activity, daily operations, municipalities and system status" />
      <OperationsSection ops={data.operations} live={data.live} periodLabel={periodLabel} />
      <MunicipalitySection rows={data.municipalities} />
      <ActivitySection items={data.activity} />
      <SystemSection items={data.system} />

      {expenseOpen && (
        <ExpenseDialog
          municipalities={data.municipalities}
          onClose={() => setExpenseOpen(false)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['admin-analytics'] })}
        />
      )}
    </div>
  )
}

interface ExpenseRow {
  id: number
  category: string
  description: string
  amount: string
  expense_date: string
  recorder?: { name: string } | null
}

function ExpenseDialog({ municipalities, onClose, onSaved }: { municipalities: Analytics['municipalities']; onClose: () => void; onSaved: () => void }) {
  const queryClient = useQueryClient()
  const blank = { category: 'operations', description: '', amount: '', expense_date: todayKey(), municipality_id: '' }
  const [form, setForm] = useState(blank)
  const [errors, setErrors] = useState<Record<string, string[]>>({})

  const { data: list } = useQuery({
    queryKey: ['platform-expenses'],
    queryFn: () => get<{ data: ExpenseRow[]; meta: { categories: string[] } }>('/admin/platform-expenses', { params: { per_page: 8 } }),
  })
  const categories = list?.meta?.categories ?? ['operations', 'personnel', 'marketing', 'technology', 'events', 'transport', 'utilities', 'other']
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['platform-expenses'] })
    onSaved()
  }

  const save = useMutation({
    mutationFn: () => post('/admin/platform-expenses', { ...form, amount: Number(form.amount), municipality_id: form.municipality_id ? Number(form.municipality_id) : null }),
    onSuccess: () => {
      setForm(blank)
      setErrors({})
      refresh()
    },
    onError: (e) => {
      if (axios.isAxiosError(e) && e.response?.status === 422) setErrors((e.response.data as { errors?: Record<string, string[]> }).errors ?? {})
    },
  })
  const remove = useMutation({ mutationFn: (id: number) => del(`/admin/platform-expenses/${id}`), onSuccess: refresh })
  const input = 'w-full rounded-xl border border-[#E7E2D6] px-3 py-2 text-sm outline-none focus:border-[#2E8B57] focus:ring-2 focus:ring-[#2E8B57]/20'

  return (
    <Modal show onClose={onClose} maxWidth="2xl">
      <div className="bg-white p-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-[#1C2B22]">Operating expenses</h2>
            <p className="text-sm text-[#66736B]">Recorded expenses are subtracted from platform revenue to give net income.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 hover:bg-[#FAF7F0]"><X className="h-5 w-5" /></button>
        </div>
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <label className="text-sm">
            <span className="mb-1 block font-medium">Category</span>
            <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className={cn(input, 'capitalize')}>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Amount (₱)</span>
            <input type="number" min="0.01" step="0.01" required value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className={input} />
            {errors.amount?.[0] && <span className="mt-1 block text-xs text-red-600">{errors.amount[0]}</span>}
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block font-medium">Description</span>
            <input required maxLength={255} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className={input} placeholder="e.g. Tourism fiesta tarpaulins" />
            {errors.description?.[0] && <span className="mt-1 block text-xs text-red-600">{errors.description[0]}</span>}
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Date</span>
            <input type="date" required max={todayKey()} value={form.expense_date} onChange={(e) => setForm((f) => ({ ...f, expense_date: e.target.value }))} className={input} />
            {errors.expense_date?.[0] && <span className="mt-1 block text-xs text-red-600">{errors.expense_date[0]}</span>}
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Municipality (optional)</span>
            <select value={form.municipality_id} onChange={(e) => setForm((f) => ({ ...f, municipality_id: e.target.value }))} className={input}>
              <option value="">Province-wide / Bansud office</option>
              {municipalities.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          {save.isError && Object.keys(errors).length === 0 && <p className="text-sm text-red-600 sm:col-span-2">{apiErrorMessage(save.error)}</p>}
          <div className="sm:col-span-2">
            <button type="submit" disabled={save.isPending} className="inline-flex items-center gap-2 rounded-xl bg-[#2E8B57] px-4 py-2 text-sm font-semibold text-white hover:bg-[#257347] disabled:opacity-50">
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Record expense
            </button>
          </div>
        </form>

        <h3 className="mt-6 text-xs font-semibold uppercase tracking-wider text-[#66736B]">Latest expenses</h3>
        {(list?.data ?? []).length === 0 ? (
          <p className="mt-2 text-sm text-[#66736B]">No operating expenses recorded yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-[#F1EDE3] rounded-xl border border-[#F1EDE3]">
            {list!.data.map((x) => (
              <li key={x.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-[#1C2B22]">{x.description}</span>
                  <span className="block text-xs capitalize text-[#66736B]">{x.category} · {x.expense_date?.slice(0, 10)}{x.recorder?.name ? ` · ${x.recorder.name}` : ''}</span>
                </span>
                <span className="font-semibold tabular-nums">{peso(Number(x.amount))}</span>
                <button type="button" onClick={() => remove.mutate(x.id)} aria-label={`Delete ${x.description}`} className="rounded-lg p-1.5 text-red-600 hover:bg-red-50">
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
