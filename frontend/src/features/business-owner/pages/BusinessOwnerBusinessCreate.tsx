import { useState, useRef, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { post, get } from '@/shared/services/api'
import { getLocalDraft, saveLocalDraft, removeLocalDraft } from '@/shared/services/draft-storage'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { Alert } from '@/shared/components/Alert'
import { ArrowLeft, MapPin, Building2, ChevronLeft, ChevronRight, Check, Search, ScanLine } from 'lucide-react'
import { extractDocument } from '@/shared/services/document-ocr'
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const businessIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

interface Category { id: number; name: string; description?: string }
interface CategoryField { key: string; label: string; type: string; placeholder?: string; options?: string[] }
interface DocumentReq {
  id: number
  key: string
  label: string
  purpose: string
  required: boolean
  multiple?: boolean
  accept?: string
  has_expiration?: boolean
  is_expirable?: boolean
  validity_period?: string
  required_fields?: string[]
  grace_period_days?: number
}
interface Barangay { id: number; name: string }
interface Municipality { id: number; name: string; barangays: Barangay[]; latitude?: string; longitude?: string; province?: string }

const STORAGE_KEY = 'bo-business-create'

function saveToSession(data: Record<string, any>) {
  const existing = getLocalDraft(STORAGE_KEY)
  const merged = existing ? { ...existing.fields, ...data } : data
  saveLocalDraft(STORAGE_KEY, {
    version: 1,
    lastSaved: Date.now(),
    formId: STORAGE_KEY,
    fields: merged,
  })
}

function loadFromSession<T>(key: string, defaultVal: T): T {
  const draft = getLocalDraft(STORAGE_KEY)
  if (draft && draft.fields && draft.fields[key] !== undefined) {
    return draft.fields[key] as T
  }
  return defaultVal
}

const steps = [
  { num: 1, label: 'Category' },
  { num: 2, label: 'Info' },
  { num: 3, label: 'Location' },
  { num: 4, label: 'Details' },
  { num: 5, label: 'Documents' },
  { num: 6, label: 'Review' },
]

const defaultForm = {
  businessName: '',
  tagline: '',
  description: '',
  contactNumber: '',
  email: '',
  website: '',
  facebook: '',
  instagram: '',
  otherSocialMedia: '',
  municipalityId: '',
  barangayId: '',
  streetAddress: '',
  buildingNumber: '',
  postalCode: '',
  landmark: '',
  navigationInstructions: '',
  latitude: '',
  longitude: '',
  legalEntityType: '',
  tin: '',
  dtiSecRegNumber: '',
  yearEstablished: '',
  initialCapital: '',
  grossFloorArea: '',
  numberOfEmployees: '',
  occupancyStatus: '',
  operatingHours: {
    Monday: { open: '08:00', close: '20:00', closed: false },
    Tuesday: { open: '08:00', close: '20:00', closed: false },
    Wednesday: { open: '08:00', close: '20:00', closed: false },
    Thursday: { open: '08:00', close: '20:00', closed: false },
    Friday: { open: '08:00', close: '20:00', closed: false },
    Saturday: { open: '08:00', close: '20:00', closed: false },
    Sunday: { open: '08:00', close: '20:00', closed: true },
  },
}

export default function BusinessOwnerBusinessCreate() {
  const navigate = useNavigate()
  const [currentStep, setCurrentStep] = useState(() => loadFromSession('currentStep', 1))
  const totalSteps = 6

  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null)
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(() => loadFromSession('selectedCategoryId', null))
  const [form, setForm] = useState(() => ({ ...defaultForm, ...loadFromSession('form', {}) }))
  const [details, setDetails] = useState(() => loadFromSession('details', {} as Record<string, any>))
  const [documents, setDocuments] = useState<Record<string, File | File[]>>({})
  const [requiredDocs, setRequiredDocs] = useState<DocumentReq[]>([])
  const [documentInfo, setDocumentInfo] = useState(() => loadFromSession('documentInfo', {} as Record<string, { registeredName: string; issueDate: string; expirationDate: string; ownerRemarks: string }>))
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [coverPreview, setCoverPreview] = useState<string | null>(null)
  const [declarationAccepted, setDeclarationAccepted] = useState(() => loadFromSession('declarationAccepted', false))

  type DocStatus = 'UPLOADED' | 'PROCESSING' | 'EXTRACTED' | 'COMPLETED' | 'FAILED'
  interface DocProcessState {
    status: DocStatus
    extractedData: Record<string, string>
    uploadedAt: string
    errorMessage?: string
  }
  const [docProcess, setDocProcess] = useState<Record<string, DocProcessState>>({})

  const [ocrEnabled, setOcrEnabled] = useState<boolean>(true)

  useEffect(() => {
    get<{ ocr_enabled: boolean }>('/documents/ocr-status').then(r => {
      setOcrEnabled(r.ocr_enabled)
    }).catch(() => {})
  }, [])

  const EXTRACTION_LABELS: Record<string, Record<string, string>> = {
    business_permit: { permit_number: 'Permit Number', business_name: 'Business Name', owner_name: 'Owner Name', business_address: 'Business Address', business_type: 'Business Type', issue_date: 'Issued Date', expiry_date: 'Expiration Date', issuing_authority: 'Issuing Authority' },
    dti: { registration_number: 'Registration Number', business_name: 'Business Name', owner_name: 'Owner Name', business_scope: 'Business Scope', issue_date: 'Registration Date', expiry_date: 'Expiration Date', business_address: 'Business Address' },
    sec: { sec_registration_number: 'SEC Registration Number', company_name: 'Company Name', company_type: 'Company Type', authorized_representative: 'Authorized Representative', issue_date: 'Registration Date', principal_office_address: 'Principal Office Address' },
    bir_cor: { tin: 'TIN', registered_name: 'Registered Name', registered_address: 'Registered Address', line_of_business: 'Line of Business', issue_date: 'Registration Date' },
    owner_valid_id: { full_name: 'Full Name', id_type: 'ID Type', id_number: 'ID Number', date_of_birth: 'Date of Birth', address: 'Address', expiry_date: 'Expiration Date' },
    sanitary_permit: { business_name: 'Business Name', owner_name: 'Owner Name', document_number: 'Permit Number', issue_date: 'Issued Date', expiry_date: 'Expiration Date' },
    fsic: { business_name: 'Business Name', owner_name: 'Owner Name', document_number: 'Certificate Number', issue_date: 'Issued Date', expiry_date: 'Expiration Date' },
  }
  const [error, setError] = useState('')
  const [stepError, setStepError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')

  const [categoryFields, setCategoryFields] = useState<CategoryField[]>([])
  const [barangayList, setBarangayList] = useState<Barangay[]>([])
  const [entityDocs, setEntityDocs] = useState<DocumentReq[]>([])

  const logoInputRef = useRef<HTMLInputElement>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)

  const { data: meta, isLoading: metaLoading } = useQuery({
    queryKey: ['bo-business-create-meta'],
    queryFn: () => get<{ categories: Category[]; municipalities: Municipality[] }>('/business-owner/businesses/create'),
  })

  const municipalities = meta?.municipalities || []

  const selectedMunicipality = useMemo(() => {
    if (!form.municipalityId) return null
    return municipalities.find(m => m.id === Number(form.municipalityId)) || null
  }, [form.municipalityId, municipalities])

  const barangays = selectedMunicipality?.barangays || barangayList

  useEffect(() => {
    if (selectedCategoryId) {
      get<CategoryField[]>('/business-owner/businesses/category-fields/' + selectedCategoryId)
        .then(res => setCategoryFields(res || []))
        .catch(() => setCategoryFields([]))
    } else {
      setCategoryFields([])
    }
  }, [selectedCategoryId])

  const ENTITY_DOCUMENTS: Record<string, DocumentReq[]> = {
    'Sole Proprietorship': [
      { id: -1, key: 'dti_cert', label: 'DTI Business Name Registration Certificate', purpose: 'Proof of business name registration with DTI.', required: true, accept: '.pdf,.jpg,.jpeg,.png', has_expiration: false, is_expirable: false },
      { id: -2, key: 'bir_cor_sp', label: 'BIR Certificate of Registration (2303)', purpose: 'BIR registration for sole proprietorship.', required: true, accept: '.pdf,.jpg,.jpeg,.png', has_expiration: false, is_expirable: false },
    ],
    Partnership: [
      { id: -3, key: 'sec_partnership_cert', label: 'SEC Certificate of Partnership', purpose: 'Proof of partnership registration with SEC.', required: true, accept: '.pdf,.jpg,.jpeg,.png', has_expiration: false, is_expirable: false },
      { id: -4, key: 'articles_of_partnership', label: 'Articles of Partnership', purpose: 'The Articles of Partnership filed with SEC.', required: true, accept: '.pdf,.jpg,.jpeg,.png', has_expiration: false, is_expirable: false },
      { id: -5, key: 'bir_cor_partnership', label: 'BIR Certificate of Registration (2303)', purpose: 'BIR registration for partnership.', required: true, accept: '.pdf,.jpg,.jpeg,.png', has_expiration: false, is_expirable: false },
    ],
    Corporation: [
      { id: -6, key: 'sec_incorporation_cert', label: 'SEC Certificate of Incorporation', purpose: 'Proof of incorporation with SEC.', required: true, accept: '.pdf,.jpg,.jpeg,.png', has_expiration: false, is_expirable: false },
      { id: -7, key: 'articles_of_incorporation', label: 'Articles of Incorporation', purpose: 'The Articles of Incorporation filed with SEC.', required: true, accept: '.pdf,.jpg,.jpeg,.png', has_expiration: false, is_expirable: false },
      { id: -8, key: 'by_laws', label: 'Corporate By-Laws', purpose: 'The By-Laws of the corporation.', required: true, accept: '.pdf,.jpg,.jpeg,.png', has_expiration: false, is_expirable: false },
      { id: -9, key: 'gis', label: 'General Information Sheet (GIS)', purpose: 'Latest GIS filed with SEC.', required: true, accept: '.pdf,.jpg,.jpeg,.png', has_expiration: true, is_expirable: true, validity_period: '1 year' },
      { id: -10, key: 'bir_cor_corp', label: 'BIR Certificate of Registration (2303)', purpose: 'BIR registration for corporation.', required: true, accept: '.pdf,.jpg,.jpeg,.png', has_expiration: false, is_expirable: false },
    ],
    Cooperative: [
      { id: -11, key: 'cda_cert', label: 'CDA Registration Certificate', purpose: 'Certificate of registration with the Cooperative Development Authority.', required: true, accept: '.pdf,.jpg,.jpeg,.png', has_expiration: false, is_expirable: false },
      { id: -12, key: 'articles_of_cooperation', label: 'Articles of Cooperation', purpose: 'The Articles of Cooperation filed with CDA.', required: true, accept: '.pdf,.jpg,.jpeg,.png', has_expiration: false, is_expirable: false },
      { id: -13, key: 'coop_by_laws', label: 'Cooperative By-Laws', purpose: 'The By-Laws of the cooperative.', required: true, accept: '.pdf,.jpg,.jpeg,.png', has_expiration: false, is_expirable: false },
      { id: -14, key: 'bir_cor_coop', label: 'BIR Certificate of Registration (2303)', purpose: 'BIR registration for cooperative.', required: true, accept: '.pdf,.jpg,.jpeg,.png', has_expiration: false, is_expirable: false },
    ],
  }

  useEffect(() => {
    const type = form.legalEntityType
    setEntityDocs(type && ENTITY_DOCUMENTS[type] ? ENTITY_DOCUMENTS[type] : [])
  }, [form.legalEntityType])

  useEffect(() => {
    if (selectedCategoryId) {
      get<{ documents: DocumentReq[] }>('/business-owner/businesses/document-requirements?category_id=' + selectedCategoryId)
        .then(res => setRequiredDocs(res?.documents || []))
        .catch(() => setRequiredDocs([]))
    } else {
      setRequiredDocs([])
    }
  }, [selectedCategoryId])

  useEffect(() => {
    if (selectedCategoryId && meta?.categories) {
      const cat = meta.categories.find(c => c.id === selectedCategoryId)
      if (cat) setSelectedCategory(cat)
    }
  }, [selectedCategoryId, meta?.categories])

  useEffect(() => { saveToSession({ currentStep }) }, [currentStep])
  useEffect(() => { saveToSession({ selectedCategoryId }) }, [selectedCategoryId])
  useEffect(() => { saveToSession({ form }) }, [form])
  useEffect(() => { saveToSession({ details }) }, [details])
  useEffect(() => { saveToSession({ documentInfo }) }, [documentInfo])
  useEffect(() => { saveToSession({ declarationAccepted }) }, [declarationAccepted])

  const loadBarangays = (munId: string) => {
    if (!munId) { setBarangayList([]); return }
    get<Barangay[]>('/business-owner/businesses/barangays/' + munId)
      .then(res => setBarangayList(res || []))
      .catch(() => setBarangayList([]))
  }

  const allDocs = useMemo(() => {
    const seen = new Set<string>()
    return [...requiredDocs, ...entityDocs].filter(d => {
      if (seen.has(d.key)) return false
      seen.add(d.key)
      return true
    })
  }, [requiredDocs, entityDocs])

  const uploadedCount = allDocs.filter(d => documents[d.key]).length
  const uploadPercentage = allDocs.length > 0 ? Math.round((uploadedCount / allDocs.length) * 100) : 0

  const validateStep = () => {
    setStepError('')
    if (currentStep === 1 && !selectedCategoryId) { setStepError('Please select a business category.'); return false }
    if (currentStep === 2) {
      if (!form.businessName.trim()) { setStepError('Business name is required.'); return false }
      if (!form.description.trim()) { setStepError('Business description is required.'); return false }
      if (!form.contactNumber.trim()) { setStepError('Contact number is required.'); return false }
      if (!form.email.trim()) { setStepError('Business email is required.'); return false }
    }
    if (currentStep === 3) {
      if (!form.municipalityId) { setStepError('Please select a municipality.'); return false }
      if (!form.barangayId) { setStepError('Please select a barangay.'); return false }
      if (!form.streetAddress.trim()) { setStepError('Street address is required.'); return false }
      if (!form.latitude || !form.longitude) { setStepError('Please pin your location on the map.'); return false }
    }
    if (currentStep === 5) {
      if (!form.legalEntityType) { setStepError('Legal entity type is required.'); return false }
      if (!form.tin.trim()) { setStepError('TIN is required.'); return false }
      if (!form.yearEstablished) { setStepError('Year established is required.'); return false }

      const missing = allDocs.filter(d => d.required && !documents[d.key])
      if (missing.length > 0) { setStepError('Please upload: ' + missing.map(d => d.label).join(', ')); return false }
      const expired = allDocs.filter(d => docProcess[d.key]?.status === 'FAILED' && docProcess[d.key]?.errorMessage?.includes('expired'))
      if (expired.length > 0) { setStepError('The following documents are expired and cannot be accepted: ' + expired.map(d => d.label).join(', ') + '. Please upload current valid documents.'); return false }
    }
    if (currentStep === 6) {
      if (!declarationAccepted) { setStepError('Please accept the declaration.'); return false }
      const missingDocs = allDocs.filter(d => d.required && !documents[d.key])
      if (missingDocs.length > 0) { setStepError('Please upload all required documents: ' + missingDocs.map(d => d.label).join(', ')); return false }
      const expiredDocs = allDocs.filter(d => docProcess[d.key]?.status === 'FAILED' && docProcess[d.key]?.errorMessage?.includes('expired'))
      if (expiredDocs.length > 0) { setStepError('Cannot submit: ' + expiredDocs.map(d => d.label).join(', ') + ' expired. Please upload current valid documents.'); return false }
    }
    return true
  }

  const nextStep = () => {
    if (!validateStep()) return
    if (currentStep === 1 && selectedCategoryId === 7) {
      navigate('/business-owner/businesses/create/tourist-attraction')
      return
    }
    if (currentStep < totalSteps) setCurrentStep(c => c + 1)
    setStepError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const prevStep = () => {
    if (currentStep > 1) setCurrentStep(c => c - 1)
    setStepError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const goToStep = (s: number) => {
    if (s < currentStep) {
      setCurrentStep(s)
      setStepError('')
    }
  }

  const toggleDetailField = (key: string, value: string) => {
    setDetails(prev => {
      const arr = prev[key] || []
      const idx = arr.indexOf(value)
      return {
        ...prev,
        [key]: idx > -1 ? arr.filter((v: string) => v !== value) : [...arr, value],
      }
    })
  }

  const removeDoc = (docKey: string) => {
    setDocuments(prev => { const { [docKey]: _, ...rest } = prev; return rest })
    setDocProcess(prev => { const { [docKey]: _, ...rest } = prev; return rest })
    setDocumentInfo(prev => { const { [docKey]: _, ...rest } = prev; return rest })
  }

  const tryParseDate = (dateStr: string): string | null => {
    const trimmed = dateStr.trim()
    const d = new Date(trimmed)
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0] ?? null
    }
    const parts = trimmed.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
    if (parts) {
      const [, m, day, y] = parts
      if (m && day && y) return `${y}-${m.padStart(2, '0')}-${day.padStart(2, '0')}`
    }
    return null
  }

  const docKeyToType = (docKey: string): string | undefined => {
    const map: Record<string, string> = {
      dti_cert: 'dti', bir_cor_sp: 'bir_cor', bir_cor_partnership: 'bir_cor', bir_cor_corp: 'bir_cor', bir_cor_coop: 'bir_cor',
      sec_partnership_cert: 'sec', sec_incorporation_cert: 'sec',
      business_permit: 'business_permit', owner_valid_id: 'owner_valid_id', sanitary_permit: 'sanitary_permit', fsic: 'fsic',
    }
    return map[docKey]
  }

  const autoOcrDoc = async (docKey: string, fileOverride?: File) => {
    const file = fileOverride || documents[docKey]
    if (!file || Array.isArray(file)) return
    const docType = docKeyToType(docKey)
    setDocProcess(prev => ({ ...prev, [docKey]: { status: 'PROCESSING', extractedData: {}, uploadedAt: new Date().toISOString() } }))
    try {
      const result = await extractDocument(file as File, docType)
      const extracted: Record<string, string> = {}
      for (const [key, val] of Object.entries(result.fields)) {
        if (val && typeof val === 'string') {
          if (key === 'issue_date' || key === 'expiry_date') {
            const parsed = tryParseDate(val)
            extracted[key] = parsed || val
          } else {
            extracted[key] = val
          }
        }
      }
      if (extracted.expiry_date) {
        const expiryDate = new Date(extracted.expiry_date)
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        if (expiryDate < today) {
          setDocProcess(prev => ({ ...prev, [docKey]: { status: 'FAILED', extractedData: extracted, uploadedAt: prev[docKey]?.uploadedAt || new Date().toISOString(), errorMessage: `This document expired on ${extracted.expiry_date}. Please upload a current valid document.` } }))
          return
        }
      }
      setDocProcess(prev => ({ ...prev, [docKey]: { status: 'COMPLETED', extractedData: extracted, uploadedAt: prev[docKey]?.uploadedAt || new Date().toISOString() } }))
      if (extracted.document_number || extracted.permit_number || extracted.registration_number || extracted.sec_registration_number || extracted.id_number) {
        updateDocInfo(docKey, 'documentNumber', extracted.document_number || extracted.permit_number || extracted.registration_number || extracted.sec_registration_number || extracted.id_number || '')
      }
      if (extracted.business_name || extracted.company_name || extracted.registered_name) {
        updateDocInfo(docKey, 'registeredName', extracted.business_name || extracted.company_name || extracted.registered_name || '')
      }
      if (extracted.issue_date) updateDocInfo(docKey, 'issueDate', extracted.issue_date)
      if (extracted.expiry_date) updateDocInfo(docKey, 'expirationDate', extracted.expiry_date)
      if (extracted.owner_name) updateDocInfo(docKey, 'ownerRemarks', extracted.owner_name)
      if (extracted.tin) updateDocInfo(docKey, 'tin', extracted.tin)
    } catch (err: any) {
      const apiMsg = err?.response?.data?.message || err?.message || 'OCR extraction failed'
      setDocProcess(prev => ({ ...prev, [docKey]: { ...(prev[docKey] || { status: 'UPLOADED' as DocStatus, extractedData: {} as Record<string, string>, uploadedAt: new Date().toISOString() }), status: 'FAILED' as DocStatus, errorMessage: apiMsg + '. You can fill the fields manually.' } }))
    }
  }

  const handleDocFile = (docKey: string, files: FileList | null, isMultiple: boolean) => {
    if (!files?.length) return
    const fileArray = Array.from(files)
    if (isMultiple) {
      setDocuments(prev => ({ ...prev, [docKey]: [...(prev[docKey] ? (prev[docKey] as File[]) : []), ...fileArray] }))
    } else {
      setDocuments(prev => ({ ...prev, [docKey]: fileArray[0] } as Record<string, File | File[]>))
      setDocProcess(prev => ({ ...prev, [docKey]: { status: 'UPLOADED', extractedData: {}, uploadedAt: new Date().toISOString() } }))
      if (ocrEnabled) {
        setTimeout(() => autoOcrDoc(docKey, fileArray[0]), 300)
      }
    }
  }

  const updateDocInfo = (docKey: string, field: string, value: string) => {
    setDocumentInfo(prev => ({
      ...prev,
      [docKey]: { ...(prev[docKey] || { registeredName: '', issueDate: '', expirationDate: '', ownerRemarks: '' }), [field]: value },
    }))
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData()

      formData.append('business_name', form.businessName)
      formData.append('business_description', form.description)
      formData.append('business_category_id', String(selectedCategoryId))
      if (form.tagline) formData.append('tagline', form.tagline)
      formData.append('contact_number', form.contactNumber)
      formData.append('email', form.email)
      if (form.website) formData.append('website', form.website)
      if (form.facebook) formData.append('facebook', form.facebook)
      if (form.instagram) formData.append('instagram', form.instagram)
      if (form.otherSocialMedia) formData.append('other_social_media', form.otherSocialMedia)
      formData.append('municipality_id', form.municipalityId)
      formData.append('barangay_id', form.barangayId)
      formData.append('address', form.streetAddress)
      if (form.buildingNumber) formData.append('building_number', form.buildingNumber)
      if (form.postalCode) formData.append('postal_code', form.postalCode)
      if (form.landmark) formData.append('landmark', form.landmark)
      if (form.navigationInstructions) formData.append('navigation_instructions', form.navigationInstructions)
      formData.append('latitude', form.latitude)
      formData.append('longitude', form.longitude)
      if (form.legalEntityType) formData.append('legal_entity_type', form.legalEntityType)
      if (form.tin) formData.append('tin', form.tin)
      if (form.dtiSecRegNumber) formData.append('dti_sec_reg_number', form.dtiSecRegNumber)
      if (form.yearEstablished) formData.append('year_established', form.yearEstablished)
      formData.append('operating_hours', JSON.stringify(form.operatingHours))
      if (form.initialCapital) formData.append('initial_capital', form.initialCapital)
      if (form.grossFloorArea) formData.append('gross_floor_area', form.grossFloorArea)
      if (form.numberOfEmployees) formData.append('number_of_employees', form.numberOfEmployees)
      if (form.occupancyStatus) formData.append('occupancy_status', form.occupancyStatus)
      const mondayHours = form.operatingHours['Monday']
      if (mondayHours && !mondayHours.closed) {
        formData.append('opening_time', mondayHours.open || '08:00')
        formData.append('closing_time', mondayHours.close || '20:00')
      } else {
        formData.append('opening_time', '08:00')
        formData.append('closing_time', '17:00')
      }
      const businessDays = Object.entries(form.operatingHours)
        .filter(([, h]) => !h.closed)
        .map(([day]) => day)
      businessDays.forEach(day => formData.append('business_days[]', day))

      Object.entries(details).forEach(([key, val]) => {
        if (Array.isArray(val)) {
          val.forEach(v => formData.append(`details[${key}][]`, String(v)))
        } else {
          formData.append(`details[${key}]`, String(val))
        }
      })

      let docIdx = 0
      for (const doc of allDocs) {
        const file = documents[doc.key]
        if (!file) continue
        const info = documentInfo[doc.key] || { documentNumber: '', registeredName: '', issueDate: '', expirationDate: '', ownerRemarks: '' }
        const extracted = docProcess[doc.key]?.extractedData || {}
        const appendDocFields = (f: File) => {
          if (doc.id > 0) formData.append(`documents[${docIdx}][required_document_id]`, String(doc.id))
          formData.append(`documents[${docIdx}][file]`, f)
          if (info.documentNumber) formData.append(`documents[${docIdx}][document_number]`, info.documentNumber)
          if (info.registeredName) formData.append(`documents[${docIdx}][registered_name]`, info.registeredName)
          if (info.issueDate) formData.append(`documents[${docIdx}][issue_date]`, info.issueDate)
          if (info.expirationDate) formData.append(`documents[${docIdx}][expiration_date]`, info.expirationDate)
          if (info.ownerRemarks) formData.append(`documents[${docIdx}][owner_remarks]`, info.ownerRemarks)
          if (extracted.document_number || extracted.permit_number || extracted.registration_number || extracted.sec_registration_number || extracted.id_number) {
            formData.append(`documents[${docIdx}][ocr_document_number]`, extracted.document_number || extracted.permit_number || extracted.registration_number || extracted.sec_registration_number || extracted.id_number || '')
          }
          if (extracted.issue_date) formData.append(`documents[${docIdx}][ocr_issue_date]`, extracted.issue_date)
          if (extracted.expiry_date) formData.append(`documents[${docIdx}][ocr_expiration_date]`, extracted.expiry_date)
          if (extracted.business_name || extracted.company_name || extracted.registered_name) {
            formData.append(`documents[${docIdx}][ocr_registered_name]`, extracted.business_name || extracted.company_name || extracted.registered_name || '')
          }
          docIdx++
        }
        if (Array.isArray(file)) {
          file.forEach(f => appendDocFields(f))
        } else {
          appendDocFields(file)
        }
      }

      if (logoFile) formData.append('logo', logoFile)
      if (coverFile) formData.append('cover_photo', coverFile)

      return post('/business-owner/businesses', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    onSuccess: () => {
      removeLocalDraft(STORAGE_KEY)
      navigate('/business-owner/businesses')
    },
    onError: (err: any) => setError(err.response?.data?.message || 'Failed to create business.'),
  })

  const handleSubmitForm = () => {
    if (!validateStep()) return
    setError('')
    mutation.mutate()
  }

  const searchLocation = async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    setSearchError('')
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=1&countrycodes=ph`,
        { headers: { 'Accept': 'application/json' } }
      )
      const data = await res.json()
      if (!data || data.length === 0) {
        setSearchError('Location not found. Try a different search term.')
        setSearching(false)
        return
      }
      const result = data[0]
      const lat = parseFloat(result.lat).toFixed(6)
      const lng = parseFloat(result.lon).toFixed(6)
      setForm(prev => ({ ...prev, latitude: lat, longitude: lng }))
    } catch {
      setSearchError('Search service unavailable. Try again later.')
    }
    setSearching(false)
  }

  function MapClickHandler() {
    useMapEvents({
      click(e) {
        const lat = e.latlng.lat.toFixed(6)
        const lng = e.latlng.lng.toFixed(6)
        setForm(prev => ({ ...prev, latitude: lat, longitude: lng }))
      },
    })
    return null
  }

  function MapController() {
    const map = useMap()
    const lat = Number(form.latitude)
    const lng = Number(form.longitude)
    useEffect(() => {
      if (form.latitude && form.longitude) {
        map.setView([lat, lng], 17, { animate: true })
      }
    }, [form.latitude, form.longitude])
    return null
  }

  const latNum = form.latitude ? Number(form.latitude) : 12.8667
  const lngNum = form.longitude ? Number(form.longitude) : 121.4500

  if (metaLoading) return <DashboardSkeleton />

  return (
    <div className="max-w-5xl mx-auto">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm text-[#647067] hover:text-[#17201A] mb-6 transition">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A] mb-2">Register New Business</h1>
          <p className="text-sm text-[#647067]">Provide your tourism business information to register your establishment in TrackTour.</p>
        </div>
        <div className="text-sm font-semibold text-[#16803C] bg-[#EAF6ED] border border-[#BFE3CB] px-4 py-2 rounded-xl">
          Step {currentStep} of {totalSteps}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-8 bg-white border border-[#E2E8E3] rounded-2xl p-5 shadow-[0_6px_18px_rgba(22,101,52,0.06)]">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-bold text-[#17201A]">Business Registration</h2>
          <span className="text-sm font-medium text-[#16803C]">Step {currentStep} of {totalSteps}</span>
        </div>
        <div className="w-full bg-[#E2E8E3] rounded-full h-2.5">
          <div className="bg-[#16803C] h-2.5 rounded-full transition-all duration-500" style={{ width: `${((currentStep - 1) / (totalSteps - 1)) * 100}%` }}></div>
        </div>
        <div className="flex justify-between mt-3 overflow-x-auto gap-1">
          {steps.map((s) => (
            <button
              key={s.num}
              type="button"
              onClick={() => goToStep(s.num)}
              disabled={s.num > currentStep}
              className={`inline-flex items-center gap-1 text-[10px] sm:text-xs font-medium transition-colors duration-200 whitespace-nowrap px-1 ${
                currentStep === s.num
                  ? 'text-[#16803C]'
                  : s.num < currentStep
                    ? 'text-[#16803C] cursor-pointer hover:text-[#16803C]'
                    : 'text-[#647067] cursor-default'
              }`}
            >
              <span
                className={`inline-flex items-center justify-center w-4 h-4 sm:w-5 sm:h-5 rounded-full shrink-0 ${
                  s.num < currentStep
                    ? 'bg-[#16803C] text-white'
                    : currentStep === s.num
                      ? 'bg-[#EAF6ED] text-[#16803C] ring-2 ring-[#16803C]'
                      : 'bg-[#E2E8E3] text-[#647067]'
                }`}
              >
                {s.num < currentStep ? <Check className="w-3 h-3" /> : s.num}
              </span>
              <span className="hidden lg:inline">{s.label}</span>
            </button>
          ))}
        </div>
      </div>

      {error && <Alert type="error" message={error} onDismiss={() => setError('')} />}

      <div className="space-y-6">
        {/* STEP 1: Business Category */}
        {currentStep === 1 && (
          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 lg:p-8">
            <div className="flex items-center gap-2 mb-4 pb-2 border-b border-[#E2E8E3]">
              <Building2 className="w-5 h-5 text-[#16803C]" />
              <h2 className="text-lg font-semibold text-[#17201A]">Select Business Category</h2>
            </div>
            <p className="text-sm text-[#647067] mb-5">Choose the category that best describes your tourism business. This determines which modules and fields are available.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {meta?.categories?.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => { setSelectedCategory(cat); setSelectedCategoryId(cat.id) }}
                  className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all duration-200 text-center ${
                    selectedCategoryId === cat.id
                      ? 'border-[#16803C] bg-[#EAF6ED] shadow-md shadow-[#16803C]/10'
                      : 'border-[#E2E8E3] bg-[#F6F8F4] hover:border-[#16803C] hover:shadow-md'
                  }`}
                >
                  <span className="text-sm font-semibold text-[#17201A]">{cat.name}</span>
                  {cat.description && <span className="text-[10px] text-[#647067] leading-tight">{cat.description}</span>}
                  {selectedCategoryId === cat.id && (
                    <div className="absolute top-2 right-2 w-5 h-5 bg-[#16803C] rounded-full flex items-center justify-center">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* STEP 2: Business Information */}
        {currentStep === 2 && (
          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 lg:p-8">
            <div className="flex items-center gap-2 mb-4 pb-2 border-b border-[#E2E8E3]">
              <Building2 className="w-5 h-5 text-[#16803C]" />
              <h2 className="text-lg font-semibold text-[#17201A]">Business Information</h2>
            </div>

            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-semibold text-[#16803C] mb-3">Basic Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Business Name *</label>
                    <input type="text" value={form.businessName} onChange={e => setForm(p => ({ ...p, businessName: e.target.value }))}
                      placeholder="e.g., Coastal Paradise Resort"
                      className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                    <p className="text-xs text-[#647067] mt-1">Enter the legal business name as registered with DTI or SEC.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Business Tagline</label>
                    <input type="text" value={form.tagline} onChange={e => setForm(p => ({ ...p, tagline: e.target.value }))}
                      placeholder="e.g., Where every sunset feels like home"
                      className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                    <p className="text-xs text-[#647067] mt-1">A short catchy phrase that captures your brand identity.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Category</label>
                    <p className="w-full px-4 py-3 bg-[#F6F8F4] border border-[#E2E8E3] rounded-xl text-sm text-[#647067] font-medium">
                      {selectedCategory?.name || 'Not selected'}
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Business Description *</label>
                    <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                      rows={3} placeholder="Tell tourists what makes your business unique — amenities, ambiance, location highlights"
                      className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition resize-none" />
                    <p className="text-xs text-[#647067] mt-1">Describe your business offerings, unique features, and what tourists can expect.</p>
                  </div>
                </div>
              </div>

              <div className="border-t border-[#E2E8E3] pt-5">
                <h3 className="text-sm font-semibold text-[#16803C] mb-3">Business Media</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Business Logo</label>
                    <label className={`flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
                      logoPreview ? 'border-[#16803C] bg-[#EAF6ED]' : 'border-[#D7E8DB] bg-[#F6F8F4] hover:bg-[#F3F8F4]'
                    }`}>
                      {logoPreview ? (
                        <div className="relative w-full h-full p-2">
                          <img src={logoPreview} className="w-full h-full object-contain rounded" alt="Logo" />
                          <button type="button" onClick={() => { setLogoPreview(null); setLogoFile(null) }}
                            className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-0.5 shadow hover:bg-[#991B1B] transition text-xs">✕</button>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-4">
                          <span className="text-xs text-[#647067]">Upload logo (JPG, PNG, max 2MB)</span>
                        </div>
                      )}
                      <input type="file" ref={logoInputRef} className="hidden" accept=".jpg,.jpeg,.png" onChange={e => { const f=e.target.files?.[0]; if(f){setLogoFile(f);const r=new FileReader();r.onload=ev=>setLogoPreview(ev.target?.result as string);r.readAsDataURL(f)}}} />
                    </label>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Cover Photo</label>
                    <label className={`flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
                      coverPreview ? 'border-[#16803C] bg-[#EAF6ED]' : 'border-[#D7E8DB] bg-[#F6F8F4] hover:bg-[#F3F8F4]'
                    }`}>
                      {coverPreview ? (
                        <div className="relative w-full h-full p-2">
                          <img src={coverPreview} className="w-full h-full object-contain rounded" alt="Cover" />
                          <button type="button" onClick={() => { setCoverPreview(null); setCoverFile(null) }}
                            className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-0.5 shadow hover:bg-[#991B1B] transition text-xs">✕</button>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-4">
                          <span className="text-xs text-[#647067]">Upload cover (JPG, PNG, max 5MB)</span>
                        </div>
                      )}
                      <input type="file" ref={coverInputRef} className="hidden" accept=".jpg,.jpeg,.png" onChange={e => { const f=e.target.files?.[0];if(f){setCoverFile(f);const r=new FileReader();r.onload=ev=>setCoverPreview(ev.target?.result as string);r.readAsDataURL(f)}}} />
                    </label>
                  </div>
                </div>
              </div>

              <div className="border-t border-[#E2E8E3] pt-5">
                <h3 className="text-sm font-semibold text-[#16803C] mb-3">Contact Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Business Contact Number *</label>
                    <input type="text" value={form.contactNumber} onChange={e => setForm(p => ({ ...p, contactNumber: e.target.value }))}
                      placeholder="e.g., 09171234567 or (043) 123-4567"
                      className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                    <p className="text-xs text-[#647067] mt-1">Mobile number or landline with area code that tourists can use to reach you.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Business Email *</label>
                    <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                      placeholder="e.g., info@coastalparadise.com"
                      className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                    <p className="text-xs text-[#647067] mt-1">Official business email for inquiries and official communications.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Website</label>
                    <input type="url" value={form.website} onChange={e => setForm(p => ({ ...p, website: e.target.value }))}
                      placeholder="https://www.yourbusiness.com"
                      className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                    <p className="text-xs text-[#647067] mt-1">Your official website or booking page URL.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Facebook Page</label>
                    <input type="url" value={form.facebook} onChange={e => setForm(p => ({ ...p, facebook: e.target.value }))}
                      placeholder="https://facebook.com/yourpage"
                      className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                    <p className="text-xs text-[#647067] mt-1">Link to your business Facebook page for social presence.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Instagram</label>
                    <input type="url" value={form.instagram} onChange={e => setForm(p => ({ ...p, instagram: e.target.value }))}
                      placeholder="https://instagram.com/yourhandle"
                      className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                    <p className="text-xs text-[#647067] mt-1">Instagram profile showcasing your business photos.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Other Social Media</label>
                    <input type="text" value={form.otherSocialMedia} onChange={e => setForm(p => ({ ...p, otherSocialMedia: e.target.value }))}
                      placeholder="e.g., TikTok, YouTube, Twitter/X links"
                      className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                    <p className="text-xs text-[#647067] mt-1">Additional social media channels (include full URLs).</p>
                  </div>
                </div>
              </div>

              <div className="border-t border-[#E2E8E3] pt-5">
                <h3 className="text-sm font-semibold text-[#16803C] mb-3">Operating Hours</h3>
                <p className="text-xs text-[#647067] mb-3">Set your regular operating hours. Check 'Closed' if your business does not operate on that day.</p>
                <div className="space-y-2">
                  {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => (
                    <div key={day} className={`flex items-center gap-3 p-2 rounded-lg ${form.operatingHours[day]?.closed ? 'bg-[#F3F4F6]' : 'bg-[#F6F8F4]'}`}>
                      <span className="w-24 text-sm font-medium text-[#4B5563]">{day}</span>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={form.operatingHours[day]?.closed ?? false}
                          onChange={e => setForm(p => ({
                            ...p,
                            operatingHours: {
                              ...p.operatingHours,
                              [day]: { ...p.operatingHours[day], closed: e.target.checked },
                            },
                          }))}
                          className="rounded border-[#E2E8E3] text-[#16803C] focus:ring-[#16803C]" />
                        <span className="text-xs text-[#647067]">Closed</span>
                      </label>
                      {!form.operatingHours[day]?.closed && (
                        <div className="flex items-center gap-2 ml-auto">
                          <input type="time" value={form.operatingHours[day]?.open || '08:00'}
                            onChange={e => setForm(p => ({
                              ...p,
                              operatingHours: {
                                ...p.operatingHours,
                                [day]: { ...p.operatingHours[day], open: e.target.value },
                              },
                            }))}
                            className="px-2 py-1 bg-white border border-[#E2E8E3] rounded-lg text-xs text-[#17201A] focus:ring-2 focus:ring-[#16803C]/25" />
                          <span className="text-[#647067] text-xs">to</span>
                          <input type="time" value={form.operatingHours[day]?.close || '20:00'}
                            onChange={e => setForm(p => ({
                              ...p,
                              operatingHours: {
                                ...p.operatingHours,
                                [day]: { ...p.operatingHours[day], close: e.target.value },
                              },
                            }))}
                            className="px-2 py-1 bg-white border border-[#E2E8E3] rounded-lg text-xs text-[#17201A] focus:ring-2 focus:ring-[#16803C]/25" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>
        )}

        {/* STEP 3: Business Location */}
        {currentStep === 3 && (
          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 lg:p-8">
            <div className="flex items-center gap-2 mb-4 pb-2 border-b border-[#E2E8E3]">
              <MapPin className="w-5 h-5 text-[#16803C]" />
              <h2 className="text-lg font-semibold text-[#17201A]">Business Location</h2>
            </div>
            <p className="text-sm text-[#647067] mb-5">Pin your exact location for tourism map discovery.</p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Country</label>
                    <input type="text" readOnly value="Philippines"
                      className="w-full px-4 py-3 bg-[#F6F8F4] border border-[#E2E8E3] rounded-xl text-sm text-[#647067] cursor-not-allowed" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Province</label>
                    <input type="text" readOnly value={selectedMunicipality?.province || 'Oriental Mindoro'}
                      className="w-full px-4 py-3 bg-[#F6F8F4] border border-[#E2E8E3] rounded-xl text-sm text-[#647067] cursor-not-allowed" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Municipality *</label>
                  <select value={form.municipalityId} onChange={e => { setForm(p => ({ ...p, municipalityId: e.target.value, barangayId: '' })); loadBarangays(e.target.value) }}
                    className="w-full px-4 py-3 bg-[#F3F8F4] border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition">
                    <option value="">Select municipality</option>
                    {municipalities.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <p className="text-xs text-[#647067] mt-1">The city or municipality where your business is physically located.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Barangay *</label>
                  <select value={form.barangayId} onChange={e => setForm(p => ({ ...p, barangayId: e.target.value }))}
                    disabled={!form.municipalityId}
                    className="w-full px-4 py-3 bg-[#F3F8F4] border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition disabled:opacity-50">
                    <option value="">Select barangay</option>
                    {barangays.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                  <p className="text-xs text-[#647067] mt-1">Select the barangay or district your business belongs to.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Street Address *</label>
                  <input type="text" value={form.streetAddress} onChange={e => setForm(p => ({ ...p, streetAddress: e.target.value }))}
                    placeholder="e.g., Rizal Street, Purok 3"
                    className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                  <p className="text-xs text-[#647067] mt-1">Street name, purok/sitio, or subdivision where your business is located.</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Building Number / Unit</label>
                    <input type="text" value={form.buildingNumber} onChange={e => setForm(p => ({ ...p, buildingNumber: e.target.value }))}
                      placeholder="e.g., Unit 2, 123 Building"
                      className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                    <p className="text-xs text-[#647067] mt-1">Building name or unit/room number if applicable.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Postal Code</label>
                    <input type="text" value={form.postalCode} onChange={e => setForm(p => ({ ...p, postalCode: e.target.value }))}
                      placeholder="e.g., 5214"
                      className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                    <p className="text-xs text-[#647067] mt-1">ZIP/postal code for your location in the municipality.</p>
                  </div>
                </div>
                <div>
                    <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Nearby Landmark</label>
                    <input type="text" value={form.landmark} onChange={e => setForm(p => ({ ...p, landmark: e.target.value }))}
                      placeholder="e.g., Beside BDO Bank or Across the Municipal Hall"
                      className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                    <p className="text-xs text-[#647067] mt-1">A notable establishment or structure near your business to help tourists find you.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Latitude</label>
                    <input type="text" readOnly value={form.latitude}
                      className="w-full px-4 py-3 bg-[#F6F8F4] border border-[#E2E8E3] rounded-xl text-sm text-[#647067] cursor-not-allowed font-mono" placeholder="--" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Longitude</label>
                    <input type="text" readOnly value={form.longitude}
                      className="w-full px-4 py-3 bg-[#F6F8F4] border border-[#E2E8E3] rounded-xl text-sm text-[#647067] cursor-not-allowed font-mono" placeholder="--" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Navigation Instructions</label>
                    <textarea value={form.navigationInstructions} onChange={e => setForm(p => ({ ...p, navigationInstructions: e.target.value }))}
                      rows={2} placeholder="e.g., From the town plaza, take the national highway north for 2km. Look for the yellow gate on the right."
                      className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition resize-none" />
                    <p className="text-xs text-[#647067] mt-1">Directions from the town center or main road to help visitors navigate to your business.</p>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <div className="relative rounded-xl overflow-hidden border border-[#E2E8E3] bg-white" style={{ minHeight: 420 }}>
                  <MapContainer center={[latNum, lngNum]} zoom={form.latitude ? 16 : 11} minZoom={2} className="h-full w-full" style={{ height: 420, cursor: 'crosshair' }} zoomControl={false}>
                    <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">Open Street Map</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    {form.latitude && form.longitude && <Marker position={[latNum, lngNum]} icon={businessIcon} />}
                    <MapClickHandler />
                    <MapController />
                  </MapContainer>
                </div>
                <div className="flex gap-2">
                  <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && searchLocation()}
                    placeholder="Search location on map..."
                    className="flex-1 px-4 py-2.5 bg-[#F3F8F4] border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                  <button type="button" onClick={searchLocation} disabled={searching}
                    className="px-4 py-2.5 bg-[#16803C] hover:bg-[#126B32] disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition shrink-0">
                    {searching ? <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Search className="w-4 h-4" />}
                  </button>
                </div>
                {searchError && <p className="text-xs text-[#B91C1C]">{searchError}</p>}
                <div className="flex items-center justify-between px-1">
                  <p className="text-[10px] text-[#647067]">
                    <span className="inline-block w-2 h-2 rounded-full bg-[#16803C] mr-1 align-middle"></span> Click the map to pin location
                  </p>
                  {form.latitude && <button type="button" onClick={() => setForm(p => ({ ...p, latitude: '', longitude: '' }))} className="text-[10px] text-[#B91C1C] hover:text-[#B91C1C] transition-colors">Clear</button>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STEP 4: Category-Specific Details */}
        {currentStep === 4 && (
          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 lg:p-8">
            <div className="flex items-center gap-2 mb-4 pb-2 border-b border-[#E2E8E3]">
              <Check className="w-5 h-5 text-[#16803C]" />
              <h2 className="text-lg font-semibold text-[#17201A]">{selectedCategory?.name || 'Business'} Specific Information</h2>
            </div>
            {categoryFields.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-[#647067] text-sm">No additional details needed for this category.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {categoryFields.map(field => (
                  <div key={field.key} className={['textarea', 'boolean', 'multi_checkbox'].includes(field.type) ? 'md:col-span-2' : ''}>
                    <label className="block text-sm font-medium text-[#4B5563] mb-1.5">{field.label}</label>
                    {field.type === 'text' && (
                      <input type="text" value={details[field.key] || ''} onChange={e => setDetails(p => ({ ...p, [field.key]: e.target.value }))}
                        placeholder={field.placeholder || ''}
                        className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:ring-2 focus:ring-[#16803C]/25 transition" />
                    )}
                    {field.type === 'number' && (
                      <input type="number" value={details[field.key] || ''} onChange={e => setDetails(p => ({ ...p, [field.key]: e.target.value }))}
                        placeholder={field.placeholder || ''}
                        className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:ring-2 focus:ring-[#16803C]/25 transition" />
                    )}
                    {field.type === 'textarea' && (
                      <textarea value={details[field.key] || ''} onChange={e => setDetails(p => ({ ...p, [field.key]: e.target.value }))}
                        placeholder={field.placeholder || ''} rows={3}
                        className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:ring-2 focus:ring-[#16803C]/25 transition resize-none" />
                    )}
                    {field.type === 'boolean' && (
                      <label className="flex items-center gap-3 p-3 rounded-xl border border-[#E2E8E3] bg-[#F6F8F4] cursor-pointer">
                        <input type="checkbox" checked={!!details[field.key]} onChange={e => setDetails(p => ({ ...p, [field.key]: e.target.checked }))}
                          className="rounded border-[#E2E8E3] text-[#16803C] focus:ring-[#16803C]" />
                        <span className="text-sm text-[#4B5563]">{field.label}</span>
                      </label>
                    )}
                    {field.type === 'select' && (
                      <select value={details[field.key] || ''} onChange={e => setDetails(p => ({ ...p, [field.key]: e.target.value }))}
                        className="w-full px-4 py-3 bg-[#F3F8F4] border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:ring-2 focus:ring-[#16803C]/25 transition">
                        <option value="">Select</option>
                        {field.options?.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    )}
                    {field.type === 'time' && (
                      <input type="time" value={details[field.key] || ''} onChange={e => setDetails(p => ({ ...p, [field.key]: e.target.value }))}
                        className="w-full px-4 py-3 bg-[#F3F8F4] border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:ring-2 focus:ring-[#16803C]/25 transition" />
                    )}
                    {field.type === 'multi_checkbox' && (
                      <div className="mt-1 flex flex-wrap gap-2">
                        {field.options?.map(opt => (
                          <label key={opt} className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer transition-all text-xs font-medium ${
                            (details[field.key] || []).includes(opt)
                              ? 'border-[#16803C] bg-[#EAF6ED] text-[#16803C]'
                              : 'border-[#E2E8E3] bg-[#F6F8F4] text-[#647067] hover:border-[#16803C]'
                          }`}>
                            <input type="checkbox" value={opt} checked={(details[field.key] || []).includes(opt)} onChange={() => toggleDetailField(field.key, opt)} className="sr-only" />
                            <span>{opt}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* STEP 5: Documents & Registration */}
        {currentStep === 5 && (
          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 lg:p-8">
            <div className="flex items-center gap-2 mb-4 pb-2 border-b border-[#E2E8E3]">
              <Check className="w-5 h-5 text-[#16803C]" />
              <h2 className="text-lg font-semibold text-[#17201A]">Documents & Registration</h2>
            </div>

            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-semibold text-[#16803C] mb-3">Legal Registration Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Legal Entity Type *</label>
                    <select value={form.legalEntityType} onChange={e => setForm(p => ({ ...p, legalEntityType: e.target.value }))}
                      className="w-full px-4 py-3 bg-[#F3F8F4] border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition">
                      <option value="">Select entity type</option>
                      <option value="Sole Proprietorship">Sole Proprietorship</option>
                      <option value="Partnership">Partnership</option>
                      <option value="Corporation">Corporation</option>
                      <option value="Cooperative">Cooperative</option>
                    </select>
                    <p className="text-xs text-[#647067] mt-1">The legal structure under which your business is registered with the government.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#4B5563] mb-1.5">TIN Number *</label>
                    <input type="text" value={form.tin} onChange={e => setForm(p => ({ ...p, tin: e.target.value }))}
                      placeholder="e.g., 123-456-789-000"
                      className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                    <p className="text-xs text-[#647067] mt-1">Tax Identification Number issued by the BIR (required for all registered businesses).</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#4B5563] mb-1.5">DTI / SEC Registration No.</label>
                    <input type="text" value={form.dtiSecRegNumber} onChange={e => setForm(p => ({ ...p, dtiSecRegNumber: e.target.value }))}
                      placeholder="e.g., 2026-123456"
                      className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                    <p className="text-xs text-[#647067] mt-1">DTI certificate number for sole proprietorship, SEC registration number for corporations/partnerships.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Year Established *</label>
                    <input type="number" value={form.yearEstablished} onChange={e => setForm(p => ({ ...p, yearEstablished: e.target.value }))}
                      placeholder="e.g., 2020" min="1900" max={new Date().getFullYear()}
                      className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                    <p className="text-xs text-[#647067] mt-1">The year your business started its operations.</p>
                  </div>
                </div>
              </div>

              <div className="border-t border-[#E2E8E3] pt-5">
                <h3 className="text-sm font-semibold text-[#16803C] mb-3">Operations</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Initial Capital *</label>
                    <input type="number" value={form.initialCapital} onChange={e => setForm(p => ({ ...p, initialCapital: e.target.value }))}
                      placeholder="e.g., 500000"
                      className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                    <p className="text-xs text-[#647067] mt-1">Total startup capital invested in the business (in PHP).</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Gross Floor Area (sqm) *</label>
                    <input type="number" value={form.grossFloorArea} onChange={e => setForm(p => ({ ...p, grossFloorArea: e.target.value }))}
                      placeholder="e.g., 120"
                      className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                    <p className="text-xs text-[#647067] mt-1">Total floor area of the business establishment in square meters.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Number of Employees *</label>
                    <input type="number" value={form.numberOfEmployees} onChange={e => setForm(p => ({ ...p, numberOfEmployees: e.target.value }))}
                      placeholder="e.g., 10"
                      className="w-full px-4 py-3 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                    <p className="text-xs text-[#647067] mt-1">Total number of employees (including owner).</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#4B5563] mb-1.5">Occupancy Status *</label>
                    <select value={form.occupancyStatus} onChange={e => setForm(p => ({ ...p, occupancyStatus: e.target.value }))}
                      className="w-full px-4 py-3 bg-[#F3F8F4] border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition">
                      <option value="">Select occupancy status</option>
                      <option value="Owned">Owned</option>
                      <option value="Rented">Rented</option>
                    </select>
                    <p className="text-xs text-[#647067] mt-1">Whether the business premises is owned or rented.</p>
                  </div>
                </div>
              </div>

              <div className="border-t border-[#E2E8E3] pt-5">
                <h3 className="text-sm font-semibold text-[#16803C] mb-3">Upload Documents</h3>
                <p className="text-sm text-[#647067] mb-2">Upload all required permits and supporting documents.</p>
                <p className="text-xs text-[#647067] mb-1">Accepted: JPG, PNG, PDF - Max 5MB per file</p>
                {form.legalEntityType && entityDocs.length > 0 && (
                  <p className="text-xs text-[#A66F00]/80 mb-2">
                    <span className="font-semibold">{form.legalEntityType}</span> registration documents are included below.
                    {form.legalEntityType !== 'Sole Proprietorship' && ' You will need SEC/CDA documents instead of DTI.'}
                  </p>
                )}
                {ocrEnabled ? (
                  <p className="text-xs text-[#16803C]/70 mb-4 flex items-center gap-1"><ScanLine className="w-3 h-3" /> Documents are automatically scanned via OCR when uploaded to extract key information.</p>
                ) : (
                  <p className="text-xs text-[#A66F00]/70 mb-4 flex items-center gap-1"><ScanLine className="w-3 h-3" /> OCR is disabled. Please fill in document details manually.</p>
                )}

            {!selectedCategory ? (
              <div className="py-12 text-center">
                <p className="text-[#647067] text-sm">Please select a business category first.</p>
              </div>
            ) : allDocs.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-[#647067] text-sm">No documents required for this category.</p>
              </div>
            ) : (
              <div>
                <div className="mb-5 p-4 bg-[#F6F8F4] rounded-xl border border-[#E2E8E3]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-[#4B5563]">Documents Uploaded</span>
                    <span className="text-xs font-bold text-[#16803C]">{uploadedCount} / {allDocs.length}</span>
                  </div>
                  <div className="w-full h-2 bg-[#E2E8E3] rounded-full overflow-hidden">
                    <div className="h-full bg-[#16803C] rounded-full transition-all duration-500" style={{ width: uploadPercentage + '%' }}></div>
                  </div>
                  <p className="text-[10px] text-[#647067] mt-1 text-right">{uploadPercentage}%</p>
                </div>
                <div className="space-y-3">
                  {allDocs.map((doc) => {
                    const process = docProcess[doc.key]
                    const state = documents[doc.key] ? (process?.status || 'UPLOADED') : null
                    const docType = docKeyToType(doc.key)
                    const labels = docType && EXTRACTION_LABELS[docType] ? EXTRACTION_LABELS[docType] : null
                    const extracted = process?.extractedData || {}
                    const info = documentInfo[doc.key] || { documentNumber: '', registeredName: '', issueDate: '', expirationDate: '', ownerRemarks: '' }
                    const reqFields = doc.required_fields || (doc.has_expiration || doc.is_expirable ? ['document_number', 'issue_date', 'expiration_date'] : ['document_number', 'issue_date'])
                    const showDocNum = reqFields.some(f => f.includes('number') || f.includes('code') || f.includes('tin') || f.includes('or_cr'))
                    const showRegName = reqFields.some(f => f.includes('name') || f.includes('lessor') || f.includes('owner'))
                    const showIssueDate = reqFields.some(f => f.includes('issue') || f.includes('registration') || f.includes('approval'))
                    const showExpDate = doc.has_expiration || doc.is_expirable || reqFields.some(f => f.includes('expiration'))

                    return (
                    <div key={doc.key} className={`p-4 rounded-xl border transition-all ${
                      state === 'COMPLETED' ? 'bg-[#EAF6ED] border-[#BFE3CB]'
                      : state === 'FAILED' ? 'bg-[#FEF2F2] border-[#FECACA]'
                      : state === 'PROCESSING' || state === 'UPLOADED' ? 'bg-[#EAF6ED] border-[#BFE3CB]'
                      : 'bg-[#F6F8F4] border-[#E2E8E3]'
                    }`}>
                      {/* Header */}
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">
                            {state === 'COMPLETED' ? '✅' : state === 'FAILED' ? '❌' : state === 'PROCESSING' || state === 'UPLOADED' ? '⏳' : '📄'}
                          </span>
                          <div>
                            <h4 className="text-sm font-semibold text-[#17201A]">{doc.label}</h4>
                            <p className="text-[11px] text-[#647067]">{doc.purpose}</p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          {doc.required ? (
                            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-[#FEF2F2] text-[#B91C1C] border border-[#FECACA]">Required</span>
                          ) : (
                            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-[#F3F4F6] text-[#647067] border border-[#E5E7EB]">Optional</span>
                          )}
                          {showExpDate && (
                            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-[#FFF7D6] text-[#A66F00] border border-[#F4B400]/40">Expirable</span>
                          )}
                        </div>
                      </div>

                      {/* Body: 3 states */}
                      {!state && (
                        <label className="mt-2 flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-[#D7E8DB] rounded-lg cursor-pointer transition-all hover:border-[#16803C] hover:bg-[#EAF6ED]">
                          <div className="flex flex-col items-center justify-center">
                            <span className="text-xs text-[#647067]"><span className="font-semibold text-[#16803C]">Upload File</span></span>
                          </div>
                          <input type="file" className="sr-only" accept={doc.accept || '.pdf,.jpg,.jpeg,.png'} multiple={!!doc.multiple} onChange={e => handleDocFile(doc.key, e.target.files, !!doc.multiple)} />
                        </label>
                      )}

                      {state === 'PROCESSING' && (
                        <div className="mt-2 p-4 bg-[#F6F8F4] rounded-lg border border-[#E2E8E3]">
                          <div className="flex items-center gap-3 mb-3">
                            <span className="inline-block w-5 h-5 border-2 border-[#16803C]/30 border-t-[#16803C] rounded-full animate-spin" />
                            <span className="text-sm font-medium text-[#16803C]">Processing Document...</span>
                          </div>
                          <div className="space-y-1.5 text-xs text-[#647067]">
                            <div className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-[#16803C]" /> Uploading file</div>
                            <div className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-[#16803C]" /> Reading document</div>
                            <div className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-[#647067]" /> Extracting information</div>
                            <div className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-[#647067]" /> Validating extracted data</div>
                          </div>
                          <p className="text-[10px] text-[#647067] mt-2">Please wait...</p>
                        </div>
                      )}

                      {state === 'UPLOADED' && !ocrEnabled && (
                        <div className="mt-2 p-4 bg-[#F6F8F4] rounded-lg border border-[#E2E8E3]">
                          <div className="flex items-center gap-3 mb-3">
                            <span className="w-5 h-5 flex items-center justify-center text-[#647067] text-lg leading-none">📄</span>
                            <span className="text-sm font-medium text-[#4B5563]">Document Uploaded</span>
                          </div>
                          <p className="text-xs text-[#647067]">Fill in the document details below manually.</p>
                        </div>
                      )}

                      {state === 'COMPLETED' && !doc.multiple && (
                        <div className="mt-2 space-y-3">
                          <div className="flex items-center justify-between p-2.5 bg-[#F6F8F4] rounded-lg border border-[#E2E8E3]">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-[#4B5563]">{(documents[doc.key] as File).name}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <label className="p-1 rounded-lg text-[#647067] hover:text-[#16803C] cursor-pointer transition" title="Replace">
                                🔄
                                <input type="file" className="sr-only" accept={doc.accept || '.pdf,.jpg,.jpeg,.png'} onChange={e => handleDocFile(doc.key, e.target.files, false)} />
                              </label>
                              <button type="button" onClick={() => removeDoc(doc.key)} className="text-[#B91C1C] hover:text-[#B91C1C] p-1" title="Delete">✕</button>
                            </div>
                          </div>
                          {/* Extracted data display */}
                          {labels && Object.keys(extracted).length > 0 && (
                            <div className="p-3 bg-[#F6F8F4] rounded-lg border border-[#E2E8E3]">
                              <p className="text-[10px] font-semibold text-[#16803C] mb-2 uppercase tracking-wide">Extracted Information</p>
                              <div className="space-y-1.5">
                                {Object.entries(labels).map(([key, label]) => {
                                  const val = extracted[key]
                                  if (!val) return null
                                  return (
                                    <div key={key} className="flex justify-between items-center text-xs">
                                      <span className="text-[#647067]">{label}</span>
                                      <span className="text-[#17201A] font-medium text-right max-w-[60%] truncate">{val}</span>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )}
                          {/* Editable fields with OCR comparison */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[#E2E8E3]">
                            {showDocNum && (
                              <div>
                                <label className="text-[11px] text-[#647067] font-medium block mb-1 flex items-center gap-1">
                                  Document / Permit No.
                                  {info.documentNumber && (extracted.document_number || extracted.permit_number || extracted.registration_number || extracted.sec_registration_number || extracted.id_number) && !info.documentNumber.includes(extracted.document_number || extracted.permit_number || extracted.registration_number || extracted.sec_registration_number || extracted.id_number || '') && (
                                    <span className="text-[#A66F00]" title="Differs from OCR extraction">⚠</span>
                                  )}
                                </label>
                                <input type="text" value={info.documentNumber || ''} onChange={e => updateDocInfo(doc.key, 'documentNumber', e.target.value)}
                                  placeholder="Enter document number"
                                  className="w-full px-3 py-2 bg-white border border-[#E2E8E3] rounded-lg text-xs text-[#17201A] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                              </div>
                            )}
                            {showRegName && (
                              <div>
                                <label className="text-[11px] text-[#647067] font-medium block mb-1 flex items-center gap-1">
                                  Registered / Business Name
                                  {info.registeredName && (extracted.business_name || extracted.company_name || extracted.registered_name) && !info.registeredName.includes(extracted.business_name || extracted.company_name || extracted.registered_name || '') && (
                                    <span className="text-[#A66F00]" title="Differs from OCR extraction">⚠</span>
                                  )}
                                </label>
                                <input type="text" value={info.registeredName || ''} onChange={e => updateDocInfo(doc.key, 'registeredName', e.target.value)}
                                  placeholder="Name on document"
                                  className="w-full px-3 py-2 bg-white border border-[#E2E8E3] rounded-lg text-xs text-[#17201A] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                              </div>
                            )}
                            {showIssueDate && (
                              <div>
                                <label className="text-[11px] text-[#647067] font-medium block mb-1 flex items-center gap-1">
                                  Date Issued
                                  {info.issueDate && extracted.issue_date && !info.issueDate.includes(extracted.issue_date) && (
                                    <span className="text-[#A66F00]" title="Differs from OCR extraction">⚠</span>
                                  )}
                                </label>
                                <input type="date" value={info.issueDate || ''} onChange={e => updateDocInfo(doc.key, 'issueDate', e.target.value)}
                                  className="w-full px-3 py-2 bg-white border border-[#E2E8E3] rounded-lg text-xs text-[#17201A] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                              </div>
                            )}
                            {showExpDate && (
                              <div>
                                <label className="text-[11px] text-[#647067] font-medium block mb-1 flex items-center gap-1">
                                  Expiration Date
                                  {info.expirationDate && extracted.expiry_date && !info.expirationDate.includes(extracted.expiry_date) && (
                                    <span className="text-[#A66F00]" title="Differs from OCR extraction">⚠</span>
                                  )}
                                </label>
                                <input type="date" value={info.expirationDate || ''} onChange={e => updateDocInfo(doc.key, 'expirationDate', e.target.value)}
                                  className="w-full px-3 py-2 bg-white border border-[#E2E8E3] rounded-lg text-xs text-[#17201A] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                              </div>
                            )}
                          </div>
                          {/* OCR mismatch notice */}
                          {process?.extractedData && Object.keys(process.extractedData).length > 0 && (
                            <div className="text-[10px] text-[#A66F00]/70 italic flex items-center gap-1">
                              <span>⚠</span>
                              <span>OCR-extracted data was pre-filled. Verify accuracy — mismatches will be flagged for review.</span>
                            </div>
                          )}
                        </div>
                      )}

                      {state === 'FAILED' && (
                        <div className="mt-2 space-y-3">
                          <div className="flex items-center justify-between p-2.5 bg-[#FEF2F2] rounded-lg border border-[#FECACA]">
                            <span className="text-xs font-medium text-[#4B5563]">{(documents[doc.key] as File).name}</span>
                            <div className="flex items-center gap-1">
                              <label className="p-1 rounded-lg text-[#647067] hover:text-[#16803C] cursor-pointer transition" title="Replace">
                                🔄
                                <input type="file" className="sr-only" accept={doc.accept || '.pdf,.jpg,.jpeg,.png'} onChange={e => handleDocFile(doc.key, e.target.files, false)} />
                              </label>
                              <button type="button" onClick={() => removeDoc(doc.key)} className="text-[#B91C1C] hover:text-[#B91C1C] p-1" title="Delete">✕</button>
                            </div>
                          </div>
                          <p className="text-[11px] text-[#B91C1C]">{process?.errorMessage || 'OCR extraction failed.'}</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[#E2E8E3]">
                            {showDocNum && (
                              <div>
                                <label className="text-[11px] text-[#647067] font-medium block mb-1">Document / Permit No.</label>
                                <input type="text" value={info.documentNumber || ''} onChange={e => updateDocInfo(doc.key, 'documentNumber', e.target.value)}
                                  placeholder="Enter document number"
                                  className="w-full px-3 py-2 bg-white border border-[#E2E8E3] rounded-lg text-xs text-[#17201A] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                              </div>
                            )}
                            {showRegName && (
                              <div>
                                <label className="text-[11px] text-[#647067] font-medium block mb-1">Registered / Business Name</label>
                                <input type="text" value={info.registeredName || ''} onChange={e => updateDocInfo(doc.key, 'registeredName', e.target.value)}
                                  placeholder="Name on document"
                                  className="w-full px-3 py-2 bg-white border border-[#E2E8E3] rounded-lg text-xs text-[#17201A] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                              </div>
                            )}
                            {showIssueDate && (
                              <div>
                                <label className="text-[11px] text-[#647067] font-medium block mb-1">Date Issued</label>
                                <input type="date" value={info.issueDate || ''} onChange={e => updateDocInfo(doc.key, 'issueDate', e.target.value)}
                                  className="w-full px-3 py-2 bg-white border border-[#E2E8E3] rounded-lg text-xs text-[#17201A] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                              </div>
                            )}
                            {showExpDate && (
                              <div>
                                <label className="text-[11px] text-[#647067] font-medium block mb-1">Expiration Date</label>
                                <input type="date" value={info.expirationDate || ''} onChange={e => updateDocInfo(doc.key, 'expirationDate', e.target.value)}
                                  className="w-full px-3 py-2 bg-white border border-[#E2E8E3] rounded-lg text-xs text-[#17201A] focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {state === 'COMPLETED' && doc.multiple && (
                        <div className="mt-2 space-y-2">
                          {(documents[doc.key] as File[]).map((file, fi) => (
                            <div key={fi} className="flex items-center gap-3 p-2.5 bg-[#F6F8F4] rounded-lg border border-[#E2E8E3]">
                              <span className="text-xs font-medium text-[#4B5563] truncate flex-1">{file.name}</span>
                              <button type="button" onClick={() => setDocuments(p => {
                                const arr = p[doc.key] as File[]
                                const filtered = [...arr]
                                filtered.splice(fi, 1)
                                return filtered.length ? { ...p, [doc.key]: filtered } : (() => { const { [doc.key]: _, ...rest } = p; return rest })()
                              })} className="text-[#B91C1C] hover:text-[#B91C1C] p-1">✕</button>
                            </div>
                          ))}
                          <label className="flex items-center justify-center gap-2 w-full py-2 border border-dashed border-[#D7E8DB] rounded-lg cursor-pointer text-xs text-[#647067] hover:text-[#16803C] hover:border-[#16803C] transition">
                            + Add more
                            <input type="file" className="sr-only" accept={doc.accept || '.pdf,.jpg,.jpeg,.png'} multiple onChange={e => handleDocFile(doc.key, e.target.files, true)} />
                          </label>
                        </div>
                      )}
                    </div>
                  )})}
                </div>
              </div>
            )}
              </div>
            </div>
          </div>
        )}

        {/* STEP 6: Review & Submit */}
        {currentStep === 6 && (
          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 lg:p-8">
            <div className="flex items-center gap-2 mb-4 pb-2 border-b border-[#E2E8E3]">
              <Check className="w-5 h-5 text-[#16803C]" />
              <h2 className="text-lg font-semibold text-[#17201A]">Review & Submit</h2>
            </div>
            <p className="text-sm text-[#647067] mb-5">Please review all information before submitting your business registration.</p>
            <div className="space-y-4">
              <div className="p-4 bg-[#F6F8F4] rounded-xl border border-[#E2E8E3]">
                <h4 className="text-sm font-semibold text-[#4B5563] mb-3">Business Summary</h4>
                <div className="divide-y divide-[#E2E8E3] text-sm">
                  <div className="flex justify-between py-2"><span className="text-[#647067]">Category</span><span className="text-[#17201A] font-medium">{selectedCategory?.name || '—'}</span></div>
                  <div className="flex justify-between py-2"><span className="text-[#647067]">Business Name</span><span className="text-[#17201A] font-medium">{form.businessName || '—'}</span></div>
                  {form.tagline && <div className="flex justify-between py-2"><span className="text-[#647067]">Tagline</span><span className="text-[#17201A] font-medium">{form.tagline}</span></div>}
                  <div className="flex justify-between py-2"><span className="text-[#647067]">Contact</span><span className="text-[#17201A]">{form.contactNumber || '—'}</span></div>
                  <div className="flex justify-between py-2"><span className="text-[#647067]">Email</span><span className="text-[#17201A]">{form.email || '—'}</span></div>
                  {form.website && <div className="flex justify-between py-2"><span className="text-[#647067]">Website</span><span className="text-[#17201A]">{form.website}</span></div>}
                </div>
              </div>

              <div className="p-4 bg-[#F6F8F4] rounded-xl border border-[#E2E8E3]">
                <h4 className="text-sm font-semibold text-[#4B5563] mb-3">Operating Hours</h4>
                <div className="space-y-1 text-sm">
                  {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => {
                    const hours = form.operatingHours[day]
                    return (
                      <div key={day} className="flex justify-between py-1">
                        <span className="text-[#647067]">{day}</span>
                        <span className={`font-medium ${hours?.closed ? 'text-[#B91C1C]' : 'text-[#16803C]'}`}>
                          {hours?.closed ? 'Closed' : `${hours?.open} - ${hours?.close}`}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="p-4 bg-[#F6F8F4] rounded-xl border border-[#E2E8E3]">
                <h4 className="text-sm font-semibold text-[#4B5563] mb-3">Legal Registration</h4>
                <div className="divide-y divide-[#E2E8E3] text-sm">
                  <div className="flex justify-between py-2"><span className="text-[#647067]">Legal Entity</span><span className="text-[#17201A]">{form.legalEntityType || '—'}</span></div>
                  <div className="flex justify-between py-2"><span className="text-[#647067]">TIN</span><span className="text-[#17201A] font-mono">{form.tin || '—'}</span></div>
                  {form.dtiSecRegNumber && <div className="flex justify-between py-2"><span className="text-[#647067]">DTI/SEC Reg. No.</span><span className="text-[#17201A]">{form.dtiSecRegNumber}</span></div>}
                  <div className="flex justify-between py-2"><span className="text-[#647067]">Year Established</span><span className="text-[#17201A]">{form.yearEstablished || '—'}</span></div>
                </div>
              </div>

              <div className="p-4 bg-[#F6F8F4] rounded-xl border border-[#E2E8E3]">
                <h4 className="text-sm font-semibold text-[#4B5563] mb-3">Location</h4>
                <div className="divide-y divide-[#E2E8E3] text-sm">
                  <div className="flex justify-between py-2"><span className="text-[#647067]">Municipality</span><span className="text-[#17201A] font-medium">{selectedMunicipality?.name || '—'}</span></div>
                  <div className="flex justify-between py-2"><span className="text-[#647067]">Barangay</span><span className="text-[#17201A] font-medium">{barangays.find(b => b.id === Number(form.barangayId))?.name || '—'}</span></div>
                  <div className="flex justify-between py-2"><span className="text-[#647067]">Address</span><span className="text-[#17201A]">{form.streetAddress || '—'}</span></div>
                  {form.landmark && <div className="flex justify-between py-2"><span className="text-[#647067]">Landmark</span><span className="text-[#17201A]">{form.landmark}</span></div>}
                </div>
              </div>

              <div className="p-4 bg-[#F6F8F4] rounded-xl border border-[#E2E8E3]">
                <h4 className="text-sm font-semibold text-[#4B5563] mb-3">Operations</h4>
                <div className="divide-y divide-[#E2E8E3] text-sm">
                  <div className="flex justify-between py-2"><span className="text-[#647067]">Initial Capital</span><span className="text-[#17201A] font-medium">₱{form.initialCapital ? Number(form.initialCapital).toLocaleString() : '—'}</span></div>
                  <div className="flex justify-between py-2"><span className="text-[#647067]">Floor Area</span><span className="text-[#17201A] font-medium">{form.grossFloorArea || '—'} sqm</span></div>
                  <div className="flex justify-between py-2"><span className="text-[#647067]">Employees</span><span className="text-[#17201A] font-medium">{form.numberOfEmployees || '—'}</span></div>
                  <div className="flex justify-between py-2"><span className="text-[#647067]">Occupancy</span><span className="text-[#17201A] font-medium">{form.occupancyStatus || '—'}</span></div>
                </div>
              </div>

              {Object.keys(details).length > 0 && (
                <div className="p-4 bg-[#F6F8F4] rounded-xl border border-[#E2E8E3]">
                  <h4 className="text-sm font-semibold text-[#4B5563] mb-3">{selectedCategory?.name || 'Business'} Details</h4>
                  <div className="divide-y divide-[#E2E8E3] text-sm">
                    {categoryFields.map(field => {
                      const val = details[field.key]
                      if (!val || (Array.isArray(val) && val.length === 0)) return null
                      return (
                        <div key={field.key} className="py-2">
                          <span className="text-[#647067]">{field.label}</span>
                          {field.type === 'multi_checkbox' ? (
                            <div className="flex flex-wrap gap-1.5 mt-1.5">
                              {(val as string[]).map(v => <span key={v} className="px-2 py-0.5 bg-[#EAF6ED] text-[#16803C] rounded-md text-xs font-medium">{v}</span>)}
                            </div>
                          ) : field.type === 'boolean' ? (
                            <span className="text-[#17201A] ml-2">{val ? 'Yes' : 'No'}</span>
                          ) : (
                            <span className="text-[#17201A] ml-2">{String(val)}</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="p-4 bg-[#F6F8F4] rounded-xl border border-[#E2E8E3]">
                <h4 className="text-sm font-semibold text-[#4B5563] mb-3">Documents</h4>
                {allDocs.length === 0 ? <p className="text-sm text-[#647067]">No documents required</p> : allDocs.map(doc => {
                  const process = docProcess[doc.key]
                  const extracted = process?.extractedData || {}
                  const docType = docKeyToType(doc.key)
                  const labels = docType && EXTRACTION_LABELS[docType] ? EXTRACTION_LABELS[docType] : null
                  return (
                  <div key={doc.key} className="py-2 text-sm border-b border-[#E2E8E3] last:border-0">
                    <div className="flex items-center gap-2 mb-1">
                      {documents[doc.key] ? <span className="w-4 h-4 text-[#16803C]">✓</span> : <span className="w-4 h-4 text-[#B91C1C]">✕</span>}
                      <span className="text-[#17201A] font-medium">{doc.label}</span>
                      {doc.required && <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-[#FEF2F2] text-[#B91C1C]">Required</span>}
                      <span className={`text-xs font-medium ${documents[doc.key] ? 'text-[#16803C]' : 'text-[#B91C1C]'}`}>{documents[doc.key] ? 'Uploaded' : 'Missing'}</span>
                    </div>
                    {extracted && Object.keys(extracted).length > 0 && labels && (
                      <div className="ml-6 grid grid-cols-2 gap-x-4 gap-y-0.5 mt-1">
                        {Object.entries(labels).map(([key, label]) => {
                          const val = extracted[key]
                          if (!val) return null
                          return (
                            <div key={key} className="flex gap-1 text-[11px]">
                              <span className="text-[#647067]">{label}:</span>
                              <span className="text-[#4B5563] truncate">{val}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )})}
              </div>

              <div className="p-4 bg-[#F6F8F4] rounded-xl border border-[#E2E8E3]">
                <h4 className="text-sm font-semibold text-[#4B5563] mb-3">Modules Enabled</h4>
                <p className="text-xs text-[#647067] mb-2">These modules are automatically enabled based on your category.</p>
                <div className="flex flex-wrap gap-1.5">
                  <span className="px-2 py-0.5 bg-[#EAF6ED] text-[#16803C] rounded-md text-xs font-medium">Promotion</span>
                  <span className="px-2 py-0.5 bg-[#EAF6ED] text-[#16803C] rounded-md text-xs font-medium">Reviews</span>
                  {selectedCategory?.name === 'Hotel' && <span className="px-2 py-0.5 bg-[#EAF6ED] text-[#16803C] rounded-md text-xs font-medium">Room Booking</span>}
                  {selectedCategory?.name === 'Resort' && <span className="px-2 py-0.5 bg-[#EAF6ED] text-[#16803C] rounded-md text-xs font-medium">Room Booking</span>}
                  {(selectedCategory?.name === 'Restaurant' || selectedCategory?.name === 'Café') && <span className="px-2 py-0.5 bg-[#EAF6ED] text-[#16803C] rounded-md text-xs font-medium">Menu Management</span>}
                </div>
              </div>

              <div className="p-5 bg-[#FFF7D6] rounded-xl border border-[#F4B400]/40">
                <h4 className="text-sm font-semibold text-[#A66F00] mb-3 flex items-center gap-2">Declaration</h4>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={declarationAccepted} onChange={e => setDeclarationAccepted(e.target.checked)}
                    className="mt-0.5 rounded border-[#E2E8E3] text-[#16803C] focus:ring-[#16803C] bg-white shadow-sm" />
                  <span className="text-sm text-[#A66F00] font-medium">I confirm that all information is accurate and I accept the Terms and Conditions.</span>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Step Error */}
        {stepError && (
          <div className="p-3 bg-[#FEF2F2] border border-[#FECACA] rounded-xl text-sm text-[#B91C1C] flex items-center gap-2">
            <span>{stepError}</span>
          </div>
        )}

        {/* Navigation Controls */}
        <div className="flex items-center justify-between bg-white border border-[#E2E8E3] rounded-2xl p-5 shadow-[0_6px_18px_rgba(22,101,52,0.06)]">
          <button type="button" onClick={prevStep} disabled={currentStep === 1}
            className="inline-flex items-center px-4 py-2.5 rounded-xl border border-[#E2E8E3] text-sm font-medium text-[#647067] hover:text-[#17201A] disabled:opacity-30 disabled:pointer-events-none transition">
            <ChevronLeft className="w-4 h-4 mr-1" /> Previous
          </button>

          {currentStep < totalSteps ? (
            <button type="button" onClick={nextStep}
              className="inline-flex items-center px-5 py-2.5 bg-[#16803C] hover:bg-[#126B32] text-white rounded-xl text-sm font-semibold transition">
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </button>
          ) : (
            <button type="button" onClick={handleSubmitForm} disabled={mutation.isPending}
              className="inline-flex items-center gap-2 bg-[#16803C] hover:bg-[#126B32] disabled:opacity-50 text-white px-6 py-2.5 rounded-xl text-sm font-semibold transition">
              {mutation.isPending ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Submitting...
                </>
              ) : (
                <>Submit Application</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
