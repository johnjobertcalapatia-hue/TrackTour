import { useEffect, useRef } from 'react'
import { cn } from '@/shared/utils'

const widthClasses = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-xl',
  '2xl': 'sm:max-w-2xl',
  '3xl': 'sm:max-w-3xl',
  '4xl': 'sm:max-w-4xl',
} as const

type MaxWidth = keyof typeof widthClasses

interface ModalProps {
  show: boolean
  onClose: () => void
  maxWidth?: MaxWidth
  children: React.ReactNode
}

export function Modal({ show, onClose, maxWidth = '2xl', children }: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (show) {
      document.body.classList.add('overflow-hidden')
    } else {
      document.body.classList.remove('overflow-hidden')
    }
    return () => document.body.classList.remove('overflow-hidden')
  }, [show])

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && show) onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [show, onClose])

  if (!show) return null

  return (
    <div className="fixed inset-0 overflow-y-auto px-4 py-6 sm:px-0 z-50">
      <div className="fixed inset-0 transform transition-all" onClick={onClose}>
        <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" />
      </div>
      <div
        ref={modalRef}
        className={cn(
          'mb-6 glass-card rounded-2xl overflow-hidden transform transition-all sm:w-full sm:mx-auto relative',
          widthClasses[maxWidth]
        )}
      >
        {children}
      </div>
    </div>
  )
}
