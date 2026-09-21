import { useState, useRef, useId } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/shared/utils'
import { useClickOutside } from '@/shared/hooks/use-click-outside'

export interface CategoryOption {
  id: number | string
  name: string
}

interface CategoryDropdownProps {
  label?: string
  options: CategoryOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export default function CategoryDropdown({
  label = 'Business Category',
  options,
  value,
  onChange,
  placeholder = 'All Categories',
  className,
}: CategoryDropdownProps) {
  const [open, setOpen] = useState(false)
  const listboxId = useId()
  const listId = useId()
  const wrapperRef = useClickOutside<HTMLDivElement>(() => setOpen(false))
  const buttonRef = useRef<HTMLButtonElement>(null)

  const selected = options.find((o) => String(o.id) === String(value))

  const toggle = () => setOpen((o) => !o)

  const select = (id: string) => {
    onChange(id)
    setOpen(false)
    buttonRef.current?.focus()
  }

  return (
    <div ref={wrapperRef} className={cn('relative', className)}>
      <span className="sr-only">{label}</span>
      <button
        ref={buttonRef}
        type="button"
        id={listboxId}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            toggle()
          }
          if (e.key === 'Escape') setOpen(false)
        }}
        className={cn(
          'h-full w-full flex items-center justify-between gap-2 px-4 py-3.5 rounded-xl text-sm transition-all duration-200',
          'bg-night-soft/80 border border-white/10',
          'text-white shadow-sm backdrop-blur-md',
          'hover:border-brand/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50',
          open && 'border-brand/60'
        )}
      >
        <span className="truncate">{selected?.name ?? placeholder}</span>
        <ChevronDown
          className={cn('w-4 h-4 text-muted shrink-0 transition-transform duration-200', open && 'rotate-180')}
        />
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-labelledby={listboxId}
          className="absolute top-full left-0 right-0 z-50 mt-2 max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-night-card/95 backdrop-blur-xl shadow-2xl shadow-black/50 p-1.5 origin-top animate-[dropdown-in_0.15s_ease-out]"
        >
          <li role="option" aria-selected={!value} aria-label={placeholder}>
            <button
              type="button"
              onClick={() => select('')}
              className={cn(
                'w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors',
                !value
                  ? 'bg-brand/15 text-brand-light font-medium'
                  : 'text-gray-300 hover:bg-white/5'
              )}
            >
              {placeholder}
            </button>
          </li>
          {options.map((opt) => (
            <li key={opt.id} role="option" aria-selected={String(opt.id) === String(value)} aria-label={opt.name}>
              <button
                type="button"
                onClick={() => select(String(opt.id))}
                className={cn(
                  'w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors',
                  String(opt.id) === String(value)
                    ? 'bg-brand/15 text-brand-light font-medium'
                    : 'text-gray-300 hover:bg-white/5'
                )}
              >
                {opt.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
