import { Link } from 'react-router-dom'
import { ArrowLeft, Shield, Plus } from 'lucide-react'

const sampleRoles = [
  { id: 1, name: 'Restaurant Manager', staff: 1, permissions: 'Full Access' },
  { id: 2, name: 'Cashier', staff: 2, permissions: 'POS, Orders, Payments' },
  { id: 3, name: 'Kitchen Staff', staff: 3, permissions: 'Kitchen Orders, Menu' },
  { id: 4, name: 'Waiter / Waitress', staff: 4, permissions: 'Orders, Tables' },
]

export default function BusinessOwnerRoles() {
  return (
    <div>
      <Link to="/business-owner/dashboard" className="inline-flex items-center gap-2 text-sm text-[#647067] hover:text-[#17201A] mb-6 transition">
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </Link>

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">User & Role Management</h1>
          <p className="mt-1 text-sm text-[#647067]">Manage staff roles and permissions</p>
        </div>
        <button className="inline-flex items-center gap-2 bg-[#16803C] hover:bg-[#126B32] text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition">
          <Plus className="w-4 h-4" /> Add Role
        </button>
      </div>

      <div className="space-y-4">
        {sampleRoles.map((role) => (
          <div key={role.id} className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-5 hover:shadow-lg transition-all">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-[#F3F8F4] border border-[#E2E8E3] flex items-center justify-center">
                  <Shield className="w-5 h-5 text-[#16803C]" />
                </div>
                <div>
                  <h3 className="font-semibold text-[#17201A]">{role.name}</h3>
                  <p className="text-sm text-[#647067]">{role.permissions}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-sm text-[#647067]">{role.staff} staff</span>
                <button className="text-sm text-[#16803C] hover:text-[#126B32] font-medium">Edit</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
