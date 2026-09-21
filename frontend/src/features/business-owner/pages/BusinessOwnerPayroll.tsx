import { Link } from 'react-router-dom'
import { ArrowLeft, DollarSign, Download, TrendingUp } from 'lucide-react'
import { formatCurrency } from '@/shared/utils'

const samplePayroll = [
  { id: 1, name: 'Maria Santos', role: 'Waitress', salary: 15000, hours: 160, status: 'paid' },
  { id: 2, name: 'Juan Dela Cruz', role: 'Chef', salary: 20000, hours: 168, status: 'paid' },
  { id: 3, name: 'Ana Reyes', role: 'Cashier', salary: 15000, hours: 152, status: 'pending' },
  { id: 4, name: 'Pedro Mendoza', role: 'Kitchen Staff', salary: 14000, hours: 160, status: 'pending' },
  { id: 5, name: 'Rosa Garcia', role: 'Waitress', salary: 15000, hours: 140, status: 'pending' },
]

const statusColor = (status: string) => {
  switch (status) {
    case 'paid': return 'text-[#16803C] bg-[#EAF6ED] border-[#BFE3CB]'
    case 'pending': return 'text-[#A66F00] bg-[#FFF7D6] border-[#F4B400]/40'
    default: return 'text-[#647067] bg-[#F3F4F6] border-[#E5E7EB]'
  }
}

export default function BusinessOwnerPayroll() {
  const totalPayroll = samplePayroll.reduce((sum, e) => sum + e.salary, 0)

  return (
    <div>
      <Link to="/business-owner/dashboard" className="inline-flex items-center gap-2 text-sm text-[#647067] hover:text-[#17201A] mb-6 transition">
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </Link>

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">Payroll</h1>
          <p className="mt-1 text-sm text-[#647067]">Manage employee salaries and payroll processing</p>
        </div>
        <button className="inline-flex items-center gap-2 bg-white text-[#16803C] px-4 py-2.5 rounded-xl text-sm font-semibold border border-[#D7E8DB] hover:bg-[#F3F8F4] transition">
          <Download className="w-4 h-4" /> Export
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <div className="bg-[#EAF6ED] border border-[#BFE3CB] rounded-2xl p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[#16803C]">Total Payroll</p>
              <p className="mt-2 text-2xl font-bold text-[#17201A]">{formatCurrency(totalPayroll)}</p>
            </div>
            <div className="w-10 h-10 bg-white border border-[#BFE3CB] rounded-xl flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-[#16803C]" />
            </div>
          </div>
        </div>
        <div className="bg-white border border-[#E2E8E3] rounded-2xl p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[#16803C]">Employees</p>
              <p className="mt-2 text-2xl font-bold text-[#17201A]">{samplePayroll.length}</p>
            </div>
            <div className="w-10 h-10 bg-[#EAF6ED] border border-[#BFE3CB] rounded-xl flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-[#16803C]" />
            </div>
          </div>
        </div>
        <div className="bg-[#FFF7D6] border border-[#F4B400]/40 rounded-2xl p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[#A66F00]">Pending</p>
              <p className="mt-2 text-2xl font-bold text-[#17201A]">{samplePayroll.filter(e => e.status === 'pending').length}</p>
            </div>
            <div className="w-10 h-10 bg-white border border-[#F4B400]/40 rounded-xl flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-[#A66F00]" />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E2E8E3] bg-[#F6F8F4]">
                <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Employee</th>
                <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Role</th>
                <th className="text-right px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Salary</th>
                <th className="text-right px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Hours</th>
                <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8E3]">
              {samplePayroll.map((record) => (
                <tr key={record.id} className="hover:bg-[#F6F8F4] transition-colors">
                  <td className="px-6 py-4 font-medium text-[#17201A]">{record.name}</td>
                  <td className="px-6 py-4 text-[#647067]">{record.role}</td>
                  <td className="px-6 py-4 text-right font-medium text-[#17201A]">{formatCurrency(record.salary)}</td>
                  <td className="px-6 py-4 text-right text-[#4B5563]">{record.hours}h</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-2.5 py-0.5 rounded text-xs font-medium capitalize border ${statusColor(record.status)}`}>
                      {record.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
