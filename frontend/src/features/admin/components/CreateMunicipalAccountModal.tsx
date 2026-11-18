import { useEffect, useState } from 'react'
import axios from 'axios'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { Modal } from '@/shared/components/Modal'
import { apiErrorMessage, get, post } from '@/shared/services/api'

const inputClass =
  'mt-1 w-full bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/40 focus:border-[#16803C] px-3 py-2.5'

const blank = { municipality_id: '', first_name: '', last_name: '', email: '', mobile_number: '', password: '', password_confirmation: '' }

interface MunicipalityOption {
  id: number
  name: string
  is_home?: boolean
  admins_count?: number
}

/**
 * Create a Municipality Tourism Office account (Bansud super admin only).
 * With a fixed `municipality` it creates the account for that municipality;
 * without one it lets the admin choose the municipality.
 */
export function CreateMunicipalAccountModal({
  open,
  municipality,
  onClose,
  onCreated,
}: {
  open: boolean
  municipality?: { id: number; name: string }
  onClose: () => void
  onCreated: (email: string, municipalityName: string) => void
}) {
  const [form, setForm] = useState(blank)
  const [errors, setErrors] = useState<Record<string, string[]>>({})

  useEffect(() => {
    if (open) {
      setForm({ ...blank, municipality_id: municipality ? String(municipality.id) : '' })
      setErrors({})
    }
  }, [open, municipality])

  const { data: options } = useQuery({
    queryKey: ['admin-municipalities', 'options'],
    queryFn: () => get<{ data: MunicipalityOption[] }>('/admin/municipalities', { params: { per_page: 100 } }),
    enabled: open && !municipality,
  })

  const chosenName = municipality?.name ?? options?.data.find((m) => String(m.id) === form.municipality_id)?.name ?? ''

  const create = useMutation({
    mutationFn: () => {
      const { municipality_id, ...rest } = form
      return municipality
        ? post(`/admin/municipalities/${municipality.id}/admins`, rest)
        : post('/admin/municipality-accounts', { ...rest, municipality_id: Number(municipality_id) || municipality_id })
    },
    onSuccess: () => {
      onCreated(form.email, chosenName)
      onClose()
    },
    onError: (e) => {
      if (axios.isAxiosError(e) && e.response?.status === 422) {
        setErrors((e.response.data as { errors?: Record<string, string[]> }).errors ?? {})
      }
    },
  })

  const input = (key: Exclude<keyof typeof blank, 'municipality_id'>, label: string, type = 'text', required = true) => (
    <div>
      <label htmlFor={`account-${key}`} className="block text-sm font-medium text-[#17201A]">
        {label}
      </label>
      <input
        id={`account-${key}`}
        type={type}
        required={required}
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        className={inputClass}
        autoComplete={type === 'password' ? 'new-password' : undefined}
      />
      {errors[key]?.[0] && <p className="mt-1 text-xs text-red-600">{errors[key]?.[0]}</p>}
    </div>
  )

  return (
    <Modal show={open} onClose={onClose} maxWidth="lg">
      <form
        className="p-6 bg-white space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        <div>
          <h2 className="text-lg font-semibold text-[#17201A]">
            {municipality ? `New ${municipality.name} Tourism Office account` : 'Create municipality account'}
          </h2>
          <p className="text-sm text-[#6B7280]">
            The account signs in to the Municipal Portal right away and only sees {chosenName ? `${chosenName}'s` : 'its own municipality’s'} business owners, businesses, riders and tourists.
          </p>
        </div>

        {!municipality && (
          <div>
            <label htmlFor="account-municipality" className="block text-sm font-medium text-[#17201A]">
              Municipality
            </label>
            <select
              id="account-municipality"
              required
              value={form.municipality_id}
              onChange={(e) => setForm((f) => ({ ...f, municipality_id: e.target.value }))}
              className={inputClass}
            >
              <option value="">Select a municipality…</option>
              {(options?.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.is_home ? ' (home office)' : m.admins_count === 0 ? ' — no account yet' : ''}
                </option>
              ))}
            </select>
            {errors.municipality_id?.[0] && <p className="mt-1 text-xs text-red-600">{errors.municipality_id?.[0]}</p>}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {input('first_name', 'First name')}
          {input('last_name', 'Last name')}
        </div>
        {input('email', 'Office email', 'email')}
        {input('mobile_number', 'Mobile number (optional)', 'tel', false)}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {input('password', 'Temporary password', 'password')}
          {input('password_confirmation', 'Confirm password', 'password')}
        </div>
        <p className="text-xs text-[#6B7280]">At least 8 characters with letters and numbers. Share it with the account holder securely.</p>
        {create.isError && Object.keys(errors).length === 0 && <p className="text-sm text-red-600">{apiErrorMessage(create.error)}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium border border-[#E2E8E3] hover:bg-[#F3F8F4]">
            Cancel
          </button>
          <button
            type="submit"
            disabled={create.isPending}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-[#16803C] text-white hover:bg-[#126B32] inline-flex items-center gap-2 disabled:opacity-50"
          >
            {create.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Create account
          </button>
        </div>
      </form>
    </Modal>
  )
}
