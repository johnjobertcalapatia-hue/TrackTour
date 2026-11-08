import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Plus, Save, X } from 'lucide-react'
import { get, put } from '@/shared/services/api'
import { Alert } from '@/shared/components/Alert'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { cn } from '@/shared/utils'
import { useActiveResort } from '@/features/business-owner/services/use-active-resort'
import { fieldErrors } from '@/features/business-owner/services/resort-offerings'

interface Catalogue {
  types: { id: number; slug: string; name: string; description: string | null }[]
  facilities: { id: number; slug: string; name: string }[]
}
interface ResortProfile {
  types: { id: number; slug: string; name: string }[]
  facilities: { id: number; slug: string; name: string }[]
  custom_facilities: string[]
}

/**
 * Resort setup: choose one or more resort types and the facilities the
 * resort offers (catalogue + custom). Dynamic resort system, Stage 5.
 */
export default function BusinessOwnerResortProfile() {
  const { businessId, business, isResort } = useActiveResort()
  const queryClient = useQueryClient()
  const [typeIds, setTypeIds] = useState<number[]>([])
  const [facilityIds, setFacilityIds] = useState<number[]>([])
  const [custom, setCustom] = useState<string[]>([])
  const [newCustom, setNewCustom] = useState('')
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const catalogue = useQuery({ queryKey: ['resort-catalogue'], queryFn: () => get<Catalogue>('/resort-catalogue'), staleTime: 60 * 60 * 1000 })
  const profile = useQuery({
    queryKey: ['bo-resort-profile', businessId],
    queryFn: () => get<ResortProfile>(`/business-owner/businesses/${businessId}/resort-profile`),
    enabled: Boolean(businessId && isResort),
  })

  useEffect(() => {
    if (!profile.data) return
    setTypeIds(profile.data.types.map((t) => t.id))
    setFacilityIds(profile.data.facilities.map((f) => f.id))
    setCustom(profile.data.custom_facilities)
  }, [profile.data])

  const save = useMutation({
    mutationFn: () => put<ResortProfile>(`/business-owner/businesses/${businessId}/resort-profile`, {
      resort_type_ids: typeIds,
      facility_ids: facilityIds,
      custom_facilities: custom,
    }),
    onSuccess: () => {
      setSuccess('Resort details saved. Tourists now see these types and facilities.')
      setError('')
      setErrors({})
      queryClient.invalidateQueries({ queryKey: ['bo-resort-profile', businessId] })
    },
    onError: (e) => {
      setErrors(fieldErrors(e))
      setError((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Could not save. Please check the form.')
    },
  })

  const toggle = (list: number[], id: number) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  const addCustom = () => {
    const name = newCustom.trim().replace(/\s+/g, ' ')
    if (!name || custom.some((c) => c.toLowerCase() === name.toLowerCase()) || custom.length >= 20) return
    setCustom([...custom, name])
    setNewCustom('')
  }

  if (!isResort) {
    return <Alert type="info" message={`Resort setup is for Resort businesses${business ? `. "${business.name}" is a ${business.category}.` : '.'}`} />
  }
  if (catalogue.isLoading || profile.isLoading) return <DashboardSkeleton />

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">Resort Types &amp; Facilities</h1>
        <p className="text-sm text-[#647067] mt-1">How {business?.name} is classified and what it offers. Tourists use these to find your resort.</p>
      </div>

      {success && <Alert type="success" message={success} onDismiss={() => setSuccess('')} />}
      {error && <Alert type="error" message={error} onDismiss={() => setError('')} />}

      <form onSubmit={(e) => { e.preventDefault(); setSuccess(''); save.mutate() }} className="space-y-6">
        <fieldset className="bg-white rounded-2xl border border-[#E2E8E3] p-6 space-y-3">
          <legend className="text-lg font-semibold text-[#17201A] px-1">Resort types</legend>
          <p className="text-sm text-[#647067]">Choose every type that fits. A resort can be, for example, both a Pool Resort and a Nature Resort.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {catalogue.data?.types.map((t) => {
              const checked = typeIds.includes(t.id)
              return (
                <label key={t.id} className={cn('flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition', checked ? 'border-[#16803C] bg-[#F0FAF3]' : 'border-[#E2E8E3] hover:border-[#16803C]/50')}>
                  <input type="checkbox" checked={checked} onChange={() => setTypeIds(toggle(typeIds, t.id))} className="mt-1 accent-[#16803C]" />
                  <span>
                    <span className="block text-sm font-semibold text-[#17201A]">{t.name}</span>
                    {t.description && <span className="block text-xs text-[#647067]">{t.description}</span>}
                  </span>
                </label>
              )
            })}
          </div>
          {errors.resort_type_ids && <p role="alert" className="text-xs text-[#B91C1C]">{errors.resort_type_ids}</p>}
        </fieldset>

        <fieldset className="bg-white rounded-2xl border border-[#E2E8E3] p-6 space-y-3">
          <legend className="text-lg font-semibold text-[#17201A] px-1">Facilities</legend>
          <div className="flex flex-wrap gap-2">
            {catalogue.data?.facilities.map((f) => {
              const checked = facilityIds.includes(f.id)
              return (
                <label key={f.id} className={cn('inline-flex items-center gap-1.5 h-9 px-3 rounded-full border text-sm cursor-pointer select-none transition', checked ? 'border-[#16803C] bg-[#F0FAF3] text-[#16803C] font-semibold' : 'border-[#E2E8E3] text-[#17201A] hover:border-[#16803C]/50')}>
                  <input type="checkbox" checked={checked} onChange={() => setFacilityIds(toggle(facilityIds, f.id))} className="sr-only" />
                  {checked && <Check className="w-3.5 h-3.5" aria-hidden="true" />}
                  {f.name}
                </label>
              )
            })}
          </div>

          <div className="pt-3 border-t border-[#E2E8E3]">
            <label htmlFor="custom-facility" className="block text-sm font-medium text-[#4B5563] mb-1.5">Other facilities</label>
            <div className="flex gap-2">
              <input
                id="custom-facility"
                value={newCustom}
                maxLength={100}
                onChange={(e) => setNewCustom(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }}
                placeholder="e.g. Videoke room, Hammock area"
                className="flex-1 px-4 py-2.5 bg-white border border-[#E2E8E3] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C]"
              />
              <button type="button" onClick={addCustom} className="inline-flex items-center gap-1.5 px-4 rounded-xl border border-[#16803C] text-[#16803C] text-sm font-semibold hover:bg-[#F0FAF3]">
                <Plus className="w-4 h-4" aria-hidden="true" /> Add
              </button>
            </div>
            {custom.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2" aria-label="Other facilities">
                {custom.map((c) => (
                  <li key={c} className="inline-flex items-center gap-1 h-8 pl-3 pr-1.5 rounded-full bg-[#F3F4F6] text-sm text-[#17201A]">
                    {c}
                    <button type="button" onClick={() => setCustom(custom.filter((x) => x !== c))} aria-label={`Remove ${c}`} className="w-6 h-6 rounded-full flex items-center justify-center text-[#647067] hover:text-[#B91C1C]">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </fieldset>

        <div className="flex justify-end">
          <button type="submit" disabled={save.isPending || typeIds.length === 0} className="inline-flex items-center gap-2 bg-[#16803C] hover:bg-[#126B32] disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-semibold">
            <Save className="w-4 h-4" aria-hidden="true" /> {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}
