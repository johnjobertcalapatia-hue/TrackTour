import { Link } from 'react-router-dom'
import { ArrowLeft, Store, Plus } from 'lucide-react'

const sampleTables = [
  { id: 1, name: 'Table 1', capacity: 4, status: 'available', zone: 'Indoor' },
  { id: 2, name: 'Table 2', capacity: 2, status: 'occupied', zone: 'Indoor' },
  { id: 3, name: 'Table 3', capacity: 6, status: 'reserved', zone: 'Outdoor' },
  { id: 4, name: 'Table 4', capacity: 8, status: 'available', zone: 'VIP' },
  { id: 5, name: 'Table 5', capacity: 4, status: 'maintenance', zone: 'Indoor' },
]

const statusColor = (status: string) => {
  switch (status) {
    case 'available': return 'text-[#16803C] bg-[#EAF6ED] border-[#BFE3CB]'
    case 'occupied': return 'text-[#B91C1C] bg-[#FEF2F2] border-[#FECACA]'
    case 'reserved': return 'text-[#A66F00] bg-[#FFF7D6] border-[#F4B400]/40'
    case 'maintenance': return 'text-[#647067] bg-[#F3F4F6] border-[#E5E7EB]'
    default: return 'text-[#647067] bg-[#F3F4F6] border-[#E5E7EB]'
  }
}

export default function BusinessOwnerTables() {
  return (
    <div>
      <Link to="/business-owner/dashboard" className="inline-flex items-center gap-2 text-sm text-[#647067] hover:text-[#17201A] mb-6 transition">
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </Link>

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">Table Management</h1>
          <p className="mt-1 text-sm text-[#647067]">Manage your restaurant tables, seating, and layout</p>
        </div>
        <button className="inline-flex items-center gap-2 bg-[#16803C] hover:bg-[#126B32] text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition">
          <Plus className="w-4 h-4" /> Add Table
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {sampleTables.map((table) => (
          <div key={table.id} className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-5 hover:shadow-lg transition-all">
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 rounded-xl bg-[#F3F8F4] border border-[#E2E8E3] flex items-center justify-center">
                <Store className="w-5 h-5 text-[#647067]" />
              </div>
              <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium capitalize border ${statusColor(table.status)}`}>
                {table.status}
              </span>
            </div>
            <h3 className="text-lg font-semibold text-[#17201A] mb-1">{table.name}</h3>
            <p className="text-sm text-[#647067]">Capacity: {table.capacity} seats</p>
            <p className="text-xs text-[#647067] mt-1">{table.zone}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
