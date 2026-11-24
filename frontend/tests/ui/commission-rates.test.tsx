import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ ...api, apiErrorMessage: (_e: unknown, f: string) => f }))

import AdminCommissionRates from '@/features/admin/pages/AdminCommissionRates'
import MunicipalCommissionRates from '@/features/municipal/pages/MunicipalCommissionRates'
import { fastSplit, foodSplit, rideSplit, townPayload } from '@/shared/finance/commission-rates'

const RATES = {
  ride_driver_percent: 40,
  ride_driver_minimum: 20,
  food_system_fee_percent: 10,
  food_office_percent: 20,
  fast_platform_percent: 10,
  fast_rider_percent: 30,
  fast_office_percent: 60,
  cashout_fee_percent: 2,
  platform_net_percent: 10,
  fast_amount_minimum: 20,
  fast_amount_maximum: 100,
}
const sources = (over: Record<string, string> = {}) =>
  Object.fromEntries(Object.keys(RATES).map((k) => [k, over[k] ?? 'default']))
const LIMITS = {
  ride_driver_percent: { min: 30, max: 70 },
  ride_driver_minimum: { min: 10, max: 50 },
  food_system_fee_percent: { min: 0, max: 20 },
  food_office_percent: { min: 0, max: 100 },
  fast_platform_percent: { min: 0, max: 100 },
  fast_rider_percent: { min: 0, max: 100 },
  fast_office_percent: { min: 0, max: 100 },
  cashout_fee_percent: { min: 0, max: 5 },
}
const NO_OVERRIDES = {
  ride_driver_percent: null, ride_driver_minimum: null, food_system_fee_percent: null, food_office_percent: null,
  fast_platform_percent: null, fast_rider_percent: null, fast_office_percent: null, cashout_fee_percent: null,
}

function renderWith(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('commission split examples (§R1)', () => {
  it('ride: the office gets the exact remainder, never a flat 60%', () => {
    expect(rideSplit(200, 40, 20)).toEqual({ driver: 80, office: 120 })
    expect(rideSplit(40, 40, 20)).toEqual({ driver: 20, office: 20 })
    expect(rideSplit(15, 40, 20)).toEqual({ driver: 15, office: 0 })
  })

  it('food: 80/20 on food plus the system fee', () => {
    expect(foodSplit(100, 10, 20)).toEqual({ fee: 10, base: 110, office: 22, restaurant: 88 })
  })

  it('fast delivery: 10 / 30 / 60', () => {
    expect(fastSplit(50, 10, 30)).toEqual({ platform: 5, rider: 15, office: 30 })
  })

  it('a blank town field is sent as null (use the district default)', () => {
    expect(townPayload({ ride_driver_percent: '50', cashout_fee_percent: '' })).toMatchObject({ ride_driver_percent: 50, cashout_fee_percent: null, food_office_percent: null })
  })
})

describe('Bansud admin: commission rates', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.put.mockReset()
    api.get.mockResolvedValue({
      district: { rates: RATES, fast_amount_options: [25, 50, 100], sources: sources(), limits: LIMITS },
      municipalities: [
        { id: 1, name: 'Bansud', is_home: true, can_edit: true, effective: { municipality_id: 1, rates: RATES, fast_amount_options: [25, 50, 100], sources: sources() }, overrides: NO_OVERRIDES, has_own_rates: false },
        { id: 2, name: 'Gloria', is_home: false, can_edit: false, effective: { municipality_id: 2, rates: { ...RATES, cashout_fee_percent: 3 }, fast_amount_options: [25, 50, 100], sources: sources({ cashout_fee_percent: 'town' }) }, overrides: { ...NO_OVERRIDES, cashout_fee_percent: 3 }, has_own_rates: true },
      ],
    })
    api.put.mockResolvedValue({})
  })

  it('shows district defaults with worked examples, Bansud own rates, and every town read-only', async () => {
    renderWith(<AdminCommissionRates />)
    const district = await screen.findByRole('region', { name: 'District defaults' })
    expect(within(district).getByText(/₱200\.00 fare → driver ₱80\.00, office ₱120\.00/)).toBeInTheDocument()
    expect(within(district).getByText(/restaurant ₱88\.00, office ₱22\.00/)).toBeInTheDocument()
    expect(within(district).getByText(/TrackTour ₱5\.00, rider ₱15\.00, office ₱30\.00/)).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('still follow the current rules')

    expect(screen.getByRole('region', { name: 'Bansud own rates' })).toBeInTheDocument()
    const gloria = screen.getByTestId('rates-row-2')
    expect(gloria).toHaveTextContent('Own rates')
    expect(gloria).toHaveTextContent('3%')
    expect(within(gloria).queryByRole('button')).toBeNull()
  })

  it('warns when the Fast Delivery split is not 100% and saves the district defaults', async () => {
    renderWith(<AdminCommissionRates />)
    const district = await screen.findByRole('region', { name: 'District defaults' })
    const rider = within(district).getByLabelText('Rider')
    await waitFor(() => expect(rider).toHaveValue(30))
    fireEvent.change(rider, { target: { value: '35' } })
    expect(within(district).getByTestId('fast-split-total')).toHaveTextContent('105% — must be exactly 100%')

    fireEvent.change(rider, { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save district defaults' }))
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/admin/commission-rates', expect.objectContaining({ fast_rider_percent: 30, fast_amount_options: [25, 50, 100] })))
  })

  it('edits the limits for municipalities and saves them with the district defaults (§R5)', async () => {
    renderWith(<AdminCommissionRates />)
    const limits = await screen.findByRole('region', { name: 'Limits for municipalities' })
    const highest = within(limits).getByLabelText('Highest Online cash-out fee')
    await waitFor(() => expect(highest).toHaveValue(5))
    fireEvent.change(highest, { target: { value: '8' } })

    const lowestShare = within(limits).getByLabelText('Lowest Driver share of the fare')
    fireEvent.change(lowestShare, { target: { value: '80' } })
    expect(limits).toHaveTextContent('Lowest is above highest')
    // The district default (40%) is now outside the range being typed.
    const district = screen.getByRole('region', { name: 'District defaults' })
    expect(within(district).getByText('Outside the allowed range 80%–70%')).toBeInTheDocument()
    fireEvent.change(lowestShare, { target: { value: '30' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save district defaults' }))
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/admin/commission-rates', expect.objectContaining({
      limits: expect.objectContaining({ cashout_fee_percent: { min: 0, max: 8 }, ride_driver_percent: { min: 30, max: 70 } }),
    })))
  })
})

describe('Municipal office: own commission rates', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.put.mockReset()
    api.get.mockResolvedValue({
      municipality: { id: 2, name: 'Gloria' },
      effective: { municipality_id: 2, rates: { ...RATES, ride_driver_percent: 50 }, fast_amount_options: [25, 50, 100], sources: sources({ ride_driver_percent: 'town' }) },
      overrides: { ...NO_OVERRIDES, ride_driver_percent: 50 },
      district_defaults: RATES,
      limits: LIMITS,
    })
    api.put.mockResolvedValue({})
  })

  it('edits only this town; a blank field shows the district default and is sent as null', async () => {
    renderWith(<MunicipalCommissionRates />)
    expect(await screen.findByRole('heading', { name: /Commission rates — Gloria/ })).toBeInTheDocument()
    const share = screen.getByLabelText('Driver share of the fare')
    await waitFor(() => expect(share).toHaveValue(50))
    expect(screen.getByLabelText('Online cash-out fee')).toHaveAttribute('placeholder', '2')
    // District-only values are shown, not editable.
    expect(screen.queryByLabelText("TrackTour share of each town's net earnings")).toBeNull()
    expect(screen.getByRole('region', { name: 'Set by Bansud for the whole district' })).toHaveTextContent('10%')

    fireEvent.click(screen.getByRole('button', { name: 'Use the district default for Driver share of the fare' }))
    fireEvent.change(screen.getByLabelText('Online cash-out fee'), { target: { value: '1.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save rates' }))
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/municipal/commission-rates', expect.objectContaining({ ride_driver_percent: null, cashout_fee_percent: 1.5 })))
  })

  it("shows Bansud's allowed range on each rate and marks a value outside it (§R5)", async () => {
    renderWith(<MunicipalCommissionRates />)
    const cashout = await screen.findByLabelText('Online cash-out fee')
    expect(screen.getByText('Allowed 0%–5%')).toBeInTheDocument()
    expect(screen.getByText('Allowed ₱10.00–₱50.00')).toBeInTheDocument()
    expect(cashout).toHaveAttribute('max', '5')

    fireEvent.change(cashout, { target: { value: '6' } })
    expect(cashout).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Outside the allowed range 0%–5%')).toBeInTheDocument()
  })
})
