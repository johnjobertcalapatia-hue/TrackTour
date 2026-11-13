import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Building2, ImagePlus, Loader2, Save, Trash2 } from 'lucide-react'
import { Alert } from '@/shared/components/Alert'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { API_ENDPOINTS } from '@/shared/constants'
import { apiErrorMessage, post } from '@/shared/services/api'
import { toAssetUrl } from '@/shared/utils'
import {
  OFFICE_PROFILE_QUERY_KEY,
  useOfficeProfile,
  type OfficeProfile,
} from '@/features/admin/hooks/use-office-profile'

const LOGO_MAX_BYTES = 5 * 1024 * 1024
const COVER_MAX_BYTES = 10 * 1024 * 1024
const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp'

interface DetailsForm {
  name: string
  about: string
  email: string
  phone: string
  address: string
}

const emptyForm: DetailsForm = { name: '', about: '', email: '', phone: '', address: '' }

function formFrom(profile: OfficeProfile): DetailsForm {
  return {
    name: profile.name,
    about: profile.about,
    email: profile.email,
    phone: profile.phone,
    address: profile.address,
  }
}

/** jsdom has no usable object URLs; the page must still stage the file. */
function previewUrl(file: File): string | null {
  if (typeof URL.createObjectURL !== 'function') return null

  try {
    return URL.createObjectURL(file)
  } catch {
    return null
  }
}

function releasePreview(url: string | null) {
  if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url)
}

/**
 * Bansud Tourism Office profile — reached from the Admin sidebar's
 * "Signed in as" card (/admin/profile).
 *
 * The office sets its logo, cover photo and contact details here. Everything
 * is municipal-wide branding stored in tourism_settings, so the sidebar logo
 * updates through the shared query cache as soon as it is saved.
 */
export default function AdminOfficeProfile() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useOfficeProfile()

  const [form, setForm] = useState<DetailsForm>(emptyForm)
  const [hydrated, setHydrated] = useState(false)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [coverPreview, setCoverPreview] = useState<string | null>(null)
  const [removeLogo, setRemoveLogo] = useState(false)
  const [removeCover, setRemoveCover] = useState(false)
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Load the saved values once; after that the form is the source of truth
  // until a save returns the canonical profile.
  useEffect(() => {
    if (!data || hydrated) return
    setForm(formFrom(data))
    setHydrated(true)
  }, [data, hydrated])

  const logoSrc = logoPreview ?? (removeLogo ? null : toAssetUrl(data?.logo_url))
  const coverSrc = coverPreview ?? (removeCover ? null : toAssetUrl(data?.cover_url))

  const savedForm = data ? formFrom(data) : emptyForm
  const detailsChanged = hydrated && JSON.stringify(form) !== JSON.stringify(savedForm)
  const hasUnsavedChanges =
    detailsChanged || Boolean(logoFile || coverFile || removeLogo || removeCover)

  const mutation = useMutation({
    mutationFn: () => {
      const payload = new FormData()
      payload.append('name', form.name.trim())
      payload.append('about', form.about)
      payload.append('email', form.email)
      payload.append('phone', form.phone)
      payload.append('address', form.address)
      if (logoFile) payload.append('logo', logoFile)
      if (coverFile) payload.append('cover', coverFile)
      if (removeLogo) payload.append('remove_logo', '1')
      if (removeCover) payload.append('remove_cover', '1')

      return post<OfficeProfile>(API_ENDPOINTS.ADMIN.PROFILE, payload)
    },
    onSuccess: (updated) => {
      // Same cache entry the Admin sidebar reads, so the new logo shows there
      // without a reload.
      queryClient.setQueryData(OFFICE_PROFILE_QUERY_KEY, updated)
      setForm(formFrom(updated))
      releasePreview(logoPreview)
      releasePreview(coverPreview)
      setLogoFile(null)
      setCoverFile(null)
      setLogoPreview(null)
      setCoverPreview(null)
      setRemoveLogo(false)
      setRemoveCover(false)
      setNotice({ type: 'success', message: 'Office profile saved.' })
    },
    onError: (error) => {
      setNotice({
        type: 'error',
        message: apiErrorMessage(error, 'Could not save the office profile. Please try again.'),
      })
    },
  })

  function pickImage(file: File | undefined, kind: 'logo' | 'cover') {
    if (!file) return

    const limit = kind === 'logo' ? LOGO_MAX_BYTES : COVER_MAX_BYTES
    if (file.size > limit) {
      setNotice({
        type: 'error',
        message: `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The ${
          kind === 'logo' ? 'logo may not be larger than 5 MB' : 'cover photo may not be larger than 10 MB'
        }.`,
      })
      return
    }

    const preview = previewUrl(file)
    setNotice(null)

    if (kind === 'logo') {
      releasePreview(logoPreview)
      setLogoFile(file)
      setLogoPreview(preview)
      setRemoveLogo(false)

      return
    }

    releasePreview(coverPreview)
    setCoverFile(file)
    setCoverPreview(preview)
    setRemoveCover(false)
  }

  function clearLogo() {
    releasePreview(logoPreview)
    setLogoFile(null)
    setLogoPreview(null)
    // Only ask the server to delete a file it actually stores.
    setRemoveLogo(Boolean(data?.logo_url))
    setNotice(null)
  }

  function clearCover() {
    releasePreview(coverPreview)
    setCoverFile(null)
    setCoverPreview(null)
    setRemoveCover(Boolean(data?.cover_url))
    setNotice(null)
  }

  if (isLoading) return <TableSkeleton rows={4} cols={1} />

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#17201A] lg:text-3xl">Office Profile</h1>
        <p className="mt-1 text-sm text-[#6B7280] lg:text-base">
          Set the Bansud Tourism Office logo, cover photo and contact details.
        </p>
      </div>

      <div
        data-testid="office-profile-save-bar"
        className="sticky top-0 z-20 -mx-2 mb-4 rounded-xl bg-[#F4F7F2]/95 px-2 py-2 backdrop-blur"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-[#17201A]">Bansud Tourism Office</h2>
          <div className="flex items-center gap-3">
            {hasUnsavedChanges && !mutation.isPending && (
              <span className="text-xs font-medium text-[#B45309]">Unsaved changes</span>
            )}
            <button
              type="button"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className={`inline-flex items-center gap-1.5 rounded-xl bg-[#16803C] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#126B32] disabled:cursor-not-allowed disabled:opacity-50 ${
                hasUnsavedChanges ? 'ring-2 ring-[#16803C]/30 ring-offset-1' : ''
              }`}
            >
              {mutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save changes
            </button>
          </div>
        </div>
        {notice && (
          <div className="mt-2">
            <Alert type={notice.type} message={notice.message} onDismiss={() => setNotice(null)} />
          </div>
        )}
      </div>

      <section
        aria-label="Office branding"
        className="overflow-hidden rounded-2xl border border-[#E2E8E3] bg-white shadow-tourism"
      >
        <div className="relative h-44 sm:h-56" data-testid="office-cover-preview">
          {coverSrc ? (
            <img
              src={coverSrc}
              alt="Bansud Tourism Office cover"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#087F3F] via-[#0A6B35] to-[#0B4F2A] px-6 text-center text-sm font-medium text-white/80">
              Add a cover photo for the office
            </div>
          )}

          <div className="absolute right-3 top-3 flex items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-white/95 px-3 py-1.5 text-xs font-semibold text-[#087F3F] shadow transition hover:bg-white">
              <ImagePlus className="h-3.5 w-3.5" />
              {coverSrc ? 'Change cover' : 'Add cover'}
              <input
                type="file"
                accept={IMAGE_ACCEPT}
                className="sr-only"
                data-testid="office-cover-input"
                onChange={(event) => {
                  pickImage(event.target.files?.[0], 'cover')
                  event.target.value = ''
                }}
              />
            </label>
            {coverSrc && (
              <button
                type="button"
                onClick={clearCover}
                className="inline-flex items-center gap-1 rounded-lg bg-white/95 px-3 py-1.5 text-xs font-semibold text-red-600 shadow transition hover:bg-white"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </button>
            )}
          </div>
        </div>

        <div className="px-5 pb-5">
          {/* relative + z-10: the cover block above is `relative`, so without an
              explicit stacking level it would paint over the overlapping logo. */}
          <div className="relative z-10 -mt-10 flex flex-wrap items-end gap-3">
            <div
              data-testid="office-logo-preview"
              className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl border-4 border-white bg-[#F3F8F4] shadow-lg"
            >
              {logoSrc ? (
                <img
                  src={logoSrc}
                  alt="Bansud Tourism Office logo"
                  className="h-full w-full object-cover"
                />
              ) : (
                <Building2 className="h-9 w-9 text-[#9CB5A4]" />
              )}
            </div>

            <div className="flex items-center gap-2 pb-1">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#C9DCCF] bg-[#F3F8F4] px-3 py-1.5 text-xs font-semibold text-[#087F3F] transition hover:border-[#16803C]/40 hover:bg-[#EAF6ED]">
                <ImagePlus className="h-3.5 w-3.5" />
                {logoSrc ? 'Change logo' : 'Add logo'}
                <input
                  type="file"
                  accept={IMAGE_ACCEPT}
                  className="sr-only"
                  data-testid="office-logo-input"
                  onChange={(event) => {
                    pickImage(event.target.files?.[0], 'logo')
                    event.target.value = ''
                  }}
                />
              </label>
              {logoSrc && (
                <button
                  type="button"
                  onClick={clearLogo}
                  className="inline-flex items-center gap-1 rounded-lg border border-red-100 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </button>
              )}
            </div>
          </div>

          <p className="mt-3 text-xs text-[#6B7280]">
            JPG, PNG or WebP — up to 5 MB for the logo and 10 MB for the cover photo. The logo also
            appears in the Admin sidebar.
          </p>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="mb-1.5 block text-sm font-medium text-[#17201A]">Office name</span>
              <input
                aria-label="Office name"
                value={form.name}
                maxLength={150}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                className="w-full rounded-xl border border-[#DDE5DF] px-3.5 py-2.5 text-sm text-[#17201A] outline-none transition focus:border-[#16803C] focus:ring-2 focus:ring-[#16803C]/20"
              />
            </label>

            <label className="sm:col-span-2">
              <span className="mb-1.5 block text-sm font-medium text-[#17201A]">
                About the office
              </span>
              <textarea
                aria-label="About the office"
                rows={4}
                maxLength={1000}
                value={form.about}
                onChange={(event) => setForm((current) => ({ ...current, about: event.target.value }))}
                placeholder="What the Bansud Tourism Office does for tourists and businesses."
                className="w-full resize-y rounded-xl border border-[#DDE5DF] px-3.5 py-2.5 text-sm text-[#17201A] outline-none transition focus:border-[#16803C] focus:ring-2 focus:ring-[#16803C]/20"
              />
            </label>

            <label>
              <span className="mb-1.5 block text-sm font-medium text-[#17201A]">Contact email</span>
              <input
                aria-label="Contact email"
                type="email"
                value={form.email}
                maxLength={255}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="tourism@bansud.gov.ph"
                className="w-full rounded-xl border border-[#DDE5DF] px-3.5 py-2.5 text-sm text-[#17201A] outline-none transition focus:border-[#16803C] focus:ring-2 focus:ring-[#16803C]/20"
              />
            </label>

            <label>
              <span className="mb-1.5 block text-sm font-medium text-[#17201A]">Contact number</span>
              <input
                aria-label="Contact number"
                value={form.phone}
                maxLength={30}
                onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                placeholder="0917 000 0000"
                className="w-full rounded-xl border border-[#DDE5DF] px-3.5 py-2.5 text-sm text-[#17201A] outline-none transition focus:border-[#16803C] focus:ring-2 focus:ring-[#16803C]/20"
              />
            </label>

            <label className="sm:col-span-2">
              <span className="mb-1.5 block text-sm font-medium text-[#17201A]">Office address</span>
              <input
                aria-label="Office address"
                value={form.address}
                maxLength={255}
                onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
                placeholder="Municipal Hall, Bansud, Oriental Mindoro"
                className="w-full rounded-xl border border-[#DDE5DF] px-3.5 py-2.5 text-sm text-[#17201A] outline-none transition focus:border-[#16803C] focus:ring-2 focus:ring-[#16803C]/20"
              />
            </label>
          </div>
        </div>
      </section>
    </div>
  )
}
