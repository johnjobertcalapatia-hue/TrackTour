import { CheckCircle2 } from 'lucide-react'
import { formatCurrency } from '@/shared/utils'

interface TripReceiptProps {
  orderNumber: string
  completedLabel: string
  distanceKm: number
  baseFare: number
  distanceFare: number
  serviceFee: number
  total: number
  estimateFare: number
  paymentMethod: string
  paymentStatus: string
  paidAmount: number
}

export default function TripReceipt({
  orderNumber,
  completedLabel,
  distanceKm,
  baseFare,
  distanceFare,
  serviceFee,
  total,
  estimateFare,
  paymentMethod,
  paymentStatus,
  paidAmount,
}: TripReceiptProps) {
  const estimateDiffers = Math.abs(estimateFare - total) > 0.01

  return (
    <div className="mb-5 bg-white rounded-xl border border-[#E5E9E7] p-4">
      <p className="text-[10px] text-[#68736D] uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <CheckCircle2 className="w-3.5 h-3.5 text-[#087F3F]" /> Trip receipt
      </p>
      <div className="space-y-1.5 text-sm">
        <div className="flex justify-between text-[#68736D]">
          <span className="font-medium text-[#17201B]">{orderNumber}</span>
          <span>{completedLabel}</span>
        </div>
        <div className="flex justify-between text-[#68736D]">
          <span>Base fare</span>
          <span>{formatCurrency(baseFare)}</span>
        </div>
        <div className="flex justify-between text-[#68736D]">
          <span>Distance ({Number(distanceKm).toFixed(1)} km)</span>
          <span>{formatCurrency(distanceFare)}</span>
        </div>
        {serviceFee > 0 && (
          <div className="flex justify-between text-[#68736D]">
            <span>Service fee</span>
            <span>{formatCurrency(serviceFee)}</span>
          </div>
        )}
        <div className="h-px bg-[#E5E9E7]" />
        <div className="flex justify-between font-semibold text-[#17201B]">
          <span>Total</span>
          <span>{formatCurrency(total)}</span>
        </div>
        {estimateDiffers && (
          <div className="flex justify-between text-xs text-[#9CA3AF] pt-1">
            <span>
              Estimate {formatCurrency(estimateFare)} · Final {formatCurrency(total)}
            </span>
            <span>route/traffic differed from estimate</span>
          </div>
        )}
        {paymentMethod !== 'cash' && (
          <div className="flex justify-between text-sm pt-1.5 border-t border-[#E5E9E7]">
            <span className="text-[#68736D]">Payment</span>
            {paymentStatus === 'paid' ? (
              <span className="inline-flex items-center gap-1 text-[#087F3F] font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Paid{Number(paidAmount) > 0 ? ` · ${formatCurrency(paidAmount)}` : ''}
              </span>
            ) : (
              <span className="text-[#D97706] font-medium">Payment pending</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}