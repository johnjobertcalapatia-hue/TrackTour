import { useState, type ReactNode } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiErrorMessage, get, openAuthenticatedDocument, post, put } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { Modal } from '@/shared/components/Modal'
import { cn, formatDate, formatDateTime } from '@/shared/utils'
import { RiderRecords } from '@/features/admin/components/RiderRecords'
import { RiderVehicleCard } from '@/features/admin/components/RiderVehicleCard'
import {
  ArrowLeft, Ban, Bike, CalendarDays, Car, CheckCircle, CheckCircle2, Clock, ExternalLink, FileText, History, Mail, MapPin, Phone,
  ReceiptText, RotateCcw, ShieldCheck, User, UtensilsCrossed, XCircle,
} from 'lucide-react'

interface RiderDetail {
  id: number
  name: string
  email: string
  phone: string | null
  profile_photo: string | null
  account_status: 'approved' | 'active' | 'suspended' | 'pending_review' | 'rejected'
  rider_status?: string | null
  current_service?: string | null
  municipality_id: number | null
  municipality: string | null
  barangay: string | null
  address: string | null
  created_at: string
  vehicle_type: string | null
  vehicle_plate: string | null
  vehicle_make?: string | null
  vehicle_model?: string | null
  vehicle_year?: number | null
  can_ride_hail?: boolean
  license_number: string | null
  license_expiry: string | null
  registration_number: string | null
  documents?: { name: string; file_url: string }[]
  review_history?: { id: number; status: string; remarks: string; created_at: string; performed_by: string }[]
}

type ActionKey = 'approve' | 'reject' | 'suspend'

const card = 'rounded-2xl border border-[#E2E8E3] bg-white'
const VEHICLE_LABELS: Record<string, string> = { motorcycle: 'Motorcycle', tricycle: 'Tricycle', car: 'Car', van: 'Van', bicycle: 'Bicycle' }
const REQUIRED_DOCUMENTS = ['Valid Government ID', "Driver's License", 'Vehicle Registration', 'NBI Clearance']

/**
 * Rider profile & verification. Hierarchy: identity and actions first, then
 * the rider's records (status, deliveries, earnings, COD cash, cash out),
 * then profile details side by side, then documents and review history.
 */
export default function AdminRiderShow() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()

  const [activeModal, setActiveModal] = useState<ActionKey | null>(null)
  const [remarks, setRemarks] = useState('')

  const { data: rider, isLoading } = useQuery({
    queryKey: ['admin-rider', id],
    queryFn: () => get<RiderDetail>(`/admin/riders/${id}`),
    enabled: !!id,
  })

  const actionMutation = useMutation({
    mutationFn: (action: string) => post(`/admin/riders/${id}/${action}`, { remarks: remarks || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-rider', id] })
      queryClient.invalidateQueries({ queryKey: ['admin-riders'] })
      setActiveModal(null)
      setRemarks('')
    },
  })

  // The rider's municipality decides which Tourism Office sees them on the
  // COD cash advance list and may issue them cash.
  const { data: municipalities } = useQuery({
    queryKey: ['public-municipalities'],
    queryFn: () => get<{ id: number; name: string }[]>('/municipalities'),
  })
  const [municipalityChoice, setMunicipalityChoice] = useState<string | null>(null)
  const [municipalityNotice, setMunicipalityNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const municipalityMutation = useMutation({
    mutationFn: (municipalityId: number) => put(`/admin/riders/${id}/municipality`, { municipality_id: municipalityId }),
    onSuccess: () => {
      setMunicipalityChoice(null)
      setMunicipalityNotice({ type: 'success', message: 'Municipality saved.' })
      queryClient.invalidateQueries({ queryKey: ['admin-rider', id] })
      queryClient.invalidateQueries({ queryKey: ['admin-rider-cash'] })
    },
    onError: (error) => setMunicipalityNotice({ type: 'error', message: apiErrorMessage(error, 'Could not save the municipality.') }),
  })

  const closeModal = () => {
    setActiveModal(null)
    setRemarks('')
  }

  if (isLoading) return <DashboardSkeleton />
  if (!rider) return <div className="py-12 text-center text-[#6B7280]">Rider not found</div>

  const status = rider.account_status
  // Actions follow the real account statuses (approved riders are not offered "Approve").
  const actions: { key: ActionKey; label: string; icon: typeof CheckCircle; tone: string }[] = [
    ...(status === 'pending_review' || status === 'rejected' ? [{ key: 'approve' as const, label: 'Approve', icon: CheckCircle, tone: 'bg-[#16803C] text-white hover:bg-[#126B32]' }] : []),
    ...(status === 'suspended' ? [{ key: 'approve' as const, label: 'Reactivate', icon: RotateCcw, tone: 'bg-[#16803C] text-white hover:bg-[#126B32]' }] : []),
    ...(status === 'pending_review' ? [{ key: 'reject' as const, label: 'Reject', icon: XCircle, tone: 'border border-red-200 bg-white text-red-600 hover:bg-red-50' }] : []),
    ...(status === 'approved' || status === 'active' ? [{ key: 'suspend' as const, label: 'Suspend', icon: Ban, tone: 'border border-[#D7E8DB] bg-white text-[#17201A] hover:bg-[#F6F8F4]' }] : []),
  ]
  const service = rider.current_service === 'transport' ? 'Ride hailing' : rider.current_service === 'food' ? 'Food delivery' : null
  const vehicle = rider.vehicle_type ? VEHICLE_LABELS[rider.vehicle_type] ?? rider.vehicle_type : null
  const docs = rider.documents ?? []

  return (
    <div className="space-y-6">
      <Link to="/admin/riders" className="inline-flex items-center gap-2 text-sm text-[#6B7280] transition hover:text-[#16803C]">
        <ArrowLeft className="h-4 w-4" /> Back to Riders
      </Link>

      {/* Identity and actions */}
      <section className={cn(card, 'p-5')} aria-label="Rider">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[#EAF6ED]">
              {rider.profile_photo ? <img src={rider.profile_photo} alt="" className="h-full w-full object-cover" /> : <Bike className="h-7 w-7 text-[#16803C]" />}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold text-[#17201A]">{rider.name}</h1>
                <StatusBadge status={rider.account_status} size="md" />
              </div>
              <ul className="mt-1.5 flex flex-wrap gap-2 text-xs text-[#4B5563]" aria-label="Rider summary">
                <Chip icon={MapPin}>{rider.municipality ?? 'No municipality'}</Chip>
                {service && <Chip icon={service === 'Ride hailing' ? Car : UtensilsCrossed}>{service}</Chip>}
                <Chip icon={Bike} warn={!vehicle}>{vehicle ?? 'No vehicle registered'}</Chip>
                <Chip icon={CalendarDays}>Joined {formatDate(rider.created_at)}</Chip>
              </ul>
            </div>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Actions">
            <Link
              to={`/admin/riders/${id}/cash-reconciliation`}
              className="inline-flex items-center gap-2 rounded-xl border border-[#D7E8DB] bg-white px-4 py-2 text-sm font-medium text-[#16803C] hover:bg-[#F6F8F4]"
            >
              <ReceiptText className="h-4 w-4" /> View daily cash receipt
            </Link>
            {actions.map((a) => (
              <button key={a.label} type="button" onClick={() => setActiveModal(a.key)} className={cn('inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition', a.tone)}>
                <a.icon className="h-4 w-4" /> {a.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Records: status, deliveries, earnings, COD cash, cash out */}
      <RiderRecords riderId={rider.id} />

      {/* Profile details, side by side */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-[#17201A]">Profile &amp; verification</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Section title="Personal information" icon={User}>
            <dl className="space-y-3 text-sm">
              <Field label="Full name">{rider.name}</Field>
              <Field label="Email"><span className="flex items-center gap-1.5 break-all"><Mail className="h-3.5 w-3.5 shrink-0 text-[#6B7280]" />{rider.email}</span></Field>
              <Field label="Phone"><span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-[#6B7280]" />{rider.phone || '—'}</span></Field>
              <div>
                <label htmlFor="rider-municipality" className="text-xs uppercase tracking-wider text-[#6B7280]">Municipality</label>
                <form
                  className="mt-1 flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (municipalityChoice) municipalityMutation.mutate(Number(municipalityChoice))
                  }}
                >
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-[#6B7280]" />
                  <select
                    id="rider-municipality"
                    value={municipalityChoice ?? (rider.municipality_id ? String(rider.municipality_id) : '')}
                    onChange={(e) => {
                      setMunicipalityNotice(null)
                      setMunicipalityChoice(e.target.value)
                    }}
                    className="min-w-0 flex-1 rounded-lg border border-[#D7E8DB] bg-[#F6F8F4] px-2 py-1 text-sm text-[#17201A]"
                  >
                    <option value="" disabled>Not set</option>
                    {(municipalities ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  {municipalityChoice && municipalityChoice !== String(rider.municipality_id ?? '') && (
                    <button type="submit" disabled={municipalityMutation.isPending} className="rounded-lg bg-[#16803C] px-3 py-1 text-sm font-semibold text-white hover:bg-[#126B32] disabled:opacity-50">
                      {municipalityMutation.isPending ? 'Saving…' : 'Save'}
                    </button>
                  )}
                </form>
                {!rider.municipality_id && !municipalityChoice && (
                  <p className="mt-1 text-xs text-[#B45309]">Not set: the Tourism Office cannot issue this rider COD cash.</p>
                )}
                {municipalityNotice && (
                  <p role={municipalityNotice.type === 'error' ? 'alert' : 'status'} className={`mt-1 text-xs ${municipalityNotice.type === 'error' ? 'text-[#B91C1C]' : 'text-[#16803C]'}`}>
                    {municipalityNotice.message}
                  </p>
                )}
              </div>
              <Field label="Barangay">{rider.barangay || '—'}</Field>
              <Field label="Address">{rider.address || '—'}</Field>
            </dl>
          </Section>

          <RiderVehicleCard key={`${rider.vehicle_type}-${rider.vehicle_plate}`} riderId={id!} vehicle={rider} />

          <Section title="License & registration" icon={ShieldCheck}>
            <dl className="space-y-3 text-sm">
              <Field label="License number"><span className="font-mono">{rider.license_number || '—'}</span></Field>
              <Field label="License expiry">{rider.license_expiry ? formatDate(rider.license_expiry) : '—'}</Field>
              <Field label="Registration number"><span className="font-mono">{rider.registration_number || '—'}</span></Field>
            </dl>
          </Section>
        </div>
      </div>

      {/* Documents and checklist, one horizontal card */}
      <Section title="Documents" icon={FileText}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          {docs.length === 0 ? (
            <p className="text-sm text-[#6B7280]">No documents uploaded.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Uploaded documents">
              {docs.map((doc) => (
                <li key={doc.name} className="flex items-center justify-between gap-3 rounded-xl border border-[#E2E8E3] bg-[#F6F8F4] px-3 py-2.5">
                  <span className="flex min-w-0 items-center gap-2 text-sm text-[#17201A]"><FileText className="h-4 w-4 shrink-0 text-[#6B7280]" /><span className="truncate">{doc.name}</span></span>
                  <button
                    type="button"
                    onClick={() => void openAuthenticatedDocument(doc.file_url).catch((error: unknown) => window.alert(apiErrorMessage(error, 'Unable to open this document.')))}
                    className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-[#16803C] hover:text-[#126B32]"
                  >
                    View <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <ul className="space-y-1.5 rounded-xl bg-[#FAFBFA] p-3" aria-label="Document checklist">
            {REQUIRED_DOCUMENTS.map((req) => {
              const uploaded = docs.some((d) => d.name.toLowerCase().includes(req.toLowerCase().split(' ')[0] ?? ''))
              return (
                <li key={req} className="flex items-center gap-2 text-sm">
                  {uploaded ? <CheckCircle2 className="h-4 w-4 text-[#16803C]" /> : <XCircle className="h-4 w-4 text-[#D1D5DB]" />}
                  <span className={uploaded ? 'text-[#17201A]' : 'text-[#6B7280]'}>{req}</span>
                  <span className={cn('ml-auto text-xs', uploaded ? 'text-[#16803C]' : 'text-[#9CA3AF]')}>{uploaded ? 'Uploaded' : 'Missing'}</span>
                </li>
              )
            })}
          </ul>
        </div>
      </Section>

      {rider.review_history && rider.review_history.length > 0 && (
        <Section title="Review history" icon={History}>
          <ol className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {rider.review_history.map((entry) => (
              <li key={entry.id} className="flex items-start gap-3 rounded-xl border border-[#E2E8E3] bg-[#F6F8F4] p-3">
                <StatusBadge status={entry.status} />
                <div className="min-w-0 flex-1">
                  {entry.remarks && <p className="text-sm text-[#17201A]">{entry.remarks}</p>}
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-[#6B7280]"><Clock className="h-3 w-3" />{formatDateTime(entry.created_at)} · by {entry.performed_by}</p>
                </div>
              </li>
            ))}
          </ol>
        </Section>
      )}

      <Modal show={activeModal !== null} onClose={closeModal} maxWidth="md">
        <div className="p-6">
          <h2 className="mb-2 text-lg font-semibold text-[#17201A]">
            {activeModal === 'approve' && (status === 'suspended' ? 'Reactivate Rider' : 'Approve Rider')}
            {activeModal === 'reject' && 'Reject Rider'}
            {activeModal === 'suspend' && 'Suspend Rider'}
          </h2>
          <p className="mb-4 text-sm text-[#6B7280]">
            Are you sure you want to {activeModal === 'approve' && status === 'suspended' ? 'reactivate' : activeModal} <span className="font-medium text-[#17201A]">{rider.name}</span>?
          </p>
          {activeModal !== 'approve' && (
            <div className="mb-6">
              <label className="mb-2 block text-sm font-medium text-[#17201A]">Remarks (required)</label>
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                rows={3}
                placeholder={`Provide a reason for ${activeModal}...`}
                className="w-full resize-none rounded-xl border border-[#E2E8E3] bg-white px-4 py-2.5 text-sm text-[#17201A] placeholder-[#6B7280] focus:border-[#16803C] focus:outline-none focus:ring-2 focus:ring-[#16803C]/50"
              />
            </div>
          )}
          {actionMutation.isError && <p className="mb-3 text-sm text-red-600" role="alert">{apiErrorMessage(actionMutation.error, 'Could not update the rider.')}</p>}
          <div className="flex justify-end gap-3">
            <button onClick={closeModal} className="rounded-xl border border-[#D7E8DB] bg-white px-4 py-2.5 text-sm font-medium text-[#16803C] transition hover:bg-[#F3F8F4]">
              Cancel
            </button>
            <button
              onClick={() => activeModal && actionMutation.mutate(activeModal)}
              disabled={actionMutation.isPending || (activeModal !== 'approve' && !remarks.trim())}
              className={`rounded-xl px-4 py-2.5 text-sm font-medium text-white transition disabled:opacity-50 ${
                activeModal === 'approve' ? 'bg-[#16803C] hover:bg-[#126B32]' : activeModal === 'reject' ? 'bg-red-600 hover:bg-red-700' : 'bg-yellow-600 hover:bg-yellow-700'
              }`}
            >
              {actionMutation.isPending ? 'Processing...' : activeModal === 'approve' ? (status === 'suspended' ? 'Reactivate' : 'Approve') : activeModal === 'reject' ? 'Reject' : 'Suspend'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function Section({ title, icon: Icon, children }: { title: string; icon: typeof User; children: ReactNode }) {
  return (
    <section className={cn(card, 'p-5')} aria-label={title}>
      <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-[#17201A]">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#EAF6ED]"><Icon className="h-4 w-4 text-[#16803C]" /></span>
        {title}
      </h3>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-[#6B7280]">{label}</dt>
      <dd className="mt-0.5 text-[#17201A]">{children}</dd>
    </div>
  )
}

function Chip({ icon: Icon, children, warn = false }: { icon: typeof User; children: ReactNode; warn?: boolean }) {
  return (
    <li className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1', warn ? 'bg-[#FFF7D6] text-[#92400E]' : 'bg-[#F3F4F6]')}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {children}
    </li>
  )
}
