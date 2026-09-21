import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post, put, patch } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { Modal } from '@/shared/components/Modal'
import { formatCurrency } from '@/shared/utils'
import { useDebounce } from '@/shared/hooks/use-debounce'
import { useClickOutside } from '@/shared/hooks/use-click-outside'
import { useBusinessOwnerStore } from '../services/business-owner-store'
import {
  Plus, Search, Download, Upload, MoreVertical, Pencil, Copy, Archive,
  Star, Eye, EyeOff, ChevronDown, CheckSquare, Square, CheckCircle2, AlertTriangle,
  Boxes, Image as ImageIcon, Filter,
} from 'lucide-react'

interface MenuCategory {
  id: number
  name: string
  description?: string | null
  sort_order?: number
}

interface MenuItem {
  id: number
  name: string
  description: string | null
  price: number
  compare_price: number | null
  unit: string | null
  stock: number | null
  status: string
  category: MenuCategory | string | null
  is_available: boolean
  is_featured: boolean
  has_variations: boolean
  variations: { id: number; name: string; price: number; compare_price: number | null; image: string | null; is_available: boolean }[]
  image: string | null
  images: string[]
  type: string
  business_name: string | null
  sort_order: number
  sales_count: number
  revenue: number
  created_at: string
  updated_at: string
}

interface MenuMeta {
  current_page: number
  last_page: number
  per_page: number
  total: number
  stats: {
    total: number
    available: number
    unavailable: number
    hidden: number
    archived: number
    featured: number
  }
  categories: { id: string; name: string }[]
}

interface MenuResponse {
  data: MenuItem[]
  meta: MenuMeta
}

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'available', label: 'Available' },
  { value: 'unavailable', label: 'Unavailable' },
  { value: 'featured', label: 'Featured' },
  { value: 'archived', label: 'Archived' },
]

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'price_asc', label: 'Price: Low to High' },
  { value: 'price_desc', label: 'Price: High to Low' },
  { value: 'name_asc', label: 'Name A-Z' },
  { value: 'featured', label: 'Featured First' },
]

const getCategoryLabel = (category: MenuCategory | string | null): string => {
  if (!category) return 'Uncategorized'
  if (typeof category === 'string') return category
  return category.name
}

export default function BusinessOwnerMenu() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const selectedBusinessId = useBusinessOwnerStore((s) => s.selectedBusinessId)

  // Filter / toolbar state
  const [searchInput, setSearchInput] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [sortBy, setSortBy] = useState('newest')
  const [page, setPage] = useState(1)
  const search = useDebounce(searchInput, 300)

  // Selection
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<number[]>([])

  // Menus / modals
  const [togglingId, setTogglingId] = useState<number | null>(null)
  const [openMenuId, setOpenMenuId] = useState<number | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState<MenuItem | null>(null)
  const [inventoryItem, setInventoryItem] = useState<MenuItem | null>(null)
  const [stockValue, setStockValue] = useState(0)
  const [unitValue, setUnitValue] = useState('')
  const [categoryModal, setCategoryModal] = useState(false)
  const [bulkCategory, setBulkCategory] = useState('')
  const [previewItem, setPreviewItem] = useState<MenuItem | null>(null)
  const [importRef, setImportRef] = useState<HTMLInputElement | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [importing, setImporting] = useState(false)

  const menuRef = useClickOutside<HTMLDivElement>(() => setOpenMenuId(null))
  const bulkRef = useClickOutside<HTMLDivElement>(() => setBulkOpen(false))

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  // Reset page + selection when filters change
  useEffect(() => { setPage(1) }, [search, filterCategory, filterStatus, sortBy, selectedBusinessId])
  useEffect(() => { setSelectedIds([]) }, [selectMode, search, filterCategory, filterStatus])

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['bo-menu'] })

  // ── Queries ──────────────────────────────────────────────────────────
  const { data, isLoading, isPlaceholderData } = useQuery<MenuResponse>({
    queryKey: ['bo-menu', selectedBusinessId, search, filterCategory, filterStatus, sortBy, page],
    queryFn: () => {
      const params = new URLSearchParams()
      if (selectedBusinessId) params.append('business_id', String(selectedBusinessId))
      if (search) params.append('search', search)
      if (filterCategory) params.append('category', filterCategory)
      if (filterStatus) params.append('status', filterStatus)
      params.append('sort', sortBy)
      params.append('per_page', '24')
      params.append('page', String(page))
      return get<MenuResponse>(`/business-owner/menu?${params.toString()}`)
    },
    enabled: !!selectedBusinessId,
    placeholderData: (prev) => prev,
  })

  const items = data?.data ?? []
  const meta = data?.meta
  const stats = meta?.stats
  const categories = meta?.categories ?? []

  // ── Mutations ────────────────────────────────────────────────────────
  const toggleAvailabilityMutation = useMutation({
    mutationFn: (item: MenuItem) => put(`/business-owner/menu/${item.id}`, { is_available: !item.is_available }),
    onMutate: (item) => setTogglingId(item.id),
    onSettled: () => setTogglingId(null),
    onSuccess: () => { invalidate(); showToast('Availability updated') },
    onError: () => showToast('Failed to update availability', 'error'),
  })

  const toggleFeaturedMutation = useMutation({
    mutationFn: (item: MenuItem) => patch(`/business-owner/offerings/${item.id}/featured`),
    onSuccess: () => { invalidate(); showToast('Featured status updated') },
    onError: () => showToast('Failed to update featured status', 'error'),
  })

  const duplicateMutation = useMutation({
    mutationFn: (item: MenuItem) => post(`/business-owner/offerings/${item.id}/duplicate`),
    onSuccess: () => { invalidate(); showToast('Item duplicated') },
    onError: () => showToast('Failed to duplicate item', 'error'),
  })

  const archiveMutation = useMutation({
    mutationFn: (id: number) => post('/business-owner/offerings/bulk-action', {
      action: 'archive', offering_ids: [id], business_id: selectedBusinessId,
    }),
    onSuccess: () => { invalidate(); setConfirmArchive(null); showToast('Item archived') },
    onError: () => showToast('Failed to archive item', 'error'),
  })

  const inventoryMutation = useMutation({
    mutationFn: ({ id, stock, unit }: { id: number; stock: number; unit: string }) =>
      put(`/business-owner/menu/${id}`, { stock, unit }),
    onSuccess: () => { invalidate(); setInventoryItem(null); showToast('Inventory updated') },
    onError: () => showToast('Failed to update inventory', 'error'),
  })

  const bulkActionMutation = useMutation({
    mutationFn: ({ action, offering_ids }: { action: string; offering_ids: number[] }) =>
      post('/business-owner/offerings/bulk-action', { action, offering_ids, business_id: selectedBusinessId }),
    onSuccess: () => {
      invalidate(); setSelectedIds([]); setSelectMode(false); setBulkOpen(false)
      showToast('Bulk action completed')
    },
    onError: () => showToast('Bulk action failed', 'error'),
  })

  const bulkCategoryMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      await Promise.all(ids.map((id) => put(`/business-owner/menu/${id}`, { offering_category_id: bulkCategory })))
    },
    onSuccess: () => {
      invalidate(); setCategoryModal(false); setSelectedIds([]); setSelectMode(false)
      showToast('Category updated')
    },
    onError: () => showToast('Failed to update category', 'error'),
  })

  // ── Import / Export ──────────────────────────────────────────────────
  const exportCsv = () => {
    const headers = ['Name', 'Category', 'Price', 'Available', 'Featured', 'Stock', 'Unit', 'Description']
    const rows = items.map((item) => [
      `"${(item.name || '').replace(/"/g, '""')}"`,
      `"${getCategoryLabel(item.category).replace(/"/g, '""')}"`,
      item.price,
      item.is_available ? 'yes' : 'no',
      item.is_featured ? 'yes' : 'no',
      item.stock ?? 0,
      `"${(item.unit || '').replace(/"/g, '""')}"`,
      `"${(item.description || '').replace(/"/g, '""')}"`,
    ])
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'menu-items.csv'
    a.click()
    URL.revokeObjectURL(url)
    showToast('Menu exported')
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
      const isHeader = header && header.toLowerCase().includes('name') && header.toLowerCase().includes('price')
      if (isHeader) {
        // skip header
      } else if (header) {
        lines.unshift(header)
      }
      let created = 0
      let failed = 0
      for (const line of lines) {
        const parsed = parseCsvLine(line)
        if (!parsed || parsed.length < 3) { failed++; continue }
        const [name, category, price, available = 'yes', featured = 'no', stock = '0', unit = '', description = ''] = parsed
        if (!name || Number.isNaN(Number(price))) { failed++; continue }
        try {
          const categoryName = category.trim()
          const matched = categoryName ? categories.find((c) => c.name.toLowerCase() === categoryName.toLowerCase()) : undefined
          await post('/business-owner/menu', {
            business_id: selectedBusinessId,
            name: name.trim(),
            offering_category_id: matched ? Number(matched.id) : undefined,
            new_category: !matched && categoryName ? categoryName : undefined,
            price: Number(price),
            description: description.trim() || undefined,
            is_available: String(available).toLowerCase() === 'yes',
            is_featured: String(featured).toLowerCase() === 'yes',
            stock: Math.max(0, Number(stock) || 0),
            unit: unit.trim() || undefined,
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

  // ── Derived ──────────────────────────────────────────────────────────
  const selectedCount = selectedIds.length
  const allOnPageSelected = items.length > 0 && items.every((i) => selectedIds.includes(i.id))
  const toggleAll = () => {
    setSelectedIds(allOnPageSelected ? [] : items.map((i) => i.id))
  }
  const toggleOne = (id: number) => {
    setSelectedIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id])
  }

  const statsCards = useMemo(() => [
    { label: 'Total Items', value: stats?.total ?? 0, icon: <Boxes className="w-5 h-5" />, iconBg: 'bg-[#EAF6ED]', iconText: 'text-[#16803C]' },
    { label: 'Available', value: stats?.available ?? 0, icon: <CheckCircle2 className="w-5 h-5" />, iconBg: 'bg-[#EAF6ED]', iconText: 'text-[#16803C]' },
    { label: 'Unavailable', value: stats?.unavailable ?? 0, icon: <EyeOff className="w-5 h-5" />, iconBg: 'bg-[#FEF2F2]', iconText: 'text-[#B91C1C]' },
    { label: 'Featured', value: stats?.featured ?? 0, icon: <Star className="w-5 h-5" />, iconBg: 'bg-[#FFF7D6]', iconText: 'text-[#A66F00]' },
  ], [stats])

  const availabilityBadge = (item: MenuItem) => {
    if (!item.is_available) {
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#FEE2E2] text-[#B91C1C]">Unavailable</span>
    }
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#DCFCE7] text-[#16803C]">Available</span>
  }

  const featuredBadge = () => (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#FEF3C7] text-[#B45309] text-[10px] font-semibold">
      <Star className="w-3 h-3 fill-[#B45309]" /> Featured
    </span>
  )

  // ── Render ───────────────────────────────────────────────────────────
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
          <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">Menu Items</h1>
          <p className="mt-1 text-sm text-[#647067]">Manage your menu offerings.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => importRef?.click()} disabled={importing}
            className="inline-flex items-center gap-2 bg-white hover:bg-[#F3F8F4] text-[#16803C] border border-[#D7E8DB] px-4 py-2.5 rounded-xl text-sm font-medium transition disabled:opacity-50">
            <Upload className="w-4 h-4" /> {importing ? 'Importing...' : 'Import Menu'}
          </button>
          <input ref={setImportRef} type="file" accept=".csv" onChange={handleImportFile} className="hidden" />
          <button onClick={exportCsv}
            className="inline-flex items-center gap-2 bg-white hover:bg-[#F3F8F4] text-[#16803C] border border-[#D7E8DB] px-4 py-2.5 rounded-xl text-sm font-medium transition">
            <Download className="w-4 h-4" /> Export Menu
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
              placeholder="Search menu..."
              className="w-full pl-9 pr-3 py-2 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition"
            />
          </div>

          <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}
            className="px-3 py-2 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#4B5563] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition">
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

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

          {/* Bulk actions */}
          <div ref={bulkRef} className="relative">
            <button onClick={() => setBulkOpen((p) => !p)} disabled={selectedCount === 0}
              className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-[#E2E8E3] rounded-xl text-sm font-medium text-[#4B5563] hover:bg-[#F3F8F4] disabled:opacity-40 transition">
              <Filter className="w-3.5 h-3.5" /> Bulk Actions <ChevronDown className="w-3.5 h-3.5" />
            </button>
            {bulkOpen && (
              <div className="absolute right-0 mt-2 w-52 bg-white rounded-xl border border-[#E2E8E3] shadow-lg py-1 z-30">
                {[
                  { label: 'Mark Available', action: 'available' },
                  { label: 'Mark Unavailable', action: 'unavailable' },
                  { label: 'Feature Selected', action: 'featured' },
                  { label: 'Unfeature Selected', action: 'unfeatured' },
                  { label: 'Archive Selected', action: 'archive' },
                ].map((opt) => (
                  <button key={opt.action} onClick={() => {
                    bulkActionMutation.mutate({ action: opt.action, offering_ids: selectedIds })
                  }}
                    className="w-full text-left px-4 py-2 text-sm text-[#4B5563] hover:bg-[#F3F8F4] hover:text-[#17201A] transition">
                    {opt.label}
                  </button>
                ))}
                <div className="border-t border-[#E2E8E3] my-1" />
                <button onClick={() => { setCategoryModal(true); setBulkOpen(false) }}
                  className="w-full text-left px-4 py-2 text-sm text-[#4B5563] hover:bg-[#F3F8F4] hover:text-[#17201A] transition">
                  Change Category...
                </button>
              </div>
            )}
          </div>

          {/* Select multiple */}
          <button onClick={() => { setSelectMode((p) => !p); setSelectedIds([]) }}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition ${
              selectMode ? 'bg-[#16803C] text-white' : 'bg-white border border-[#E2E8E3] text-[#4B5563] hover:bg-[#F3F8F4]'
            }`}>
            {selectMode ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
            Select Multiple
          </button>
        </div>

        {/* Selection bar */}
        {selectMode && items.length > 0 && (
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-[#E2E8E3]">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={allOnPageSelected} onChange={toggleAll}
                className="w-3.5 h-3.5 rounded bg-white border-[#E2E8E3] text-[#16803C] focus:ring-[#16803C]/50" />
              <span className="text-[10px] text-[#647067]">Select all ({items.length})</span>
            </label>
            {selectedCount > 0 && (
              <>
                <span className="text-[10px] text-[#647067]">{selectedCount} selected</span>
                <div className="flex items-center gap-1.5 ml-auto">
                  <button onClick={() => bulkActionMutation.mutate({ action: 'featured', offering_ids: selectedIds })}
                    className="inline-flex items-center gap-1 bg-white text-[#A66F00] border border-[#FCE9A8] hover:bg-[#FFF7D6] px-2.5 py-1 rounded-lg text-[10px] font-medium transition">
                    <Star className="w-2.5 h-2.5" /> Feature
                  </button>
                  <button onClick={() => bulkActionMutation.mutate({ action: 'archive', offering_ids: selectedIds })}
                    className="inline-flex items-center gap-1 bg-white text-[#647067] border border-[#E2E8E3] hover:bg-[#F3F8F4] px-2.5 py-1 rounded-lg text-[10px] font-medium transition">
                    <Archive className="w-2.5 h-2.5" /> Archive
                  </button>
                  <button onClick={() => bulkActionMutation.mutate({ action: 'available', offering_ids: selectedIds })}
                    className="inline-flex items-center gap-1 bg-white text-[#16803C] border border-[#BFE3CB] hover:bg-[#EAF6ED] px-2.5 py-1 rounded-lg text-[10px] font-medium transition">
                    <CheckCircle2 className="w-2.5 h-2.5" /> Mark Available
                  </button>
                  <button onClick={() => setCategoryModal(true)}
                    className="inline-flex items-center gap-1 bg-white text-[#4B5563] border border-[#E2E8E3] hover:bg-[#F3F8F4] px-2.5 py-1 rounded-lg text-[10px] font-medium transition">
                    Change Category
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <DashboardSkeleton />
      ) : items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-16 text-center">
          <div className="w-16 h-16 bg-[#F3F8F4] rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ImageIcon className="w-8 h-8 text-[#647067]" />
          </div>
          <h3 className="text-lg font-semibold text-[#17201A] mb-1">No Menu Items Found</h3>
          <p className="text-sm text-[#647067] mb-6">Create your first food item to start building your menu.</p>
          <button onClick={() => navigate('/business-owner/food/create')}
            className="inline-flex items-center gap-2 bg-[#16803C] hover:bg-[#126B32] text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition">
            <Plus className="w-4 h-4" /> Create Food
          </button>
        </div>
      ) : (
        <>
          {/* Card grid */}
          <div className={`grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 transition-opacity ${isPlaceholderData ? 'opacity-50 pointer-events-none' : ''}`}>
            {items.map((item) => (
              <div key={item.id} onClick={() => selectMode && toggleOne(item.id)}
                className={`bg-white rounded-xl border border-[#E2E8E3] overflow-hidden flex flex-col transition ${
                  selectedIds.includes(item.id) ? 'ring-2 ring-[#16803C] border-[#16803C]' : 'hover:border-[#16803C]/30'
                } ${selectMode ? 'cursor-pointer' : ''}`}>
                {/* Image */}
                <div className="relative h-40 bg-[#F3F8F4]">
                  {item.image ? (
                    <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon className="w-10 h-10 text-[#647067]" />
                    </div>
                  )}

                  {/* Selection checkbox */}
                  {selectMode && (
                    <button onClick={(e) => { e.stopPropagation(); toggleOne(item.id) }}
                      className={`absolute top-2 left-2 w-6 h-6 rounded-md flex items-center justify-center border-2 transition ${
                        selectedIds.includes(item.id) ? 'bg-[#16803C] border-[#16803C] text-white' : 'bg-white border-[#E2E8E3] text-transparent'
                      }`}>
                      <CheckCircle2 className="w-4 h-4" />
                    </button>
                  )}

                  {/* ⋮ menu */}
                  {!selectMode && (
                    <div ref={openMenuId === item.id ? menuRef : undefined} className="absolute top-2 right-2">
                      <button onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === item.id ? null : item.id) }}
                        className="w-8 h-8 rounded-lg bg-white/90 hover:bg-white text-[#647067] hover:text-[#17201A] flex items-center justify-center shadow-sm transition">
                        <MoreVertical className="w-4 h-4" />
                      </button>
                      {openMenuId === item.id && (
                        <div className="absolute right-0 mt-1 w-48 bg-white rounded-xl border border-[#E2E8E3] shadow-lg py-1 z-30">
                          <button onClick={() => { setOpenMenuId(null); navigate(`/business-owner/menu/${item.id}/edit`) }}
                            className="w-full text-left px-3 py-2 text-xs text-[#4B5563] hover:bg-[#F3F8F4] flex items-center gap-2 transition">
                            <Pencil className="w-3.5 h-3.5" /> Edit
                          </button>
                          <button onClick={() => { setOpenMenuId(null); setPreviewItem(item) }}
                            className="w-full text-left px-3 py-2 text-xs text-[#4B5563] hover:bg-[#F3F8F4] flex items-center gap-2 transition">
                            <Eye className="w-3.5 h-3.5" /> Preview
                          </button>
                          <button onClick={() => { setOpenMenuId(null); duplicateMutation.mutate(item) }}
                            className="w-full text-left px-3 py-2 text-xs text-[#4B5563] hover:bg-[#F3F8F4] flex items-center gap-2 transition">
                            <Copy className="w-3.5 h-3.5" /> Duplicate
                          </button>
                          <button onClick={() => { setOpenMenuId(null); setInventoryItem(item); setStockValue(item.stock ?? 0); setUnitValue(item.unit ?? '') }}
                            className="w-full text-left px-3 py-2 text-xs text-[#4B5563] hover:bg-[#F3F8F4] flex items-center gap-2 transition">
                            <Boxes className="w-3.5 h-3.5" /> Manage Inventory
                          </button>
                          <div className="border-t border-[#E2E8E3] my-1" />
                          <button onClick={() => { setOpenMenuId(null); toggleAvailabilityMutation.mutate(item) }}
                            className="w-full text-left px-3 py-2 text-xs text-[#4B5563] hover:bg-[#F3F8F4] flex items-center gap-2 transition">
                            {item.is_available ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            {item.is_available ? 'Mark Unavailable' : 'Mark Available'}
                          </button>
                          <button onClick={() => { setOpenMenuId(null); toggleFeaturedMutation.mutate(item) }}
                            className="w-full text-left px-3 py-2 text-xs text-[#4B5563] hover:bg-[#F3F8F4] flex items-center gap-2 transition">
                            <Star className="w-3.5 h-3.5" />
                            {item.is_featured ? 'Unfeature' : 'Mark as Featured'}
                          </button>
                          <div className="border-t border-[#E2E8E3] my-1" />
                          <button onClick={() => { setOpenMenuId(null); setConfirmArchive(item) }}
                            className="w-full text-left px-3 py-2 text-xs text-[#647067] hover:bg-[#F3F8F4] flex items-center gap-2 transition">
                            <Archive className="w-3.5 h-3.5" /> Archive
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Body */}
                <div className="p-4 flex-1 flex flex-col">
                  {item.is_featured && (
                    <div className="mb-2">
                      {featuredBadge()}
                    </div>
                  )}
                  <h3 className="font-semibold text-[#17201A] text-sm leading-snug truncate">{item.name}</h3>
                  <p className="text-[11px] text-[#647067] mt-1 truncate">{getCategoryLabel(item.category)}</p>
                  {item.has_variations && item.variations && item.variations.length > 0 ? (
                    <div className="mt-2">
                      <p className="font-bold text-[#16803C] text-base">
                        {(() => {
                          const prices = item.variations.map((v) => v.price).filter((p) => p > 0)
                          if (prices.length === 0) return '₱0.00'
                          const min = Math.min(...prices)
                          const max = Math.max(...prices)
                          return min === max ? formatCurrency(min) : `${formatCurrency(min)} - ${formatCurrency(max)}`
                        })()}
                      </p>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#F3F8F4] text-[#4B5563] text-[10px] font-medium mt-1">
                        {item.variations.length} variation{item.variations.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  ) : (
                    <p className="font-bold text-[#16803C] text-base mt-2">{formatCurrency(item.price)}</p>
                  )}
                  <div className="mt-auto pt-3 flex items-center justify-between">
                    {availabilityBadge(item)}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleAvailabilityMutation.mutate(item) }}
                      disabled={togglingId === item.id}
                      title={item.is_available ? 'Mark as unavailable' : 'Mark as available'}
                      className={`relative inline-flex items-center h-6 w-11 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 disabled:opacity-50 ${
                        item.is_available ? 'bg-[#16803C]' : 'bg-[#D1D5DB]'
                      }`}
                    >
                      <span className={`inline-block w-4 h-4 transform rounded-full bg-white shadow transition-transform ${
                        item.is_available ? 'translate-x-6' : 'translate-x-1'
                      }`} />
                    </button>
                  </div>
                </div>

                {/* Footer actions */}
                <div className="flex items-center border-t border-[#E2E8E3] divide-x divide-[#E2E8E3]">
                  <button onClick={(e) => { e.stopPropagation(); navigate(`/business-owner/menu/${item.id}/edit`) }}
                    className="flex-1 py-2.5 flex items-center justify-center gap-1 text-[11px] font-medium text-[#16803C] hover:bg-[#EAF6ED] transition">
                    <Pencil className="w-3 h-3" /> Edit
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setPreviewItem(item) }}
                    className="flex-1 py-2.5 flex items-center justify-center gap-1 text-[11px] font-medium text-[#647067] hover:bg-[#F3F8F4] transition">
                    <Eye className="w-3 h-3" /> Preview
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); setConfirmArchive(item) }}
                    className="flex-1 py-2.5 flex items-center justify-center gap-1 text-[11px] font-medium text-[#A66F00] hover:bg-[#FFF7D6] transition">
                    <Archive className="w-3 h-3" /> Archive
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {meta && meta.last_page > 1 && (
            <div className="flex items-center justify-between mt-6">
              <p className="text-sm text-[#647067]">
                Showing {((meta.current_page - 1) * meta.per_page) + 1}–{Math.min(meta.current_page * meta.per_page, meta.total)} of {meta.total}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                  className="px-3 py-2 rounded-lg border border-[#E2E8E3] text-[#647067] hover:bg-[#F3F8F4] disabled:opacity-40 transition text-sm">
                  Previous
                </button>
                <span className="text-sm text-[#647067]">Page {meta.current_page} of {meta.last_page}</span>
                <button onClick={() => setPage((p) => Math.min(meta.last_page, p + 1))} disabled={page === meta.last_page}
                  className="px-3 py-2 rounded-lg border border-[#E2E8E3] text-[#647067] hover:bg-[#F3F8F4] disabled:opacity-40 transition text-sm">
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────── */}

      {/* Archive confirm */}
      <Modal show={confirmArchive !== null} onClose={() => setConfirmArchive(null)} maxWidth="sm">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-[#17201A] mb-2">Archive Menu Item</h3>
          <p className="text-sm text-[#647067] mb-6">
            Are you sure you want to archive "{confirmArchive?.name}"? It can be restored later from the Archive Vault.
          </p>
          <div className="flex items-center justify-end gap-3">
            <button onClick={() => setConfirmArchive(null)} className="px-4 py-2 rounded-xl bg-white text-[#16803C] border border-[#D7E8DB] text-sm font-medium hover:bg-[#F3F8F4] transition">
              Cancel
            </button>
            <button onClick={() => confirmArchive && archiveMutation.mutate(confirmArchive.id)} disabled={archiveMutation.isPending}
              className="px-4 py-2 rounded-xl bg-[#F4B400] hover:bg-[#A66F00] disabled:opacity-50 text-white text-sm font-semibold transition">
              {archiveMutation.isPending ? 'Archiving...' : 'Archive'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Inventory modal */}
      <Modal show={inventoryItem !== null} onClose={() => setInventoryItem(null)} maxWidth="sm">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-[#17201A] mb-1">Manage Inventory</h3>
          <p className="text-sm text-[#647067] mb-6">{inventoryItem?.name}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[#647067] mb-1">Stock</label>
              <input type="number" min={0} value={stockValue} onChange={(e) => setStockValue(Number(e.target.value))}
                className="w-full px-3 py-2 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
            </div>
            <div>
              <label className="block text-xs text-[#647067] mb-1">Unit</label>
              <input type="text" value={unitValue} onChange={(e) => setUnitValue(e.target.value)} placeholder="e.g. pc, kg"
                className="w-full px-3 py-2 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
            </div>
          </div>
          <div className="flex items-center justify-end gap-3 mt-6">
            <button onClick={() => setInventoryItem(null)} className="px-4 py-2 rounded-xl bg-white text-[#16803C] border border-[#D7E8DB] text-sm font-medium hover:bg-[#F3F8F4] transition">
              Cancel
            </button>
            <button onClick={() => inventoryItem && inventoryMutation.mutate({ id: inventoryItem.id, stock: stockValue, unit: unitValue })}
              disabled={inventoryMutation.isPending}
              className="px-4 py-2 rounded-xl bg-[#16803C] hover:bg-[#126B32] disabled:opacity-50 text-white text-sm font-semibold transition">
              {inventoryMutation.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Change category (bulk) modal */}
      <Modal show={categoryModal} onClose={() => setCategoryModal(false)} maxWidth="sm">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-[#17201A] mb-2">Change Category</h3>
          <p className="text-sm text-[#647067] mb-6">Apply a category to {selectedCount || 'selected'} item{selectedCount === 1 ? '' : 's'}.</p>
          <select value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition">
            <option value="">Select a category...</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <div className="flex items-center justify-end gap-3 mt-6">
            <button onClick={() => setCategoryModal(false)} className="px-4 py-2 rounded-xl bg-white text-[#16803C] border border-[#D7E8DB] text-sm font-medium hover:bg-[#F3F8F4] transition">
              Cancel
            </button>
            <button onClick={() => bulkCategory && bulkCategoryMutation.mutate(selectedIds)} disabled={!bulkCategory || bulkCategoryMutation.isPending}
              className="px-4 py-2 rounded-xl bg-[#16803C] hover:bg-[#126B32] disabled:opacity-50 text-white text-sm font-semibold transition">
              {bulkCategoryMutation.isPending ? 'Saving...' : 'Apply'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Preview modal */}
      <Modal show={previewItem !== null} onClose={() => setPreviewItem(null)} maxWidth="md">
        {previewItem && (
          <div>
            <div className="h-52 bg-[#F3F8F4]">
              {previewItem.image ? (
                <img src={previewItem.image} alt={previewItem.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-12 h-12 text-[#647067]" /></div>
              )}
            </div>
            <div className="p-6">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <h3 className="text-xl font-bold text-[#17201A]">{previewItem.name}</h3>
                  <p className="text-xs text-[#647067] mt-0.5">{getCategoryLabel(previewItem.category)}</p>
                </div>
                {previewItem.has_variations && previewItem.variations && previewItem.variations.length > 0 ? (
                  <div className="text-right">
                    <p className="text-xl font-bold text-[#16803C]">
                      {(() => {
                        const prices = previewItem.variations.map((v) => v.price).filter((p) => p > 0)
                        if (prices.length === 0) return '₱0.00'
                        const min = Math.min(...prices)
                        const max = Math.max(...prices)
                        return min === max ? formatCurrency(min) : `${formatCurrency(min)} - ${formatCurrency(max)}`
                      })()}
                    </p>
                    <span className="text-xs text-[#647067]">{previewItem.variations.length} variation{previewItem.variations.length !== 1 ? 's' : ''}</span>
                  </div>
                ) : (
                  <p className="text-xl font-bold text-[#16803C]">{formatCurrency(previewItem.price)}</p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mb-3">
                {availabilityBadge(previewItem)}
                {previewItem.is_featured && featuredBadge()}
              </div>
              {previewItem.description && (
                <p className="text-sm text-[#4B5563] leading-relaxed">{previewItem.description}</p>
              )}
              {previewItem.has_variations && previewItem.variations && previewItem.variations.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <p className="text-xs font-semibold text-[#647067] uppercase tracking-wider">Variations</p>
                  <div className="flex flex-wrap gap-1.5">
                    {previewItem.variations.map((v) => (
                      <span key={v.id} className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border ${v.is_available ? 'bg-[#F3F8F4] border-[#D7E8DB] text-[#4B5563]' : 'bg-gray-50 border-gray-200 text-gray-400'}`}>
                        {v.name} — {formatCurrency(v.price)}
                        {!v.is_available && <span className="text-[#B91C1C] text-[9px]">(unavailable)</span>}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex items-center justify-end gap-3 mt-6">
                <button onClick={() => navigate(`/business-owner/menu/${previewItem.id}/edit`)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#16803C] hover:bg-[#126B32] text-white text-sm font-semibold transition">
                  <Pencil className="w-3.5 h-3.5" /> Edit Item
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
