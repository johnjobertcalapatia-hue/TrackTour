import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { apiErrorMessage, post } from '@/shared/services/api'

/**
 * Stage C (2026-11-18): at the drop-off, the passenger also owes a ₱50
 * cancellation fee from an earlier ride (owed to another driver). The driver
 * collects it in cash and confirms it here, separately from the fare. Not
 * collected? Leave it: the fee stays owed and the ride completes as normal.
 */
export default function RiderCancellationFeeCollect({ deliveryId, due }: {
  deliveryId: number
  due: { penalty_id: number; amount: number; from_ride: string | null }
}) {
  const queryClient = useQueryClient()
  const collect = useMutation({
    mutationFn: () => post(`/rider/deliveries/${deliveryId}/cancellation-fee/collect`, { penalty_id: due.penalty_id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rider-map-location'] }),
  })
  const amount = `₱${due.amount.toFixed(2)}`

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm" data-testid="ride-cancellation-fee">
      <p className="font-semibold text-[#7C4A03]">Also collect a {amount} cancellation fee</p>
      <p className="mt-0.5 text-xs text-[#7C4A03]">
        The customer owes it from {due.from_ride ? `ride ${due.from_ride}` : 'an earlier ride'}. Collect it with the payment. It is not your earning: it goes to the driver who accepted that ride, so hand it in with your cash remittance.
      </p>
      {collect.isError && <p role="alert" className="mt-1 text-xs text-[#B91C1C]">{apiErrorMessage(collect.error, "Couldn't record it.")}</p>}
      <button
        type="button"
        onClick={() => collect.mutate()}
        disabled={collect.isPending}
        className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-full bg-[#7C4A03] text-xs font-bold text-white disabled:opacity-60"
      >
        {collect.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />} I collected {amount} in cash
      </button>
    </div>
  )
}
