import { Link } from 'react-router-dom'
import { ArrowLeft, CreditCard, ShoppingCart, DollarSign, TrendingUp } from 'lucide-react'

export default function BusinessOwnerPOS() {
  return (
    <div>
      <Link to="/business-owner/dashboard" className="inline-flex items-center gap-2 text-sm text-[#647067] hover:text-[#17201A] mb-6 transition">
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </Link>

      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">POS & Sales</h1>
        <p className="mt-1 text-sm text-[#647067]">Point of sale system and sales tracking</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Today's Sales", value: '₱12,450', icon: DollarSign, bg: 'bg-[#EAF6ED]', text: 'text-[#16803C]', border: 'border-[#BFE3CB]' },
          { label: 'Transactions', value: '48', icon: ShoppingCart, bg: 'bg-[#EAF6ED]', text: 'text-[#16803C]', border: 'border-[#BFE3CB]' },
          { label: 'Avg. Transaction', value: '₱259', icon: CreditCard, bg: 'bg-[#EAF6ED]', text: 'text-[#16803C]', border: 'border-[#BFE3CB]' },
          { label: 'Growth', value: '+12%', icon: TrendingUp, bg: 'bg-[#FFF7D6]', text: 'text-[#A66F00]', border: 'border-[#F4B400]/40' },
        ].map((card) => (
          <div key={card.label} className={`${card.bg} border ${card.border} rounded-2xl p-5`}>
            <div className="flex items-start justify-between">
              <div>
                <p className={`text-xs font-semibold uppercase tracking-wider ${card.text}`}>{card.label}</p>
                <p className="mt-2 text-2xl font-bold text-[#17201A]">{card.value}</p>
              </div>
              <div className={`w-10 h-10 ${card.bg} border ${card.border} rounded-xl flex items-center justify-center`}>
                <card.icon className={`w-5 h-5 ${card.text}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-12 text-center">
        <CreditCard className="w-12 h-12 text-[#647067] mx-auto mb-4" />
        <p className="text-[#647067] text-lg font-medium">POS Terminal</p>
        <p className="text-[#647067] text-sm mt-1">Start a new sale or manage existing transactions</p>
        <button className="mt-6 inline-flex items-center gap-2 bg-[#16803C] hover:bg-[#126B32] text-white px-6 py-3 rounded-xl font-semibold transition">
          <ShoppingCart className="w-5 h-5" /> New Sale
        </button>
      </div>
    </div>
  )
}
