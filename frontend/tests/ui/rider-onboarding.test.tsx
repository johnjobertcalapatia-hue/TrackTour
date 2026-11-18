import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), openAuthenticatedDocument: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ ...api, apiErrorMessage: (_e: unknown, f = 'Request failed.') => f }))

import RiderOnboardingPage from '@/features/onboarding/pages/RiderOnboardingPage'
import BecomeRiderPage from '@/features/onboarding/pages/BecomeRiderPage'
import { RiderOnboardingGate } from '@/features/onboarding/components/RiderOnboardingGate'
import { RiderOnboardingOffice } from '@/features/onboarding/components/RiderOnboardingOffice'
import { useAuthStore } from '@/features/auth/services/auth-store'
import type { RiderOnboardingState } from '@/features/onboarding/types'

const office = { municipality_id: 1, municipality: 'Bansud', name: 'Bansud Tourism Office', address: 'Municipal Hall, Bansud, Oriental Mindoro', phone: null, email: null, hours: 'Mon–Fri' }

const stages = (current: number): RiderOnboardingState['stages'] =>
  ['submitted', 'appointment', 'visit', 'interview', 'training', 'assessment', 'activation'].map((key, i) => ({
    key: key as RiderOnboardingState['stages'][number]['key'],
    label: ['Application submitted', 'Appointment confirmed', 'Visit Tourism Office', 'Interview and document verification', 'Actual rider training', 'Assessment and approval', 'Rider account activation'][i]!,
    status: i < current ? 'done' : i === current ? 'current' : 'upcoming',
    detail: null,
  }))

function state(overrides: Partial<RiderOnboardingState> = {}): RiderOnboardingState {
  return {
    reference: 'TT-RIDER-2026-00125',
    account_status: 'pending_review',
    rejection_remarks: null,
    office,
    application: {
      submitted: false, submitted_at: null, requested_services: [], vehicle_type: null, vehicle_make: null, vehicle_model: null,
      vehicle_plate_number: null, vehicle_year: null, license_number: null, license_expiry: null,
      documents: [
        { key: 'drivers_license_front', name: "Driver's license (front)", uploaded: false, required: true },
        { key: 'drivers_license_back', name: "Driver's license (back)", uploaded: false, required: true },
        { key: 'or_cr_image', name: 'Vehicle OR/CR', uploaded: false, required: true },
        { key: 'nbi_clearance', name: 'NBI or police clearance', uploaded: false, required: false },
      ],
    },
    appointment: null,
    stages: stages(1),
    ...overrides,
  }
}

const slot = (id: number, time: string, remaining: number) => ({
  id, starts_at: '2026-11-19T01:00:00Z', date: '2026-11-19', time, capacity: 5, booked: 5 - remaining, remaining, status: 'open' as const,
  location_name: 'Bansud Tourism Office', location_address: 'Municipal Hall',
})

function renderAt(ui: React.ReactNode, path = '/rider/onboarding') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/rider/onboarding" element={ui} />
          <Route path="/rider/map" element={<p>rider map</p>} />
          <Route path="*" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ user: { id: 9, name: 'Ana', email: 'ana@example.com', role: 'rider', account_status: 'pending_review' } as never, loading: false })
})

describe('rider onboarding — applicant', () => {
  it('offers online registration and shows where interview and training happen (no walk-in registration)', () => {
    renderAt(<BecomeRiderPage />, '/become-a-rider')

    expect(screen.getByRole('heading', { level: 1, name: 'Become a TrackTour Rider' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Get Started/ })).toHaveAttribute('href', '/register/rider')
    expect(screen.getByRole('link', { name: /See training locations/ })).toHaveAttribute('href', '/become-a-rider/offices')
    expect(screen.queryByText(/Walk-in Registration/)).toBeNull()
    expect(screen.getByText('Requirements verified')).toBeInTheDocument()
  })

  it('sends applicants from the rider area to onboarding', () => {
    renderAt(<RiderOnboardingGate><p>rider area</p></RiderOnboardingGate>, '/rider/earnings')
    expect(screen.queryByText('rider area')).toBeNull()
  })

  it('collects services, vehicle and documents as multipart form data', async () => {
    api.get.mockResolvedValue(state())
    api.post.mockResolvedValue(state())
    renderAt(<RiderOnboardingPage />)

    expect(await screen.findByText('Step 2 of 4')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: /Ride-Hailing/ }))
    fireEvent.click(screen.getByRole('radio', { name: 'Tricycle' }))
    fireEvent.change(screen.getByLabelText('Plate number'), { target: { value: 'ABC 1234' } })
    fireEvent.change(screen.getByLabelText("Driver's license number"), { target: { value: 'N01-23' } })
    fireEvent.change(screen.getByLabelText('License expiry'), { target: { value: '2028-01-01' } })
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))

    const front = new File(['x'], 'front.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByLabelText("Driver's license (front)"), { target: { files: [front] } })
    fireEvent.click(screen.getByRole('button', { name: /Submit application/ }))

    await waitFor(() => expect(api.post).toHaveBeenCalled())
    const [url, body] = api.post.mock.calls[0]!
    expect(url).toBe('/rider/onboarding/application')
    const form = body as FormData
    expect(form.getAll('requested_services[]')).toEqual(['food', 'transport'])
    expect(form.get('vehicle_type')).toBe('tricycle')
    expect(form.get('drivers_license_front')).toBe(front)
  })

  it('books an available slot and never offers a full one', async () => {
    api.get.mockImplementation((url: string) =>
      Promise.resolve(url === '/rider/onboarding/slots' ? { office, slots: [slot(11, '08:00 AM', 3), slot(12, '09:00 AM', 5), slot(13, '02:00 PM', 0)] } : state({ application: { ...state().application, submitted: true, requested_services: ['food'] } })),
    )
    api.post.mockResolvedValue({})
    renderAt(<RiderOnboardingPage />)

    expect(await screen.findByText('Step 4 of 4')).toBeInTheDocument()
    expect(await screen.findByRole('radio', { name: /02:00 PM\s*Full/ })).toBeDisabled()
    // The earliest open seat is preselected (automatic scheduling); the rider may pick another.
    const summary = screen.getByRole('complementary', { name: 'Appointment summary' })
    expect(within(summary).getByText('08:00 AM')).toBeInTheDocument()
    expect(within(summary).getByText('Earliest available')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /08:00 AM/ })).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(screen.getByRole('radio', { name: /09:00 AM\s*5 slots left/ }))
    expect(within(summary).getByText('09:00 AM')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Confirm Appointment/ }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/rider/onboarding/appointment', { schedule_id: 12 }))
  })

  it('shows the reference, appointment and seven-step tracker after booking', async () => {
    api.get.mockResolvedValue(
      state({
        application: { ...state().application, submitted: true, requested_services: ['food'] },
        appointment: { id: 5, status: 'booked', walk_in: false, checked_in_at: null, slot: slot(12, '09:00 AM', 4) },
        stages: stages(2),
      }),
    )
    renderAt(<RiderOnboardingPage />)

    expect(await screen.findByText('TT-RIDER-2026-00125')).toBeInTheDocument()
    const tracker = screen.getByRole('list', { name: 'Onboarding progress' })
    expect(within(tracker).getAllByRole('listitem')).toHaveLength(7)
    expect(within(tracker).getByText('Visit Tourism Office').closest('li')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('button', { name: 'Reschedule' })).toBeInTheDocument()
  })

  it('shows the rejection reason', async () => {
    api.get.mockResolvedValue(state({ account_status: 'rejected', rejection_remarks: 'License is not valid.' }))
    renderAt(<RiderOnboardingPage />)

    expect(await screen.findByText('Your application was not approved')).toBeInTheDocument()
    expect(screen.getByText('Reason: License is not valid.')).toBeInTheDocument()
  })

  it('tells a waiting applicant they will be scheduled automatically and lists notices', async () => {
    api.get.mockResolvedValue(
      state({
        application_status: 'pending_schedule',
        application_status_label: 'Pending schedule',
        application: { ...state().application, submitted: true, requested_services: ['food'] },
        notices: [{ id: 1, title: 'Waiting for a schedule', message: 'We will schedule you automatically.', created_at: '2026-11-18T02:00:00Z' }],
      }),
    )
    renderAt(<RiderOnboardingPage />)

    expect(await screen.findByText('Waiting for an available schedule')).toBeInTheDocument()
    expect(screen.queryByText('Step 4 of 4')).toBeNull()
    expect(screen.getByText('Pending schedule')).toBeInTheDocument()
    expect(within(screen.getByLabelText('Notices')).getByText('Waiting for a schedule')).toBeInTheDocument()
  })

  it('flags an automatically scheduled appointment that needs rescheduling', async () => {
    api.get.mockResolvedValue(
      state({
        application_status: 'appointment_scheduled',
        application: { ...state().application, submitted: true, requested_services: ['food'] },
        appointment: { id: 5, status: 'booked', walk_in: false, scheduled_by: 'system', needs_reschedule: true, checked_in_at: null, slot: slot(12, '09:00 AM', 4) },
        stages: stages(2),
      }),
    )
    renderAt(<RiderOnboardingPage />)

    expect(await screen.findByText('Your appointment date is no longer available')).toBeInTheDocument()
    expect(screen.getByText('Scheduled automatically at the earliest available time.')).toBeInTheDocument()
  })
})

const applicant = {
  id: 9, name: 'Ana Cruz', email: 'ana@example.com', phone: '09171234567', account_status: 'pending_review', reference: 'TT-RIDER-2026-00009',
  requested_services: ['food', 'transport'], vehicle_type: 'motorcycle', application_submitted: true,
  current_stage: { key: 'visit', label: 'Visit Tourism Office', status: 'current' as const }, appointment: null, registered_at: '2026-11-10T00:00:00Z',
}

const evaluation = (over: Record<string, unknown> = {}) => ({
  requested_services: ['food', 'transport'],
  checklist: [
    { key: 'identification', label: 'Valid identification', verified: null },
    { key: 'drivers_license', label: "Driver's license", verified: null },
    { key: 'vehicle_documents', label: 'Vehicle documents', verified: null },
    { key: 'profile', label: 'Profile information', verified: null },
  ],
  interview: null, assessment: null, eligible_services: [], eligibility: [], decisions: [],
  ...over,
})

function detail(over: { application_status?: string; appointment?: unknown; stages?: unknown; evaluation?: unknown } = {}) {
  return {
    applicant: {
      ...applicant, application_status: over.application_status ?? 'appointment_scheduled',
      vehicle: { type: 'motorcycle', plate_number: 'ABC 1234', make: null, model: null, license_number: 'N01', license_expiry: '2028-01-01' }, missing_documents: [], documents: [],
    },
    appointment: over.appointment ?? { id: 5, status: 'booked', walk_in: false, checked_in_at: null, slot: slot(12, '09:00 AM', 4) },
    stages: over.stages ?? stages(2),
    evaluation: over.evaluation ?? evaluation(),
    history: { interviews: [], attendance: [], assessments: [] },
  }
}

function monthOf(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const days = Array.from({ length: 28 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1, i + 1))
    return {
      date: d.toISOString().slice(0, 10), weekday: d.getUTCDay() || 7, past: false, schedulable: true, overridden: false,
      trainer_available: true, interviewer_available: true, notes: null, booked: i === 19 ? 2 : 0, affected: 0,
    }
  })
  return { office, month, days, summary: { available_days: 28, unavailable_days: 0, affected_appointments: 0, pending_schedule: 1 } }
}

function mockOffice(applicantDetail: ReturnType<typeof detail>) {
  api.get.mockImplementation((url: string, config?: { params?: Record<string, string> }) => {
    if (url === '/onboarding-office/appointments') {
      return Promise.resolve({ date: '2026-11-19', sessions: [{ ...slot(12, '09:00 AM', 4), appointments: [{ id: 5, status: 'booked', walk_in: false, applicant }] }] })
    }
    if (url === '/onboarding-office/schedules') return Promise.resolve({ office, slots: [slot(12, '09:00 AM', 4)] })
    if (url === '/onboarding-office/availability') return Promise.resolve(monthOf(config?.params?.month ?? '2026-11'))
    if (url === '/onboarding-office/affected') return Promise.resolve([])
    return Promise.resolve(applicantDetail)
  })
}

describe('rider onboarding — Tourism Office', () => {
  it('checks in a booked applicant from the day list', async () => {
    mockOffice(detail())
    api.post.mockResolvedValue({})
    renderAt(<RiderOnboardingOffice />, '/municipal/onboarding')

    fireEvent.click(await screen.findByRole('button', { name: /Ana Cruz/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Check in' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/onboarding-office/applicants/9/check-in', {}))
  })

  it('has no session posting — the office marks a date unavailable and reviews affected appointments', async () => {
    mockOffice(detail())
    api.put.mockResolvedValue({ schedulable: false, affected: [{ ...applicant, appointment: { id: 5, status: 'booked', walk_in: false, checked_in_at: null, slot: slot(12, '09:00 AM', 4) } }], scheduled_from_pending: 0 })
    api.post.mockResolvedValue({ moved: 1, unplaced: 0 })
    renderAt(<RiderOnboardingOffice />, '/admin/rider-onboarding')

    fireEvent.click(await screen.findByRole('tab', { name: /Training availability/ }))
    expect(screen.queryByRole('button', { name: /Add sessions/ })).toBeNull()
    const days = await screen.findAllByRole('button', { name: /2 booked/ })
    fireEvent.click(days[0]!)

    expect(screen.getByRole('button', { name: /Save availability/ })).toBeDisabled()
    const trainer = screen.getByRole('switch', { name: 'Trainer available' })
    expect(trainer).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(trainer)
    expect(trainer).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText(/will need rescheduling\. They will not change automatically/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Save availability/ }))

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(expect.stringMatching(/^\/onboarding-office\/availability\/\d{4}-\d{2}-20$/), {
        trainer_available: false, interviewer_available: true, notes: null,
      }),
    )
    const warning = await screen.findByRole('region', { name: 'Affected appointments' })
    expect(within(warning).getByText(/Ana Cruz/)).toBeInTheDocument()
    fireEvent.click(within(warning).getByRole('button', { name: /Reschedule all/ }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/onboarding-office/affected/reschedule', { date: undefined }))
  })

  it('records an itemised training assessment for the requested services', async () => {
    mockOffice(detail({
      application_status: 'training_completed',
      appointment: { id: 5, status: 'checked_in', walk_in: false, checked_in_at: '2026-11-19T01:05:00Z', slot: slot(12, '09:00 AM', 4) },
      stages: stages(5),
      evaluation: evaluation({ interview: { result: 'passed', notes: null } }),
    }))
    api.post.mockResolvedValue({})
    renderAt(<RiderOnboardingOffice />, '/municipal/onboarding')

    fireEvent.click(await screen.findByRole('button', { name: /Ana Cruz/ }))
    const step = await screen.findByRole('region', { name: 'Training assessment' })
    const save = within(step).getByRole('button', { name: 'Save assessment' })
    expect(save).toBeDisabled()
    for (const name of ['TrackTour orientation', 'Safety procedures', 'Navigation and GPS', 'Delivery procedures', 'Passenger procedures', 'Practical assessment']) {
      fireEvent.click(within(within(step).getByRole('radiogroup', { name })).getByRole('radio', { name: name === 'Passenger procedures' ? 'Failed' : 'Passed' }))
    }
    fireEvent.click(save)
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/onboarding-office/applicants/9/assessment', expect.objectContaining({
        score: 80,
        items: { orientation: 'passed', safety: 'passed', navigation: 'passed', delivery: 'passed', passenger: 'failed', practical: 'passed' },
      })),
    )
  })

  it('approves only the services the assessment qualifies for; reject and return need a reason', async () => {
    const items = ['orientation', 'safety', 'navigation', 'delivery', 'passenger', 'practical'].map((key) => ({ key, label: key, result: key === 'passenger' ? 'failed' : 'passed' }))
    mockOffice(detail({
      application_status: 'for_final_approval',
      appointment: { id: 5, status: 'checked_in', walk_in: false, checked_in_at: '2026-11-19T01:05:00Z', slot: slot(12, '09:00 AM', 4) },
      stages: stages(5),
      evaluation: evaluation({
        interview: { result: 'passed', notes: null },
        assessment: { result: 'passed', score: 85, notes: null, items },
        eligible_services: ['food'],
      }),
    }))
    api.post.mockResolvedValue({})
    renderAt(<RiderOnboardingOffice />, '/municipal/onboarding')

    fireEvent.click(await screen.findByRole('button', { name: /Ana Cruz/ }))
    const panel = await screen.findByRole('region', { name: 'Final evaluation' })
    expect(within(panel).getByRole('checkbox', { name: /Approve Ride-Hailing/ })).toBeDisabled()
    expect(within(panel).getByRole('checkbox', { name: /Approve Food Delivery/ })).toBeChecked()
    expect(within(panel).getByRole('button', { name: 'Reject applicant' })).toBeDisabled()
    expect(within(panel).getByRole('button', { name: 'Return for further evaluation' })).toBeDisabled()

    fireEvent.click(within(panel).getByRole('button', { name: 'Approve rider' }))
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/onboarding-office/applicants/9/decision', { decision: 'approve', services: ['food'], remarks: undefined }),
    )

    fireEvent.change(within(panel).getByPlaceholderText(/Remarks/), { target: { value: 'Repeat the passenger module.' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Return for further evaluation' }))
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/onboarding-office/applicants/9/decision', { decision: 'return', remarks: 'Repeat the passenger module.' }),
    )
  })

  it('quick-approves a test rider for the presentation, with the services chosen', async () => {
    mockOffice({ ...detail(), quick_approve_enabled: true } as ReturnType<typeof detail>)
    api.post.mockResolvedValue({})
    renderAt(<RiderOnboardingOffice />, '/municipal/onboarding')

    fireEvent.click(await screen.findByRole('button', { name: /Ana Cruz/ }))
    const box = await screen.findByRole('region', { name: 'Quick approve' })
    fireEvent.click(within(box).getByRole('checkbox', { name: 'Ride-Hailing' }))
    fireEvent.click(within(box).getByRole('button', { name: /Approve rider now/ }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/onboarding-office/applicants/9/quick-approve', { services: ['food'] }))
    expect(await screen.findByText('Rider approved. They can now go online.')).toBeInTheDocument()
  })

  it('hides quick approve when it is turned off', async () => {
    mockOffice(detail())
    renderAt(<RiderOnboardingOffice />, '/municipal/onboarding')

    fireEvent.click(await screen.findByRole('button', { name: /Ana Cruz/ }))
    await screen.findByRole('button', { name: 'Check in' })
    expect(screen.queryByRole('region', { name: 'Quick approve' })).toBeNull()
  })

  it('verifies requirements in phase 1, and has no walk-in registration', async () => {
    mockOffice({ ...detail({ application_status: 'requirements_review', appointment: null, stages: stages(1) }) } as ReturnType<typeof detail>)
    api.post.mockResolvedValue({})
    renderAt(<RiderOnboardingOffice />, '/municipal/onboarding')

    expect(screen.queryByRole('tab', { name: /Walk-in/ })).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: /Ana Cruz/ }))
    const step = await screen.findByRole('region', { name: 'Verify requirements (phase 1)' })
    const returnButton = within(step).getByRole('button', { name: 'Return for correction' })
    expect(returnButton).toBeDisabled()
    // No scheduling before verification.
    expect(screen.queryByRole('region', { name: 'Schedule and reject' })).toBeNull()

    fireEvent.click(within(step).getByRole('button', { name: 'Verify requirements' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/onboarding-office/applicants/9/requirements/verify', {}))

    fireEvent.change(within(step).getByPlaceholderText(/What needs correction/), { target: { value: 'Blurry OR/CR.' } })
    fireEvent.click(returnButton)
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/onboarding-office/applicants/9/requirements/return', { remarks: 'Blurry OR/CR.' }))
  })
})

describe('rider onboarding — phase 1 for the applicant', () => {
  it('waits for requirements verification before any training is scheduled', async () => {
    api.get.mockResolvedValue(state({
      application_status: 'requirements_review', application_status_label: 'Requirements under review',
      application: { ...state().application, submitted: true, requested_services: ['food'] },
      requirements: { verified: false, verified_at: null, remarks: null },
    }))
    renderAt(<RiderOnboardingPage />)

    expect(await screen.findByText('Requirements under review', { selector: 'p' })).toBeInTheDocument()
    expect(screen.queryByText('Step 4 of 4')).toBeNull()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('shows the office note and lets the applicant resubmit when requirements are returned', async () => {
    api.get.mockResolvedValue(state({
      application_status: 'requirements_returned',
      application: { ...state().application, submitted: true, requested_services: ['food'] },
      requirements: { verified: false, verified_at: null, remarks: 'The OR/CR photo is blurry.' },
    }))
    renderAt(<RiderOnboardingPage />)

    expect(await screen.findByText('Your requirements need correction')).toBeInTheDocument()
    expect(screen.getByText('The OR/CR photo is blurry.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Update and resubmit' }))
    expect(await screen.findByText('Step 2 of 4')).toBeInTheDocument()
  })
})
