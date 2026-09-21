import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { get, post } from '@/shared/services/api'
import { formatCurrency } from '@/shared/utils'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { ArrowUpRight, ArrowDownLeft, AlertCircle, X, Loader2, Banknote, CheckCircle2, XCircle } from 'lucide-react'

interface CreditBalance {
  total_credits: number
  minimum_reserve: number
  reserved_credits: number
  usable_credits: number
  is_cod_eligible: boolean
}

interface CreditTransaction {
  id: number
  transaction_type: string
  amount: number
  balance_before: number
  balance_after: number
  reserved_before: number | null
  reserved_after: number | null
  reference: string | null
  description: string
  created_at: string
}

interface TopUpResponse {
  checkout_url: string
  reference: string
  amount: number
}

const TOP_UP_PRESETS = [500, 1000, 2000, 5000]

export default function RiderWallet() {
  const [showTopUp, setShowTopUp] = useState(false)
  const [topUpAmount, setTopUpAmount] = useState<string>('')
  const [customAmount, setCustomAmount] = useState(false)

  const { data: balanceData, isLoading: balanceLoading } = useQuery({
    queryKey: ['rider-credits-balance'],
    queryFn: () => get<CreditBalance>('/rider/credits/balance'),
  })

  const { data: transactionsData } = useQuery({
    queryKey: ['rider-credits-transactions'],
    queryFn: () => get<CreditTransaction[]>('/rider/credits/transactions'),
  })

  const topUpMutation = useMutation({
    mutationFn: (amount: number) => post<TopUpResponse>('/rider/credits/topup', { amount }),
    onSuccess: (data) => {
      if (data?.checkout_url) {
        window.location.href = data.checkout_url
      }
    },
  })

  const handleTopUp = () => {
    const amount = parseFloat(topUpAmount)
    if (amount >= 100 && amount <= 50000) {
      topUpMutation.mutate(amount)
    }
  }

  const handlePresetClick = (amount: number) => {
    setTopUpAmount(amount.toString())
    setCustomAmount(false)
  }

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case 'TOP_UP':
        return <ArrowDownLeft className="w-3 h-3" />
      case 'CREDIT_RESERVATION':
      case 'COD_RESERVE':
        return <ArrowUpRight className="w-3 h-3" />
      case 'CREDIT_RELEASE':
      case 'COD_RELEASE':
      case 'CREDIT_FINALIZATION':
      case 'COD_SETTLEMENT':
      case 'REFUND':
        return <ArrowDownLeft className="w-3 h-3" />
      default:
        return <ArrowDownLeft className="w-3 h-3" />
    }
  }

  const getTransactionColor = (type: string) => {
    switch (type) {
      case 'TOP_UP':
      case 'CREDIT_RELEASE':
      case 'COD_RELEASE':
      case 'CREDIT_FINALIZATION':
      case 'COD_SETTLEMENT':
      case 'REFUND':
        return 'bg-[#E5F3E9] text-[#005C42]'
      case 'CREDIT_RESERVATION':
      case 'COD_RESERVE':
        return 'bg-amber-100 text-amber-700'
      default:
        return 'bg-gray-100 text-gray-700'
    }
  }

  const getTransactionAmountColor = (type: string) => {
    switch (type) {
      case 'TOP_UP':
      case 'CREDIT_RELEASE':
      case 'COD_RELEASE':
      case 'CREDIT_FINALIZATION':
      case 'COD_SETTLEMENT':
      case 'REFUND':
        return 'text-[#059669]'
      case 'CREDIT_RESERVATION':
      case 'COD_RESERVE':
        return 'text-amber-600'
      default:
        return 'text-gray-600'
    }
  }

  const getTransactionLabel = (type: string) => {
    switch (type) {
      case 'TOP_UP':
        return 'Top Up'
      case 'CREDIT_RESERVATION':
      case 'COD_RESERVE':
        return 'COD Reserved'
      case 'CREDIT_RELEASE':
      case 'COD_RELEASE':
        return 'COD Released'
      case 'CREDIT_FINALIZATION':
        return 'COD Finalized'
      case 'COD_SETTLEMENT':
        return 'COD Settled'
      case 'REFUND':
        return 'Refund'
      default:
        return type
    }
  }

  const isCreditOut = (type: string) =>
    type === 'CREDIT_RESERVATION' || type === 'COD_RESERVE'

  if (balanceLoading) return <TableSkeleton rows={5} cols={4} />

  const balance = balanceData ?? {
    total_credits: 200,
    minimum_reserve: 200,
    reserved_credits: 0,
    usable_credits: 0,
    is_cod_eligible: false,
  }

  const transactions = transactionsData ?? []

  return (
    <div className="min-h-screen bg-[#F8FAF9]">
      <div className="max-w-lg mx-auto px-4 py-8">
        <div className="mb-4">
          <h1 className="text-2xl lg:text-3xl font-bold text-[#005C42]">My Credits</h1>
          <p className="mt-1 text-sm text-[#6B8F7A]">TrackTour credits for COD deliveries</p>
        </div>

        {/* Premium Rider Wallet Card */}
        <div className="flex justify-center mt-6 mb-8">
          <div className="wallet-container">
            <div className="wallet-wrapper">
              <div className="premium-card">
                <div className="card-bg-base" />
                <div className="card-bg-gradient" />
                <div className="card-bg-texture" />
                <div className="card-geometric-pattern" />
                <div className="card-subtle-landscape" />

                <svg className="gold-accent-top-right" viewBox="0 0 200 200" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="goldGradTR" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#FFD700" stopOpacity="0.95" />
                      <stop offset="50%" stopColor="#FFC107" stopOpacity="0.7" />
                      <stop offset="100%" stopColor="#FFB300" stopOpacity="0.3" />
                    </linearGradient>
                    <linearGradient id="goldGradTR2" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#FFE44D" stopOpacity="0.5" />
                      <stop offset="100%" stopColor="#FFD700" stopOpacity="0.15" />
                    </linearGradient>
                  </defs>
                  <path d="M200,0 C175,25 150,70 125,110 C100,150 65,170 20,195 C55,178 95,155 125,120 C155,85 180,45 200,0 Z" fill="url(#goldGradTR)" />
                  <path d="M200,0 C185,18 168,50 150,85 C132,120 100,148 60,170 C88,155 125,130 150,100 C175,70 192,35 200,0 Z" fill="url(#goldGradTR2)" />
                </svg>

                <svg className="gold-accent-bottom-left" viewBox="0 0 200 200" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="goldGradBL" x1="100%" y1="100%" x2="0%" y2="0%">
                      <stop offset="0%" stopColor="#FFD700" stopOpacity="0.85" />
                      <stop offset="50%" stopColor="#FFC107" stopOpacity="0.6" />
                      <stop offset="100%" stopColor="#FFB300" stopOpacity="0.25" />
                    </linearGradient>
                    <linearGradient id="goldGradBL2" x1="100%" y1="100%" x2="0%" y2="0%">
                      <stop offset="0%" stopColor="#FFE44D" stopOpacity="0.4" />
                      <stop offset="100%" stopColor="#FFD700" stopOpacity="0.1" />
                    </linearGradient>
                  </defs>
                  <path d="M0,200 C25,175 50,130 75,90 C100,50 135,30 180,5 C145,22 105,45 75,80 C45,115 20,155 0,200 Z" fill="url(#goldGradBL)" />
                  <path d="M0,200 C15,182 32,150 50,115 C68,80 100,52 140,30 C112,45 75,70 50,100 C25,130 8,165 0,200 Z" fill="url(#goldGradBL2)" />
                </svg>

                <div className="card-content">
                  <div className="card-header">
                    <div className="card-brand">
                      <svg className="brand-icon" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="url(#silverGrad)" strokeWidth="1.5" />
                        <path d="M12 2C12 2 8 8 8 12C8 16 12 22 12 22" stroke="url(#silverGrad)" strokeWidth="1" />
                        <path d="M12 2C12 2 16 8 16 12C16 16 12 22 12 22" stroke="url(#silverGrad)" strokeWidth="1" />
                        <path d="M2 12h20" stroke="url(#silverGrad)" strokeWidth="1" />
                        <path d="M4 7h16" stroke="url(#silverGrad)" strokeWidth="0.8" />
                        <path d="M4 17h16" stroke="url(#silverGrad)" strokeWidth="0.8" />
                        <defs>
                          <linearGradient id="silverGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#E8E8E8" />
                            <stop offset="50%" stopColor="#FFFFFF" />
                            <stop offset="100%" stopColor="#C0C0C0" />
                          </linearGradient>
                        </defs>
                      </svg>
                      <div className="brand-text">
                        <span className="brand-name">TRACKTOUR</span>
                        <span className="brand-label">RIDER WALLET</span>
                      </div>
                    </div>
                  </div>

                  <div className="card-financials">
                    <div className="financial-main">
                      <div className="financial-item primary">
                        <span className="financial-label">AVAILABLE CREDITS</span>
                        <span className="financial-value large">{formatCurrency(balance.usable_credits)}</span>
                      </div>
                      <div className="financial-item secondary text-right">
                        <span className="financial-label">TOTAL CREDITS</span>
                        <span className="financial-value">{formatCurrency(balance.total_credits)}</span>
                      </div>
                    </div>
                    <div className="financial-footer">
                      <div className="financial-protected">
                        <span className="protected-label">PROTECTED RESERVE</span>
                        <span className="protected-value">₱200.00</span>
                      </div>
                      <div className="financial-reserved">
                        <span className="protected-label">RESERVED</span>
                        <span className="protected-value">{formatCurrency(balance.reserved_credits)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="card-border" />
              </div>

              {/* Pocket */}
              <div className="pocket">
                <svg className="pocket-svg" viewBox="0 0 360 200" fill="none">
                  <path d="M 0 20 C 0 10, 5 10, 10 10 C 20 10, 25 25, 40 25 L 320 25 C 335 25, 340 10, 350 10 C 355 10, 360 10, 360 20 L 360 160 C 360 195, 340 200, 320 200 L 40 200 C 20 200, 0 195, 0 160 Z" fill="#022c22" />
                  <path d="M 8 22 C 8 16, 12 16, 15 16 C 23 16, 27 29, 40 29 L 320 29 C 333 29, 337 16, 345 16 C 348 16, 352 16, 352 22 L 352 160 C 352 190, 335 192, 320 192 L 40 192 C 25 192, 8 192, 8 160 Z" stroke="#047857" strokeWidth="1.5" strokeDasharray="6 4" />
                </svg>
              </div>
            </div>
            <p className="mt-4 text-sm italic text-[#047857] font-medium">Hover to see balance</p>
          </div>
        </div>

        {/* COD Eligibility */}
        <div className={`mb-6 p-3 rounded-xl flex items-center gap-2 ${balance.is_cod_eligible ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
          {balance.is_cod_eligible ? (
            <>
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              <div>
                <p className="text-sm font-semibold text-emerald-700">COD Eligible</p>
                <p className="text-xs text-emerald-600/70">You can accept COD deliveries</p>
              </div>
            </>
          ) : (
            <>
              <XCircle className="w-5 h-5 text-red-500" />
              <div>
                <p className="text-sm font-semibold text-red-700">COD Not Eligible</p>
                <p className="text-xs text-red-600/70">Your credits have reached the ₱200 protected reserve. Top up to accept COD deliveries again.</p>
              </div>
            </>
          )}
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <button
            onClick={() => setShowTopUp(true)}
            className="bg-white rounded-2xl border border-[#E8EEE9] p-5 shadow-sm hover:shadow-md hover:border-[#2E8B57]/40 transition-all duration-200 text-left"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-[#E5F3E9] rounded-xl flex items-center justify-center">
                <ArrowDownLeft className="w-6 h-6 text-[#2E8B57]" />
              </div>
              <div>
                <h3 className="font-semibold text-[#005C42]">Cash In</h3>
                <p className="text-sm text-[#6B8F7A]">Buy credits</p>
              </div>
            </div>
          </button>
          <button className="bg-white rounded-2xl border border-[#E8EEE9] p-5 shadow-sm opacity-50 cursor-not-allowed">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-[#FFF4B8] rounded-xl flex items-center justify-center">
                <ArrowUpRight className="w-6 h-6 text-[#D97706]" />
              </div>
              <div>
                <h3 className="font-semibold text-[#005C42]">Cash Out</h3>
                <p className="text-sm text-[#6B8F7A]">Coming soon</p>
              </div>
            </div>
          </button>
        </div>

        {/* Recent Transactions */}
        <div className="bg-white rounded-2xl border border-[#C5D4CB] shadow-md">
          <div className="p-5 border-b border-[#E8EEE9]">
            <h2 className="text-lg font-semibold text-[#005C42]">Transaction History</h2>
          </div>
          <div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#D7E2DC] bg-[#F0F5F2]">
                  <th className="text-left px-3 py-2 font-bold uppercase tracking-wider text-[#005C42]">Type</th>
                  <th className="text-left px-3 py-2 font-bold uppercase tracking-wider text-[#005C42]">Description</th>
                  <th className="text-right px-3 py-2 font-bold uppercase tracking-wider text-[#005C42]">Amount</th>
                  <th className="text-right px-3 py-2 font-bold uppercase tracking-wider text-[#005C42]">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8EEE9]">
                {transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-[#F8FAF9] transition-colors">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${getTransactionColor(tx.transaction_type)}`}>
                        {getTransactionIcon(tx.transaction_type)}
                        {getTransactionLabel(tx.transaction_type)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[#374151] truncate max-w-[120px]">{tx.description}</td>
                    <td className={`px-3 py-2 text-right font-medium whitespace-nowrap ${getTransactionAmountColor(tx.transaction_type)}`}>
                      {isCreditOut(tx.transaction_type) ? '-' : '+'}{formatCurrency(tx.amount)}
                    </td>
                    <td className="px-3 py-2 text-[#6B8F7A] text-right whitespace-nowrap">
                      {new Date(tx.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
                {transactions.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-[#9CA3AF]">No transactions yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Top Up Modal */}
        {showTopUp && (
          <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl border border-[#E8EEE9] shadow-2xl w-full max-w-md overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-[#E8EEE9]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#E5F3E9] rounded-xl flex items-center justify-center">
                    <Banknote className="w-5 h-5 text-[#2E8B57]" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-[#005C42]">Buy Credits</h3>
                    <p className="text-xs text-[#6B8F7A]">via GCash</p>
                  </div>
                </div>
                <button
                  onClick={() => { setShowTopUp(false); setTopUpAmount(''); setCustomAmount(false) }}
                  className="text-[#9CA3AF] hover:text-[#374151] transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Content */}
              <div className="px-6 py-5 space-y-5">
                {/* Preset Amounts */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#6B8F7A] mb-3">Select Amount</p>
                  <div className="grid grid-cols-2 gap-3">
                    {TOP_UP_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        onClick={() => handlePresetClick(preset)}
                        className={`py-3 px-4 rounded-xl border-2 font-semibold transition-all ${
                          topUpAmount === preset.toString() && !customAmount
                            ? 'border-[#2E8B57] bg-[#E5F3E9] text-[#005C42]'
                            : 'border-[#E8EEE9] bg-[#F8FAF9] text-[#374151] hover:border-[#D1D5DB]'
                        }`}
                      >
                        {formatCurrency(preset)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom Amount */}
                <div>
                  <button
                    onClick={() => setCustomAmount(!customAmount)}
                    className="text-sm text-[#2E8B57] hover:text-[#005C42] transition mb-2"
                  >
                    {customAmount ? 'Use preset amounts' : 'Enter custom amount'}
                  </button>
                  {customAmount && (
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#6B8F7A] font-medium">₱</span>
                      <input
                        type="number"
                        min="100"
                        max="50000"
                        value={topUpAmount}
                        onChange={(e) => setTopUpAmount(e.target.value)}
                        placeholder="100 - 50,000"
                        className="w-full pl-8 pr-4 py-3 bg-[#F8FAF9] border border-[#E8EEE9] rounded-xl text-[#005C42] placeholder-[#9CA3AF] focus:outline-none focus:border-[#2E8B57] focus:ring-2 focus:ring-[#2E8B57]/20 transition"
                      />
                    </div>
                  )}
                </div>

                {/* Summary */}
                {topUpAmount && parseFloat(topUpAmount) >= 100 && (
                  <div className="bg-[#F8FAF9] rounded-xl p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-[#6B8F7A]">Credits</span>
                      <span className="text-[#005C42]">{formatCurrency(parseFloat(topUpAmount))}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-[#6B8F7A]">Payment Method</span>
                      <span className="text-[#005C42]">GCash</span>
                    </div>
                    <div className="border-t border-[#E8EEE9] pt-2 flex justify-between">
                      <span className="font-semibold text-[#005C42]">Amount to Pay</span>
                      <span className="font-bold text-[#2E8B57]">{formatCurrency(parseFloat(topUpAmount))}</span>
                    </div>
                  </div>
                )}

                {/* Error */}
                {topUpMutation.isError && (
                  <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>Failed to initiate payment. Please try again.</span>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-[#E8EEE9]">
                <button
                  onClick={handleTopUp}
                  disabled={!topUpAmount || parseFloat(topUpAmount) < 100 || topUpMutation.isPending}
                  className="w-full py-3 bg-[#FFD700] hover:bg-[#E6C200] disabled:bg-[#D1D5DB] disabled:cursor-not-allowed text-[#005C42] font-bold rounded-xl transition flex items-center justify-center gap-2"
                >
                  {topUpMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      Continue to GCash
                      <ArrowUpRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Wallet Styles */}
        <style>{`
          .wallet-container {
            display: flex;
            flex-direction: column;
            align-items: center;
          }

          .wallet-wrapper {
            position: relative;
            width: 360px;
            height: 300px;
            cursor: pointer;
            perspective: 1200px;
            display: flex;
            justify-content: center;
            align-items: flex-end;
            transition: transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1);
            overflow: hidden;
          }

          .wallet-wrapper:hover {
            transform: scale(1.03);
          }

          @keyframes slideIntoPocket {
            0% { transform: translateY(-100px); opacity: 0; }
            100% { transform: translateY(0); opacity: 1; }
          }

          .premium-card {
            position: absolute;
            width: 340px;
            height: 210px;
            left: 10px;
            bottom: 0;
            border-radius: 20px;
            overflow: hidden;
            z-index: 10;
            transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1), z-index 0s;
            animation: slideIntoPocket 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
            animation-delay: 0.1s;
          }

          .wallet-wrapper:hover .premium-card {
            transform: translateY(-90px);
            z-index: 9999;
          }
            box-shadow:
              0 12px 20px rgba(0, 0, 0, 0.2),
              0 30px 70px rgba(7, 53, 42, 0.55),
              0 40px 100px rgba(7, 53, 42, 0.3),
              inset 0 1px 0 rgba(255, 255, 255, 0.15);
          }

          .card-bg-base {
            position: absolute;
            inset: 0;
            background: #07352A;
          }

          .card-bg-gradient {
            position: absolute;
            inset: 0;
            background: linear-gradient(145deg, #07352A 0%, #0A4D3A 20%, #087F5B 50%, #0A4D3A 80%, #07352A 100%);
            opacity: 1;
          }

          .card-bg-texture {
            position: absolute;
            inset: 0;
            background:
              radial-gradient(ellipse at 25% 15%, rgba(255,255,255,0.07) 0%, transparent 45%),
              radial-gradient(ellipse at 75% 85%, rgba(255,255,255,0.03) 0%, transparent 35%);
            pointer-events: none;
          }

          .card-geometric-pattern {
            position: absolute;
            inset: 0;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='100' viewBox='0 0 56 100'%3E%3Cpath d='M28 66L0 50L0 16L28 0L56 16L56 50L28 66L28 100' fill='none' stroke='%23ffffff' stroke-opacity='0.03' stroke-width='1'/%3E%3Cpath d='M28 0L28 34L0 50L0 84L28 100L56 84L56 50L28 34' fill='none' stroke='%23ffffff' stroke-opacity='0.02' stroke-width='1'/%3E%3C/svg%3E");
            background-position: right -10px bottom -20px;
            pointer-events: none;
          }

          .card-subtle-landscape {
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            height: 50px;
            background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 50' preserveAspectRatio='none'%3E%3Cpath d='M0,50 L0,38 C40,30 80,35 120,28 C160,21 190,15 230,20 C270,25 300,30 340,25 C370,21 390,30 400,35 L400,50 Z' fill='%23ffffff' fill-opacity='0.025'/%3E%3C/svg%3E") no-repeat bottom;
            background-size: cover;
            pointer-events: none;
          }

          .gold-accent-top-right {
            position: absolute;
            top: -15px;
            right: -15px;
            width: 150px;
            height: 150px;
            pointer-events: none;
            z-index: 2;
          }

          .gold-accent-bottom-left {
            position: absolute;
            bottom: -15px;
            left: -15px;
            width: 140px;
            height: 140px;
            pointer-events: none;
            z-index: 2;
          }

          .card-content {
            position: relative;
            z-index: 5;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            height: 100%;
            padding: 26px 30px;
          }

          .card-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
          }

          .card-brand {
            display: flex;
            align-items: center;
            gap: 14px;
          }

          .brand-icon {
            width: 36px;
            height: 36px;
          }

          .brand-text {
            display: flex;
            flex-direction: column;
            gap: 3px;
          }

          .brand-name {
            font-size: 17px;
            font-weight: 700;
            letter-spacing: 4px;
            color: #FFFFFF;
            font-family: 'Poppins', sans-serif;
          }

          .brand-label {
            font-size: 9px;
            font-weight: 400;
            letter-spacing: 2.5px;
            color: rgba(255, 255, 255, 0.55);
            font-family: 'Poppins', sans-serif;
          }

          .card-financials {
            display: flex;
            flex-direction: column;
            gap: 10px;
          }

          .financial-main {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
          }

          .financial-item {
            display: flex;
            flex-direction: column;
            gap: 4px;
          }

          .financial-item.primary .financial-value {
            font-size: 30px;
            font-weight: 300;
            color: #FFFFFF;
            letter-spacing: 1px;
            line-height: 1;
          }

          .financial-item.secondary .financial-value {
            font-size: 20px;
            font-weight: 400;
            color: rgba(255, 255, 255, 0.85);
            letter-spacing: 0.5px;
            line-height: 1;
          }

          .financial-label {
            font-size: 8px;
            font-weight: 500;
            letter-spacing: 1.5px;
            color: rgba(255, 255, 255, 0.45);
            text-transform: uppercase;
            font-family: 'Poppins', sans-serif;
          }

          .financial-value {
            font-family: 'Poppins', sans-serif;
          }

          .financial-footer {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            padding-top: 10px;
            border-top: 1px solid rgba(255, 255, 255, 0.08);
          }

          .financial-protected {
            display: flex;
            flex-direction: column;
            gap: 2px;
          }

          .financial-reserved {
            display: flex;
            flex-direction: column;
            gap: 2px;
            text-align: right;
          }

          .protected-label {
            font-size: 8px;
            font-weight: 600;
            letter-spacing: 1.5px;
            color: rgba(255, 255, 255, 0.6);
            text-transform: uppercase;
            font-family: 'Poppins', sans-serif;
          }

          .protected-value {
            font-size: 12px;
            font-weight: 500;
            color: rgba(255, 255, 255, 0.7);
            font-family: 'Poppins', sans-serif;
          }

          .card-border {
            position: absolute;
            inset: 0;
            border-radius: 24px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            pointer-events: none;
            z-index: 10;
          }

          .pocket {
            position: absolute;
            bottom: 0;
            width: 360px;
            height: 200px;
            z-index: 40;
            overflow: hidden;
          }
        `}</style>
      </div>
    </div>
  )
}
