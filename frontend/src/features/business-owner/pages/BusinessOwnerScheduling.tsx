import { Link } from 'react-router-dom'
import { ArrowLeft, CalendarDays, Plus } from 'lucide-react'

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const staff = ['Maria S.', 'Juan D.', 'Ana R.', 'Pedro M.', 'Rosa G.']
const shifts = ['Morning', 'Afternoon', 'Evening']

export default function BusinessOwnerScheduling() {
  return (
    <div>
      <Link to="/business-owner/dashboard" className="inline-flex items-center gap-2 text-sm text-[#647067] hover:text-[#17201A] mb-6 transition">
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </Link>

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">Employee Scheduling</h1>
          <p className="mt-1 text-sm text-[#647067]">Manage staff work schedules and shifts</p>
        </div>
        <button className="inline-flex items-center gap-2 bg-[#16803C] hover:bg-[#126B32] text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition">
          <Plus className="w-4 h-4" /> Add Shift
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6">
        <div className="flex items-center gap-3 mb-6">
          <CalendarDays className="w-5 h-5 text-[#16803C]" />
          <h2 className="text-lg font-semibold text-[#17201A]">This Week</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E2E8E3]">
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Staff</th>
                {days.map((day) => (
                  <th key={day} className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">{day}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8E3]">
              {staff.map((name) => (
                <tr key={name} className="hover:bg-[#F6F8F4] transition-colors">
                  <td className="px-4 py-3 font-medium text-[#17201A]">{name}</td>
                  {days.map((day) => (
                    <td key={day} className="px-4 py-3 text-center">
                      <div className="flex flex-col gap-1">
                        {Math.random() > 0.3 && (
                          <span className="text-xs bg-[#EAF6ED] text-[#16803C] border border-[#BFE3CB] rounded px-1.5 py-0.5">
                            {shifts[Math.floor(Math.random() * 3)]}
                          </span>
                        )}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
