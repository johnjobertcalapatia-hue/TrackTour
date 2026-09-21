import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { useBusinessOwnerStore } from '../services/business-owner-store'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { ArrowLeft, Phone, Mail, Search } from 'lucide-react'

interface Customer {
  id: string | number
  name: string
  email: string
  phone: string
  is_guest: boolean
  orders_count: number
  total_spent: number
  avg_order_value: number
  last_order_at: string
  first_order_at: string
  last_order_number: string
}

interface CustomerSummary {
  total_customers: number
  regular_customers: number
  total_orders: number
  total_revenue: number
  new_this_month: number
}

interface PaginatedResponse {
  data: Customer[]
  current_page: number
  last_page: number
  per_page: number
  total: number
}

export default function BusinessOwnerCustomers() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const selectedBusinessId = useBusinessOwnerStore((s) => s.selectedBusinessId)

  const { data: summaryData, isLoading: summaryLoading } = useQuery({
    queryKey: ['bo-customers-summary', selectedBusinessId],
    queryFn: () => {
      const params = new URLSearchParams()
      if (selectedBusinessId) params.set('business_id', String(selectedBusinessId))
      const qs = params.toString()
      return get<{ data: CustomerSummary }>(`/business-owner/customers/summary${qs ? `?${qs}` : ''}`)
    },
  })

  const { data: customersData, isLoading: customersLoading } = useQuery({
    queryKey: ['bo-customers', selectedBusinessId, page, search],
    queryFn: () => {
      const params = new URLSearchParams()
      if (selectedBusinessId) params.set('business_id', String(selectedBusinessId))
      params.set('page', String(page))
      if (search) params.set('search', search)
      const qs = params.toString()
      return get<{ data: PaginatedResponse }>(`/business-owner/customers${qs ? `?${qs}` : ''}`)
    },
  })

  if (summaryLoading || customersLoading) return <DashboardSkeleton />

  const summary = summaryData?.data
  const customers = customersData?.data?.data ?? []
  const totalPages = customersData?.data?.last_page ?? 1

  return (
    <div>
      <Link to="/business-owner/dashboard" className="inline-flex items-center gap-2 text-sm text-[#647067] hover:text-[#17201A] mb-6 transition">
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </Link>

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">Customer Management</h1>
          <p className="mt-1 text-sm text-[#647067]">View and manage your customer database</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-5 text-center">
          <p className="text-3xl font-bold text-[#17201A]">{summary?.total_customers ?? 0}</p>
          <p className="text-sm text-[#647067] mt-1">Total Customers</p>
        </div>
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-5 text-center">
          <p className="text-3xl font-bold text-[#16803C]">{summary?.regular_customers ?? 0}</p>
          <p className="text-sm text-[#647067] mt-1">Regular Customers</p>
        </div>
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-5 text-center">
          <p className="text-3xl font-bold text-[#A66F00]">{summary?.total_orders ?? 0}</p>
          <p className="text-sm text-[#647067] mt-1">Total Orders</p>
        </div>
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-5 text-center">
          <p className="text-3xl font-bold text-[#2563EB]">{summary?.new_this_month ?? 0}</p>
          <p className="text-sm text-[#647067] mt-1">New This Month</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] overflow-hidden">
        <div className="p-4 border-b border-[#E2E8E3]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#647067]" />
            <input
              type="text"
              placeholder="Search customers by name, email, or phone..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              className="w-full pl-10 pr-4 py-2 border border-[#E2E8E3] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#126B32]/20 focus:border-[#126B32]"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E2E8E3] bg-[#F6F8F4]">
                <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Customer</th>
                <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Contact</th>
                <th className="text-right px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Orders</th>
                <th className="text-right px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Avg. Order</th>
                <th className="text-right px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Total Spent</th>
                <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Last Order</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8E3]">
              {customers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-[#647067]">
                    No customers found
                  </td>
                </tr>
              ) : (
                customers.map((customer) => (
                  <tr key={customer.id} className="hover:bg-[#F6F8F4] transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white text-xs font-bold">
                          {customer.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                        </div>
                        <div>
                          <span className="font-medium text-[#17201A]">{customer.name}</span>
                          {customer.is_guest && (
                            <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Guest</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-0.5">
                        {customer.phone && (
                          <span className="text-[#4B5563] text-xs flex items-center gap-1">
                            <Phone className="w-3 h-3" /> {customer.phone}
                          </span>
                        )}
                        {customer.email && (
                          <span className="text-[#647067] text-xs flex items-center gap-1">
                            <Mail className="w-3 h-3" /> {customer.email}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right text-[#4B5563]">{customer.orders_count}</td>
                    <td className="px-6 py-4 text-right text-[#4B5563]">₱{customer.avg_order_value.toLocaleString()}</td>
                    <td className="px-6 py-4 text-right font-medium text-[#17201A]">₱{customer.total_spent.toLocaleString()}</td>
                    <td className="px-6 py-4 text-[#647067]">
                      {customer.last_order_at ? new Date(customer.last_order_at).toLocaleDateString() : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-[#E2E8E3]">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-4 py-2 text-sm border border-[#E2E8E3] rounded-lg hover:bg-[#F6F8F4] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-sm text-[#647067]">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-4 py-2 text-sm border border-[#E2E8E3] rounded-lg hover:bg-[#F6F8F4] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
