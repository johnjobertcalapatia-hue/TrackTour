import { useEffect, useState } from 'react'
import axios from 'axios'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ImagePlus, Landmark, Loader2, Lock, Save, Trash2 } from 'lucide-react'
import { apiErrorMessage, get, post } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { Alert } from '@/shared/components/Alert'
import { toAssetUrl } from '@/shared/utils'
import { card, DetailRow, inputClass, PageHeader } from '@/features/municipal/components/MunicipalUi'
import { MUNICIPAL_API, type MunicipalProfile as Profile } from '@/features/municipal/types'

type TextField = 'office_name' | 'about' | 'email' | 'phone' | 'address' | 'office_hours'

const FIELDS: { key: TextField; label: string; type?: string; textarea?: boolean; placeholder?: string }[] = [
  { key: 'office_name', label: 'Office name' },
  { key: 'email', label: 'Office email', type: 'email' },
  { key: 'phone', label: 'Contact number', type: 'tel' },
  { key: 'office_hours', label: 'Office hours', placeholder: 'Mon–Fri, 8:00 AM – 5:00 PM' },
  { key: 'address', label: 'Office address' },
  { key: 'about', label: 'About the office', textarea: true },
]

export default function MunicipalProfile() {
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['municipal', 'profile'],
    queryFn: () => get<Profile>(MUNICIPAL_API.PROFILE),
  })

  const [form, setForm] = useState<Record<TextField, string>>({ office_name: '', about: '', email: '', phone: '', address: '', office_hours: '' })
  const [logo, setLogo] = useState<File | null>(null)
  const [cover, setCover] = useState<File | null>(null)
  const [remove, setRemove] = useState({ logo: false, cover: false })
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (data) {
      setForm({ office_name: data.office_name, about: data.about, email: data.email, phone: data.phone, address: data.address, office_hours: data.office_hours })
    }
  }, [data])

  const save = useMutation({
    mutationFn: () => {
      const body = new FormData()
      FIELDS.forEach(({ key }) => body.append(key, form[key]))
      if (logo) body.append('logo', logo)
      else if (remove.logo) body.append('remove_logo', '1')
      if (cover) body.append('cover', cover)
      else if (remove.cover) body.append('remove_cover', '1')
      return post<Profile>(MUNICIPAL_API.PROFILE, body)
    },
    onSuccess: () => {
      setLogo(null)
      setCover(null)
      setRemove({ logo: false, cover: false })
      setErrors({})
      setNotice('Office profile saved.')
      queryClient.invalidateQueries({ queryKey: ['municipal'] })
    },
    onError: (e) => {
      if (axios.isAxiosError(e) && e.response?.status === 422) {
        setErrors((e.response.data as { errors?: Record<string, string[]> }).errors ?? {})
      }
    },
  })

  if (isLoading) return <DashboardSkeleton />
  if (error || !data) return <Alert type="error" message={apiErrorMessage(error, 'Could not load the office profile.')} />

  const logoPreview = logo ? URL.createObjectURL(logo) : remove.logo ? null : data.logo_url ? toAssetUrl(data.logo_url) : null
  const coverPreview = cover ? URL.createObjectURL(cover) : remove.cover ? null : data.cover_url ? toAssetUrl(data.cover_url) : null

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setNotice('')
        save.mutate()
      }}
    >
      <PageHeader
        title="Profile & Settings"
        subtitle="Your office identity. The logo and cover also appear on the public pages for your municipality."
        actions={
          <button
            type="submit"
            disabled={save.isPending}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-[#2E8B57] text-white hover:bg-[#257347] inline-flex items-center gap-2 disabled:opacity-50"
          >
            {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save changes
          </button>
        }
      />

      {notice && <Alert type="success" message={notice} onDismiss={() => setNotice('')} />}
      {save.isError && Object.keys(errors).length === 0 && <Alert type="error" message={apiErrorMessage(save.error)} />}

      <section className={`${card} mb-6 overflow-hidden`} aria-label="Branding">
        <div
          className="relative h-40 bg-gradient-to-br from-[#0F2E1D] via-[#1D5C3A] to-[#2E8B57] bg-cover bg-center"
          style={coverPreview ? { backgroundImage: `url(${coverPreview})` } : undefined}
        >
          <div className="absolute bottom-3 right-3 flex gap-2">
            <ImagePicker label="Change cover" onPick={(f) => { setCover(f); setRemove((r) => ({ ...r, cover: false })) }} />
            {coverPreview && (
              <button type="button" onClick={() => { setCover(null); setRemove((r) => ({ ...r, cover: true })) }} className="rounded-lg bg-white/90 px-3 py-1.5 text-xs font-semibold text-red-600 inline-flex items-center gap-1">
                <Trash2 className="w-3.5 h-3.5" /> Remove
              </button>
            )}
          </div>
        </div>
        <div className="px-5 pb-5 -mt-10 flex flex-wrap items-end gap-4">
          <div className="w-20 h-20 rounded-2xl border-4 border-white bg-[#E6F2EB] overflow-hidden flex items-center justify-center shadow-md">
            {logoPreview ? <img src={logoPreview} alt="Office logo" className="w-full h-full object-cover" /> : <Landmark className="w-8 h-8 text-[#2E8B57]" />}
          </div>
          <div className="flex gap-2 pb-1">
            <ImagePicker label="Change logo" dark onPick={(f) => { setLogo(f); setRemove((r) => ({ ...r, logo: false })) }} />
            {logoPreview && (
              <button type="button" onClick={() => { setLogo(null); setRemove((r) => ({ ...r, logo: true })) }} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 inline-flex items-center gap-1 hover:bg-red-50">
                <Trash2 className="w-3.5 h-3.5" /> Remove
              </button>
            )}
          </div>
          {(errors.logo?.[0] || errors.cover?.[0]) && <p className="w-full text-xs text-red-600">{errors.logo?.[0] ?? errors.cover?.[0]}</p>}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className={`${card} p-5 lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4`} aria-label="Office details">
          {FIELDS.map((f) => (
            <div key={f.key} className={f.textarea || f.key === 'address' ? 'sm:col-span-2' : ''}>
              <label htmlFor={`profile-${f.key}`} className="block text-sm font-medium text-[#1C2B22]">
                {f.label}
              </label>
              {f.textarea ? (
                <textarea id={`profile-${f.key}`} rows={4} maxLength={1000} value={form[f.key]} onChange={(e) => setForm((v) => ({ ...v, [f.key]: e.target.value }))} className={`${inputClass} mt-1`} />
              ) : (
                <input
                  id={`profile-${f.key}`}
                  type={f.type ?? 'text'}
                  required={f.key === 'office_name'}
                  placeholder={f.placeholder}
                  value={form[f.key]}
                  onChange={(e) => setForm((v) => ({ ...v, [f.key]: e.target.value }))}
                  className={`${inputClass} mt-1`}
                />
              )}
              {errors[f.key]?.[0] && <p className="mt-1 text-xs text-red-600">{errors[f.key]?.[0]}</p>}
            </div>
          ))}
        </section>

        <div className="space-y-4">
          <section className={`${card} p-5`} aria-label="Municipality">
            <h2 className="text-sm font-semibold text-[#1C2B22] mb-2 flex items-center gap-2">
              <Lock className="w-4 h-4 text-[#66736B]" aria-hidden="true" /> Municipality record
            </h2>
            <dl>
              <DetailRow label="Municipality" value={data.municipality.name} />
              <DetailRow label="District" value={data.municipality.district} />
              <DetailRow label="Province" value={data.municipality.province} />
            </dl>
            <p className="mt-3 text-xs text-[#66736B]">These details are managed by the Bansud Tourism Office.</p>
          </section>
          <section className={`${card} p-5`} aria-label="Signed in account">
            <h2 className="text-sm font-semibold text-[#1C2B22] mb-2">Signed-in account</h2>
            <dl>
              <DetailRow label="Name" value={data.account.name} />
              <DetailRow label="Email" value={data.account.email} />
            </dl>
          </section>
        </div>
      </div>
    </form>
  )
}

function ImagePicker({ label, onPick, dark }: { label: string; onPick: (file: File) => void; dark?: boolean }) {
  return (
    <label
      className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1 ${
        dark ? 'bg-[#0F2E1D] text-white hover:bg-[#18402A]' : 'bg-white/90 text-[#1C2B22] hover:bg-white'
      }`}
    >
      <ImagePlus className="w-3.5 h-3.5" /> {label}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onPick(file)
          e.target.value = ''
        }}
      />
    </label>
  )
}
