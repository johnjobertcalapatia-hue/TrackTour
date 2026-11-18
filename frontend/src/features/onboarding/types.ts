// Grab-style rider onboarding: application → appointment → office steps.

export type StageStatus = 'done' | 'current' | 'upcoming' | 'failed'

export interface OnboardingStage {
  key: 'submitted' | 'requirements' | 'appointment' | 'visit' | 'interview' | 'training' | 'assessment' | 'activation'
  label: string
  status: StageStatus
  detail: string | null
}

export interface OnboardingSlot {
  id: number
  starts_at: string
  date: string
  time: string
  capacity: number
  booked: number
  remaining: number
  status: 'open' | 'closed'
  location_name: string
  location_address: string | null
}

export interface OnboardingAppointment {
  id: number
  status: 'booked' | 'checked_in' | 'completed' | 'cancelled' | 'no_show'
  walk_in: boolean
  scheduled_by?: 'system' | 'rider' | 'office'
  needs_reschedule?: boolean
  checked_in_at: string | null
  slot: OnboardingSlot | null
}

export interface RegistrationOffice {
  municipality_id: number
  municipality: string
  name: string
  address: string
  phone: string | null
  email: string | null
  hours: string
  is_home?: boolean
  next_session_at?: string | null
  open_seats?: number
}

export interface OnboardingDocument {
  key: 'drivers_license_front' | 'drivers_license_back' | 'or_cr_image' | 'nbi_clearance'
  name: string
  uploaded: boolean
  required: boolean
}

export interface RiderOnboardingState {
  reference: string | null
  account_status: string
  application_status?: string | null
  application_status_label?: string | null
  notices?: { id: number; title: string; message: string; created_at: string }[]
  /** Phase 1 → 2: training is scheduled once the office verifies the requirements. */
  requirements?: { verified: boolean; verified_at: string | null; remarks: string | null }
  rejection_remarks: string | null
  office: RegistrationOffice | null
  application: {
    submitted: boolean
    submitted_at: string | null
    requested_services: string[]
    vehicle_type: string | null
    vehicle_make: string | null
    vehicle_model: string | null
    vehicle_plate_number: string | null
    vehicle_year: number | null
    license_number: string | null
    license_expiry: string | null
    documents: OnboardingDocument[]
  }
  appointment: OnboardingAppointment | null
  stages: OnboardingStage[]
}

export interface ApplicantSummary {
  id: number
  name: string
  email: string
  phone: string | null
  account_status: string
  application_status?: string | null
  application_status_label?: string | null
  requirements_verified_at?: string | null
  requirements_remarks?: string | null
  reference: string | null
  requested_services: string[]
  vehicle_type: string | null
  application_submitted: boolean
  current_stage: { key: string; label: string; status: StageStatus } | null
  appointment: OnboardingAppointment | null
  registered_at: string
}

export const SERVICE_LABELS: Record<string, string> = { food: 'Food Delivery', transport: 'Ride-Hailing' }
export const VEHICLE_LABELS: Record<string, string> = { motorcycle: 'Motorcycle', tricycle: 'Tricycle', car: 'Car', van: 'Van', bicycle: 'Bicycle' }

/** Vehicles that can carry passengers (ride-hailing). A bicycle is food delivery only. */
export const RIDE_HAILING_VEHICLES = ['motorcycle', 'tricycle', 'car', 'van']
export const canRideHail = (vehicle?: string | null) => !!vehicle && RIDE_HAILING_VEHICLES.includes(vehicle)

/** Philippine-local date for an ISO timestamp, e.g. "Thursday, November 19, 2026". */
export function manilaDate(iso: string, options: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) {
  return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', ...options }).format(new Date(iso))
}

export interface AvailabilityDay {
  date: string
  weekday: number
  past: boolean
  schedulable: boolean
  overridden: boolean
  trainer_available: boolean
  interviewer_available: boolean
  notes: string | null
  booked: number
  affected: number
}

export interface AvailabilityMonth {
  office: RegistrationOffice
  month: string
  days: AvailabilityDay[]
  summary: { available_days: number; unavailable_days: number; affected_appointments: number; pending_schedule: number }
}

export interface Evaluation {
  requested_services: string[]
  checklist: { key: string; label: string; verified: boolean | null }[]
  interview: { result: string; notes: string | null } | null
  assessment: { result: string; score: number; notes: string | null; items: { key: string; label: string; result: 'passed' | 'failed' | 'na' }[] } | null
  eligible_services: string[]
  eligibility: { service: string; status: string; decided_at: string }[]
  decisions: { decision: string; services: string[] | null; remarks: string | null; by: string | null; at: string }[]
}

export const CHECKLIST_ITEMS = [
  { key: 'identification', label: 'Valid identification' },
  { key: 'drivers_license', label: "Driver's license" },
  { key: 'vehicle_documents', label: 'Vehicle documents' },
  { key: 'profile', label: 'Profile information' },
] as const

export const ASSESSMENT_ITEMS = [
  { key: 'orientation', label: 'TrackTour orientation', service: null },
  { key: 'safety', label: 'Safety procedures', service: null },
  { key: 'navigation', label: 'Navigation and GPS', service: null },
  { key: 'delivery', label: 'Delivery procedures', service: 'food' },
  { key: 'passenger', label: 'Passenger procedures', service: 'transport' },
  { key: 'practical', label: 'Practical assessment', service: null },
] as const
