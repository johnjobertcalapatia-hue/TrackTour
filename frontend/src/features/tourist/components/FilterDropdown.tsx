import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, MapPin } from 'lucide-react'
import { cn } from '@/shared/utils'
import { useClickOutside } from '@/shared/hooks/use-click-outside'

export interface FilterOption {
  id: number | string
  name: string
}

/**
 * Explore filter dropdown with a green list. A custom list instead of a
 * native <select>: the browser draws a native select's open list itself
 * (blue highlight on Windows/Chrome) and it can't be recoloured.
 *
 * `value` is the chosen option id as a string; '' = the "all" option.
 *
 * Variants:
 * - 'pill': green pill with a map-pin icon (Explore list filter row).
 * - 'field': white rounded field with a grey border (map places panel);
 *   it turns green once something other than "all" is chosen.
 */
export default function FilterDropdown({
  value,
  options,
  onChange,
  label,
  allLabel,
  className,
  id,
  testId,
  variant = 'pill',
  size = 'md',
  align = 'left',
}: {
  value: string
  options: FilterOption[]
  onChange: (value: string) => void
  /** Accessible name, e.g. "Municipality". */
  label: string
  /** The first option, meaning no filter, e.g. "All municipalities". Omit for a plain choice (e.g. sort order). */
  allLabel?: string
  className?: string
  id?: string
  testId?: string
  variant?: 'pill' | 'field'
  /** 'sm': shorter field (for a toolbar row). */
  size?: 'md' | 'sm'
  /** Which edge the open list lines up with ('right' opens leftwards). */
  align?: 'left' | 'right'
}) {
  const pill = variant === 'pill'
  const [open, setOpen] = useState(false)
  const listId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const close = useCallback(() => setOpen(false), [])
  const wrapRef = useClickOutside<HTMLDivElement>(close)

  const items = [
    ...(allLabel != null ? [{ value: '', label: allLabel }] : []),
    ...options.map((o) => ({ value: String(o.id), label: o.name })),
  ]
  const selectedIndex = Math.max(0, items.findIndex((i) => i.value === value))
  const [active, setActive] = useState(selectedIndex)
  // A plain choice (no "all" option) is never shown as an active filter.
  const filtered = allLabel != null && value !== ''

  useEffect(() => {
    if (open) setActive(selectedIndex)
    // Only when it opens: arrow keys move `active` while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [open, active])

  const choose = (v: string) => {
    if (v !== value) onChange(v)
    setOpen(false)
    buttonRef.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (open) e.preventDefault()
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return setOpen(true)
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((a) => Math.min(items.length - 1, Math.max(0, a + step)))
      return
    }
    if (e.key === 'Home' && open) {
      e.preventDefault()
      setActive(0)
      return
    }
    if (e.key === 'End' && open) {
      e.preventDefault()
      setActive(items.length - 1)
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (open) choose(items[active]!.value)
      else setOpen(true)
      return
    }
    if (e.key === 'Tab') setOpen(false)
  }

  return (
    <div ref={wrapRef} data-testid={testId} className={cn('relative', className)}>
      {pill && (
        <MapPin
          className={cn('absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none', filtered ? 'text-white' : 'text-[#087F3F]')}
          aria-hidden="true"
        />
      )}
      <button
        ref={buttonRef}
        type="button"
        id={id}
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className={cn(
          'w-full border text-left text-sm font-medium truncate transition',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#087F3F]/30',
          pill
            ? cn(
                'h-9 pl-9 pr-8 rounded-full',
                filtered
                  ? 'bg-[#087F3F] border-[#087F3F] text-white hover:bg-[#056B35]'
                  : 'bg-[#E9F7EF] border-[#087F3F] text-[#087F3F] hover:bg-[#DDF2E6]',
              )
            : cn(
                size === 'sm' ? 'h-8 pl-3 pr-8 rounded-lg text-xs' : 'h-10 pl-3 pr-9 rounded-xl',
                // "bg-[#fff]", not "bg-white": the shared card rule in index.css
                // (substring bg-white + rounded-xl + border) would override the
                // green "filter active" border and background.
                'bg-[#fff]',
                filtered
                  ? 'border-[#087F3F] text-[#087F3F] bg-[#F3FAF6]'
                  : 'border-[#E5E9E7] text-[#17201B] hover:border-[#087F3F]/50',
                open && 'border-[#087F3F]',
              ),
        )}
      >
        {items[selectedIndex]!.label}
      </button>
      <ChevronDown
        className={cn(
          'absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none transition-transform',
          pill ? (filtered ? 'text-white' : 'text-[#087F3F]') : filtered ? 'text-[#087F3F]' : 'text-[#17201B]',
          open && 'rotate-180',
        )}
        aria-hidden="true"
      />

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          className={cn(
            align === 'right' ? 'right-0' : 'left-0',
            'absolute top-full z-40 mt-1.5 min-w-full w-max max-h-72 overflow-y-auto rounded-2xl border border-[#087F3F]/30 bg-white p-1.5 shadow-lg shadow-[#087F3F]/10',
          )}
        >
          {items.map((item, i) => {
            const selected = i === selectedIndex
            return (
              <li
                key={item.value || '__all'}
                id={`${listId}-${i}`}
                data-index={i}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(item.value)}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm whitespace-nowrap',
                  selected
                    ? 'bg-[#087F3F] font-semibold text-white'
                    : i === active
                      ? 'bg-[#E9F7EF] text-[#087F3F]'
                      : 'text-[#17201B]',
                )}
              >
                {item.label}
                {selected && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
