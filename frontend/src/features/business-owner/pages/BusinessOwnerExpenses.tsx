import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post, put, del } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency } from '@/shared/utils'
import { Plus, Pencil, Archive, ChevronLeft, ChevronRight, Wallet, TrendingDown } from 'lucide-react'
import { Modal } from '@/shared/components/Modal'
import { useBusinessOwnerStore } from '../services/business-owner-store'
import type { Business } from '@/shared/types'

interface Expense {
  id: number
  business_id: number
  vendor_name: string
  category: string
  amount: number
  expense_date: string
  notes: string | null
  receipt_path: string | null
  created_at: string
  business?: { id: number; business_name: string }
}

interface PaginatedResponse<T> {
  data: T[]
  meta: { current_page: number; last_page: number; total: number }
}

interface ExpenseSummary {
  total_expenses: number
  by_category: Record<string, number>
  period: string
}

const EXPENSE_CATEGORIES = ['supplies', 'utilities', 'rent', 'services', 'ingredients', 'transport', 'marketing', 'salary', 'other'] as const

const categoryLabels: Record<string, string> = {
  supplies: 'Supplies', utilities: 'Utilities', rent: 'Rent', services: 'Services',
  ingredients: 'Ingredients', transport: 'Transport', marketing: 'Marketing', salary: 'Salary', other: 'Other',
}

const emptyForm = { business_id: 0, vendor_name: '', category: 'other', amount: 0, expense_date: new Date().toISOString().split('T')[0], notes: '' }

export default function BusinessOwnerExpenses() {
  const queryClient = useQueryClient()
  const selectedBusinessId = useBusinessOwnerStore((s) => s.selectedBusinessId)
  const [page, setPage] = useState(1)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [archiveId, setArchiveId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [categoryFilter, setCategoryFilter] = useState('')

  const queryParams = new URLSearchParams()
  if (selectedBusinessId) queryParams.set('business_id', String(selectedBusinessId))
  if (categoryFilter) queryParams.set('category', categoryFilter)
  queryParams.set('page', String(page))

  const { data: businessesData } = useQuery({
    queryKey: ['bo-businesses'],
    queryFn: () => get<{ data: Business[] }>('/business-owner/businesses'),
  })
  const businesses = businessesData?.data ?? []

  const { data: expensesData, isLoading } = useQuery<PaginatedResponse<Expense>>({
    queryKey: ['bo-expenses', queryParams.toString()],
    queryFn: () => get<PaginatedResponse<Expense>>(`/business-owner/expenses?${queryParams.toString()}`),
  })

  const { data: summaryData } = useQuery<ExpenseSummary>({
    queryKey: ['bo-expenses-summary', selectedBusinessId],
    queryFn: () => get<ExpenseSummary>(`/business-owner/expenses/summary${selectedBusinessId ? '?business_id=' + selectedBusinessId : ''}`),
  })

  const expenses = expensesData?.data ?? []
  const meta = expensesData?.meta

  const saveMutation = useMutation({
    mutationFn: (data: typeof form) =>
      editing
        ? put(`/business-owner/expenses/${editing.id}`, data)
        : post('/business-owner/expenses', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-expenses'] })
      queryClient.invalidateQueries({ queryKey: ['bo-expenses-summary'] })
      setShowForm(false); setEditing(null); setForm(emptyForm)
    },
  })

  const archiveMutation = useMutation({
    mutationFn: (id: number) => del(`/business-owner/expenses/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-expenses'] })
      queryClient.invalidateQueries({ queryKey: ['bo-expenses-summary'] })
      setArchiveId(null)
    },
  })

  const openEdit = (expense: Expense) => {
    setEditing(expense)
    setForm({ business_id: expense.business_id, vendor_name: expense.vendor_name, category: expense.category, amount: expense.amount, expense_date: expense.expense_date, notes: expense.notes ?? '' })
    setShowForm(true)
  }

  const openCreate = () => {
    setEditing(null)
    setForm({ ...emptyForm, business_id: selectedBusinessId ?? (businesses[0]?.id ?? 0) })
    setShowForm(true)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32] flex items-center gap-2">
            <Wallet className="w-8 h-8 text-[#16803C]" />
            Expenses
          </h1>
          <p className="mt-1 text-sm text-[#647067]">Track vendor payments and business expenses</p>
        </div>
        <button onClick={openCreate} className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-[#16803C] hover:bg-[#126B32] text-white rounded-xl text-sm font-semibold transition">
          <Plus className="w-4 h-4" /> Add Expense
        </button>
      </div>

      {/* Summary */}
      {summaryData && (
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-5 lg:p-6 ">
          <div className="flex items-center gap-2 mb-4">
            <TrendingDown className="w-5 h-5 text-rose-400" />
            <h3 className="font-semibold text-[#17201A]">Expense Summary ({summaryData.period})</h3>
          </div>
          <div className="text-3xl font-bold text-rose-400 mb-4">{formatCurrency(summaryData.total_expenses)}</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(summaryData.by_category).map(([cat, total]) => (
              <span key={cat} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F3F8F4] border border-[#E2E8E3] text-xs text-[#4B5563]">
                {categoryLabels[cat] ?? cat}: <span className="font-semibold text-[#17201A]">{formatCurrency(Number(total))}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-4 ">
        <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(1) }} className="px-4 py-2 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C]">
          <option value="">All categories</option>
          {EXPENSE_CATEGORIES.map((cat) => (<option key={cat} value={cat}>{categoryLabels[cat]}</option>))}
        </select>
      </div>

      {isLoading ? <DashboardSkeleton /> : expenses.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] py-20 text-center">
          <Wallet className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className="text-[#647067] font-medium">No expenses recorded</p>
          <p className="text-sm text-[#647067] mt-1">Track your first expense to see accurate profit reports</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)]  overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead><tr className="bg-[#F6F8F4] border-b border-[#E2E8E3]">
                <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-[#647067]">Vendor</th>
                <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-[#647067]">Category</th>
                <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-[#647067]">Amount</th>
                <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-[#647067]">Date</th>
                <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-[#647067]">Business</th>
                <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-[#647067] text-right">Actions</th>
              </tr></thead>
              <tbody className="divide-y divide-[#E2E8E3]">
                {expenses.map((exp) => (
                  <tr key={exp.id} className="hover:bg-[#F6F8F4] transition-colors">
                    <td className="px-5 py-3.5 font-medium text-[#17201A]">{exp.vendor_name}</td>
                    <td className="px-5 py-3.5"><span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#F3F8F4] border border-[#E2E8E3] text-[#4B5563]">{categoryLabels[exp.category] ?? exp.category}</span></td>
                    <td className="px-5 py-3.5 font-semibold text-rose-400">{formatCurrency(exp.amount)}</td>
                    <td className="px-5 py-3.5 text-[#647067] text-xs">{exp.expense_date}</td>
                    <td className="px-5 py-3.5 text-[#647067] text-xs">{exp.business?.business_name ?? '—'}</td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(exp)} className="p-1.5 rounded-lg text-[#647067] hover:text-[#16803C] hover:bg-[#EAF6ED] transition"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => setArchiveId(exp.id)} className="p-1.5 rounded-lg text-[#647067] hover:text-[#A66F00] hover:bg-[#FFF7D6] transition"><Archive className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {meta && (
            <div className="px-5 py-3 border-t border-[#E2E8E3] flex items-center justify-between">
              <span className="text-xs text-[#647067]">Page {meta.current_page} of {meta.last_page} ({meta.total} total)</span>
              <div className="flex gap-1">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="p-1.5 rounded-lg text-[#647067] hover:bg-[#F3F8F4] disabled:opacity-30 transition"><ChevronLeft className="w-4 h-4" /></button>
                <button disabled={page >= (meta.last_page ?? 1)} onClick={() => setPage(p => p + 1)} className="p-1.5 rounded-lg text-[#647067] hover:bg-[#F3F8F4] disabled:opacity-30 transition"><ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add/Edit Modal */}
      <Modal show={showForm} onClose={() => { setShowForm(false); setEditing(null) }} maxWidth="lg">
        <div className="p-6 space-y-5">
          <h3 className="text-lg font-semibold text-[#17201A]">{editing ? 'Edit Expense' : 'Add Expense'}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#647067] uppercase tracking-wider mb-1.5">Business</label>
              <select value={form.business_id} onChange={(e) => setForm({ ...form, business_id: Number(e.target.value) })}
                className="w-full px-4 py-2.5 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C]">
                {businesses.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#647067] uppercase tracking-wider mb-1.5">Vendor Name</label>
              <input value={form.vendor_name} onChange={(e) => setForm({ ...form, vendor_name: e.target.value })}
                className="w-full px-4 py-2.5 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C]" placeholder="e.g. Manila Electric Co." />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#647067] uppercase tracking-wider mb-1.5">Category</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full px-4 py-2.5 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C]">
                {EXPENSE_CATEGORIES.map((cat) => (<option key={cat} value={cat}>{categoryLabels[cat]}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#647067] uppercase tracking-wider mb-1.5">Amount (₱)</label>
              <input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })}
                className="w-full px-4 py-2.5 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#647067] uppercase tracking-wider mb-1.5">Expense Date</label>
              <input type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
                className="w-full px-4 py-2.5 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C]" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#647067] uppercase tracking-wider mb-1.5">Notes (optional)</label>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full px-4 py-2.5 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C]" rows={2} placeholder="Invoice # or additional details" />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => { setShowForm(false); setEditing(null) }} className="px-4 py-2 rounded-xl border border-[#D7E8DB] text-sm font-medium text-[#16803C] hover:bg-[#F3F8F4] transition">Cancel</button>
            <button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending || !form.vendor_name || !form.amount}
              className="px-4 py-2 rounded-xl bg-[#16803C] hover:bg-[#126B32] disabled:opacity-50 text-white text-sm font-semibold transition">
              {saveMutation.isPending ? 'Saving...' : editing ? 'Update' : 'Save Expense'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Archive confirmation */}
      <Modal show={archiveId !== null} onClose={() => setArchiveId(null)} maxWidth="sm">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-[#17201A] mb-2">Archive Expense</h3>
          <p className="text-sm text-[#647067] mb-6">Are you sure you want to archive this expense? It can be restored later from the Archive Vault.</p>
          <div className="flex items-center justify-end gap-3">
            <button onClick={() => setArchiveId(null)} className="px-4 py-2 rounded-xl border border-[#D7E8DB] text-sm font-medium text-[#16803C] hover:bg-[#F3F8F4] transition">Cancel</button>
            <button onClick={() => archiveId && archiveMutation.mutate(archiveId)} disabled={archiveMutation.isPending}
              className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-semibold transition">
              {archiveMutation.isPending ? 'Archiving...' : 'Archive'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
