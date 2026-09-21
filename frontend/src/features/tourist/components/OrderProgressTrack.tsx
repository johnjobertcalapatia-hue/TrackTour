import React from 'react'
import { Check, MessageSquare, ClipboardList, ChefHat, ClipboardCheck, Truck, CheckCircle2 } from 'lucide-react'
import { SubOrderStatusResolution } from '../utils/subOrderStatusEngine'

const STEP_ICONS: Record<string, React.FC<{ className?: string }>> = {
  'Placed': ClipboardList,
  'Preparing': ChefHat,
  'Ready': ClipboardCheck,
  'On The Way': Truck,
  'Delivered': CheckCircle2,
}

interface OrderProgressTrackProps {
  resolution: SubOrderStatusResolution
  className?: string
}

export const OrderProgressTrack: React.FC<OrderProgressTrackProps> = ({ resolution, className = '' }) => {
  const { steps, statusMessage, isCancelled } = resolution

  if (isCancelled) {
    return (
      <div className={`rounded-xl bg-red-50 border border-red-200 p-3.5 text-sm text-red-700 ${className}`}>
        <p className="font-semibold">Sub-Order Cancelled</p>
        <p className="text-xs text-red-600 mt-0.5">{statusMessage}</p>
      </div>
    )
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* 5-Step Progress Track */}
      <div className="relative py-2 px-1">
        <div className="flex items-center justify-between relative z-10">
          {steps.map((step, idx) => {
            const isLast = idx === steps.length - 1
            const nextStep = steps[idx + 1]
            const lineCompleted = step.state === 'completed' && nextStep && (nextStep.state === 'completed' || nextStep.state === 'current')
            const StepIcon = STEP_ICONS[step.label] || ClipboardList

            return (
              <React.Fragment key={step.index}>
                {/* Step Node */}
                <div className="flex flex-col items-center group relative min-w-[56px]">
                  <div
                    className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-300 ${
                      step.state === 'completed'
                        ? 'bg-[#087F3F] text-white shadow-sm shadow-[#087F3F]/30'
                        : step.state === 'current'
                        ? 'bg-white border-2 border-[#087F3F] text-[#087F3F] ring-4 ring-[#087F3F]/15 animate-pulse'
                        : 'bg-white border border-[#D1D5DB] text-[#9CA3AF]'
                    }`}
                  >
                    {step.state === 'completed' ? (
                      <Check className="w-4 h-4 stroke-[3]" />
                    ) : (
                      <StepIcon className="w-4 h-4" />
                    )}
                  </div>

                  {/* Step Label */}
                  <span
                    className={`text-[11px] mt-1.5 text-center font-medium tracking-tight whitespace-nowrap transition-colors ${
                      step.state === 'current'
                        ? 'text-[#087F3F] font-bold'
                        : step.state === 'completed'
                        ? 'text-[#17201B] font-semibold'
                        : 'text-[#9CA3AF]'
                    }`}
                  >
                    {step.label}
                  </span>
                </div>

                {/* Connecting Line */}
                {!isLast && (
                  <div className="flex-1 mx-1.5 mb-5 relative h-0.5 bg-[#E5E9E7] overflow-hidden rounded-full">
                    <div
                      className={`h-full transition-all duration-500 rounded-full ${
                        lineCompleted ? 'bg-[#087F3F] w-full' : 'w-0'
                      }`}
                    />
                  </div>
                )}
              </React.Fragment>
            )
          })}
        </div>
      </div>

      {/* Sub-Status Message */}
      <div className="bg-white/80 rounded-xl border border-[#E5E9E7] p-3 flex items-start gap-2">
        <div className="w-6 h-6 rounded-lg bg-[#087F3F]/10 flex items-center justify-center shrink-0 mt-0.5">
          <MessageSquare className="w-3.5 h-3.5 text-[#087F3F]" />
        </div>
        <div className="text-xs text-[#17201B] leading-relaxed">
          <span className="font-semibold text-[#6B7280] mr-1.5">Status Message:</span>
          <span className="font-medium text-[#087F3F]">{statusMessage}</span>
        </div>
      </div>
    </div>
  )
}
