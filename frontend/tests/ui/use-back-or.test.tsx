import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { hasInAppHistory, useBackOr } from '@/shared/hooks/use-back-or'

/**
 * Back after paying on PayMongo (reported 2026-11-09): PayMongo redirects to
 * /payment/callback, which replaces itself with the order page. The entry
 * before that is PayMongo's checkout, so a plain history-back from the order
 * page returned to PayMongo's "payment successful" page. Back now only goes
 * back when the previous entry is ours (React Router's history idx > 0).
 */

function Page() {
  const goBack = useBackOr('/tourist/activities?view=orders')
  const { pathname, search } = useLocation()
  return (
    <>
      <output data-testid="where">{pathname + search}</output>
      <button type="button" onClick={goBack}>Back</button>
    </>
  )
}

function renderAt(entries: string[]) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <Routes>
        <Route path="*" element={<Page />} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => window.history.replaceState(null, ''))

describe('useBackOr', () => {
  it('arrived from PayMongo (first page of this app load): Back opens My Orders, not PayMongo', async () => {
    window.history.replaceState({ usr: null, key: 'k', idx: 0 }, '')
    expect(hasInAppHistory()).toBe(false)
    renderAt(['/tourist/orders/11/progress'])
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Back' })) })
    expect(screen.getByTestId('where')).toHaveTextContent('/tourist/activities?view=orders')
  })

  it('no router state at all (a fresh tab): also opens My Orders', () => {
    window.history.replaceState(null, '')
    expect(hasInAppHistory()).toBe(false)
  })

  it('came from another page of the app: Back goes back to it', async () => {
    window.history.replaceState({ usr: null, key: 'k', idx: 3 }, '')
    expect(hasInAppHistory()).toBe(true)
    renderAt(['/tourist/food/cart', '/tourist/orders/11/progress'])
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Back' })) })
    expect(screen.getByTestId('where')).toHaveTextContent('/tourist/food/cart')
  })
})
