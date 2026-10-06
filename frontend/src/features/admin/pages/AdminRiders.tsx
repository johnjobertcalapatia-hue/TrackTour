import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, put, apiErrorMessage } from '@/shared/services/api'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { Alert } from '@/shared/components/Alert'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { formatDate } from '@/shared/utils'
import { API_ENDPOINTS } from '@/shared/constants'
import type { User, PaginatedResponse } from '@/shared/types'
import { Search, ChevronLeft, ChevronRight, Bike, Banknote, Save, Loader2 } from 'lucide-react'

interface DeliveryFareSettings {
  base_fare: number
  included_kilometers: number
  per_kilometer: number
  minimum_fee: number
  service_adjustment: number
  surge_multiplier: number
}

interface FareField {
  key: keyof DeliveryFareSettings
  label: string
  hint: string
  step: number
  prefix?: string
  suffix?: string
}

const FARE_FIELDS: FareField[] = [
  { key: 'base_fare', label: 'Base Fare', hint: 'Charged on every delivery', step: 0.01, prefix: '₱' },
  { key: 'included_kilometers', label: 'Included Kilometers', hint: 'Covered by the base fare', step: 0.1, suffix: 'km' },
  { key: 'per_kilometer', label: 'Per-Kilometer Rate', hint: 'Extra charge beyond the included distance', step: 0.01, prefix: '₱' },
  { key: 'minimum_fee', label: 'Minimum Fee', hint: 'Floor for the final delivery fee', step: 0.01, prefix: '₱' },
  { key: 'service_adjustment', label: 'Service Adjustment', hint: 'Additional flat fee per order', step: 0.01, prefix: '₱' },
  { key: 'surge_multiplier', label: 'Surge Multiplier', hint: 'Multiplier applied to the calculated fare', step: 0.05, suffix: '×' },
]

const DEFAULT_FARES: DeliveryFareSettings = {
  base_fare: 40,
  included_kilometers: 2,
  per_kilometer: 15,
  minimum_fee: 40,
  service_adjustment: 0,
  surge_multiplier: 1,
}

export default function AdminRiders() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const handleSearch = (value: string) => {
    setSearch(value)
    setPage(1)
    const timeout = setTimeout(() => setDebouncedSearch(value), 400)
    return () => clearTimeout(timeout)
  }

  const { data, isLoading } = useQuery({
    queryKey: ['admin-riders', debouncedSearch, page],
    queryFn: () =>
      get<PaginatedResponse<User>>(API_ENDPOINTS.ADMIN.RIDERS, {
        params: { search: debouncedSearch || undefined, page },
      }),
  })

  const { data: fares } = useQuery({
    queryKey: ['admin-riders-fares'],
    queryFn: () => get<DeliveryFareSettings>(API_ENDPOINTS.ADMIN.RIDERS_FARES),
  })

  const [form, setForm] = useState<DeliveryFareSettings>(DEFAULT_FARES)
  const [formLoaded, setFormLoaded] = useState(false)
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    if (fares && !formLoaded) {
      setForm(fares)
      setFormLoaded(true)
    }
  }, [fares, formLoaded])

  const saveMutation = useMutation({
    mutationFn: (payload: DeliveryFareSettings) =>
      put<DeliveryFareSettings>(API_ENDPOINTS.ADMIN.RIDERS_FARES, payload),
    onSuccess: (saved) => {
      setForm(saved)
      queryClient.invalidateQueries({ queryKey: ['admin-riders-fares'] })
      setNotice({ type: 'success', message: 'Fare settings saved. New fees apply to future delivery quotes.' })
    },
    onError: (error) => {
      setNotice({ type: 'error', message: apiErrorMessage(error, 'Failed to save fare settings. Please try again.') })
    },
  })

  const setFareField = (key: keyof DeliveryFareSettings, value: string) => {
    setNotice(null)
    setForm((prev) => ({ ...prev, [key]: value === '' ? 0 : Number(value) }))
  }

  const handleSaveFares = () => {
    saveMutation.mutate({ ...form })
  }

  const riders = data?.data ?? []
  const meta = data?.meta

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">Riders</h1>
        <p className="mt-1 text-sm lg:text-base text-[#6B7280]">Manage delivery rider accounts and fare policy</p>
      </div>

      {/* Delivery fare settings — standard fare and additional fees used by rider calculation */}
      <div className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism mb-8">
        <div className="px-6 py-4 border-b border-[#E2E8E3] flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#EAF6ED] rounded-xl flex items-center justify-center">
              <Banknote className="w-5 h-5 text-[#16803C]" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#17201A]">Fare Policy</h2>
              <p className="text-xs text-[#6B7280]">
                Standard fare and additional fees used to calculate rider delivery fees
              </p>
            </div>
          </div>
          <button
            onClick={handleSaveFares}
            disabled={saveMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#16803C] hover:bg-[#126B32] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition"
          >
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Fares
          </button>
        </div>

        <div className="p-6">
          {notice && <Alert type={notice.type} message={notice.message} onDismiss={() => setNotice(null)} />}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FARE_FIELDS.map((field) => (
              <div key={field.key}>
                <label className="block text-sm font-medium text-[#17201A] mb-1">{field.label}</label>
                <div className="relative">
                  {field.prefix && (
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#6B7280]">{field.prefix}</span>
                  )}
                  <input
                    type="number"
                    min={0}
                    step={field.step}
                    value={form[field.key]}
                    onChange={(e) => setFareField(field.key, e.target.value)}
                    className={`w-full bg-[#F6F8F4] border border-[#D7E8DB] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/30 focus:border-[#16803C] py-2.5 ${
                      field.prefix ? 'pl-8' : 'pl-3'
                    } ${field.suffix ? 'pr-10' : 'pr-3'}`}
                  />
                  {field.suffix && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[#6B7280]">{field.suffix}</span>
                  )}
                </div>
                <p className="mt-1 text-xs text-[#6B7280]">{field.hint}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 p-4 bg-[#F6F8F4] border border-[#E2E8E3] rounded-xl text-sm text-[#6B7280]">
            Delivery fee = (Base fare + (distance − included km) × per-km rate + service adjustment) × surge multiplier,
            floored at the minimum fee. Fee changes apply to new quotes; existing orders keep their stored fee.
          </div>
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton rows={8} cols={5} />
      ) : (
        <div className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism">
          <div className="p-5 lg:p-6 border-b border-[#E2E8E3]">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6B7280]" />
              <input
                type="text"
                placeholder="Search riders..."
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-[#F6F8F4] border border-[#D7E8DB] rounded-xl text-sm text-[#17201A] placeholder-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#16803C]/30 focus:border-[#16803C]"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E2E8E3] bg-[#F6F8F4]">
                  <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Rider</th>
                  <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Phone</th>
                  <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Status</th>
                  <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Verified</th>
                  <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8E3]">
                {riders.map((rider) => (
                  <tr key={rider.id} className="hover:bg-[#F6F8F4] transition-colors">
                    <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-[#FFF7D6] border border-[#E2E8E3] flex items-center justify-center overflow-hidden">
                          {rider.profile_photo ? (
                            <img src={rider.profile_photo} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <Bike className="w-4 h-4 text-[#126B32]" />
                          )}
                        </div>
                        <div>
                          <div className="font-medium text-[#17201A]">{rider.name}</div>
                          <div className="text-xs text-[#6B7280]">{rider.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 lg:px-6 py-3 text-[#6B7280] whitespace-nowrap">{rider.phone || '—'}</td>
                    <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                      <StatusBadge status={rider.account_status} />
                    </td>
                    <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                      {rider.email_verified_at ? (
                        <span className="text-[#16803C] text-xs font-medium">Verified</span>
                      ) : (
                        <span className="text-[#6B7280] text-xs font-medium">Unverified</span>
                      )}
                    </td>
                    <td className="px-5 lg:px-6 py-3 text-[#6B7280] whitespace-nowrap">
                      {formatDate(rider.created_at)}
                    </td>
                  </tr>
                ))}
                {riders.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 lg:px-6 py-12 text-center text-[#6B7280]">No riders found</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {meta && meta.last_page > 1 && (
            <div className="px-5 lg:px-6 py-4 border-t border-[#E2E8E3] flex items-center justify-between">
              <p className="text-sm text-[#6B7280]">
                Showing {((meta.current_page - 1) * meta.per_page) + 1} to{' '}
                {Math.min(meta.current_page * meta.per_page, meta.total)} of {meta.total} riders
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-2 rounded-lg bg-white border border-[#D7E8DB] text-[#16803C] hover:bg-[#F3F8F4] disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm text-[#6B7280] px-3">
                  Page {meta.current_page} of {meta.last_page}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(meta.last_page, p + 1))}
                  disabled={page === meta.last_page}
                  className="p-2 rounded-lg bg-white border border-[#D7E8DB] text-[#16803C] hover:bg-[#F3F8F4] disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}