import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Info, Loader2, RotateCcw, Wrench, X } from 'lucide-react'
import { apiErrorMessage, get, post } from '@/shared/services/api'
import TripPathView, { type TripPathStep } from '@/shared/components/TripPathView'
import { cn } from '@/shared/utils'

interface Finding {
  code: string
  kind: 'fix' | 'reset' | 'person' | 'ok'
  status: 'ok' | 'fixed' | 'needs_action' | 'warn' | 'info'
  title: string
  message: string
}

interface ResetOption {
  action: 'redo_pickup_arrival' | 'redo_dropoff_arrival'
  business_id: number | null
  label: string
  description: string
}

export interface TripDiagnosis {
  delivery_id: number
  order_number: string
  status: string
  covered: boolean
  path: TripPathStep[]
  next_step: string
  findings: Finding[]
  resets: ResetOption[]
  repaired: string[]
}

const KIND_LABEL: Record<Finding['kind'], string> = {
  fix: 'Data mismatch',
  reset: 'Reset',
  person: 'Waiting on a person',
  ok: 'On track',
}

const REASON_MIN = 10

/**
 * Tourism Office trip diagnostics (2026-11-12): the delivery's canonical path,
 * what is out of line, "Apply fixes" (the same safe re-syncs the rider can
 * run) and "Reopen" for a recorded step — with a written reason — so the rider
 * must do it again. Nothing here marks a step done.
 */
export default function TripDiagnosticsPanel({ deliveryId, onClose }: { deliveryId: number; onClose: () => void }) {
  const queryClient = useQueryClient()
  const key = ['admin-trip-diagnostics', deliveryId]
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resetting, setResetting] = useState<ResetOption | null>(null)
  const [reason, setReason] = useState('')

  const { data, isLoading, isError } = useQuery({
    queryKey: key,
    queryFn: () => get<TripDiagnosis>(`/admin/deliveries/${deliveryId}/diagnostics`),
  })

  const settle = (result: TripDiagnosis, message: string) => {
    queryClient.setQueryData(key, result)
    void queryClient.invalidateQueries({ queryKey: ['admin-live-deliveries'] })
    setError(null)
    setNotice(message)
  }

  const fix = useMutation({
    mutationFn: () => post<TripDiagnosis>(`/admin/deliveries/${deliveryId}/diagnostics/fix`),
    onSuccess: (result) => settle(result, result.repaired.length > 0 ? `Fixed: ${result.repaired.join(' ')}` : 'Nothing needed fixing.'),
    onError: (e) => setError(apiErrorMessage(e, 'Could not apply the fixes.')),
  })

  const reset = useMutation({
    mutationFn: (option: ResetOption) => post<TripDiagnosis & { reset: string }>(`/admin/deliveries/${deliveryId}/diagnostics/reset`, {
      action: option.action,
      business_id: option.business_id,
      reason: reason.trim(),
    }),
    onSuccess: (result) => {
      settle(result, result.reset)
      setResetting(null)
      setReason('')
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not reopen the step.')),
  })

  const d = data
  const mismatches = d?.findings.filter((f) => f.kind === 'fix' && f.status !== 'fixed').length ?? 0

  return createPortal(
    <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="trip-diag-title" onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 id="trip-diag-title" className="text-lg font-bold text-[#17201A]">Trip diagnostics</h2>
            {d && <p className="text-xs text-[#6B7280]">Order {d.order_number} · delivery #{d.delivery_id} · {d.status.replace(/_/g, ' ')}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close trip diagnostics" className="rounded-full p-1.5 text-[#6B7280] hover:bg-[#F3F4F6]">
            <X className="h-5 w-5" />
          </button>
        </div>

        {isLoading && <p className="flex items-center gap-2 py-6 text-sm text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" /> Checking the trip…</p>}
        {isError && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">Could not load the diagnostics.</p>}

        {d && !d.covered && <p className="text-sm text-[#6B7280]">{d.next_step}</p>}

        {d && d.covered && (
          <>
            <section aria-label="Trip path" className="rounded-xl border border-[#E5E9E7] px-3 py-2.5">
              <TripPathView path={d.path} nextStep={d.next_step} />
            </section>

            <ul className="mt-3 space-y-2" aria-label="Findings">
              {d.findings.map((f, i) => {
                const bad = f.status === 'needs_action' || f.status === 'warn'
                const Icon = f.status === 'fixed' || f.status === 'ok' ? CheckCircle2 : f.kind === 'person' ? Info : AlertTriangle
                return (
                  <li key={`${f.code}-${i}`} data-finding={f.code} data-status={f.status} className="flex items-start gap-2 rounded-xl border border-[#E5E9E7] px-3 py-2">
                    <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', bad ? (f.kind === 'person' ? 'text-amber-600' : 'text-red-600') : 'text-emerald-600')} aria-hidden />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#17201A]">
                        {f.title} <span className="ml-1 text-[10px] font-bold uppercase text-[#6B7280]">{KIND_LABEL[f.kind]}</span>
                      </p>
                      <p className="text-xs leading-snug text-[#4B5563]">{f.message}</p>
                    </div>
                  </li>
                )
              })}
            </ul>

            <button type="button" onClick={() => fix.mutate()} disabled={fix.isPending}
              className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#16803C] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#126B32] disabled:opacity-50">
              {fix.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
              {mismatches > 0 ? `Apply fixes (${mismatches})` : 'Re-check and re-sync'}
            </button>

            {d.resets.length > 0 && (
              <section aria-label="Reopen a step" className="mt-4 border-t border-[#E5E9E7] pt-3">
                <p className="text-sm font-bold text-[#17201A]">Reopen a step</p>
                <p className="mb-2 text-[11px] text-[#6B7280]">Clears a recorded step so the rider must do it again. The previous record and your reason are kept in the audit log.</p>
                <div className="space-y-2">
                  {d.resets.map((option) => {
                    const open = resetting?.action === option.action && resetting.business_id === option.business_id
                    return (
                      <div key={`${option.action}-${option.business_id ?? 'x'}`} className="rounded-xl border border-[#E5E9E7] px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[#17201A]">{option.label}</p>
                            <p className="text-[11px] text-[#6B7280]">{option.description}</p>
                          </div>
                          {!open && (
                            <button type="button" onClick={() => { setResetting(option); setReason(''); setError(null) }}
                              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#D1D5DB] px-2.5 py-1.5 text-xs font-semibold text-[#17201A] hover:bg-[#F3F4F6]">
                              <RotateCcw className="h-3.5 w-3.5" /> Reopen
                            </button>
                          )}
                        </div>
                        {open && (
                          <form className="mt-2" onSubmit={(e) => { e.preventDefault(); reset.mutate(option) }}>
                            <label className="block text-xs font-medium text-[#4B5563]">
                              Reason (required)
                              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} aria-label="Reset reason"
                                placeholder="What went wrong and why the rider must redo this step"
                                className="mt-1 w-full rounded-lg border border-[#D1D5DB] px-2 py-1.5 text-sm" />
                            </label>
                            <div className="mt-1.5 flex gap-2">
                              <button type="submit" disabled={reason.trim().length < REASON_MIN || reset.isPending}
                                className="inline-flex items-center gap-1 rounded-lg bg-[#B45309] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                                {reset.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Reopen step
                              </button>
                              <button type="button" onClick={() => setResetting(null)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-[#6B7280] hover:bg-[#F3F4F6]">Cancel</button>
                            </div>
                          </form>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            )}
          </>
        )}

        {notice && <p role="status" className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}
        {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>
    </div>,
    document.body,
  )
}
