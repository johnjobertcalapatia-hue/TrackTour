import { useState } from 'react'
import { Smartphone, X } from 'lucide-react'
import type { GCashBillingDetails } from '@/shared/services/payment'

interface GCashDetailsModalProps {
  open: boolean
  onClose: () => void
  onConfirm: (details: GCashBillingDetails) => void
  amount: number
  isLoading?: boolean
  defaultName?: string
  defaultEmail?: string
}

export function GCashDetailsModal({
  open,
  onClose,
  onConfirm,
  amount,
  isLoading,
  defaultName = '',
  defaultEmail = '',
}: GCashDetailsModalProps) {
  const [name, setName] = useState(defaultName)
  const [email, setEmail] = useState(defaultEmail)
  const [phone, setPhone] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  if (!open) return null

  const validate = () => {
    const errs: Record<string, string> = {}
    if (!name.trim()) errs.name = 'Full name is required'
    if (!email.trim()) errs.email = 'Email is required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = 'Invalid email address'
    if (!phone.trim()) errs.phone = 'GCash number is required'
    else if (!/^09\d{9}$/.test(phone.replace(/\s|-/g, ''))) errs.phone = 'Enter a valid 11-digit GCash number (09XXXXXXXXX)'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = () => {
    if (!validate()) return
    onConfirm({ name: name.trim(), email: email.trim(), phone: phone.replace(/\s|-/g, '') })
  }

  return (
    <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5">
        <button onClick={onClose} className="absolute top-4 right-4 p-1 rounded-lg hover:bg-gray-100 transition">
          <X className="w-4 h-4 text-gray-400" />
        </button>

        <div className="w-14 h-14 bg-blue-50 rounded-full flex items-center justify-center mx-auto">
          <Smartphone className="w-7 h-7 text-blue-600" />
        </div>

        <div className="text-center">
          <h3 className="text-lg font-bold text-gray-900">GCash Payment Details</h3>
          <p className="text-sm text-gray-500 mt-1">
            Enter your GCash information to pay <span className="font-semibold text-gray-900">₱{amount.toFixed(2)}</span>
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">GCash Number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="09XXXXXXXXX"
              maxLength={11}
              className={`w-full px-4 py-2.5 border rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none transition ${errors.phone ? 'border-red-400' : 'border-gray-200'}`}
            />
            {errors.phone && <p className="text-xs text-red-500 mt-1">{errors.phone}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="As registered in GCash"
              className={`w-full px-4 py-2.5 border rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none transition ${errors.name ? 'border-red-400' : 'border-gray-200'}`}
            />
            {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="For payment receipt"
              className={`w-full px-4 py-2.5 border rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none transition ${errors.email ? 'border-red-400' : 'border-gray-200'}`}
            />
            {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-500 hover:bg-gray-50 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isLoading}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition disabled:opacity-50"
          >
            {isLoading ? 'Processing...' : 'Confirm & Pay'}
          </button>
        </div>
      </div>
    </div>
  )
}
