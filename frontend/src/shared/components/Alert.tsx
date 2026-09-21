import { useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/shared/utils'

const styles = {
  success: 'bg-emerald-50/80 backdrop-blur-sm border-emerald-200 text-emerald-700',
  error: 'bg-red-50/80 backdrop-blur-sm border-red-200 text-red-700',
  warning: 'bg-amber-50/80 backdrop-blur-sm border-amber-200 text-amber-700',
  info: 'bg-blue-50/80 backdrop-blur-sm border-blue-200 text-blue-700',
}

interface AlertProps {
  type?: 'success' | 'error' | 'warning' | 'info'
  message: string
  onDismiss?: () => void
}

export function Alert({ type = 'success', message, onDismiss }: AlertProps) {
  const [visible, setVisible] = useState(true)

  if (!message || !visible) return null

  const handleDismiss = () => {
    setVisible(false)
    onDismiss?.()
  }

  return (
    <div
      className={cn(
        'flex items-start gap-3 p-4 mb-4 border rounded-lg text-sm',
        styles[type] || styles.info
      )}
      role="alert"
    >
      <div className="flex-1">{message}</div>
      <button
        type="button"
        onClick={handleDismiss}
        className="shrink-0 opacity-60 hover:opacity-100 transition"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
