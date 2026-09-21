import { Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle, XCircle, Clock } from 'lucide-react'

const sampleAttendance = [
  { id: 1, name: 'Maria Santos', role: 'Waitress', time_in: '08:00 AM', time_out: '04:00 PM', status: 'present' },
  { id: 2, name: 'Juan Dela Cruz', role: 'Chef', time_in: '09:00 AM', time_out: null, status: 'present' },
  { id: 3, name: 'Ana Reyes', role: 'Cashier', time_in: null, time_out: null, status: 'absent' },
  { id: 4, name: 'Pedro Mendoza', role: 'Kitchen Staff', time_in: '07:30 AM', time_out: '03:30 PM', status: 'present' },
  { id: 5, name: 'Rosa Garcia', role: 'Waitress', time_in: '10:00 AM', time_out: null, status: 'late' },
]

const statusConfig = {
  present: { color: 'text-[#16803C] bg-[#EAF6ED] border-[#BFE3CB]', icon: CheckCircle },
  absent: { color: 'text-[#B91C1C] bg-[#FEF2F2] border-[#FECACA]', icon: XCircle },
  late: { color: 'text-[#A66F00] bg-[#FFF7D6] border-[#F4B400]/40', icon: Clock },
}

export default function BusinessOwnerAttendance() {
  return (
    <div>
      <Link to="/business-owner/dashboard" className="inline-flex items-center gap-2 text-sm text-[#647067] hover:text-[#17201A] mb-6 transition">
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </Link>

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">Attendance</h1>
          <p className="mt-1 text-sm text-[#647067]">Track employee attendance and work hours</p>
        </div>
        <div className="text-sm text-[#647067]">{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Present', value: 3, color: 'text-[#16803C]' },
          { label: 'Absent', value: 1, color: 'text-[#B91C1C]' },
          { label: 'Late', value: 1, color: 'text-[#A66F00]' },
          { label: 'Total Staff', value: 5, color: 'text-[#17201A]' },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-5 text-center">
            <p className={`text-3xl font-bold ${stat.color}`}>{stat.value}</p>
            <p className="text-sm text-[#647067] mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E2E8E3] bg-[#F6F8F4]">
                <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Employee</th>
                <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Role</th>
                <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Time In</th>
                <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Time Out</th>
                <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8E3]">
              {sampleAttendance.map((record) => {
                const config = statusConfig[record.status as keyof typeof statusConfig]
                const Icon = config.icon
                return (
                  <tr key={record.id} className="hover:bg-[#F6F8F4] transition-colors">
                    <td className="px-6 py-4 font-medium text-[#17201A]">{record.name}</td>
                    <td className="px-6 py-4 text-[#647067]">{record.role}</td>
                    <td className="px-6 py-4 text-[#4B5563]">{record.time_in ?? '—'}</td>
                    <td className="px-6 py-4 text-[#4B5563]">{record.time_out ?? '—'}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-medium border ${config.color}`}>
                        <Icon className="w-3.5 h-3.5" /> {record.status}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
