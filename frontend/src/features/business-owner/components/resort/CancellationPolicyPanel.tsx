import { useEffect, useState, type FormEvent } from 'react'
import axios from 'axios'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { apiErrorMessage, get, put } from '@/shared/services/api'

/** GET/PUT /business-owner/businesses/{id}/resort-policy (reservations Stage 7). */
export interface ResortPolicy {
  free_days: number
  penalty_percent: number
  summary: string
  limits: { free_days: { min: number; max: number }; penalty_percent: { min: number; max: number } }
}

const input = 'w-full rounded-xl border border-[#E2E8E3] bg-white px-3 py-2 text-sm text-[#17201B] focus:border-[#16803C] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25'

/**
 * The resort's cancellation policy: free until N days before check-in, then a
 * penalty % of what was paid online is kept — inside the Tourism Office's
 * limits. Tourists see it before they reserve; each reservation keeps the
 * policy in force when it was made.
 */
export default function CancellationPolicyPanel({ businessId }: { businessId: number }) {
  const queryClient = useQueryClient()
  const key = ['bo-resort-policy', businessId]
  const { data } = useQuery({ queryKey: key, queryFn: () => get<ResortPolicy>(`/business-owner/businesses/${businessId}/resort-policy`) })
  const [days, setDays] = useState('')
  const [penalty, setPenalty] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (data && typeof data === 'object' && 'free_days' in data) {
      setDays(String(data.free_days))
      setPenalty(String(data.penalty_percent))
    }
  }, [data])

  const save = useMutation({
    mutationFn: () => put<ResortPolicy>(`/business-owner/businesses/${businessId}/resort-policy`, { free_days: Number(days), penalty_percent: Number(penalty) }),
    onSuccess: () => {
      setErrors({})
      setNotice({ type: 'success', text: 'Cancellation policy saved. It applies to new reservations.' })
      queryClient.invalidateQueries({ queryKey: key })
    },
    onError: (err) => {
      const fieldErrors = axios.isAxiosError(err) ? (err.response?.data as { errors?: Record<string, string[]> })?.errors : undefined
      if (fieldErrors) setErrors(Object.fromEntries(Object.entries(fieldErrors).map(([k, v]) => [k, v[0] ?? ''])))
      else setNotice({ type: 'error', text: apiErrorMessage(err, 'Could not save the policy.') })
    },
  })

  if (!data || typeof data !== 'object' || !('limits' in data)) return null
  const { limits } = data

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setNotice(null)
    save.mutate()
  }

  return (
    <section className="bg-white rounded-2xl border border-[#E2E8E3] p-5" aria-labelledby="policy-heading">
      <h2 id="policy-heading" className="flex items-center gap-2 text-lg font-semibold text-[#17201A]">
        <ShieldCheck className="h-5 w-5 text-[#16803C]" aria-hidden="true" /> Cancellation policy
      </h2>
      <p className="mt-1 text-sm text-[#647067]">Tourists see this before they reserve. Each reservation keeps the policy in force when it was made.</p>
      <p className="mt-3 rounded-xl bg-[#F6F8F4] px-3 py-2 text-sm text-[#3F4A43]" data-testid="policy-summary">{data.summary}</p>

      {notice && <p role="status" className={`mt-3 rounded-xl px-3 py-2 text-sm ${notice.type === 'success' ? 'bg-[#EAF6ED] text-[#126B32]' : 'bg-[#FEF2F2] text-[#B91C1C]'}`}>{notice.text}</p>}

      <form onSubmit={submit} noValidate className="mt-4 grid gap-3 sm:grid-cols-3 sm:items-end">
        <div>
          <label htmlFor="policy-days" className="mb-1 block text-xs font-semibold text-[#4B5563]">Free cancellation until (days before check-in)</label>
          <input id="policy-days" type="number" className={input} min={limits.free_days.min} max={limits.free_days.max} value={days} onChange={(e) => setDays(e.target.value)} />
          <p className="mt-1 text-xs text-[#8A948E]">Allowed {limits.free_days.min}–{limits.free_days.max} days</p>
          {errors.free_days && <p className="mt-1 text-xs text-[#B91C1C]">{errors.free_days}</p>}
        </div>
        <div>
          <label htmlFor="policy-penalty" className="mb-1 block text-xs font-semibold text-[#4B5563]">Kept after that (% of what was paid online)</label>
          <input id="policy-penalty" type="number" className={input} min={limits.penalty_percent.min} max={limits.penalty_percent.max} value={penalty} onChange={(e) => setPenalty(e.target.value)} />
          <p className="mt-1 text-xs text-[#8A948E]">Allowed {limits.penalty_percent.min}–{limits.penalty_percent.max}%</p>
          {errors.penalty_percent && <p className="mt-1 text-xs text-[#B91C1C]">{errors.penalty_percent}</p>}
        </div>
        <button type="submit" disabled={save.isPending} className="inline-flex h-10 items-center justify-center rounded-xl bg-[#16803C] px-4 text-sm font-semibold text-white hover:bg-[#126B32] disabled:opacity-60 sm:mb-5">
          {save.isPending ? 'Saving…' : 'Save policy'}
        </button>
      </form>
    </section>
  )
}
