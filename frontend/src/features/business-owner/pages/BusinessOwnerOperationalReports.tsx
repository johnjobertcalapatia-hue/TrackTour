import { Link } from 'react-router-dom'
import { ArrowLeft, FileBarChart, Download, TrendingUp, TrendingDown } from 'lucide-react'

export default function BusinessOwnerOperationalReports() {
  return (
    <div>
      <Link to="/business-owner/dashboard" className="inline-flex items-center gap-2 text-sm text-[#647067] hover:text-[#17201A] mb-6 transition">
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </Link>

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">Operational Reports</h1>
          <p className="mt-1 text-sm text-[#647067]">Detailed operational analytics and performance metrics</p>
        </div>
        <button className="inline-flex items-center gap-2 bg-white text-[#16803C] px-4 py-2.5 rounded-xl text-sm font-semibold border border-[#D7E8DB] hover:bg-[#F3F8F4] transition">
          <Download className="w-4 h-4" /> Export
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {[
          { title: 'Order Fulfillment', value: '94%', change: '+2%', up: true, desc: 'Average order completion rate' },
          { title: 'Avg. Preparation Time', value: '18 min', change: '-3 min', up: true, desc: 'Kitchen order preparation time' },
          { title: 'Table Turnover', value: '4.2x', change: '+0.5x', up: true, desc: 'Average daily table turnover rate' },
          { title: 'Customer Wait Time', value: '12 min', change: '+2 min', up: false, desc: 'Average customer wait time' },
          { title: 'Waste Rate', value: '3.8%', change: '-0.5%', up: true, desc: 'Food waste percentage' },
          { title: 'Peak Hours', value: '11AM-1PM', change: '', up: true, desc: 'Busiest operational hours' },
        ].map((report) => (
          <div key={report.title} className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 hover:shadow-lg transition-all">
            <div className="flex items-start justify-between mb-4">
              <div className="w-10 h-10 rounded-xl bg-[#EAF6ED] border border-[#D7E8DB] flex items-center justify-center">
                <FileBarChart className="w-5 h-5 text-[#16803C]" />
              </div>
              {report.change && (
                <span className={`inline-flex items-center gap-1 text-xs font-medium ${report.up ? 'text-[#16803C]' : 'text-[#B91C1C]'}`}>
                  {report.up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {report.change}
                </span>
              )}
            </div>
            <h3 className="text-sm text-[#647067] mb-1">{report.title}</h3>
            <p className="text-2xl font-bold text-[#17201A]">{report.value}</p>
            <p className="text-xs text-[#647067] mt-1">{report.desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
