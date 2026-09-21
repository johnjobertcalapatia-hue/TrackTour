import { create } from 'zustand'

interface BusinessOwnerBusiness {
  id: number
  name: string
  category: string
  status: string
  logo: string | null
  module_codes?: string[]
}

interface BusinessOwnerState {
  businesses: BusinessOwnerBusiness[]
  selectedBusinessId: number | null
  setBusinesses: (businesses: BusinessOwnerBusiness[]) => void
  setSelectedBusinessId: (id: number | null) => void
  getSelectedBusiness: () => BusinessOwnerBusiness | undefined
  getAllModuleCodes: () => string[]
  hasModule: (moduleCode: string) => boolean
}

const STORAGE_KEY = 'bo_selected_business_id'

export const useBusinessOwnerStore = create<BusinessOwnerState>((set, get) => ({
  businesses: [],
  selectedBusinessId: (() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? Number(saved) : null
  })(),

  setBusinesses: (businesses) => {
    const current = get()
    set({ businesses })
    const idExists = businesses.some((b) => b.id === current.selectedBusinessId)
    if (!idExists) {
      const nextId = businesses[0]?.id ?? null
      set({ selectedBusinessId: nextId })
      if (nextId === null) {
        localStorage.removeItem(STORAGE_KEY)
      } else {
        localStorage.setItem(STORAGE_KEY, String(nextId))
      }
    }
  },

  setSelectedBusinessId: (id) => {
    if (id === null) {
      localStorage.removeItem(STORAGE_KEY)
    } else {
      localStorage.setItem(STORAGE_KEY, String(id))
    }
    set({ selectedBusinessId: id })
  },

  getSelectedBusiness: () => {
    const { businesses, selectedBusinessId } = get()
    if (selectedBusinessId === null) return undefined
    return businesses.find((b) => b.id === selectedBusinessId)
  },

  getAllModuleCodes: () => {
    const { businesses } = get()
    const codes = new Set<string>()
    for (const biz of businesses) {
      if (biz.module_codes) {
        for (const code of biz.module_codes) {
          codes.add(code)
        }
      }
    }
    return Array.from(codes)
  },

  hasModule: (moduleCode: string) => {
    const { businesses, selectedBusinessId } = get()
    if (selectedBusinessId === null) {
      return businesses.some(
        (b) => b.module_codes && b.module_codes.includes(moduleCode)
      )
    }
    const business = businesses.find((b) => b.id === selectedBusinessId)
    if (!business) return false
    return business.module_codes?.includes(moduleCode) ?? false
  },
}))
