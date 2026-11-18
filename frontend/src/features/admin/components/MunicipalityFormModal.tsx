import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { Modal } from '@/shared/components/Modal'
import { apiErrorMessage, post, put } from '@/shared/services/api'
import axios from 'axios'

export interface MunicipalityFormValues {
  id?: number
  name: string
  district: string
  province: string
  latitude?: string | number | null
  longitude?: string | number | null
}

const empty: MunicipalityFormValues = { name: '', district: '', province: 'Oriental Mindoro', latitude: '', longitude: '' }

const inputClass =
  'mt-1 w-full bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/40 focus:border-[#16803C] px-3 py-2.5'

/** Add or edit a municipality (District Super Admin only). */
export function MunicipalityFormModal({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean
  initial?: MunicipalityFormValues | null
  onClose: () => void
  onSaved?: (id: number) => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<MunicipalityFormValues>(empty)
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  const editing = !!initial?.id

  useEffect(() => {
    if (open) {
      setForm(initial ? { ...empty, ...initial, latitude: initial.latitude ?? '', longitude: initial.longitude ?? '' } : empty)
      setErrors({})
    }
  }, [open, initial])

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        district: form.district.trim(),
        province: form.province.trim(),
        latitude: form.latitude === '' ? null : form.latitude,
        longitude: form.longitude === '' ? null : form.longitude,
      }
      return editing
        ? put<{ id: number }>(`/admin/municipalities/${initial!.id}`, payload)
        : post<{ id: number }>('/admin/municipalities', payload)
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['admin-municipalities'] })
      queryClient.invalidateQueries({ queryKey: ['admin-municipality'] })
      onSaved?.(saved.id)
      onClose()
    },
    onError: (e) => {
      if (axios.isAxiosError(e) && e.response?.status === 422) {
        setErrors((e.response.data as { errors?: Record<string, string[]> }).errors ?? {})
      }
    },
  })

  const field = (key: keyof MunicipalityFormValues, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label htmlFor={`municipality-${key}`} className="block text-sm font-medium text-[#17201A]">
        {label}
      </label>
      <input
        id={`municipality-${key}`}
        value={(form[key] as string | number | null | undefined) ?? ''}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        className={inputClass}
        {...props}
      />
      {errors[key]?.[0] && <p className="mt-1 text-xs text-red-600">{errors[key][0]}</p>}
    </div>
  )

  return (
    <Modal show={open} onClose={onClose} maxWidth="lg">
      <form
        className="p-6 bg-white space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <div>
          <h2 className="text-lg font-semibold text-[#17201A]">{editing ? `Edit ${initial?.name}` : 'Add municipality'}</h2>
          <p className="text-sm text-[#6B7280]">
            {editing
              ? 'Update the municipality details shown across TrackTour.'
              : 'Add a municipality under the Bansud Tourism Office, then create its Tourism Office account.'}
          </p>
        </div>
        {field('name', 'Municipality name', { required: true, maxLength: 255 })}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field('district', 'District', { required: true, maxLength: 255, placeholder: 'District 2' })}
          {field('province', 'Province', { required: true, maxLength: 255 })}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field('latitude', 'Latitude (optional)', { type: 'number', step: 'any', min: -90, max: 90 })}
          {field('longitude', 'Longitude (optional)', { type: 'number', step: 'any', min: -180, max: 180 })}
        </div>
        {save.isError && Object.keys(errors).length === 0 && (
          <p className="text-sm text-red-600">{apiErrorMessage(save.error)}</p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium border border-[#E2E8E3] text-[#17201A] hover:bg-[#F3F8F4]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={save.isPending}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-[#16803C] text-white hover:bg-[#126B32] inline-flex items-center gap-2 disabled:opacity-50"
          >
            {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {editing ? 'Save changes' : 'Add municipality'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
