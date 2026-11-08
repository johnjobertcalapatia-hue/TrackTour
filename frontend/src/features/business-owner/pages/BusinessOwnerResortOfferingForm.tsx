import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ImagePlus, Save, X } from 'lucide-react'
import { get, post, put } from '@/shared/services/api'
import { Alert } from '@/shared/components/Alert'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { cn, toAssetUrl } from '@/shared/utils'
import { useActiveResort } from '@/features/business-owner/services/use-active-resort'
import {
  BOOKING_MODE_LABEL,
  EMPTY_OFFERING,
  INVENTORY_MODE_LABEL,
  PRICING_BASIS_LABEL,
  fieldErrors,
  inventoryModesFor,
  needsDuration,
  offeringFormData,
  offeringToForm,
  pricingBasesFor,
  type BookingMode,
  type OfferingFormValues,
  type OfferingOptions,
  type OwnerOffering,
} from '@/features/business-owner/services/resort-offerings'

const inputClass = 'w-full px-4 py-2.5 bg-white border border-[#E2E8E3] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C]'

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-[#4B5563] mb-1.5">{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-[#647067]">{hint}</p>}
      {error && <p role="alert" className="mt-1 text-xs text-[#B91C1C]">{error}</p>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="bg-white rounded-2xl border border-[#E2E8E3] p-6 space-y-4">
      <legend className="text-lg font-semibold text-[#17201A] px-1">{title}</legend>
      {children}
    </fieldset>
  )
}

/**
 * Create / edit one resort offering (cottage, pool access, activity, …).
 * Only coherent mode/pricing/inventory combinations are offered; the server
 * (ResortOfferingController) stays the authority and its 422s show per field.
 */
export default function BusinessOwnerResortOfferingForm() {
  const { offeringId } = useParams()
  const editing = Boolean(offeringId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { businessId, business, isResort } = useActiveResort()
  const [values, setValues] = useState<OfferingFormValues>(EMPTY_OFFERING)
  const [newImages, setNewImages] = useState<File[]>([])
  const [removeIds, setRemoveIds] = useState<number[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [loadedId, setLoadedId] = useState<number | null>(null)

  const listKey = ['bo-resort-offerings', businessId]
  const { data, isLoading } = useQuery({
    queryKey: listKey,
    queryFn: () => get<{ offerings: OwnerOffering[]; options: OfferingOptions }>(`/business-owner/businesses/${businessId}/resort-offerings`),
    enabled: Boolean(businessId && isResort),
  })
  const current = editing ? data?.offerings.find((o) => String(o.id) === offeringId) ?? null : null

  useEffect(() => {
    if (current && loadedId !== current.id) {
      setValues(offeringToForm(current))
      setLoadedId(current.id)
    }
  }, [current, loadedId])

  // Only top-level offerings can be required by another (one dependency level).
  const parentChoices = useMemo(
    () => (data?.offerings ?? []).filter((o) => o.requires_offering_id == null && o.id !== current?.id),
    [data, current],
  )
  const hasDependents = Boolean(current && data?.offerings.some((o) => o.requires_offering_id === current.id))

  const set = <K extends keyof OfferingFormValues>(k: K, v: OfferingFormValues[K]) => setValues((prev) => ({ ...prev, [k]: v }))

  const changeMode = (mode: BookingMode) => setValues((prev) => ({
    ...prev,
    booking_mode: mode,
    pricing_basis: pricingBasesFor(mode).includes(prev.pricing_basis) ? prev.pricing_basis : 'per_unit',
    inventory_mode: inventoryModesFor(mode).includes(prev.inventory_mode) ? prev.inventory_mode : 'units',
  }))

  const maxImages = data?.options.max_images ?? 8
  const keptImages = (current?.images ?? []).filter((img) => !removeIds.includes(img.id))
  const slotsLeft = maxImages - keptImages.length - newImages.length

  const save = useMutation({
    mutationFn: () => {
      const body = offeringFormData(values, newImages, removeIds)
      const base = `/business-owner/businesses/${businessId}/resort-offerings`
      return editing ? put(`${base}/${offeringId}`, body) : post(base, body)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listKey })
      navigate('/business-owner/resort/offerings')
    },
    onError: (e) => {
      setErrors(fieldErrors(e))
      setError((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Could not save. Please check the form.')
    },
  })

  if (!isResort) {
    return <Alert type="info" message={`Cottages & offerings are for Resort businesses${business ? `. "${business.name}" is a ${business.category}.` : '.'}`} />
  }
  if (isLoading) return <DashboardSkeleton />
  if (editing && !current) {
    return <Alert type="error" message="This offering was not found. It may have been removed." />
  }

  const categories = data?.options.categories ?? []
  const modes = (data?.options.booking_modes ?? (Object.keys(BOOKING_MODE_LABEL) as BookingMode[]))
  const inventoryLabel = values.inventory_mode === 'units' ? 'Number of units' : values.inventory_mode === 'capacity' ? 'Capacity (guests)' : 'Capacity per slot'

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link to="/business-owner/resort/offerings" className="inline-flex items-center gap-1 text-sm text-[#16803C] font-medium hover:underline">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Cottages &amp; Offerings
        </Link>
        <h1 className="mt-2 text-2xl lg:text-3xl font-bold text-[#126B32]">{editing ? `Edit ${current?.name}` : 'Add offering'}</h1>
      </div>

      {error && <Alert type="error" message={error} onDismiss={() => setError('')} />}

      <form onSubmit={(e) => { e.preventDefault(); setErrors({}); setError(''); save.mutate() }} className="space-y-6" noValidate>
        <Section title="Basics">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="category" label="Category" error={errors.category}>
              <select id="category" value={values.category} onChange={(e) => set('category', e.target.value)} className={inputClass}>
                {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
            <Field id="name" label="Name" error={errors.name}>
              <input id="name" value={values.name} maxLength={150} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Family Cottage" className={inputClass} required />
            </Field>
          </div>
          <Field id="description" label="Description" error={errors.description}>
            <textarea id="description" rows={3} value={values.description} onChange={(e) => set('description', e.target.value)} placeholder="What's included, size, view…" className={inputClass} />
          </Field>

          <div>
            <p className="text-sm font-medium text-[#4B5563] mb-1.5">Photos <span className="text-[#647067] font-normal">(up to {maxImages})</span></p>
            <div className="flex flex-wrap gap-3">
              {keptImages.map((img) => (
                <div key={img.id} className="relative w-24 h-24 rounded-xl overflow-hidden border border-[#E2E8E3]">
                  <img src={toAssetUrl(img.path)} alt="" className="w-full h-full object-cover" />
                  <button type="button" onClick={() => setRemoveIds([...removeIds, img.id])} aria-label="Remove photo" className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {newImages.map((f, i) => (
                <div key={`${f.name}-${i}`} className="relative w-24 h-24 rounded-xl overflow-hidden border border-[#16803C]/40 bg-[#F0FAF3] flex items-center justify-center p-1">
                  <span className="text-[11px] text-[#17201A] break-all text-center">{f.name}</span>
                  <button type="button" onClick={() => setNewImages(newImages.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`} className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {slotsLeft > 0 && (
                <label className="w-24 h-24 rounded-xl border-2 border-dashed border-[#C9D6CD] flex flex-col items-center justify-center gap-1 text-xs text-[#647067] cursor-pointer hover:border-[#16803C]">
                  <ImagePlus className="w-5 h-5" aria-hidden="true" /> Add photo
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    aria-label="Add photos"
                    className="sr-only"
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []).slice(0, slotsLeft)
                      setNewImages([...newImages, ...files])
                      e.target.value = ''
                    }}
                  />
                </label>
              )}
            </div>
            {errors.images && <p role="alert" className="mt-1 text-xs text-[#B91C1C]">{errors.images}</p>}
          </div>
        </Section>

        <Section title="Booking & pricing">
          <div role="radiogroup" aria-label="Booking mode" className="grid gap-2 sm:grid-cols-4">
            {modes.map((m) => (
              <label key={m} className={cn('flex items-center justify-center h-10 rounded-xl border text-sm cursor-pointer transition', values.booking_mode === m ? 'border-[#16803C] bg-[#F0FAF3] text-[#16803C] font-semibold' : 'border-[#E2E8E3] text-[#17201A] hover:border-[#16803C]/50')}>
                <input type="radio" name="booking_mode" value={m} checked={values.booking_mode === m} onChange={() => changeMode(m)} className="sr-only" />
                {BOOKING_MODE_LABEL[m]}
              </label>
            ))}
          </div>
          {errors.booking_mode && <p role="alert" className="text-xs text-[#B91C1C]">{errors.booking_mode}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="pricing_basis" label="Charged" error={errors.pricing_basis}>
              <select id="pricing_basis" value={values.pricing_basis} onChange={(e) => set('pricing_basis', e.target.value as OfferingFormValues['pricing_basis'])} className={inputClass}>
                {pricingBasesFor(values.booking_mode).map((p) => <option key={p} value={p}>{PRICING_BASIS_LABEL[p]}</option>)}
              </select>
            </Field>
            <Field id="price" label="Price (₱)" hint="Use 0 for free inclusions." error={errors.price}>
              <input id="price" type="number" min={0} step="0.01" inputMode="decimal" value={values.price} onChange={(e) => set('price', e.target.value)} className={inputClass} />
            </Field>
          </div>
          {needsDuration(values.booking_mode) && (
            <Field id="duration_minutes" label="Duration (minutes)" hint="Length of one slot or session." error={errors.duration_minutes}>
              <input id="duration_minutes" type="number" min={15} value={values.duration_minutes} onChange={(e) => set('duration_minutes', e.target.value)} className={inputClass} />
            </Field>
          )}
        </Section>

        <Section title="Inventory & guests">
          <Field id="inventory_mode" label="How availability is counted" error={errors.inventory_mode}>
            <select id="inventory_mode" value={values.inventory_mode} onChange={(e) => set('inventory_mode', e.target.value as OfferingFormValues['inventory_mode'])} className={inputClass}>
              {inventoryModesFor(values.booking_mode).map((m) => <option key={m} value={m}>{INVENTORY_MODE_LABEL[m]}</option>)}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="inventory_quantity" label={inventoryLabel} error={errors.inventory_quantity}>
              <input id="inventory_quantity" type="number" min={1} value={values.inventory_quantity} onChange={(e) => set('inventory_quantity', e.target.value)} className={inputClass} />
            </Field>
            <Field id="min_guests" label="Min guests" error={errors.min_guests}>
              <input id="min_guests" type="number" min={1} value={values.min_guests} onChange={(e) => set('min_guests', e.target.value)} className={inputClass} />
            </Field>
            <Field id="max_guests" label="Max guests" error={errors.max_guests}>
              <input id="max_guests" type="number" min={1} value={values.max_guests} onChange={(e) => set('max_guests', e.target.value)} className={inputClass} />
            </Field>
            <Field id="min_quantity" label="Min per reservation" error={errors.min_quantity}>
              <input id="min_quantity" type="number" min={1} value={values.min_quantity} onChange={(e) => set('min_quantity', e.target.value)} className={inputClass} />
            </Field>
            <Field id="max_quantity" label="Max per reservation" error={errors.max_quantity}>
              <input id="max_quantity" type="number" min={1} value={values.max_quantity} onChange={(e) => set('max_quantity', e.target.value)} className={inputClass} />
            </Field>
          </div>
        </Section>

        <Section title="Rules">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={values.is_required} onChange={(e) => set('is_required', e.target.checked)} className="mt-1 accent-[#16803C]" />
            <span>
              <span className="block text-sm font-semibold text-[#17201A]">Required in every reservation</span>
              <span className="block text-xs text-[#647067]">For example an entrance fee every guest must pay.</span>
            </span>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={values.bookable_independently}
              disabled={hasDependents}
              onChange={(e) => setValues((prev) => ({ ...prev, bookable_independently: e.target.checked, requires_offering_id: e.target.checked ? '' : prev.requires_offering_id }))}
              className="mt-1 accent-[#16803C]"
            />
            <span>
              <span className="block text-sm font-semibold text-[#17201A]">Can be reserved on its own</span>
              <span className="block text-xs text-[#647067]">
                {hasDependents ? 'Other offerings depend on this one, so it must stay bookable on its own.' : 'Turn off for add-ons that need another offering, e.g. extra mattress only with a cottage.'}
              </span>
            </span>
          </label>
          {!values.bookable_independently && (
            <Field id="requires_offering_id" label="Only available with" error={errors.requires_offering_id ?? errors.bookable_independently}>
              <select id="requires_offering_id" value={values.requires_offering_id} onChange={(e) => set('requires_offering_id', e.target.value)} className={inputClass}>
                <option value="">Choose an offering…</option>
                {parentChoices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </Field>
          )}
        </Section>

        <Section title="Visibility">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={values.is_published} onChange={(e) => set('is_published', e.target.checked)} className="mt-1 accent-[#16803C]" />
            <span>
              <span className="block text-sm font-semibold text-[#17201A]">Published</span>
              <span className="block text-xs text-[#647067]">Tourists see published offerings on your resort page. Leave off to keep it as a draft.</span>
            </span>
          </label>
          <div className="max-w-[200px]">
            <Field id="sort_order" label="Display order" hint="Lower numbers show first." error={errors.sort_order}>
              <input id="sort_order" type="number" min={0} value={values.sort_order} onChange={(e) => set('sort_order', e.target.value)} className={inputClass} />
            </Field>
          </div>
        </Section>

        <div className="flex justify-end gap-3">
          <Link to="/business-owner/resort/offerings" className="px-5 py-2.5 rounded-xl border border-[#E2E8E3] text-sm font-semibold text-[#17201A]">Cancel</Link>
          <button type="submit" disabled={save.isPending || values.name.trim() === ''} className="inline-flex items-center gap-2 bg-[#16803C] hover:bg-[#126B32] disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-semibold">
            <Save className="w-4 h-4" aria-hidden="true" /> {save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create offering'}
          </button>
        </div>
      </form>
    </div>
  )
}
