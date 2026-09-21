import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/shared/services/api'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { Search, Wallet, Users, Lock, Clock3, CheckCircle, X, Plus, Minus, CalendarDays, ArrowUpDown } from 'lucide-react'

type Rider = {
  id: number; name: string; email: string
  available_credits: number; reserved_credits: number; total_credits: number
  eligibility: 'eligible' | 'limited' | 'ineligible'
}
type Transaction = {
  id: number; rider_id: number; rider_name: string; transaction_type: string
  amount: number; balance_before: number; balance_after: number; reference: string | null
  description: string | null; order_number: string | null; created_at: string
  status: 'success' | 'pending'; payment_method: string | null; provider: string | null
}
type CreditsData = {
  stats: { total_credits: number; available_credits: number; reserved_credits: number; riders: number; eligible_riders: number; pending_topups: number }
  riders: Rider[]; transactions: Transaction[]
}

const money = (value: number) => `₱${value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const date = (value: string) => new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })

export default function AdminCredits() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'overview' | 'riders' | 'topups' | 'activity'>('overview')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [riderSort, setRiderSort] = useState('name_asc')
  const [transactionSort, setTransactionSort] = useState('date_desc')
  const [selectedRider, setSelectedRider] = useState<Rider | null>(null)
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null)
  const [adjustment, setAdjustment] = useState({ type: 'add', amount: '', reason: '' })

  const { data, isLoading } = useQuery({
    queryKey: ['admin-credits'],
    queryFn: () => get<CreditsData>('/admin/credits'),
  })
  const adjustMutation = useMutation({
    mutationFn: () => post(`/admin/credits/riders/${selectedRider?.id}/adjust`, adjustment),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-credits'] })
      setSelectedRider(null)
      setAdjustment({ type: 'add', amount: '', reason: '' })
    },
  })

  const normalizedSearch = search.trim().toLowerCase()
  const riders = useMemo(() => {
    const filtered = (data?.riders ?? []).filter((r) => {
    if (!normalizedSearch) return true
    const riderId = `rt-${String(r.id).padStart(5, '0')}`
    return `${r.name} ${r.email} ${r.id} ${riderId}`.toLowerCase().includes(normalizedSearch)
    })
    return [...filtered].sort((a, b) => {
      const direction = riderSort.endsWith('_desc') ? -1 : 1
      const key = riderSort.replace(/_(asc|desc)$/, '')
      if (key === 'available') return direction * (a.available_credits - b.available_credits)
      if (key === 'reserved') return direction * (a.reserved_credits - b.reserved_credits)
      if (key === 'total') return direction * (a.total_credits - b.total_credits)
      return direction * a.name.localeCompare(b.name)
    })
  }, [data, normalizedSearch, riderSort])
  const transactions = useMemo(() => {
    const filtered = (data?.transactions ?? []).filter((t) => {
      const transactionDate = new Date(t.created_at)
      const day = `${transactionDate.getFullYear()}-${String(transactionDate.getMonth() + 1).padStart(2, '0')}-${String(transactionDate.getDate()).padStart(2, '0')}`
      if (dateFrom && day < dateFrom) return false
      if (dateTo && day > dateTo) return false
      if (!normalizedSearch) return true
      return [
        t.rider_name,
        t.rider_id,
        t.reference,
        t.description,
        t.transaction_type.replaceAll('_', ' '),
        t.order_number,
        t.payment_method,
        t.provider,
      ].filter(Boolean).join(' ').toLowerCase().includes(normalizedSearch)
    })
    return [...filtered].sort((a, b) => {
      const direction = transactionSort.endsWith('_desc') ? -1 : 1
      const key = transactionSort.replace(/_(asc|desc)$/, '')
      if (key === 'amount') return direction * (a.amount - b.amount)
      if (key === 'rider') return direction * a.rider_name.localeCompare(b.rider_name)
      if (key === 'type') return direction * a.transaction_type.localeCompare(b.transaction_type)
      return direction * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    })
  }, [data, dateFrom, dateTo, normalizedSearch, transactionSort])
  if (isLoading) return <TableSkeleton rows={8} cols={5} />
  const stats = data?.stats ?? { total_credits: 0, available_credits: 0, reserved_credits: 0, riders: 0, eligible_riders: 0, pending_topups: 0 }

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">Credits Management</h1><p className="mt-1 text-sm text-[#6B7280]">Manage and monitor rider credits, COD reservations, top-ups, and credit activity.</p></div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Stat icon={Wallet} label="Total Credits" value={money(stats.total_credits)} detail={`${stats.riders} Riders`} tone="green" />
        <Stat icon={CheckCircle} label="Available Credits" value={money(stats.available_credits)} detail="Currently usable" tone="emerald" />
        <Stat icon={Lock} label="Reserved Credits" value={money(stats.reserved_credits)} detail="Active COD orders" tone="amber" />
        <Stat icon={Users} label="Eligible Riders" value={`${stats.eligible_riders}`} detail="Can accept COD" tone="blue" />
        <Stat icon={Clock3} label="Pending Top-ups" value={money(stats.pending_topups)} detail="Processing" tone="purple" />
      </div>
      <div className="rounded-2xl border-2 border-[#D7E8DB] bg-white p-2 shadow-sm">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {(['overview', 'riders', 'topups', 'activity'] as const).map((item) => <button key={item} onClick={() => setTab(item)} className={`rounded-xl px-4 py-3 text-sm font-bold capitalize transition ${tab === item ? 'bg-[#087F3F] text-white shadow-md' : 'text-[#4B5563] hover:bg-[#E9F7EF] hover:text-[#087F3F]'}`}>{item === 'riders' ? 'Rider Credits' : item === 'topups' ? 'Top-ups' : item}</button>)}
        </div>
      </div>
      {(tab !== 'overview') && <div className="grid gap-3 md:grid-cols-[minmax(280px,1fr)_repeat(2,minmax(150px,auto))_minmax(190px,auto)]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#087F3F]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setSearch('') }}
            placeholder={tab === 'riders' ? 'Search rider name, email, or Rider ID...' : 'Search reference, rider, order, or transaction type...'}
            aria-label={tab === 'riders' ? 'Search rider credits' : 'Search credit transactions'}
            className="w-full rounded-xl border-2 border-[#D7E8DB] bg-white py-3 pl-10 pr-24 text-sm text-[#087F3F] placeholder:text-[#087F3F]/70 shadow-sm focus:border-[#16803C] focus:outline-none focus:ring-2 focus:ring-[#16803C]/20"
          />
          {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-bold text-[#16803C] hover:bg-[#E9F7EF]">Clear</button>}
        </div>
        {tab !== 'riders' && <><label className="relative"><CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#087F3F]" /><span className="sr-only">From date</span><input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} className="w-full rounded-xl border-2 border-[#D7E8DB] bg-white py-3 pl-10 pr-3 text-sm text-[#087F3F] shadow-sm focus:border-[#16803C] focus:outline-none focus:ring-2 focus:ring-[#16803C]/20" /></label>
          <label className="relative"><CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#087F3F]" /><span className="sr-only">To date</span><input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} className="w-full rounded-xl border-2 border-[#D7E8DB] bg-white py-3 pl-10 pr-3 text-sm text-[#087F3F] shadow-sm focus:border-[#16803C] focus:outline-none focus:ring-2 focus:ring-[#16803C]/20" /></label></>}
        <label className="relative"><ArrowUpDown className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#087F3F]" /><span className="sr-only">Sort results</span><select value={tab === 'riders' ? riderSort : transactionSort} onChange={(e) => tab === 'riders' ? setRiderSort(e.target.value) : setTransactionSort(e.target.value)} className="w-full appearance-none rounded-xl border-2 border-[#D7E8DB] bg-white py-3 pl-10 pr-3 text-sm font-semibold text-[#087F3F] shadow-sm focus:border-[#16803C] focus:outline-none focus:ring-2 focus:ring-[#16803C]/20">{tab === 'riders' ? <><option value="name_asc">Name A-Z</option><option value="name_desc">Name Z-A</option><option value="available_desc">Available credits high-low</option><option value="available_asc">Available credits low-high</option><option value="reserved_desc">Reserved credits high-low</option><option value="total_desc">Total credits high-low</option></> : <><option value="date_desc">Newest first</option><option value="date_asc">Oldest first</option><option value="amount_desc">Amount high-low</option><option value="amount_asc">Amount low-high</option><option value="rider_asc">Rider A-Z</option><option value="type_asc">Type A-Z</option></>}</select></label>
      </div>}
      {tab === 'overview' && <Overview riders={riders} transactions={transactions} onRider={setSelectedRider} onTransaction={setSelectedTransaction} />}
      {tab === 'riders' && <RiderTable riders={riders} onRider={setSelectedRider} />}
      {tab === 'topups' && <TransactionTable transactions={transactions.filter((t) => t.transaction_type === 'CREDIT_TOPUP')} onTransaction={setSelectedTransaction} />}
      {tab === 'activity' && <TransactionTable transactions={transactions} onTransaction={setSelectedTransaction} />}
      {selectedRider && <RiderModal rider={selectedRider} adjustment={adjustment} setAdjustment={setAdjustment} onClose={() => setSelectedRider(null)} onSubmit={() => adjustMutation.mutate()} pending={adjustMutation.isPending} />}
      {selectedTransaction && <TransactionModal transaction={selectedTransaction} onClose={() => setSelectedTransaction(null)} />}
    </div>
  )
}

function Stat({ icon: Icon, label, value, detail, tone }: { icon: typeof Wallet; label: string; value: string; detail: string; tone: 'green' | 'emerald' | 'amber' | 'blue' | 'purple' }) {
  const styles = {
    green: { card: 'border-[#A7D8B5] bg-gradient-to-br from-[#E9F7EF] to-white', icon: 'bg-[#087F3F] text-white', value: 'text-[#065F2E]' },
    emerald: { card: 'border-[#8ED8BE] bg-gradient-to-br from-[#E6FAF1] to-white', icon: 'bg-[#059669] text-white', value: 'text-[#047857]' },
    amber: { card: 'border-[#F1CF83] bg-gradient-to-br from-[#FFF8E1] to-white', icon: 'bg-[#D97706] text-white', value: 'text-[#B45309]' },
    blue: { card: 'border-[#A9C9F5] bg-gradient-to-br from-[#EFF6FF] to-white', icon: 'bg-[#2563EB] text-white', value: 'text-[#1D4ED8]' },
    purple: { card: 'border-[#D8B4FE] bg-gradient-to-br from-[#FAF5FF] to-white', icon: 'bg-[#7C3AED] text-white', value: 'text-[#6D28D9]' },
  }[tone]

  return (
    <div className={`relative overflow-hidden rounded-2xl border-2 p-5 shadow-md transition hover:-translate-y-0.5 hover:shadow-lg ${styles.card}`}>
      <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/60" />
      <div className={`relative mb-5 flex h-11 w-11 items-center justify-center rounded-xl shadow-sm ${styles.icon}`}><Icon className="h-5 w-5" /></div>
      <p className="text-xs font-bold uppercase tracking-wider text-[#4B5563]">{label}</p>
      <p className={`mt-2 text-2xl font-extrabold tracking-tight ${styles.value}`}>{value}</p>
      <p className="mt-2 text-sm font-medium text-[#4B5563]">{detail}</p>
    </div>
  )
}
function Overview({ riders, transactions, onRider, onTransaction }: { riders: Rider[]; transactions: Transaction[]; onRider: (r: Rider) => void; onTransaction: (t: Transaction) => void }) {
  return <div className="rounded-2xl border-2 border-[#D7E8DB] bg-[#F8FBF8] p-4 shadow-sm"><div className="mb-4"><h2 className="text-lg font-extrabold text-[#17201A]">Overview</h2><p className="text-sm text-[#6B7280]">Monitor rider balances and the latest credit activity.</p></div><div className="grid gap-6 lg:grid-cols-2"><RiderTable riders={riders.slice(0, 5)} onRider={onRider} /><TransactionTable transactions={transactions.slice(0, 5)} onTransaction={onTransaction} /></div></div>
}
function RiderTable({ riders, onRider }: { riders: Rider[]; onRider: (r: Rider) => void }) {
  return <Panel title="Rider Credits" subtitle="Current credit balances and COD eligibility"><table className="w-full text-sm"><thead><tr className="bg-[#E9F7EF] text-left text-xs uppercase text-[#4B5563]"><th className="p-3 font-extrabold">Rider</th><th className="p-3 font-extrabold">Available</th><th className="p-3 font-extrabold">Reserved</th><th className="p-3 font-extrabold">Eligibility</th><th /></tr></thead><tbody className="divide-y divide-[#E2E8E3]">{riders.map((r) => <tr key={r.id} className="bg-white hover:bg-[#F2FAF4]"><td className="p-3 font-bold text-[#17201A]">{r.name}<div className="text-xs font-medium text-[#6B7280]">RT-{String(r.id).padStart(5, '0')}</div></td><td className="p-3 font-bold text-[#087F3F]">{money(r.available_credits)}</td><td className="p-3 font-semibold text-[#B45309]">{money(r.reserved_credits)}</td><td className="p-3"><Badge status={r.eligibility} /></td><td className="p-3"><button onClick={() => onRider(r)} className="rounded-lg bg-[#E9F7EF] px-3 py-1.5 font-bold text-[#087F3F] hover:bg-[#CDEED8]">View</button></td></tr>)}{riders.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-sm font-medium text-[#6B7280]">No riders match the current search.</td></tr>}</tbody></table></Panel>
}
function TransactionTable({ transactions, onTransaction }: { transactions: Transaction[]; onTransaction: (t: Transaction) => void }) {
  return <Panel title="Credit Activity" subtitle="Recent top-ups and credit ledger entries"><table className="w-full text-sm"><thead><tr className="bg-[#E9F7EF] text-left text-xs uppercase text-[#4B5563]"><th className="p-3 font-extrabold">Reference</th><th className="p-3 font-extrabold">Rider</th><th className="p-3 font-extrabold">Type</th><th className="p-3 font-extrabold">Amount</th><th className="p-3 font-extrabold">Status</th></tr></thead><tbody className="divide-y divide-[#E2E8E3]">{transactions.map((t) => <tr key={t.id} onClick={() => onTransaction(t)} className="cursor-pointer bg-white hover:bg-[#F2FAF4]"><td className="p-3 font-bold text-[#17201A]">{t.reference ?? '—'}<div className="text-xs font-medium text-[#6B7280]">{date(t.created_at)}</div></td><td className="p-3 font-semibold">{t.rider_name}</td><td className="p-3 font-semibold text-[#4B5563]">{t.transaction_type.replaceAll('_', ' ')}</td><td className={t.amount >= 0 ? 'p-3 font-extrabold text-[#087F3F]' : 'p-3 font-extrabold text-red-600'}>{t.amount >= 0 ? '+' : ''}{money(t.amount)}</td><td className="p-3"><Badge status={t.status} /></td></tr>)}{transactions.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-sm font-medium text-[#6B7280]">No transactions match the current search.</td></tr>}</tbody></table></Panel>
}
function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) { return <div className="overflow-hidden rounded-2xl border-2 border-[#CFE3D4] bg-white shadow-md"><div className="border-b border-[#D7E8DB] bg-gradient-to-r from-[#E9F7EF] to-white px-5 py-4"><h3 className="font-extrabold text-[#17201A]">{title}</h3>{subtitle && <p className="mt-1 text-xs font-medium text-[#6B7280]">{subtitle}</p>}</div><div className="overflow-x-auto">{children}</div></div> }
function Badge({ status }: { status: string }) { const good = status === 'eligible' || status === 'success'; const limited = status === 'limited' || status === 'pending'; return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${good ? 'bg-emerald-50 text-emerald-700' : limited ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>{status}</span> }
function RiderModal({ rider, adjustment, setAdjustment, onClose, onSubmit, pending }: { rider: Rider; adjustment: { type: string; amount: string; reason: string }; setAdjustment: (v: { type: string; amount: string; reason: string }) => void; onClose: () => void; onSubmit: () => void; pending: boolean }) {
  return <Modal title={`${rider.name} · Rider Credits`} onClose={onClose}><div className="grid grid-cols-3 gap-3 mb-5">{[['Available', rider.available_credits], ['Reserved', rider.reserved_credits], ['Total', rider.total_credits]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-[#F6F8F4] p-3"><p className="text-xs text-[#6B7280]">{label}</p><p className="mt-1 font-bold">{money(Number(value))}</p></div>)}</div><div className="border-t pt-4"><h3 className="font-bold mb-3">Adjust Credits</h3><div className="flex gap-2 mb-3"><button onClick={() => setAdjustment({ ...adjustment, type: 'add' })} className={`flex-1 rounded-lg border p-2 ${adjustment.type === 'add' ? 'border-[#16803C] text-[#16803C]' : ''}`}><Plus className="inline w-4 h-4" /> Add</button><button onClick={() => setAdjustment({ ...adjustment, type: 'deduct' })} className={`flex-1 rounded-lg border p-2 ${adjustment.type === 'deduct' ? 'border-red-500 text-red-600' : ''}`}><Minus className="inline w-4 h-4" /> Deduct</button></div><input type="number" min="0.01" placeholder="Amount" value={adjustment.amount} onChange={(e) => setAdjustment({ ...adjustment, amount: e.target.value })} className="w-full border rounded-lg p-2 mb-3" /><textarea placeholder="Reason" value={adjustment.reason} onChange={(e) => setAdjustment({ ...adjustment, reason: e.target.value })} className="w-full border rounded-lg p-2 mb-4" /><button disabled={pending || !adjustment.amount || !adjustment.reason} onClick={onSubmit} className="w-full rounded-lg bg-[#16803C] p-2.5 text-white disabled:opacity-50">{pending ? 'Saving...' : 'Confirm Adjustment'}</button></div></Modal>
}
function TransactionModal({ transaction, onClose }: { transaction: Transaction; onClose: () => void }) { return <Modal title="Top-up Details" onClose={onClose}><div className="space-y-3 text-sm"><Detail label="Reference" value={transaction.reference ?? '—'} /><Detail label="Rider" value={transaction.rider_name} /><Detail label="Amount" value={money(transaction.amount)} /><Detail label="Payment" value={`${transaction.payment_method ?? '—'} · ${transaction.provider ?? '—'}`} /><Detail label="Status" value={transaction.status} /><Detail label="Date" value={date(transaction.created_at)} /><div className="border-t pt-3 font-semibold text-[#16803C]">Credit Result: {transaction.amount >= 0 ? '+' : ''}{money(transaction.amount)}</div></div></Modal> }
function Detail({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-4"><span className="text-[#6B7280]">{label}</span><span className="font-medium text-right">{value}</span></div> }
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) { return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-lg rounded-2xl bg-white shadow-xl"><div className="flex items-center justify-between border-b p-5"><h2 className="font-bold">{title}</h2><button onClick={onClose}><X className="w-5 h-5" /></button></div><div className="p-5">{children}</div></div></div> }
