import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { usePersistFormRHF } from '@/shared/hooks/use-persist-form-rhf'
import { ApplicationLogo } from '@/shared/components/ApplicationLogo'
import { Alert } from '@/shared/components/Alert'
import { get } from '@/shared/services/api'
import { resolvePostAuthDestination } from '@/shared/services/pending-action'
import { ChevronLeft, ChevronRight, Eye, EyeOff } from 'lucide-react'

interface Municipality {
  id: number
  name: string
  slug: string
  barangays: { id: number; name: string }[]
}

const NATIONALITIES = [
  'Filipino', 'Afghan', 'Albanian', 'Algerian', 'American', 'Andorran', 'Angolan', 'Antiguans', 'Argentinean', 'Armenian',
  'Australian', 'Austrian', 'Azerbaijani', 'Bahamian', 'Bahraini', 'Bangladeshi', 'Barbadian', 'Barbudans', 'Batswana',
  'Belarusian', 'Belgian', 'Belizean', 'Beninese', 'Bhutanese', 'Bolivian', 'Bosnian', 'Brazilian', 'British', 'Bruneian',
  'Bulgarian', 'Burkinabe', 'Burmese', 'Burundian', 'Cambodian', 'Cameroonian', 'Canadian', 'Cape Verdean', 'Central African',
  'Chadian', 'Chilean', 'Chinese', 'Colombian', 'Comoran', 'Congolese', 'Costa Rican', 'Croatian', 'Cuban', 'Cypriot',
  'Czech', 'Danish', 'Djiboutian', 'Dominican', 'Dutch', 'East Timorese', 'Ecuadorian', 'Egyptian', 'Emirian', 'Equatorial Guinean',
  'Eritrean', 'Estonian', 'Ethiopian', 'Fijian', 'Finnish', 'French', 'Gabonese', 'Gambian', 'Georgian', 'German', 'Ghanaian',
  'Greek', 'Grenadian', 'Guatemalan', 'Guinea-Bissauan', 'Guinean', 'Guyanese', 'Haitian', 'Herzegovinian', 'Honduran',
  'Hungarian', 'I-Kiribati', 'Icelander', 'Indian', 'Indonesian', 'Iranian', 'Iraqi', 'Irish', 'Israeli', 'Italian',
  'Ivorian', 'Jamaican', 'Japanese', 'Jordanian', 'Kazakhstani', 'Kenyan', 'Kittian and Nevisian', 'Kuwaiti', 'Kyrgyz',
  'Laotian', 'Latvian', 'Lebanese', 'Liberian', 'Libyan', 'Liechtensteiner', 'Lithuanian', 'Luxembourger', 'Macedonian',
  'Malagasy', 'Malawian', 'Malaysian', 'Maldivian', 'Malian', 'Maltese', 'Marshallese', 'Mauritanian', 'Mauritian',
  'Mexican', 'Micronesian', 'Moldovan', 'Monacan', 'Mongolian', 'Moroccan', 'Mosotho', 'Motswana', 'Mozambican', 'Namibian',
  'Nauruan', 'Nepalese', 'New Zealander', 'Nicaraguan', 'Nigerian', 'Nigerien', 'North Korean', 'Northern Irish', 'Norwegian',
  'Omani', 'Pakistani', 'Palauan', 'Panamanian', 'Papua New Guinean', 'Paraguayan', 'Peruvian', 'Polish', 'Portuguese',
  'Qatari', 'Romanian', 'Russian', 'Rwandan', 'Saint Lucian', 'Salvadoran', 'Samoan', 'San Marinese', 'Sao Tomean', 'Saudi',
  'Scottish', 'Senegalese', 'Serbian', 'Seychellois', 'Sierra Leonean', 'Singaporean', 'Slovakian', 'Slovenian', 'Solomon Islander',
  'Somali', 'South African', 'South Korean', 'Spanish', 'Sri Lankan', 'Sudanese', 'Surinamer', 'Swazi', 'Swedish', 'Swiss',
  'Syrian', 'Taiwanese', 'Tajik', 'Tanzanian', 'Thai', 'Togolese', 'Tongan', 'Trinidadian or Tobagonian', 'Tunisian', 'Turkish',
  'Tuvaluan', 'Ugandan', 'Ukrainian', 'Uruguayan', 'Uzbekistani', 'Venezuelan', 'Vietnamese', 'Welsh', 'Yemenite', 'Zambian',
  'Zimbabwean',
]

const passwordRule = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[a-z]/, 'Must include a lowercase letter')
  .regex(/[A-Z]/, 'Must include an uppercase letter')
  .regex(/[0-9]/, 'Must include a number')
  .regex(/[^A-Za-z0-9]/, 'Must include a symbol')

const touristSchema = z.object({
  role: z.literal('tourist'),
  first_name: z.string().min(1, 'First name is required'),
  middle_name: z.string().optional(),
  last_name: z.string().min(1, 'Last name is required'),
  date_of_birth: z.string().min(1, 'Birthdate is required'),
  email: z.string().email('Please enter a valid email'),
  mobile_number: z.string().min(10, 'Phone number is required'),
  password: passwordRule,
  password_confirmation: z.string(),
}).refine((d) => d.password === d.password_confirmation, {
  message: 'Passwords do not match',
  path: ['password_confirmation'],
})

const businessOwnerSchema = z.object({
  role: z.literal('business_owner'),
  step: z.number(),
  first_name: z.string().min(1, 'First name is required'),
  middle_name: z.string().optional(),
  last_name: z.string().min(1, 'Last name is required'),
  date_of_birth: z.string().min(1, 'Birthdate is required'),
  sex: z.string().min(1, 'Sex is required'),
  nationality: z.string().min(1, 'Nationality is required'),
  email: z.string().email('Please enter a valid email'),
  mobile_number: z.string().min(10, 'Contact number is required'),
  municipality_id: z.coerce.number().min(1, 'Municipality is required'),
  barangay: z.string().min(1, 'Barangay is required'),
  house_no_street: z.string().min(5, 'Complete address is required'),
  government_id_type: z.string().min(1, 'ID type is required'),
  government_id_number: z.string().min(1, 'ID number is required'),
  password: passwordRule,
  password_confirmation: z.string(),
}).refine((d) => d.password === d.password_confirmation, {
  message: 'Passwords do not match',
  path: ['password_confirmation'],
})

const riderSchema = z.object({
  role: z.literal('rider'),
  step: z.number(),
  name: z.string().min(2, 'Name is required'),
  email: z.string().email('Please enter a valid email'),
  mobile_number: z.string().min(10, 'Phone number is required'),
  municipality_id: z.coerce.number().min(1, 'Municipality is required'),
  barangay: z.string().min(1, 'Barangay is required'),
  house_no_street: z.string().min(5, 'Address is required'),
  vehicle_type: z.string().min(1, 'Vehicle type is required'),
  plate_number: z.string().min(1, 'Plate number is required'),
  license_number: z.string().min(1, 'License number is required'),
  password: passwordRule,
  password_confirmation: z.string(),
}).refine((d) => d.password === d.password_confirmation, {
  message: 'Passwords do not match',
  path: ['password_confirmation'],
})

type TouristForm = z.infer<typeof touristSchema>
type BusinessOwnerForm = z.infer<typeof businessOwnerSchema>
type RiderForm = z.infer<typeof riderSchema>
type FormData = TouristForm | BusinessOwnerForm | RiderForm

export default function RegisterPage() {
  const [searchParams] = useSearchParams()
  const role = (searchParams.get('role') as 'tourist' | 'business_owner' | 'rider') || 'tourist'
  const [step, setStep] = useState(1)
  const [error, setError] = useState('')
  const [municipalities, setMunicipalities] = useState<Municipality[]>([])
  const [showPassword, setShowPassword] = useState(false)
  const [idFront, setIdFront] = useState<File | null>(null)
  const [idBack, setIdBack] = useState<File | null>(null)
  const [selfie, setSelfie] = useState<File | null>(null)
  const [idFrontPreview, setIdFrontPreview] = useState<string>('')
  const [idBackPreview, setIdBackPreview] = useState<string>('')
  const [selfiePreview, setSelfiePreview] = useState<string>('')
  const { register: registerUser } = useAuthStore()
  const navigate = useNavigate()

  const form = useForm<FormData>({
    resolver: zodResolver(
      (role === 'tourist' ? touristSchema : role === 'rider' ? riderSchema : businessOwnerSchema) as any
    ),
    defaultValues: {
      role,
      step: 1,
      email: '',
      password: '',
      password_confirmation: '',
      ...(role === 'tourist'
        ? { first_name: '', middle_name: '', last_name: '', date_of_birth: '', mobile_number: '' }
        : { mobile_number: '', house_no_street: '' }),
      ...(role === 'business_owner'
        ? {
            first_name: '',
            middle_name: '',
            last_name: '',
            date_of_birth: '',
            sex: '',
            nationality: '',
            municipality_id: 0,
            barangay: '',
            government_id_type: '',
            government_id_number: '',
          }
        : {}),
      ...(role === 'rider'
        ? { municipality_id: 0, barangay: '', house_no_street: '', vehicle_type: '', plate_number: '', license_number: '' }
        : {}),
    } as FormData,
  })

  const { clearDraft } = usePersistFormRHF({
    draftKey: `register-${role}`,
    formId: 'register',
    form,
    onRestored: useCallback(() => {
      const savedStep = form.getValues('step' as never) as number
      if (savedStep && savedStep > 1) setStep(savedStep)
    }, [form]),
  })

  const selectedMunicipality = municipalities.find(
    (m) => m.id === Number(form.watch('municipality_id' as never))
  )

  const watchedBarangay = form.watch('barangay' as never)
  const watchedMunicipalityId = form.watch('municipality_id' as never)
  const addressPrefix = (() => {
    const brgy = selectedMunicipality?.barangays.find((b) => b.name === watchedBarangay)
    const muni = selectedMunicipality
    if (brgy && muni) return `${brgy.name}, ${muni.name}, Oriental Mindoro, `
    if (muni) return `${muni.name}, Oriental Mindoro, `
    return ''
  })()

  const riderAddressPrefix = role === 'rider' ? addressPrefix : ''

  useEffect(() => {
    if (role !== 'tourist') {
      get<Municipality[]>('/municipalities')
        .then(setMunicipalities)
        .catch(() => {})
    }
  }, [role])

  useEffect(() => {
    if (addressPrefix && role === 'business_owner') {
      const current = form.getValues('house_no_street' as never) as string
      if (!current || current.endsWith(', ') === false || current === addressPrefix.slice(0, -2)) {
        form.setValue('house_no_street' as never, addressPrefix as never)
      }
    }
  }, [watchedBarangay, role])

  const totalSteps = role === 'tourist' ? 1 : role === 'business_owner' ? 5 : 6
  const inputClasses =
    'tourism-input w-full px-4 py-3 text-sm'
  const labelClasses = 'block text-sm font-medium text-[#17201A] mb-1'

  const onSubmit = async (data: FormData) => {
    setError('')
    try {
      const submitData = { ...data }
      if (submitData.role === 'business_owner' && addressPrefix) {
        const addr = submitData.house_no_street as string
        if (addr && !addr.startsWith(addressPrefix)) {
          submitData.house_no_street = addressPrefix + addr
        }
      }
      if (submitData.role === 'rider' && riderAddressPrefix) {
        const addr = submitData.house_no_street as string
        if (addr && !addr.startsWith(riderAddressPrefix)) {
          submitData.house_no_street = riderAddressPrefix + addr
        }
      }

      const fd = new FormData()
      Object.entries(submitData).forEach(([key, val]) => {
        if (val !== undefined && val !== null && val !== '') {
          fd.append(key, String(val))
        }
      })
      if (idFront) fd.append('valid_id_front', idFront)
      if (idBack) fd.append('valid_id_back', idBack)
      if (selfie) fd.append('selfie_holding_id', selfie)

      const user = await registerUser(fd as unknown as Record<string, unknown>)
      clearDraft()
      navigate(resolvePostAuthDestination(user.role))
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string; errors?: Record<string, string[]> } } }
      if (axiosErr.response?.data?.errors) {
        const firstError = Object.values(axiosErr.response.data.errors)[0]
        setError(firstError?.[0] || 'Registration failed')
      } else {
        setError(axiosErr.response?.data?.message || 'Registration failed')
      }
    }
  }

  const renderStep = () => {
    if (role === 'tourist') {
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClasses}>First Name</label>
              <input {...form.register('first_name')} className={inputClasses} placeholder="Juan" />
            </div>
            <div>
              <label className={labelClasses}>Middle Name</label>
              <input {...form.register('middle_name')} className={inputClasses} placeholder="Optional" />
            </div>
          </div>
          <div>
            <label className={labelClasses}>Last Name</label>
            <input {...form.register('last_name')} className={inputClasses} placeholder="Dela Cruz" />
          </div>
          <div>
            <label className={labelClasses}>Birthdate</label>
            <input {...form.register('date_of_birth')} type="date" className={inputClasses} />
          </div>
          <div>
            <label className={labelClasses}>Email Address</label>
            <input {...form.register('email')} type="email" className={inputClasses} placeholder="you@example.com" />
          </div>
          <div>
            <label className={labelClasses}>Phone Number</label>
            <input {...form.register('mobile_number')} className={inputClasses} placeholder="09XXXXXXXXX" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClasses}>Password</label>
              <input
                {...form.register('password')}
                type={showPassword ? 'text' : 'password'}
                className={inputClasses}
                placeholder="••••••••"
              />
            </div>
            <div>
              <label className={labelClasses}>Confirm</label>
              <div className="relative">
                <input
                  {...form.register('password_confirmation')}
                  type={showPassword ? 'text' : 'password'}
                  className={inputClasses}
                  placeholder="••••••••"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B7280]">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
          <p className="text-xs text-[#9CA3AF]">Min 8 characters with uppercase, lowercase, number, and symbol.</p>
        </div>
      )
    }

    if (role === 'business_owner') {
      switch (step) {
        case 1:
          return (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-[#6B7280] uppercase tracking-wide">Personal Information</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClasses}>First Name</label>
                  <input {...form.register('first_name')} className={inputClasses} placeholder="Juan" />
                </div>
                <div>
                  <label className={labelClasses}>Middle Name</label>
                  <input {...form.register('middle_name')} className={inputClasses} placeholder="Optional" />
                </div>
              </div>
              <div>
                <label className={labelClasses}>Last Name</label>
                <input {...form.register('last_name')} className={inputClasses} placeholder="Dela Cruz" />
              </div>
              <div>
                <label className={labelClasses}>Date of Birth</label>
                <input {...form.register('date_of_birth')} type="date" className={inputClasses} />
              </div>
              <div>
                <label className={labelClasses}>Sex</label>
                <select {...form.register('sex')} className={inputClasses}>
                  <option value="">Select sex</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>
              <div>
                <label className={labelClasses}>Nationality</label>
                <select {...form.register('nationality')} className={inputClasses}>
                  <option value="">Select nationality</option>
                  {NATIONALITIES.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClasses}>Email Address</label>
                <input {...form.register('email')} type="email" className={inputClasses} placeholder="you@gmail.com" />
              </div>
              <div>
                <label className={labelClasses}>Contact Number</label>
                <input {...form.register('mobile_number')} className={inputClasses} placeholder="09XXXXXXXXX" />
              </div>
            </div>
          )
        case 2:
          return (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-[#6B7280] uppercase tracking-wide">Address</h3>
              <div>
                <label className={labelClasses}>Municipality</label>
                <select {...form.register('municipality_id')} className={inputClasses}>
                  <option value="">Select municipality</option>
                  {municipalities.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClasses}>Barangay</label>
                <select {...form.register('barangay')} className={inputClasses} disabled={!selectedMunicipality}>
                  <option value="">Select barangay</option>
                  {selectedMunicipality?.barangays.map((b) => (
                    <option key={b.id} value={b.name}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClasses}>Complete Address</label>
                <input {...form.register('house_no_street')} className={inputClasses} placeholder="Street, Sitio, etc." />
                {addressPrefix && (
                  <p className="text-xs text-[#16803C] mt-1">Auto-filled: {addressPrefix}<span className="text-[#6B7280]">type your street/sitio...</span></p>
                )}
              </div>
            </div>
          )
        case 3:
          return (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-[#6B7280] uppercase tracking-wide">Government Issued ID</h3>
              <div>
                <label className={labelClasses}>ID Type</label>
                <select {...form.register('government_id_type')} className={inputClasses}>
                  <option value="">Select ID type</option>
                  <option value="passport">Passport</option>
                  <option value="drivers_license">Driver&apos;s License</option>
                  <option value="national_id">National ID</option>
                  <option value="sss">SSS ID</option>
                  <option value="philhealth">PhilHealth ID</option>
                  <option value="postal_id">Postal ID</option>
                  <option value="voters_id">Voter&apos;s ID</option>
                </select>
              </div>
              <div>
                <label className={labelClasses}>ID Number</label>
                <input {...form.register('government_id_number')} className={inputClasses} placeholder="Enter ID number" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClasses}>ID Front Photo</label>
                  <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-[#D7E8DB] rounded-xl cursor-pointer hover:border-[#16803C] transition-colors overflow-hidden">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null
                        setIdFront(file)
                        if (file) {
                          setIdFrontPreview(URL.createObjectURL(file))
                        } else {
                          setIdFrontPreview('')
                        }
                      }}
                    />
                    {idFrontPreview ? (
                      <img src={idFrontPreview} alt="ID Front" className="w-full h-full object-cover" />
                    ) : idFront ? (
                      <div className="text-center px-2">
                        <p className="text-xs text-[#16803C] truncate max-w-[120px]">{idFront.name}</p>
                        <p className="text-xs text-[#6B7280] mt-1">Click to change</p>
                      </div>
                    ) : (
                      <div className="text-center">
                        <p className="text-sm text-[#6B7280]">Click to upload</p>
                        <p className="text-xs text-[#6B7280]/70 mt-1">JPG, PNG, WebP</p>
                      </div>
                    )}
                  </label>
                </div>
                <div>
                  <label className={labelClasses}>ID Back Photo</label>
                  <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-[#D7E8DB] rounded-xl cursor-pointer hover:border-[#16803C] transition-colors overflow-hidden">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null
                        setIdBack(file)
                        if (file) {
                          setIdBackPreview(URL.createObjectURL(file))
                        } else {
                          setIdBackPreview('')
                        }
                      }}
                    />
                    {idBackPreview ? (
                      <img src={idBackPreview} alt="ID Back" className="w-full h-full object-cover" />
                    ) : idBack ? (
                      <div className="text-center px-2">
                        <p className="text-xs text-[#16803C] truncate max-w-[120px]">{idBack.name}</p>
                        <p className="text-xs text-[#6B7280] mt-1">Click to change</p>
                      </div>
                    ) : (
                      <div className="text-center">
                        <p className="text-sm text-[#6B7280]">Click to upload</p>
                        <p className="text-xs text-[#6B7280]/70 mt-1">JPG, PNG, WebP</p>
                      </div>
                    )}
                  </label>
                </div>
              </div>
              <div>
                <label className={labelClasses}>Selfie Holding ID</label>
                <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-[#D7E8DB] rounded-xl cursor-pointer hover:border-[#16803C] transition-colors overflow-hidden">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null
                      setSelfie(file)
                      if (file) {
                        setSelfiePreview(URL.createObjectURL(file))
                      } else {
                        setSelfiePreview('')
                      }
                    }}
                  />
                  {selfiePreview ? (
                    <img src={selfiePreview} alt="Selfie" className="w-full h-full object-cover" />
                  ) : selfie ? (
                    <div className="text-center px-2">
                      <p className="text-xs text-[#16803C] truncate max-w-[120px]">{selfie.name}</p>
                      <p className="text-xs text-[#6B7280] mt-1">Click to change</p>
                    </div>
                  ) : (
                    <div className="text-center">
                      <p className="text-sm text-[#6B7280]">Click to upload</p>
                      <p className="text-xs text-[#6B7280]/70 mt-1">JPG, PNG, WebP (max 5MB)</p>
                    </div>
                  )}
                </label>
              </div>
            </div>
          )
        case 4:
          return (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-[#6B7280] uppercase tracking-wide">Create Password</h3>
              <div>
                <label className={labelClasses}>Password</label>
                <div className="relative">
                  <input
                    {...form.register('password')}
                    type={showPassword ? 'text' : 'password'}
                    className={inputClasses}
                    placeholder="Min 8 characters"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B7280]">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className={labelClasses}>Confirm Password</label>
                <input
                  {...form.register('password_confirmation')}
                  type={showPassword ? 'text' : 'password'}
                  className={inputClasses}
                  placeholder="••••••••"
                />
              </div>
            </div>
          )
        case 5:
          return (
            <div className="space-y-4 text-sm text-[#17201A]">
              <h3 className="text-lg font-semibold text-[#17201A]">Review & Submit</h3>
              <div className="space-y-2 bg-white/60 backdrop-blur-sm border border-white/40 rounded-xl p-4">
                <div className="flex justify-between"><span className="text-[#6B7280]">Name</span><span>{form.watch('first_name')} {form.watch('middle_name')} {form.watch('last_name')}</span></div>
                <div className="flex justify-between"><span className="text-[#6B7280]">Birthdate</span><span>{form.watch('date_of_birth')}</span></div>
                <div className="flex justify-between"><span className="text-[#6B7280]">Sex</span><span>{form.watch('sex')}</span></div>
                <div className="flex justify-between"><span className="text-[#6B7280]">Nationality</span><span>{form.watch('nationality')}</span></div>
                <div className="flex justify-between"><span className="text-[#6B7280]">Email</span><span>{form.watch('email')}</span></div>
                <div className="flex justify-between"><span className="text-[#6B7280]">Phone</span><span>{form.watch('mobile_number')}</span></div>
                <div className="flex justify-between"><span className="text-[#6B7280]">ID Type</span><span>{form.watch('government_id_type')}</span></div>
                <div className="flex justify-between"><span className="text-[#6B7280]">ID Number</span><span>{form.watch('government_id_number')}</span></div>
                <div className="flex justify-between"><span className="text-[#6B7280]">ID Front</span><span className="text-[#16803C]">{idFront ? idFront.name : 'Not uploaded'}</span></div>
                <div className="flex justify-between"><span className="text-[#6B7280]">ID Back</span><span className="text-[#16803C]">{idBack ? idBack.name : 'Not uploaded'}</span></div>
                <div className="flex justify-between"><span className="text-[#6B7280]">Selfie</span><span className="text-[#16803C]">{selfie ? selfie.name : 'Not uploaded'}</span></div>
              </div>
              <div className="bg-emerald-50/80 backdrop-blur-sm border border-emerald-200 rounded-xl p-4">
                <p className="text-emerald-800 font-medium">What Happens Next?</p>
                <ul className="mt-2 space-y-1 text-emerald-700/80 text-sm">
                  <li>• Your account will be reviewed by the tourism office</li>
                  <li>• You&apos;ll receive an email once approved</li>
                  <li>• Then you can create your business from the dashboard</li>
                </ul>
              </div>
            </div>
          )
        default:
          return null
      }
    }

    // Rider
    switch (step) {
      case 1:
        return (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-[#6B7280] uppercase tracking-wide">Personal Information</h3>
            <div>
              <label className={labelClasses}>Full Name</label>
              <input {...form.register('name')} className={inputClasses} placeholder="Juan Dela Cruz" />
            </div>
            <div>
              <label className={labelClasses}>Email Address</label>
              <input {...form.register('email')} type="email" className={inputClasses} placeholder="you@example.com" />
            </div>
            <div>
              <label className={labelClasses}>Phone Number</label>
              <input {...form.register('mobile_number')} className={inputClasses} placeholder="09XXXXXXXXX" />
            </div>
          </div>
        )
      case 2:
        return (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-[#6B7280] uppercase tracking-wide">Address</h3>
            <div>
              <label className={labelClasses}>Municipality</label>
              <select {...form.register('municipality_id')} className={inputClasses}>
                <option value="">Select municipality</option>
                {municipalities.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClasses}>Barangay</label>
              <select {...form.register('barangay')} className={inputClasses} disabled={!selectedMunicipality}>
                <option value="">Select barangay</option>
                {selectedMunicipality?.barangays.map((b) => (
                  <option key={b.id} value={b.name}>{b.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClasses}>Complete Address</label>
              <input {...form.register('house_no_street')} className={inputClasses} placeholder="Street, Sitio, etc." />
              {riderAddressPrefix && (
                <p className="text-xs text-[#16803C] mt-1">Auto-filled: {riderAddressPrefix}<span className="text-[#6B7280]">type your street/sitio...</span></p>
              )}
            </div>
          </div>
        )
      case 3:
        return (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-[#6B7280] uppercase tracking-wide">Vehicle Information</h3>
            <div>
              <label className={labelClasses}>Vehicle Type</label>
              <select {...form.register('vehicle_type')} className={inputClasses}>
                <option value="">Select vehicle</option>
                <option value="motorcycle">Motorcycle</option>
                <option value="bicycle">Bicycle</option>
                <option value="tricycle">Tricycle</option>
                <option value="car">Car</option>
              </select>
            </div>
            <div>
              <label className={labelClasses}>Plate Number</label>
              <input {...form.register('plate_number')} className={inputClasses} placeholder="e.g. ABC 1234" />
            </div>
            <div>
              <label className={labelClasses}>Driver&apos;s License Number</label>
              <input {...form.register('license_number')} className={inputClasses} placeholder="License number" />
            </div>
          </div>
        )
      case 4:
        return (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-[#6B7280] uppercase tracking-wide">Verification Documents</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClasses}>Valid Government ID (Front)</label>
                <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-[#D7E8DB] rounded-xl cursor-pointer hover:border-[#16803C] transition-colors overflow-hidden">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null
                      setIdFront(file)
                      if (file) setIdFrontPreview(URL.createObjectURL(file))
                      else setIdFrontPreview('')
                    }}
                  />
                  {idFrontPreview ? (
                    <img src={idFrontPreview} alt="ID Front" className="w-full h-full object-cover" />
                  ) : idFront ? (
                    <div className="text-center px-2">
                      <p className="text-xs text-[#16803C] truncate max-w-[120px]">{idFront.name}</p>
                      <p className="text-xs text-[#6B7280] mt-1">Click to change</p>
                    </div>
                  ) : (
                    <div className="text-center">
                      <p className="text-sm text-[#6B7280]">Click to upload</p>
                      <p className="text-xs text-[#6B7280]/70 mt-1">JPG, PNG, WebP</p>
                    </div>
                  )}
                </label>
              </div>
              <div>
                <label className={labelClasses}>Valid Government ID (Back)</label>
                <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-[#D7E8DB] rounded-xl cursor-pointer hover:border-[#16803C] transition-colors overflow-hidden">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null
                      setIdBack(file)
                      if (file) setIdBackPreview(URL.createObjectURL(file))
                      else setIdBackPreview('')
                    }}
                  />
                  {idBackPreview ? (
                    <img src={idBackPreview} alt="ID Back" className="w-full h-full object-cover" />
                  ) : idBack ? (
                    <div className="text-center px-2">
                      <p className="text-xs text-[#16803C] truncate max-w-[120px]">{idBack.name}</p>
                      <p className="text-xs text-[#6B7280] mt-1">Click to change</p>
                    </div>
                  ) : (
                    <div className="text-center">
                      <p className="text-sm text-[#6B7280]">Click to upload</p>
                      <p className="text-xs text-[#6B7280]/70 mt-1">JPG, PNG, WebP</p>
                    </div>
                  )}
                </label>
              </div>
            </div>
            <div>
              <label className={labelClasses}>Selfie Holding ID</label>
              <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-[#D7E8DB] rounded-xl cursor-pointer hover:border-[#16803C] transition-colors overflow-hidden">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null
                    setSelfie(file)
                    if (file) setSelfiePreview(URL.createObjectURL(file))
                    else setSelfiePreview('')
                  }}
                />
                {selfiePreview ? (
                  <img src={selfiePreview} alt="Selfie" className="w-full h-full object-cover" />
                ) : selfie ? (
                  <div className="text-center px-2">
                    <p className="text-xs text-[#16803C] truncate max-w-[120px]">{selfie.name}</p>
                    <p className="text-xs text-[#6B7280] mt-1">Click to change</p>
                  </div>
                ) : (
                  <div className="text-center">
                    <p className="text-sm text-[#6B7280]">Click to upload</p>
                    <p className="text-xs text-[#6B7280]/70 mt-1">JPG, PNG, WebP (max 5MB)</p>
                  </div>
                )}
              </label>
            </div>
          </div>
        )
      case 5:
        return (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-[#6B7280] uppercase tracking-wide">Create Password</h3>
            <div>
              <label className={labelClasses}>Password</label>
              <div className="relative">
                <input
                  {...form.register('password')}
                  type={showPassword ? 'text' : 'password'}
                  className={inputClasses}
                  placeholder="Min 8 characters"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B7280]">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className={labelClasses}>Confirm Password</label>
              <input
                {...form.register('password_confirmation')}
                type={showPassword ? 'text' : 'password'}
                className={inputClasses}
                placeholder="••••••••"
              />
            </div>
            <p className="text-xs text-[#9CA3AF]">Min 8 characters with uppercase, lowercase, number, and symbol.</p>
          </div>
        )
      case 6:
        return (
          <div className="space-y-4 text-sm text-[#17201A]">
            <h3 className="text-lg font-semibold text-[#17201A]">Review & Submit</h3>
            <div className="space-y-2 bg-white/60 backdrop-blur-sm border border-white/40 rounded-xl p-4">
              <div className="flex justify-between"><span className="text-[#6B7280]">Name</span><span>{form.watch('name')}</span></div>
              <div className="flex justify-between"><span className="text-[#6B7280]">Email</span><span>{form.watch('email')}</span></div>
              <div className="flex justify-between"><span className="text-[#6B7280]">Phone</span><span>{form.watch('mobile_number')}</span></div>
              <div className="flex justify-between"><span className="text-[#6B7280]">Vehicle</span><span>{form.watch('vehicle_type')}</span></div>
              <div className="flex justify-between"><span className="text-[#6B7280]">Plate Number</span><span>{form.watch('plate_number')}</span></div>
              <div className="flex justify-between"><span className="text-[#6B7280]">License</span><span>{form.watch('license_number')}</span></div>
              <div className="flex justify-between"><span className="text-[#6B7280]">ID Front</span><span className="text-[#16803C]">{idFront ? idFront.name : 'Not uploaded'}</span></div>
              <div className="flex justify-between"><span className="text-[#6B7280]">ID Back</span><span className="text-[#16803C]">{idBack ? idBack.name : 'Not uploaded'}</span></div>
              <div className="flex justify-between"><span className="text-[#6B7280]">Selfie</span><span className="text-[#16803C]">{selfie ? selfie.name : 'Not uploaded'}</span></div>
            </div>
            <div className="bg-[#FFF7D6] border border-[#F59E0B]/20 rounded-xl p-4">
              <p className="text-[#D97706] font-medium">What Happens Next?</p>
              <ul className="mt-2 space-y-1 text-[#92400E] text-sm">
                <li>• Your account will be reviewed by the admin</li>
                <li>• You&apos;ll receive an email once approved</li>
                <li>• Then you can start accepting deliveries</li>
              </ul>
            </div>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="min-h-screen tourism-bg tourism-bg-orbs flex flex-col items-center justify-center px-6 py-12">
      <div className="mb-6">
        <Link to="/">
          <ApplicationLogo className="w-30 h-30" />
        </Link>
      </div>

      <div className="w-full max-w-md px-6 py-8 tourism-card rounded-2xl">
        <h1 className="text-2xl font-bold text-center text-[#126B32] mb-1">
          {role === 'tourist' ? 'Create Account' : role === 'business_owner' ? 'Business Registration' : 'Rider Registration'}
        </h1>
        <p className="text-center text-sm text-[#6B7280] mb-6">
          {role === 'tourist'
            ? 'Start exploring Oriental Mindoro'
            : `Step ${step} of ${totalSteps}`}
        </p>

        {error && <Alert type="error" message={error} onDismiss={() => setError('')} />}

        <form onSubmit={form.handleSubmit(onSubmit)}>
          {renderStep()}

          {role !== 'tourist' && (
            <div className="flex justify-between mt-6">
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(1, s - 1))}
                disabled={step === 1}
                className="flex items-center gap-1 px-4 py-2 text-sm text-[#6B7280] hover:text-[#17201A] disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
              {step < totalSteps ? (
                <button
                  type="button"
                  onClick={() => setStep((s) => Math.min(totalSteps, s + 1))}
                  className="btn-tourism flex items-center gap-1 px-6 py-2 text-sm font-medium"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={form.formState.isSubmitting}
                  className="btn-tourism px-6 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {form.formState.isSubmitting ? 'Creating...' : 'Create Account'}
                </button>
              )}
            </div>
          )}

          {role === 'tourist' && (
            <button
              type="submit"
              disabled={form.formState.isSubmitting}
              className="btn-tourism w-full mt-6 py-3 px-4 font-medium disabled:opacity-50"
            >
              {form.formState.isSubmitting ? 'Creating Account...' : 'Create Account'}
            </button>
          )}
        </form>
      </div>

      <p className="mt-6 text-sm text-[#6B7280]">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-[#16803C] hover:text-[#16803C]-dark">
          Sign In
        </Link>
      </p>
    </div>
  )
}
