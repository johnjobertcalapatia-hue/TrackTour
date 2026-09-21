import { useState, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post, put, del } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { Modal } from '@/shared/components/Modal'
import { useDebounce } from '@/shared/hooks/use-debounce'
import { useClickOutside } from '@/shared/hooks/use-click-outside'
import { useBusinessOwnerStore } from '../services/business-owner-store'
import {
  Plus, Search, MoreVertical, Pencil, Eye, Trash2,
  CheckCircle2, AlertTriangle, Tag, FolderOpen, Upload,
} from 'lucide-react'

interface Category {
  id: number
  name: string
  icon: string | null
  description: string | null
  is_available: boolean
  offerings_count: number
}

interface CategoryMeta {
  stats: {
    total: number
    active: number
    hidden: number
    menu_items: number
  }
}

interface CategoryResponse {
  data: Category[]
  meta: CategoryMeta
}

interface PresetCategory {
  icon: string
  label: string
}

interface PresetGroup {
  title: string
  items: PresetCategory[]
}

const PRESET_GROUPS: PresetGroup[] = [
  {
    title: 'Main Food',
    items: [
      { icon: '🍽', label: 'Main Course' },
      { icon: '🍔', label: 'Burgers' },
      { icon: '🍕', label: 'Pizza' },
      { icon: '🍝', label: 'Pasta' },
      { icon: '🍗', label: 'Chicken' },
      { icon: '🥩', label: 'Beef' },
      { icon: '🐟', label: 'Seafood' },
      { icon: '🍚', label: 'Rice Meals' },
      { icon: '🥣', label: 'Soups' },
      { icon: '🥗', label: 'Salads' },
      { icon: '🌮', label: 'Mexican' },
      { icon: '🍜', label: 'Noodles' },
      { icon: '🥟', label: 'Dumplings' },
      { icon: '🍛', label: 'Curry' },
      { icon: '🥪', label: 'Sandwiches' },
      { icon: '🌭', label: 'Hotdogs' },
      { icon: '🍟', label: 'Snacks' },
      { icon: '🍢', label: 'Street Food' },
      { icon: '🍤', label: 'Appetizers' },
      { icon: '🥘', label: 'Filipino Dishes' },
      { icon: '🍣', label: 'Japanese' },
      { icon: '🥢', label: 'Chinese' },
      { icon: '🍲', label: 'Korean' },
      { icon: '🇮🇹', label: 'Italian' },
      { icon: '🌯', label: 'Wraps' },
      { icon: '🥙', label: 'Middle Eastern' },
    ],
  },
  {
    title: 'Filipino Favorites',
    items: [
      { icon: '🍛', label: 'Filipino Favorites' },
      { icon: '🐟', label: 'Seafood Specials' },
      { icon: '🥩', label: 'Grilled' },
      { icon: '🍢', label: 'BBQ' },
      { icon: '🥘', label: 'Sisig' },
      { icon: '🍖', label: 'Lechon' },
      { icon: '🍗', label: 'Fried Chicken' },
      { icon: '🥣', label: 'Bulalo' },
      { icon: '🍜', label: 'Mami' },
      { icon: '🍚', label: 'Silog Meals' },
      { icon: '🍤', label: 'Seafood Boil' },
      { icon: '🦀', label: 'Crab Dishes' },
      { icon: '🦐', label: 'Shrimp Dishes' },
      { icon: '🥥', label: 'Bicol Express' },
      { icon: '🍲', label: 'Kare-Kare' },
      { icon: '🍖', label: 'Adobo' },
      { icon: '🥣', label: 'Sinigang' },
      { icon: '🍡', label: 'Street Foods' },
    ],
  },
  {
    title: 'Desserts',
    items: [
      { icon: '🍰', label: 'Cakes' },
      { icon: '🧁', label: 'Pastries' },
      { icon: '🍨', label: 'Ice Cream' },
      { icon: '🍮', label: 'Pudding' },
      { icon: '🍩', label: 'Donuts' },
      { icon: '🍪', label: 'Cookies' },
      { icon: '🍫', label: 'Chocolate' },
      { icon: '🍧', label: 'Shaved Ice' },
      { icon: '🥧', label: 'Pies' },
    ],
  },
  {
    title: 'Drinks',
    items: [
      { icon: '🥤', label: 'Soft Drinks' },
      { icon: '💧', label: 'Water' },
      { icon: '☕', label: 'Coffee' },
      { icon: '🫖', label: 'Tea' },
      { icon: '🧋', label: 'Milk Tea' },
      { icon: '🥛', label: 'Milk' },
      { icon: '🍹', label: 'Juice' },
      { icon: '🥭', label: 'Smoothies' },
      { icon: '🍋', label: 'Lemonade' },
      { icon: '🥥', label: 'Coconut Drinks' },
      { icon: '🍺', label: 'Mocktails' },
    ],
  },
  {
    title: 'Breakfast',
    items: [
      { icon: '🍳', label: 'Breakfast Meals' },
      { icon: '🥞', label: 'Pancakes' },
      { icon: '🧇', label: 'Waffles' },
      { icon: '🥓', label: 'Silog Meals' },
      { icon: '🥣', label: 'Oatmeal' },
      { icon: '🥪', label: 'Breakfast Sandwiches' },
    ],
  },
  {
    title: 'Healthy',
    items: [
      { icon: '🥗', label: 'Healthy Meals' },
      { icon: '🥬', label: 'Vegan' },
      { icon: '🥦', label: 'Vegetarian' },
      { icon: '🌱', label: 'Plant-Based' },
      { icon: '💪', label: 'High Protein' },
      { icon: '🥜', label: 'Keto' },
    ],
  },
  {
    title: 'Kids',
    items: [
      { icon: '🧒', label: 'Kids Meals' },
      { icon: '🍟', label: 'Kids Combo' },
      { icon: '🧃', label: 'Kids Drinks' },
    ],
  },
  {
    title: 'Specials',
    items: [
      { icon: '⭐', label: 'Best Sellers' },
      { icon: '🔥', label: "Chef's Specials" },
      { icon: '🎉', label: 'Limited Edition' },
      { icon: '🎄', label: 'Seasonal Menu' },
      { icon: '💝', label: 'Promotional Meals' },
      { icon: '👨‍👩‍👧', label: 'Family Bundle' },
      { icon: '🥡', label: 'Combo Meals' },
    ],
  },
  {
    title: 'Others',
    items: [
      { icon: '📦', label: 'Others (Custom)' },
    ],
  },
]

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'active', label: 'Active' },
  { value: 'hidden', label: 'Hidden' },
]

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'name_asc', label: 'Name A-Z' },
  { value: 'name_desc', label: 'Name Z-A' },
  { value: 'most_items', label: 'Most Items' },
  { value: 'least_items', label: 'Least Items' },
]

export default function BusinessOwnerOfferingCategories() {
  const queryClient = useQueryClient()
  const selectedBusinessId = useBusinessOwnerStore((s) => s.selectedBusinessId)

  const [searchInput, setSearchInput] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [sortBy, setSortBy] = useState('newest')
  const search = useDebounce(searchInput, 300)

  const [openMenuId, setOpenMenuId] = useState<number | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editCategory, setEditCategory] = useState<Category | null>(null)
  const [previewCategory, setPreviewCategory] = useState<Category | null>(null)
  const [deleteCategory, setDeleteCategory] = useState<Category | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [importing, setImporting] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)

  // Create/edit form state
  const [formName, setFormName] = useState('')
  const [formIcon, setFormIcon] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formStatus, setFormStatus] = useState<'active' | 'hidden'>('active')
  const [formError, setFormError] = useState('')

  const menuRef = useClickOutside<HTMLDivElement>(() => setOpenMenuId(null))

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  const handlePresetSelect = (preset: PresetCategory) => {
    setFormIcon(preset.icon)
    if (!formName.trim() || formName === preset.label) {
      setFormName(preset.label)
    }
  }

  const openCreate = () => {
    setFormName('')
    setFormIcon('')
    setFormDescription('')
    setFormStatus('active')
    setFormError('')
    setShowCreateModal(true)
  }

  const openEdit = (cat: Category) => {
    setEditCategory(cat)
    setFormName(cat.name)
    setFormIcon(cat.icon ?? '')
    setFormDescription(cat.description ?? '')
    setFormStatus(cat.is_available ? 'active' : 'hidden')
    setFormError('')
  }

  const { data, isLoading } = useQuery<CategoryResponse>({
    queryKey: ['bo-offering-categories', selectedBusinessId, search, filterStatus, sortBy],
    queryFn: () => {
      const params = new URLSearchParams()
      if (selectedBusinessId) params.append('business_id', String(selectedBusinessId))
      if (search) params.append('search', search)
      if (filterStatus) params.append('status', filterStatus)
      params.append('sort', sortBy)
      return get<CategoryResponse>(`/business-owner/offerings/categories?${params.toString()}`)
    },
  })

  const categories = data?.data ?? []
  const stats = data?.meta?.stats

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['bo-offering-categories'] })

  const createMutation = useMutation({
    mutationFn: () => post('/business-owner/offerings/categories', {
      business_id: selectedBusinessId ?? undefined,
      name: formName,
      icon: formIcon,
      description: formDescription || null,
      is_available: formStatus === 'active',
    }),
    onSuccess: () => {
      invalidate()
      setShowCreateModal(false)
      showToast('Category created')
    },
    onError: (err: any) => setFormError(err.response?.data?.message || 'Failed to create category.'),
  })

  const updateMutation = useMutation({
    mutationFn: (cat: Category) => put(`/business-owner/offerings/categories/${cat.id}`, {
      name: formName,
      icon: formIcon,
      description: formDescription || null,
      is_available: formStatus === 'active',
    }),
    onSuccess: () => {
      invalidate()
      setEditCategory(null)
      showToast('Category updated')
    },
    onError: (err: any) => setFormError(err.response?.data?.message || 'Failed to update category.'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => del(`/business-owner/offerings/categories/${id}`),
    onSuccess: () => {
      invalidate()
      setDeleteCategory(null)
      showToast('Category deleted')
    },
    onError: (err: any) => {
      const msg = err.response?.data?.message || 'Failed to delete category.'
      setDeleteCategory(null)
      showToast(msg, 'error')
    },
  })

  const statsCards = useMemo(() => [
    { label: 'Categories', value: stats?.total ?? 0, icon: <FolderOpen className="w-5 h-5" />, iconBg: 'bg-[#EAF6ED]', iconText: 'text-[#16803C]' },
    { label: 'Active', value: stats?.active ?? 0, icon: <CheckCircle2 className="w-5 h-5" />, iconBg: 'bg-[#EAF6ED]', iconText: 'text-[#16803C]' },
    { label: 'Hidden', value: stats?.hidden ?? 0, icon: <Eye className="w-5 h-5" />, iconBg: 'bg-[#FEF2F2]', iconText: 'text-[#B91C1C]' },
    { label: 'Menu Items', value: stats?.menu_items ?? 0, icon: <Tag className="w-5 h-5" />, iconBg: 'bg-[#FFF7D6]', iconText: 'text-[#A66F00]' },
  ], [stats])

  const statusBadge = (cat: Category) => (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
      cat.is_available ? 'bg-[#DCFCE7] text-[#16803C]' : 'bg-[#FEE2E2] text-[#B91C1C]'
    }`}>
      {cat.is_available ? 'Active' : 'Hidden'}
    </span>
  )

  const categoryIcon = (cat: Category, className = 'text-3xl') => (
    cat.icon ? <span className={className}>{cat.icon}</span> : null
  )

  const isDeletable = (cat: Category) => cat.offerings_count === 0

  const parseCsvLine = (line: string): string[] => {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { current += '"'; i++ }
        else if (ch === '"') inQuotes = false
        else current += ch
      } else {
        if (ch === '"') inQuotes = true
        else if (ch === ',') { result.push(current); current = '' }
        else current += ch
      }
    }
    result.push(current)
    return result.map((s) => s.trim())
  }

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!selectedBusinessId) { showToast('Select a business first', 'error'); return }

    setImporting(true)
    try {
      const text = await file.text()
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      const header = lines.shift()
      const isHeader = header && header.toLowerCase().includes('name')
      if (isHeader) {
        // skip header
      } else if (header) {
        lines.unshift(header)
      }
      let created = 0
      let failed = 0
      for (const line of lines) {
        const parsed = parseCsvLine(line)
        if (!parsed || parsed.length < 1) { failed++; continue }
        const [name, icon = '', description = '', status = 'active'] = parsed
        if (!name) { failed++; continue }
        try {
          await post('/business-owner/offerings/categories', {
            business_id: selectedBusinessId,
            name: name.trim(),
            icon: icon.trim() || undefined,
            description: description.trim() || null,
            is_available: String(status).toLowerCase() !== 'hidden',
          })
          created++
        } catch { failed++ }
      }
      invalidate()
      showToast(`Import complete: ${created} created${failed ? `, ${failed} failed` : ''}`)
    } catch {
      showToast('Failed to read file', 'error')
    } finally {
      setImporting(false)
    }
  }

  if (isLoading) return <DashboardSkeleton />

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-[80]">
          <div className={`flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg border ${
            toast.type === 'success' ? 'bg-[#EAF6ED] border-[#BFE3CB] text-[#16803C]' : 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
          }`}>
            {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            <span className="text-sm font-medium">{toast.message}</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">Menu Categories</h1>
          <p className="mt-1 text-sm text-[#647067]">Organize your menu into categories for easier customer browsing.</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => importRef.current?.click()} disabled={importing}
            className="inline-flex items-center gap-2 bg-white hover:bg-[#F3F8F4] text-[#16803C] border border-[#D7E8DB] px-4 py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50">
            <Upload className="w-4 h-4" /> {importing ? 'Importing...' : 'Import Categories'}
          </button>
          <input ref={importRef} type="file" accept=".csv" onChange={handleImportFile} className="hidden" />
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 bg-[#16803C] hover:bg-[#126B32] text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition"
          >
            <Plus className="w-4 h-4" /> Create Category
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {statsCards.map((card) => (
          <div key={card.label} className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${card.iconBg} ${card.iconText}`}>
              {card.icon}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-medium text-[#647067] uppercase tracking-wider">{card.label}</p>
              <p className="text-2xl font-bold text-[#17201A] leading-tight">{card.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#647067]" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search category..."
              className="w-full pl-9 pr-3 py-2 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition"
            />
          </div>

          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-2 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#4B5563] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition">
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
            className="px-3 py-2 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#4B5563] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition">
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Content */}
      {categories.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-16 text-center">
          <div className="w-16 h-16 bg-[#F3F8F4] rounded-2xl flex items-center justify-center mx-auto mb-4">
            <FolderOpen className="w-8 h-8 text-[#647067]" />
          </div>
          <h3 className="text-lg font-semibold text-[#17201A] mb-1">No Categories Found</h3>
          <p className="text-sm text-[#647067] mb-6">Create your first menu category.</p>
          <button onClick={openCreate}
            className="inline-flex items-center gap-2 bg-[#16803C] hover:bg-[#126B32] text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition">
            <Plus className="w-4 h-4" /> Create Category
          </button>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {categories.map((cat) => (
            <div key={cat.id} className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] overflow-hidden flex flex-col transition hover:shadow-[0_10px_24px_rgba(22,101,52,0.12)]">
              {/* Icon header */}
              <div className="relative h-28 bg-[#F3F8F4] flex items-center justify-center">
                {categoryIcon(cat, 'text-4xl')}

                {/* ⋮ menu */}
                <div ref={openMenuId === cat.id ? menuRef : undefined} className="absolute top-2 right-2">
                  <button onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === cat.id ? null : cat.id) }}
                    className="w-8 h-8 rounded-lg bg-white/90 hover:bg-white text-[#647067] hover:text-[#17201A] flex items-center justify-center shadow-sm transition">
                    <MoreVertical className="w-4 h-4" />
                  </button>
                  {openMenuId === cat.id && (
                    <div className="absolute right-0 mt-1 w-48 bg-white rounded-xl border border-[#E2E8E3] shadow-lg py-1 z-30">
                      <button onClick={() => { setOpenMenuId(null); openEdit(cat) }}
                        className="w-full text-left px-3 py-2 text-xs text-[#4B5563] hover:bg-[#F3F8F4] flex items-center gap-2 transition">
                        <Pencil className="w-3.5 h-3.5" /> Edit
                      </button>
                      <button onClick={() => { setOpenMenuId(null); setPreviewCategory(cat) }}
                        className="w-full text-left px-3 py-2 text-xs text-[#4B5563] hover:bg-[#F3F8F4] flex items-center gap-2 transition">
                        <Eye className="w-3.5 h-3.5" /> Preview
                      </button>
                      <div className="border-t border-[#E2E8E3] my-1" />
                      <button onClick={() => { setOpenMenuId(null); setDeleteCategory(cat) }} disabled={!isDeletable(cat)}
                        className="w-full text-left px-3 py-2 text-xs text-[#B91C1C] hover:bg-[#FEF2F2] flex items-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed">
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Body */}
              <div className="p-4 flex-1 flex flex-col">
                <h3 className="font-semibold text-[#17201A] text-sm leading-snug truncate">{cat.name}</h3>
                <p className="text-[11px] text-[#647067] mt-1">{cat.offerings_count} Menu Item{cat.offerings_count === 1 ? '' : 's'}</p>
                <div className="mt-auto pt-3">
                  {statusBadge(cat)}
                </div>
              </div>

              {/* Footer actions */}
              <div className="flex items-center border-t border-[#E2E8E3] divide-x divide-[#E2E8E3]">
                <button onClick={() => openEdit(cat)}
                  className="flex-1 py-2.5 flex items-center justify-center gap-1 text-[11px] font-medium text-[#16803C] hover:bg-[#EAF6ED] transition">
                  <Pencil className="w-3 h-3" /> Edit
                </button>
                <button onClick={() => setPreviewCategory(cat)}
                  className="flex-1 py-2.5 flex items-center justify-center gap-1 text-[11px] font-medium text-[#647067] hover:bg-[#F3F8F4] transition">
                  <Eye className="w-3 h-3" /> Preview
                </button>
                <button onClick={() => setDeleteCategory(cat)} disabled={!isDeletable(cat)}
                  title={isDeletable(cat) ? 'Delete category' : 'Cannot delete. Category still contains menu items.'}
                  className="flex-1 py-2.5 flex items-center justify-center gap-1 text-[11px] font-medium text-[#B91C1C] hover:bg-[#FEF2F2] transition disabled:opacity-40 disabled:cursor-not-allowed">
                  <Trash2 className="w-3 h-3" /> Delete
                </button>
              </div>

              {/* Delete blocked hint */}
              {!isDeletable(cat) && (
                <p className="px-4 py-2 bg-[#FEF2F2] border-t border-[#FECACA] text-[10px] text-[#B91C1C] leading-snug">
                  Cannot delete. Category still contains menu items.
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create modal */}
      <Modal show={showCreateModal} onClose={() => setShowCreateModal(false)} maxWidth="md">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-[#17201A] mb-4">Create Category</h3>
          {formError && <div className="mb-4 px-4 py-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-sm text-[#B91C1C]">{formError}</div>}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Category Name</label>
              <input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Burgers"
                className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Icon / Category Type</label>
              <div className="max-h-72 overflow-y-auto border border-[#E2E8E3] rounded-xl p-3 space-y-3">
                {PRESET_GROUPS.map((group) => (
                  <div key={group.title}>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[#647067] mb-1.5">{group.title}</p>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                      {group.items.map((item) => (
                        <button key={item.label} type="button" onClick={() => handlePresetSelect(item)}
                          className={`flex flex-col items-center gap-0.5 rounded-lg px-1 py-2 border transition ${
                            formIcon === item.icon
                              ? 'bg-[#EAF6ED] border-[#16803C] ring-2 ring-[#16803C]/25'
                              : 'bg-white border-[#E2E8E3] hover:bg-[#F3F8F4]'
                          }`}>
                          <span className="text-lg leading-none">{item.icon}</span>
                          <span className="text-[9px] text-[#4B5563] text-center leading-tight">{item.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Description</label>
              <textarea value={formDescription} onChange={(e) => setFormDescription(e.target.value)} rows={2} placeholder="Optional description"
                className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition resize-none" />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Status</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={formStatus === 'active'} onChange={() => setFormStatus('active')}
                    className="w-4 h-4 rounded-full border-[#E2E8E3] text-[#16803C] focus:ring-[#16803C]/40" />
                  <span className="text-sm text-[#4B5563]">Active</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={formStatus === 'hidden'} onChange={() => setFormStatus('hidden')}
                    className="w-4 h-4 rounded-full border-[#E2E8E3] text-[#16803C] focus:ring-[#16803C]/40" />
                  <span className="text-sm text-[#4B5563]">Hidden</span>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowCreateModal(false)} className="px-4 py-2 rounded-xl bg-white text-[#16803C] border border-[#D7E8DB] text-sm font-medium hover:bg-[#F3F8F4] transition">
                Cancel
              </button>
              <button type="button" onClick={() => createMutation.mutate()} disabled={!formName.trim() || createMutation.isPending}
                className="inline-flex items-center gap-2 bg-[#16803C] hover:bg-[#126B32] disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-semibold transition">
                <Plus className="w-4 h-4" />
                {createMutation.isPending ? 'Creating...' : 'Save Category'}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Edit modal */}
      <Modal show={editCategory !== null} onClose={() => setEditCategory(null)} maxWidth="md">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-[#17201A] mb-4">Edit Category</h3>
          {formError && <div className="mb-4 px-4 py-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-sm text-[#B91C1C]">{formError}</div>}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Category Name</label>
              <input value={formName} onChange={(e) => setFormName(e.target.value)}
                className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Icon / Category Type</label>
              <div className="max-h-72 overflow-y-auto border border-[#E2E8E3] rounded-xl p-3 space-y-3">
                {PRESET_GROUPS.map((group) => (
                  <div key={group.title}>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[#647067] mb-1.5">{group.title}</p>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                      {group.items.map((item) => (
                        <button key={item.label} type="button" onClick={() => handlePresetSelect(item)}
                          className={`flex flex-col items-center gap-0.5 rounded-lg px-1 py-2 border transition ${
                            formIcon === item.icon
                              ? 'bg-[#EAF6ED] border-[#16803C] ring-2 ring-[#16803C]/25'
                              : 'bg-white border-[#E2E8E3] hover:bg-[#F3F8F4]'
                          }`}>
                          <span className="text-lg leading-none">{item.icon}</span>
                          <span className="text-[9px] text-[#4B5563] text-center leading-tight">{item.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Description</label>
              <textarea value={formDescription} onChange={(e) => setFormDescription(e.target.value)} rows={2}
                className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition resize-none" />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Status</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={formStatus === 'active'} onChange={() => setFormStatus('active')}
                    className="w-4 h-4 rounded-full border-[#E2E8E3] text-[#16803C] focus:ring-[#16803C]/40" />
                  <span className="text-sm text-[#4B5563]">Active</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={formStatus === 'hidden'} onChange={() => setFormStatus('hidden')}
                    className="w-4 h-4 rounded-full border-[#E2E8E3] text-[#16803C] focus:ring-[#16803C]/40" />
                  <span className="text-sm text-[#4B5563]">Hidden</span>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button type="button" onClick={() => setEditCategory(null)} className="px-4 py-2 rounded-xl bg-white text-[#16803C] border border-[#D7E8DB] text-sm font-medium hover:bg-[#F3F8F4] transition">
                Cancel
              </button>
              <button type="button" onClick={() => editCategory && updateMutation.mutate(editCategory)} disabled={!formName.trim() || updateMutation.isPending}
                className="inline-flex items-center gap-2 bg-[#16803C] hover:bg-[#126B32] disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-semibold transition">
                {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Delete confirm */}
      <Modal show={deleteCategory !== null} onClose={() => setDeleteCategory(null)} maxWidth="sm">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-[#17201A] mb-2">Delete Category</h3>
          <p className="text-sm text-[#647067] mb-6">
            Are you sure you want to delete "{deleteCategory?.name}"? This permanently removes it.
          </p>
          <div className="flex items-center justify-end gap-3">
            <button onClick={() => setDeleteCategory(null)} className="px-4 py-2 rounded-xl bg-white text-[#16803C] border border-[#D7E8DB] text-sm font-medium hover:bg-[#F3F8F4] transition">
              Cancel
            </button>
            <button onClick={() => deleteCategory && deleteMutation.mutate(deleteCategory.id)} disabled={deleteMutation.isPending}
              className="px-4 py-2 rounded-xl bg-[#B91C1C] hover:bg-[#991B1B] disabled:opacity-50 text-white text-sm font-semibold transition">
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Preview modal */}
      <Modal show={previewCategory !== null} onClose={() => setPreviewCategory(null)} maxWidth="sm">
        {previewCategory && (
          <div className="p-6 text-center">
            <div className="w-20 h-20 bg-[#F3F8F4] rounded-2xl flex items-center justify-center mx-auto mb-4">
              {categoryIcon(previewCategory, 'text-4xl')}
            </div>
            <h3 className="text-xl font-bold text-[#17201A]">{previewCategory.name}</h3>
            <p className="text-sm text-[#647067] mt-1">Contains</p>
            <p className="text-2xl font-bold text-[#17201A] mt-1">{previewCategory.offerings_count} Menu Item{previewCategory.offerings_count === 1 ? '' : 's'}</p>
            <div className="flex items-center justify-center mt-4">
              {statusBadge(previewCategory)}
            </div>
            <p className="text-xs text-[#647067] mt-3">
              {previewCategory.is_available ? 'Visible to Customers' : 'Hidden from Customers'}
            </p>
            {previewCategory.description && (
              <p className="text-sm text-[#4B5563] mt-3 leading-relaxed">{previewCategory.description}</p>
            )}
            <div className="flex items-center justify-end gap-3 mt-6">
              <button onClick={() => { setPreviewCategory(null); openEdit(previewCategory) }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#16803C] hover:bg-[#126B32] text-white text-sm font-semibold transition">
                <Pencil className="w-3.5 h-3.5" /> Edit Category
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
