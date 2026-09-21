import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { useBusinessOwnerStore } from '../services/business-owner-store'
import { ChevronDown, Building2, Check } from 'lucide-react'
import { cn, toAssetUrl } from '@/shared/utils'

interface DashboardData {
  businesses: {
    id: number
    name: string
    category: string
    status: string
    logo: string | null
    module_codes?: string[]
  }[]
  selected_business_id: number | null
}

export default function BusinessSwitcher({ collapsed }: { collapsed?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { businesses, selectedBusinessId, setBusinesses, setSelectedBusinessId, getSelectedBusiness } = useBusinessOwnerStore()

  const { data } = useQuery({
    queryKey: ['bo-businesses-switcher'],
    queryFn: () => get<DashboardData>('/business-owner/businesses/switcher'),
  })

  useEffect(() => {
    if (data?.businesses) {
      setBusinesses(data.businesses)
    }
  }, [data, setBusinesses])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const selected = getSelectedBusiness()
  const displayName = selected ? selected.name : 'All Businesses'

  const handleSelect = (id: number | null) => {
    setSelectedBusinessId(id)
    setOpen(false)
  }

  if (businesses.length === 0) return null

  if (collapsed) {
    return (
      <div className="relative group" ref={ref}>
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center justify-center w-full py-2.5 text-[#647067] hover:bg-[#F3F8F4] hover:text-[#16803C] rounded-lg transition-all"
        >
          <Building2 className="w-5 h-5 shrink-0" />
        </button>
        <div className="absolute left-full top-0 ml-2 px-2.5 py-1 bg-white text-ink text-xs font-medium rounded-md whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-glass border border-ink/5">
          Switch Business
        </div>
        {open && (
          <div className="absolute left-full top-0 ml-2 w-56 bg-white/95 backdrop-blur-xl border border-white/60 rounded-xl shadow-glass-lg z-50 py-1">
            <BusinessDropdownItems businesses={businesses} selectedId={selectedBusinessId} onSelect={handleSelect} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[#F3F8F4] border border-[#E2E8E3] hover:border-[#16803C]/40 transition-all duration-200 shadow-glass"
      >
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#EAF6ED] to-[#F3F8F4] border border-[#16803C]/30 flex items-center justify-center shrink-0">
          {selected?.logo ? (
            <img src={toAssetUrl(selected.logo)} alt="" className="w-8 h-8 rounded-lg object-cover" />
          ) : (
            <Building2 className="w-4 h-4 text-[#16803C]" />
          )}
        </div>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-[10px] font-medium text-[#16803C] uppercase tracking-wider">Active Business</p>
          <p className="text-sm font-medium text-[#17201A] truncate">{displayName}</p>
        </div>
        <ChevronDown className={cn('w-4 h-4 text-[#647067] transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 mt-1 bg-white/95 backdrop-blur-xl border border-white/60 rounded-xl shadow-glass-lg z-50 py-1 max-h-64 overflow-y-auto">
          <BusinessDropdownItems businesses={businesses} selectedId={selectedBusinessId} onSelect={handleSelect} />
        </div>
      )}
    </div>
  )
}

function BusinessDropdownItems({
  businesses,
  selectedId,
  onSelect,
}: {
  businesses: { id: number; name: string; category: string; status: string; logo?: string | null }[]
  selectedId: number | null
  onSelect: (id: number | null) => void
}) {
  const showAllBusinesses = businesses.length > 1
  return (
    <>
      {showAllBusinesses && (
        <>
          <button
            onClick={() => onSelect(null)}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2.5 text-sm transition-colors text-left',
              selectedId === null ? 'bg-[#EAF6ED] text-[#16803C]' : 'text-[#647067] hover:bg-white/80 hover:text-[#16803C]'
            )}
          >
            <div className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center">
              <Building2 className="w-4 h-4 text-[#647067]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">All Businesses</p>
              <p className="text-xs text-[#647067]/70">{businesses.length} total</p>
            </div>
            {selectedId === null && <Check className="w-4 h-4 text-[#16803C] shrink-0" />}
          </button>
          <div className="mx-3 border-t border-[#E2E8E3]" />
        </>
      )}
      {businesses.map((biz) => (
        <button
          key={biz.id}
          onClick={() => onSelect(biz.id)}
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2.5 text-sm transition-colors text-left',
            selectedId === biz.id ? 'bg-[#EAF6ED] text-[#16803C]' : 'text-[#647067] hover:bg-white/80 hover:text-[#16803C]'
          )}
        >
          <div className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center">
            {biz.logo ? (
              <img src={toAssetUrl(biz.logo)} alt="" className="w-8 h-8 rounded-lg object-cover" />
            ) : (
              <Building2 className="w-4 h-4 text-[#647067]" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{biz.name}</p>
            <p className="text-xs text-[#647067]/70">{biz.category}</p>
          </div>
          {selectedId === biz.id && <Check className="w-4 h-4 text-[#16803C] shrink-0" />}
        </button>
      ))}
    </>
  )
}
