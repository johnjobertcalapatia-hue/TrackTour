import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { formatCurrency, formatDateTime } from '@/shared/utils'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { ArrowUpRight, ArrowDownLeft, ChevronLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

interface CreditTransaction {
  id: number
  transaction_type: string
  amount: number
  balance_before: number
  balance_after: number
  reference: string | null
  description: string
  created_at: string
}

type FilterTab = 'all' | 'topup' | 'cod' | 'adjust'

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'topup', label: 'Top-ups' },
  { key: 'cod', label: 'COD' },
  { key: 'adjust', label: 'Adjust' },
]

export default function RiderCreditActivity() {
  const navigate = useNavigate()
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all')

  const { data: transactions, isLoading } = useQuery({
    queryKey: ['rider-credits-transactions'],
    queryFn: () => get<CreditTransaction[]>('/rider/credits/transactions'),
  })

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case 'CREDIT_TOPUP':
      case 'COD_RELEASE':
        return <ArrowDownLeft className="w-3 h-3" />
      case 'COD_RESERVE':
        return <ArrowUpRight className="w-3 h-3" />
      default:
        return <ArrowDownLeft className="w-3 h-3" />
    }
  }

  const getTransactionColor = (type: string) => {
    switch (type) {
      case 'CREDIT_TOPUP':
      case 'COD_RELEASE':
        return 'bg-emerald-900/20 text-emerald-300'
      case 'COD_RESERVE':
        return 'bg-amber-900/20 text-amber-300'
      default:
        return 'bg-[#F3F8F5] text-[#4B5563]'
    }
  }

  const getTransactionAmountColor = (type: string) => {
    switch (type) {
      case 'CREDIT_TOPUP':
      case 'COD_RELEASE':
        return 'text-emerald-400'
      case 'COD_RESERVE':
        return 'text-amber-400'
      default:
        return 'text-[#6B7280]'
    }
  }

  const getTransactionLabel = (type: string) => {
    switch (type) {
      case 'CREDIT_TOPUP':
        return 'Credit Top-up'
      case 'COD_RESERVE':
        return 'COD Credit Reserved'
      case 'COD_RELEASE':
        return 'COD Credit Released'
      case 'CREDIT_ADJUSTMENT':
        return 'Credit Adjustment'
      case 'REFUND':
        return 'Refund'
      default:
        return type
    }
  }

  const filterTransactions = (txs: CreditTransaction[]) => {
    switch (activeFilter) {
      case 'topup':
        return txs.filter((tx) => tx.transaction_type === 'CREDIT_TOPUP')
      case 'cod':
        return txs.filter((tx) => tx.transaction_type === 'COD_RESERVE' || tx.transaction_type === 'COD_RELEASE')
      case 'adjust':
        return txs.filter((tx) => tx.transaction_type === 'CREDIT_ADJUSTMENT' || tx.transaction_type === 'REFUND')
      default:
        return txs
    }
  }

  const allTransactions = transactions ?? []
  const filteredTransactions = filterTransactions(allTransactions)

  if (isLoading) return <TableSkeleton rows={8} cols={4} />

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-xl bg-[#F3F8F5] border border-[#D7E2DC] flex items-center justify-center text-[#6B7280] hover:text-[#17201B] transition"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#17201B]">Credit Activity</h1>
          <p className="text-sm text-[#6B7280]">Your credit transaction history</p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveFilter(tab.key)}
            className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition ${
              activeFilter === tab.key
                ? 'bg-[#087F3F] text-white'
                : 'bg-[#F3F8F5] text-[#6B7280] hover:text-[#17201B] border border-[#D7E2DC]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Transactions */}
      <div className="space-y-2">
        {filteredTransactions.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#E5E9E7] p-12 text-center">
            <p className="text-[#9CA3AF]">No transactions found</p>
          </div>
        ) : (
          filteredTransactions.map((tx) => (
            <div
              key={tx.id}
              className="bg-white rounded-xl border border-[#E5E9E7] px-4 py-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${getTransactionColor(tx.transaction_type)}`}>
                    {getTransactionIcon(tx.transaction_type)}
                    {getTransactionLabel(tx.transaction_type)}
                  </span>
                </div>
                <p className={`text-sm font-semibold shrink-0 ml-3 ${getTransactionAmountColor(tx.transaction_type)}`}>
                  {tx.transaction_type === 'COD_RESERVE' ? '-' : '+'}{formatCurrency(tx.amount)}
                </p>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <p className="text-xs text-[#9CA3AF] truncate">{tx.description}</p>
                <p className="text-xs text-[#9CA3AF] shrink-0 ml-3">
                  {formatDateTime(tx.created_at)}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
