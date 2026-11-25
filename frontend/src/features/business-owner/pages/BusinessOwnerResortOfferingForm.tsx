import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CalendarClock, ChevronDown, Clock, Home, ImagePlus, Moon, Save, Sun, Users, X } from 'lucide-react'
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

const input = 'w-full rounded-xl border border-[#DDE5DF] bg-white px-3.5 py-2.5 text-sm text-[#17201A] placeholder-[#9CA3AF] transition focus:border-[#16803C] focus:outline-none focus:ring-2 focus:ring-[#16803C]/20'

/** One line under each booking type, in the owner's words. */
const MODE_INFO: Record<BookingMode, { icon: typeof Sun; hint: string }> = {
  day_use: { icon: Sun, hint: 'Used during the day' },
  overnight: { icon: Moon, hint: 'Guests stay the night' },
  time_slot: { icon: Clock, hint: 'Fixed start times' },
  duration: { icon: CalendarClock, hint: 'Rented for a set time' },
}

const UNIT_WORD: Record<OfferingFormValues['pricing_basis'], string> = {
  per_person: 'person', per_unit: 'unit', per_hour: 'hour', per_night: 'night', per_booking: 'booking',
}

function Field({ id, label, hint, error, children, className }: { id: string; label: string; hint?: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-semibold text-[#3F4A43]">{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-[#7A857E]">{hint}</p>}
      {error && <p role="alert" className="mt-1 text-xs text-[#B91C1C]">{error}</p>}
    </div>
  )
}

function Card({ step, title, subtitle, children }: { step?: number; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="rounded-[20px] border border-[#E2E8E3] bg-white p-5 shadow-[0_6px_18px_rgba(22,101,52,0.05)] sm:p-6">
      <div className="mb-5 flex items-start gap-3">
        {step != null && <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#EAF6ED] text-xs font-bold text-[#16803C]">{step}</span>}
        <div>
          <h2 className="text-base font-bold text-[#17201A]">{title}</h2>
          {subtitle && <p className="text-sm text-[#647067]">{subtitle}</p>}
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

/** A checkbox shown as a switch (still a real checkbox for keyboards and screen readers). */
function Toggle({ checked, disabled, onChange, title, hint }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; title: string; hint: string }) {
  return (
    <label className={cn('relative flex items-start justify-between gap-4 rounded-xl border border-[#EEF2EF] px-4 py-3', disabled ? 'opacity-60' : 'cursor-pointer hover:bg-[#FAFCFA]')}>
      <span>
        <span className="block text-sm font-semibold text-[#17201A]">{title}</span>
        <span className="block text-xs text-[#647067]">{hint}</span>
      </span>
      <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden="true" className="relative mt-0.5 h-6 w-11 shrink-0 rounded-full bg-[#D5DDD7] transition peer-checked:bg-[#16803C] peer-focus-visible:ring-2 peer-focus-visible:ring-[#16803C]/40 after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-5" />
    </label>
  )
}

/**
 * Create / edit one resort offering (cottage, room, pool access, activity, …),
 * redesigned 2026-11-24: four short steps, a live preview of what tourists
 * see, and rarely used limits folded away. Only coherent mode/pricing/
 * inventory combinations are offered; the server (ResortOfferingController)
 * stays the authority and its 422s show per field.
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
  const [moreOpen, setMoreOpen] = useState(false)

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

  // Previews of newly picked photos (freed when they go away).
  const previews = useMemo(() => newImages.map((f) => {
    try {
      return URL.createObjectURL(f)
    } catch {
      return '' // no preview available: a placeholder icon is shown instead
    }
  }), [newImages])
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL?.(u)), [previews])

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

  // "More options" opens by itself when it holds a value or an error.
  const moreHasContent = Boolean(values.min_quantity && values.min_quantity !== '1') || Boolean(values.max_quantity) || Boolean(values.sort_order && values.sort_order !== '0')
  const moreHasError = Boolean(errors.min_quantity || errors.max_quantity || errors.sort_order)
  const showMore = moreOpen || moreHasError || (editing && moreHasContent)

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
  const categoryLabel = categories.find((c) => c.value === values.category)?.label ?? 'Offering'
  const priceNumber = Number(values.price)
  const previewPhoto = keptImages[0] ? toAssetUrl(keptImages[0].path) : previews[0] ?? ''

  return (
    <div className="pb-24">
      <Link to="/business-owner/resort/offerings" className="inline-flex items-center gap-1.5 text-sm font-medium text-[#647067] hover:text-[#17201A]">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Cottages &amp; Offerings
      </Link>
      <div className="mt-2 mb-6">
        <h1 className="text-2xl font-bold text-[#17201A] lg:text-3xl">{editing ? `Edit ${current?.name}` : 'Add offering'}</h1>
        <p className="mt-1 text-sm text-[#647067]">A cottage, room, campsite, pool pass, activity or anything else tourists can reserve.</p>
      </div>

      {error && <div className="mb-5"><Alert type="error" message={error} onDismiss={() => setError('')} /></div>}

      <form id="offering-form" onSubmit={(e) => { e.preventDefault(); setErrors({}); setError(''); save.mutate() }} noValidate
        className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          {/* 1. What it is */}
          <Card step={1} title="What is it?" subtitle="The name and description tourists read.">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,200px)_1fr]">
              <Field id="category" label="Category" error={errors.category}>
                <select id="category" value={values.category} onChange={(e) => set('category', e.target.value)} className={input}>
                  {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </Field>
              <Field id="name" label="Name" error={errors.name}>
                <input id="name" value={values.name} maxLength={150} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Family Cottage" className={input} required />
              </Field>
            </div>
            <Field id="description" label="Description" hint="What's included, its size, the view…" error={errors.description}>
              <textarea id="description" rows={3} value={values.description} onChange={(e) => set('description', e.target.value)} placeholder="e.g. Beachfront cottage with a table for 8, fan and electric outlet." className={cn(input, 'resize-none')} />
            </Field>
          </Card>

          {/* 2. Photos */}
          <Card step={2} title="Photos" subtitle={`Show it off — the first photo is the cover. Up to ${maxImages}.`}>
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4" aria-label="Offering photos">
              {keptImages.map((img, i) => (
                <li key={img.id} className="group relative aspect-square overflow-hidden rounded-xl border border-[#E2E8E3] bg-[#F3F8F4]">
                  <img src={toAssetUrl(img.path)} alt="" className="h-full w-full object-cover" />
                  {i === 0 && <span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">Cover</span>}
                  <button type="button" onClick={() => setRemoveIds([...removeIds, img.id])} aria-label="Remove photo" className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80">
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
              {newImages.map((f, i) => (
                <li key={`${f.name}-${i}`} className="relative aspect-square overflow-hidden rounded-xl border border-[#16803C]/40 bg-[#F0FAF3]">
                  {previews[i] ? <img src={previews[i]} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="m-auto mt-6 h-6 w-6 text-[#16803C]/50" aria-hidden="true" />}
                  <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-0.5 text-[10px] text-white">{f.name}</span>
                  <button type="button" onClick={() => setNewImages(newImages.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`} className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80">
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
              {slotsLeft > 0 && (
                <li>
                  <label className="relative flex aspect-square cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-[#C9D6CD] text-xs font-medium text-[#647067] transition hover:border-[#16803C] hover:bg-[#F6FBF7] hover:text-[#16803C]">
                    <ImagePlus className="h-6 w-6" aria-hidden="true" />
                    Add photo
                    <input type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label="Add photos" className="sr-only"
                      onChange={(e) => {
                        const files = Array.from(e.target.files ?? []).slice(0, slotsLeft)
                        setNewImages([...newImages, ...files])
                        e.target.value = ''
                      }} />
                  </label>
                </li>
              )}
            </ul>
            {errors.images && <p role="alert" className="text-xs text-[#B91C1C]">{errors.images}</p>}
          </Card>

          {/* 3. Booking & price */}
          <Card step={3} title="Booking & price" subtitle="How tourists reserve it and what it costs.">
            <div role="radiogroup" aria-label="Booking mode" className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              {modes.map((m) => {
                const Icon = MODE_INFO[m].icon
                const on = values.booking_mode === m
                return (
                  <label key={m} className={cn('relative flex cursor-pointer flex-col gap-1 rounded-xl border p-3 transition', on ? 'border-[#16803C] bg-[#F0FAF3] ring-1 ring-[#16803C]' : 'border-[#E2E8E3] hover:border-[#16803C]/50')}>
                    <input type="radio" name="booking_mode" value={m} checked={on} onChange={() => changeMode(m)} aria-label={BOOKING_MODE_LABEL[m]} className="sr-only" />
                    <Icon className={cn('h-5 w-5', on ? 'text-[#16803C]' : 'text-[#7A857E]')} aria-hidden="true" />
                    <span className={cn('text-sm font-semibold', on ? 'text-[#126B32]' : 'text-[#17201A]')}>{BOOKING_MODE_LABEL[m]}</span>
                    <span className="text-xs text-[#647067]">{MODE_INFO[m].hint}</span>
                  </label>
                )
              })}
            </div>
            {errors.booking_mode && <p role="alert" className="text-xs text-[#B91C1C]">{errors.booking_mode}</p>}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="price" label="Price (₱)" hint="Use 0 for something included for free." error={errors.price}>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-[#647067]">₱</span>
                  <input id="price" type="number" min={0} step="0.01" inputMode="decimal" value={values.price} onChange={(e) => set('price', e.target.value)} className={cn(input, 'pl-8')} placeholder="0.00" />
                </div>
              </Field>
              <Field id="pricing_basis" label="Charged" error={errors.pricing_basis}>
                <select id="pricing_basis" value={values.pricing_basis} onChange={(e) => set('pricing_basis', e.target.value as OfferingFormValues['pricing_basis'])} className={input}>
                  {pricingBasesFor(values.booking_mode).map((p) => <option key={p} value={p}>{PRICING_BASIS_LABEL[p]}</option>)}
                </select>
              </Field>
            </div>
            {needsDuration(values.booking_mode) && (
              <Field id="duration_minutes" label="Duration (minutes)" hint="How long one slot or session lasts (at least 15)." error={errors.duration_minutes} className="sm:max-w-[240px]">
                <input id="duration_minutes" type="number" min={15} value={values.duration_minutes} onChange={(e) => set('duration_minutes', e.target.value)} className={input} />
              </Field>
            )}
          </Card>

          {/* 4. Availability & rules */}
          <Card step={4} title="Availability & rules" subtitle="How many there are, who fits, and when it can be reserved.">
            <div className="grid gap-4 sm:grid-cols-[1fr_minmax(0,180px)]">
              <Field id="inventory_mode" label="How availability is counted" error={errors.inventory_mode}>
                <select id="inventory_mode" value={values.inventory_mode} onChange={(e) => set('inventory_mode', e.target.value as OfferingFormValues['inventory_mode'])} className={input}>
                  {inventoryModesFor(values.booking_mode).map((m) => <option key={m} value={m}>{INVENTORY_MODE_LABEL[m]}</option>)}
                </select>
              </Field>
              <Field id="inventory_quantity" label={inventoryLabel} error={errors.inventory_quantity}>
                <input id="inventory_quantity" type="number" min={1} value={values.inventory_quantity} onChange={(e) => set('inventory_quantity', e.target.value)} className={input} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:max-w-md">
              <Field id="min_guests" label="Min guests" error={errors.min_guests}>
                <input id="min_guests" type="number" min={1} value={values.min_guests} onChange={(e) => set('min_guests', e.target.value)} className={input} placeholder="Any" />
              </Field>
              <Field id="max_guests" label="Max guests" error={errors.max_guests}>
                <input id="max_guests" type="number" min={1} value={values.max_guests} onChange={(e) => set('max_guests', e.target.value)} className={input} placeholder="Any" />
              </Field>
            </div>

            <div className="space-y-2.5">
              <Toggle checked={values.is_required} onChange={(v) => set('is_required', v)}
                title="Required in every reservation" hint="For example an entrance fee every guest pays." />
              <Toggle checked={values.bookable_independently} disabled={hasDependents}
                onChange={(v) => setValues((prev) => ({ ...prev, bookable_independently: v, requires_offering_id: v ? '' : prev.requires_offering_id }))}
                title="Can be reserved on its own"
                hint={hasDependents ? 'Other offerings depend on this one, so it must stay bookable on its own.' : 'Turn off for add-ons, e.g. an extra mattress only with a cottage.'} />
              {!values.bookable_independently && (
                <Field id="requires_offering_id" label="Only available with" error={errors.requires_offering_id ?? errors.bookable_independently} className="pl-1">
                  <select id="requires_offering_id" value={values.requires_offering_id} onChange={(e) => set('requires_offering_id', e.target.value)} className={input}>
                    <option value="">Choose an offering…</option>
                    {parentChoices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </Field>
              )}
            </div>

            <div className="border-t border-[#EEF2EF] pt-3">
              <button type="button" onClick={() => setMoreOpen((v) => !v)} aria-expanded={showMore} aria-controls="offering-more"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#16803C] hover:text-[#126B32]">
                <ChevronDown className={cn('h-4 w-4 transition-transform', showMore && 'rotate-180')} aria-hidden="true" /> More options
              </button>
              {showMore && (
                <div id="offering-more" className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <Field id="min_quantity" label="Min per reservation" error={errors.min_quantity}>
                    <input id="min_quantity" type="number" min={1} value={values.min_quantity} onChange={(e) => set('min_quantity', e.target.value)} className={input} />
                  </Field>
                  <Field id="max_quantity" label="Max per reservation" error={errors.max_quantity}>
                    <input id="max_quantity" type="number" min={1} value={values.max_quantity} onChange={(e) => set('max_quantity', e.target.value)} className={input} placeholder="No limit" />
                  </Field>
                  <Field id="sort_order" label="Display order" hint="Lower numbers show first." error={errors.sort_order}>
                    <input id="sort_order" type="number" min={0} value={values.sort_order} onChange={(e) => set('sort_order', e.target.value)} className={input} />
                  </Field>
                </div>
              )}
            </div>
          </Card>

          {/* Publish */}
          <Card title="Visibility">
            <Toggle checked={values.is_published} onChange={(v) => set('is_published', v)}
              title="Published" hint="Tourists see published offerings on your resort page. Leave off to keep it as a draft." />
          </Card>
        </div>

        {/* Live preview */}
        <aside className="hidden xl:block" aria-label="Preview">
          <div className="sticky top-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#647067]">How tourists see it</p>
            <div className="overflow-hidden rounded-[20px] border border-[#E2E8E3] bg-white shadow-[0_6px_18px_rgba(22,101,52,0.06)]">
              <div className="flex aspect-[4/3] items-center justify-center bg-gradient-to-br from-[#EAF6ED] to-[#F6F4EE]">
                {previewPhoto ? <img src={previewPhoto} alt="" className="h-full w-full object-cover" /> : <Home className="h-10 w-10 text-[#16803C]/40" aria-hidden="true" />}
              </div>
              <div className="space-y-1.5 p-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#16803C]">{categoryLabel}</p>
                <p className="text-base font-bold text-[#17201A]">{values.name.trim() || 'Offering name'}</p>
                <p className="text-sm font-bold text-[#126B32]">
                  {priceNumber > 0 ? `₱${priceNumber.toLocaleString('en-PH', { maximumFractionDigits: 2 })} / ${UNIT_WORD[values.pricing_basis]}` : 'Free'}
                </p>
                <p className="flex flex-wrap gap-x-2 text-xs text-[#647067]">
                  <span>{BOOKING_MODE_LABEL[values.booking_mode]}</span>
                  {values.max_guests && <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" aria-hidden="true" /> up to {values.max_guests}</span>}
                  {values.is_required && <span>· Required</span>}
                </p>
                {values.description.trim() && <p className="line-clamp-3 text-xs text-[#3F4A43]">{values.description}</p>}
              </div>
            </div>
            <p className={cn('rounded-xl px-3 py-2 text-xs font-medium', values.is_published ? 'bg-[#EAF6ED] text-[#126B32]' : 'bg-[#F1F3F2] text-[#56615B]')}>
              {values.is_published ? 'Published — visible on your resort page.' : 'Draft — only you can see it.'}
            </p>
          </div>
        </aside>
      </form>

      {/* Save bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#E2E8E3] bg-white/95 backdrop-blur lg:left-[264px]">
        <div className="mx-auto flex max-w-[1600px] items-center justify-end gap-3 px-4 py-3 sm:px-6">
          <Link to="/business-owner/resort/offerings" className="rounded-xl border border-[#E2E8E3] px-5 py-2.5 text-sm font-semibold text-[#17201A] hover:bg-[#F3F8F4]">Cancel</Link>
          <button type="submit" form="offering-form" disabled={save.isPending || values.name.trim() === ''}
            className="inline-flex items-center gap-2 rounded-xl bg-[#16803C] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#126B32] disabled:opacity-50">
            <Save className="h-4 w-4" aria-hidden="true" /> {save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create offering'}
          </button>
        </div>
      </div>
    </div>
  )
}
