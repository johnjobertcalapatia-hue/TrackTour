import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, Search } from 'lucide-react'
import { get, post, put } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency, toAssetUrl } from '@/shared/utils'
import { useBusinessPortal } from '../services/business-portal'
import {
  formatManilaDate, manilaDay, previewSalePrice, type DishSaleSummary, type SaleDish,
} from '../services/promotions'

type FieldErrors = Partial<Record<'title' | 'discount_value' | 'starts_at' | 'ends_at' | 'offering_ids' | 'business_id', string>>

const input = 'w-full rounded-xl border border-[#D9E2DC] bg-[#fff] px-3.5 py-2.5 text-sm text-[#17201B] focus:border-[#16803C] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25'

/**
 * Create or edit a dish sale. Prices shown here are a preview: the server
 * checks every dish (its business, a sale price above ₱0, no other sale on the
 * same days) and works out the real price at checkout.
 */
export default function BusinessOwnerSaleForm() {
  const { id } = useParams()
  const editing = id != null
  const portal = useBusinessPortal()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [businessId, setBusinessId] = useState<number | null>(portal.businessId ?? portal.businesses[0]?.id ?? null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<'percentage' | 'fixed'>('percentage')
  const [value, setValue] = useState('')
  const today = manilaDay(new Date())
  const [startsAt, setStartsAt] = useState(today)
  const [endsAt, setEndsAt] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  const [search, setSearch] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState('')

  const saleQuery = useQuery({
    queryKey: ['bo-dish-sale', portal.prefix, id],
    queryFn: () => get<DishSaleSummary>(`${portal.prefix}/dish-sales/${id}`),
    enabled: editing,
  })
  const sale = saleQuery.data
  const started = sale?.status === 'active'

  useEffect(() => {
    if (!sale) return
    setBusinessId(sale.business_id)
    setTitle(sale.title)
    setDescription(sale.description ?? '')
    setType(sale.discount_type)
    setValue(String(sale.discount_value))
    setStartsAt(manilaDay(sale.starts_at))
    setEndsAt(manilaDay(sale.ends_at))
    setSelected(sale.dishes.map((d) => d.id))
  }, [sale])

  const dishesQuery = useQuery({
    queryKey: ['bo-sale-dishes', portal.prefix, businessId],
    queryFn: () => get<SaleDish[]>(`${portal.prefix}/dish-sales/dishes?business_id=${businessId}`),
    enabled: businessId != null,
  })
  const dishes = dishesQuery.data ?? []
  const numericValue = Number(value)

  // Another sale on the same dish whose days overlap the chosen days.
  const clashFor = (dish: SaleDish) => {
    if (!startsAt || !endsAt) return null
    return dish.sales.find((s) => s.id !== Number(id) && manilaDay(s.starts_at) <= endsAt && manilaDay(s.ends_at) >= startsAt) ?? null
  }

  const visibleDishes = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? dishes.filter((d) => d.name.toLowerCase().includes(q)) : dishes
  }, [dishes, search])

  const toggle = (dishId: number) => setSelected((cur) => (cur.includes(dishId) ? cur.filter((x) => x !== dishId) : [...cur, dishId]))

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) => (editing
      ? put(`${portal.prefix}/dish-sales/${id}`, payload)
      : post(`${portal.prefix}/dish-sales`, payload)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-dish-sales'] })
      queryClient.invalidateQueries({ queryKey: ['bo-sale-dishes'] })
      navigate(`${portal.prefix}/promotions?tab=sales`)
    },
    onError: (err: any) => {
      const fieldErrors = err?.response?.data?.errors as Record<string, string[]> | undefined
      if (fieldErrors) {
        const next: FieldErrors = {}
        for (const [key, messages] of Object.entries(fieldErrors)) {
          const k = key.startsWith('offering_ids') ? 'offering_ids' : key
          ;(next as Record<string, string>)[k] = messages[0] ?? ''
        }
        setErrors(next)
      }
      setFormError(err?.response?.data?.message || 'Could not save the sale. Please check the form.')
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setFormError('')
    const next: FieldErrors = {}
    if (title.trim().length < 2) next.title = 'Enter a sale title.'
    if (!(numericValue > 0)) next.discount_value = 'Enter the discount.'
    else if (type === 'percentage' && numericValue >= 100) next.discount_value = 'A percentage sale must be below 100%.'
    if (!endsAt) next.ends_at = 'Choose the last day of the sale.'
    else if (startsAt && endsAt < startsAt) next.ends_at = 'The last day cannot be before the first day.'
    if (selected.length === 0) next.offering_ids = 'Choose at least one dish.'
    const free = dishes.filter((d) => selected.includes(d.id) && previewSalePrice(d.price, type, numericValue) < 0.01)
    if (free.length > 0 && !next.discount_value) next.discount_value = `${free.map((d) => d.name).join(', ')} would cost ₱0 or less.`
    setErrors(next)
    if (Object.keys(next).length > 0) return

    save.mutate({
      business_id: businessId,
      title: title.trim(),
      description: description.trim() || null,
      discount_type: type,
      discount_value: numericValue,
      starts_at: startsAt,
      ends_at: endsAt,
      offering_ids: selected,
    })
  }

  if (editing && saleQuery.isLoading) return <DashboardSkeleton />
  if (editing && sale && (sale.status === 'ended' || sale.status === 'stopped')) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-5">
        <Link to={`${portal.prefix}/promotions?tab=sales`} className="inline-flex items-center gap-2 text-sm text-[#647067] hover:text-[#17201A]"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Deals &amp; Posts</Link>
        <p className="rounded-[20px] border border-[#E2E8E3] bg-[#fff] p-5 text-sm text-[#5E6B63]">This sale has finished and can no longer be changed. Create a new sale instead.</p>
      </div>
    )
  }

  const errorText = (key: keyof FieldErrors) => errors[key] && <p id={`${key}-error`} className="mt-1 text-xs text-[#B42318]">{errors[key]}</p>

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <Link to={`${portal.prefix}/promotions?tab=sales`} className="inline-flex items-center gap-2 text-sm text-[#647067] transition hover:text-[#17201A]">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Deals &amp; Posts
      </Link>
      <div>
        <h1 className="text-2xl font-bold text-[#17201B] lg:text-3xl">{editing ? 'Edit sale' : 'New sale'}</h1>
        <p className="mt-1 text-sm text-[#5E6B63]">Customers pay the sale price at checkout while the sale runs. Your business pays for the discount; the system fee is worked out on the sale price.</p>
      </div>

      {formError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>}

      <form onSubmit={submit} noValidate className="space-y-5">
        <section className="space-y-4 rounded-[20px] border border-[#E2E8E3] bg-[#fff] p-5">
          {!editing && portal.businesses.length > 1 && (
            <div>
              <label htmlFor="sale-business" className="mb-1.5 block text-sm font-medium text-[#17201B]">Business</label>
              <select id="sale-business" className={input} value={businessId ?? ''} onChange={(e) => { setBusinessId(Number(e.target.value)); setSelected([]) }}>
                {portal.businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="sale-title" className="mb-1.5 block text-sm font-medium text-[#17201B]">Sale title</label>
            <input id="sale-title" className={input} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Weekend Sisig Sale" aria-invalid={!!errors.title} aria-describedby={errors.title ? 'title-error' : undefined} />
            {errorText('title')}
          </div>
          <div>
            <label htmlFor="sale-description" className="mb-1.5 block text-sm font-medium text-[#17201B]">Description <span className="font-normal text-[#5E6B63]">(optional)</span></label>
            <textarea id="sale-description" className={input} rows={2} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <fieldset>
            <legend className="mb-1.5 block text-sm font-medium text-[#17201B]">Discount</legend>
            <div className="flex flex-wrap items-start gap-3">
              <div role="radiogroup" aria-label="Discount type" className="inline-flex rounded-xl border border-[#D9E2DC] p-1">
                {(['percentage', 'fixed'] as const).map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={type === t} onClick={() => setType(t)}
                    className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${type === t ? 'bg-[#0F4D2B] text-white' : 'text-[#2F4A3A] hover:bg-[#F3F8F4]'}`}>
                    {t === 'percentage' ? '% off' : '₱ off'}
                  </button>
                ))}
              </div>
              <div className="w-40">
                <label htmlFor="sale-value" className="sr-only">{type === 'percentage' ? 'Percent off' : 'Pesos off'}</label>
                <input id="sale-value" type="number" min="0.01" step="0.01" max={type === 'percentage' ? 99 : undefined} className={input} value={value} onChange={(e) => setValue(e.target.value)}
                  placeholder={type === 'percentage' ? '20' : '50.00'} aria-invalid={!!errors.discount_value} aria-describedby={errors.discount_value ? 'discount_value-error' : undefined} />
              </div>
            </div>
            {errorText('discount_value')}
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="sale-start" className="mb-1.5 block text-sm font-medium text-[#17201B]">First day</label>
              <input id="sale-start" type="date" className={input} value={startsAt} min={started ? undefined : today} disabled={started} onChange={(e) => setStartsAt(e.target.value)} />
              <p className="mt-1 text-xs text-[#5E6B63]">{started ? 'The sale has started; its start stays as it is.' : startsAt === today ? 'Starts as soon as you save.' : 'Starts at 12:00 AM (Philippine time).'}</p>
            </div>
            <div>
              <label htmlFor="sale-end" className="mb-1.5 block text-sm font-medium text-[#17201B]">Last day</label>
              <input id="sale-end" type="date" className={input} value={endsAt} min={startsAt || today} onChange={(e) => setEndsAt(e.target.value)} aria-invalid={!!errors.ends_at} aria-describedby={errors.ends_at ? 'ends_at-error' : 'sale-end-hint'} />
              {errors.ends_at ? errorText('ends_at') : <p id="sale-end-hint" className="mt-1 text-xs text-[#5E6B63]">Ends at 11:59 PM (Philippine time){endsAt ? ` on ${formatManilaDate(`${endsAt}T12:00:00+08:00`)}` : ''}.</p>}
            </div>
          </div>
        </section>

        <section className="rounded-[20px] border border-[#E2E8E3] bg-[#fff] p-5" aria-labelledby="sale-dishes-heading">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 id="sale-dishes-heading" className="font-semibold text-[#17201B]">Dishes on sale <span className="font-normal text-[#5E6B63]">({selected.length} chosen)</span></h2>
            <div className="relative sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" aria-hidden="true" />
              <label htmlFor="sale-dish-search" className="sr-only">Search dishes</label>
              <input id="sale-dish-search" className={`${input} pl-9`} placeholder="Search dishes" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          {errorText('offering_ids')}

          {dishesQuery.isLoading ? <p className="py-6 text-center text-sm text-[#5E6B63]">Loading dishes…</p> : dishes.length === 0 ? (
            <p className="py-6 text-center text-sm text-[#5E6B63]">This business has no dishes yet. Add dishes in Menu first.</p>
          ) : (
            <ul className="max-h-[420px] divide-y divide-[#EEF2EF] overflow-y-auto" aria-label="Dishes">
              {visibleDishes.map((dish) => {
                const chosen = selected.includes(dish.id)
                const clash = clashFor(dish)
                const salePrice = previewSalePrice(dish.price, type, numericValue)
                const free = chosen && numericValue > 0 && salePrice < 0.01
                return (
                  <li key={dish.id}>
                    <label className={`flex cursor-pointer items-center gap-3 py-2.5 ${clash && !chosen ? 'opacity-60' : ''}`}>
                      <input type="checkbox" className="peer sr-only" checked={chosen} onChange={() => toggle(dish.id)} disabled={!!clash && !chosen} />
                      <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border peer-focus-visible:ring-2 peer-focus-visible:ring-[#16803C]/40 ${chosen ? 'border-[#16803C] bg-[#16803C] text-white' : 'border-[#C9D3CC] bg-[#fff]'}`}>
                        {chosen && <Check className="h-3.5 w-3.5" />}
                      </span>
                      {dish.image ? <img src={toAssetUrl(dish.image)} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" /> : <span className="h-10 w-10 shrink-0 rounded-lg bg-[#F3F8F4]" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-[#17201B]">{dish.name}</span>
                        {clash
                          ? <span className="block text-xs text-[#9A6700]">In “{clash.title}” until {formatManilaDate(clash.ends_at)}</span>
                          : !dish.is_available && <span className="block text-xs text-[#5E6B63]">Currently unavailable</span>}
                      </span>
                      <span className="shrink-0 text-right text-sm">
                        {chosen && numericValue > 0 ? (
                          <>
                            <s className="block text-xs text-[#5E6B63]">{formatCurrency(dish.price)}</s>
                            <span className={`font-semibold ${free ? 'text-[#B42318]' : 'text-[#087F3F]'}`}>{free ? '₱0 or less' : formatCurrency(salePrice)}</span>
                          </>
                        ) : <span className="text-[#17201B]">{formatCurrency(dish.price)}</span>}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <div className="flex justify-end gap-3">
          <Link to={`${portal.prefix}/promotions?tab=sales`} className="rounded-xl border border-[#D7E8DB] px-4 py-2.5 text-sm font-medium text-[#16803C] hover:bg-[#F3F8F4]">Cancel</Link>
          <button type="submit" disabled={save.isPending} className="rounded-xl bg-[#16803C] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#126B32] disabled:opacity-50">
            {save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create sale'}
          </button>
        </div>
      </form>
    </div>
  )
}
