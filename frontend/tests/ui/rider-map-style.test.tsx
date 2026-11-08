import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RiderMapStyleSwitcher } from '@/features/rider/components/RiderMapStyleSwitcher'
import { MAP_STYLES, loadMapStyle, saveMapStyle } from '@/shared/utils/map-tiles'

describe('Rider map type (Standard / Dark / Satellite)', () => {
  beforeEach(() => localStorage.clear())

  it('offers the three map types and marks the current one', () => {
    render(<RiderMapStyleSwitcher value="standard" onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Map type' }))

    const options = screen.getAllByRole('radio')
    expect(options.map((o) => o.textContent)).toEqual(['Standard', 'Dark', 'Satellite'])
    expect(screen.getByRole('radio', { name: 'Standard' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'false')
    // Each option shows its icon (map / moon / satellite).
    expect(screen.getByTestId('map-style-icon-standard')).toBeInTheDocument()
    expect(screen.getByTestId('map-style-icon-dark')).toBeInTheDocument()
    expect(screen.getByTestId('map-style-icon-satellite')).toBeInTheDocument()
  })

  it('switches to the dark map and closes the menu', () => {
    const onChange = vi.fn()
    render(<RiderMapStyleSwitcher value="standard" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Map type' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }))

    expect(onChange).toHaveBeenCalledWith('dark')
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
  })

  it('closes on Escape and on an outside tap', () => {
    render(<div><span>outside</span><RiderMapStyleSwitcher value="dark" onChange={vi.fn()} /></div>)
    const toggle = screen.getByRole('button', { name: 'Map type' })

    fireEvent.click(toggle)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()

    fireEvent.click(toggle)
    fireEvent.mouseDown(screen.getByText('outside'))
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
  })

  it('remembers the rider\'s choice on this device and ignores unknown values', () => {
    expect(loadMapStyle('rider_map_style')).toBe('standard')
    saveMapStyle('rider_map_style', 'dark')
    expect(loadMapStyle('rider_map_style')).toBe('dark')
    localStorage.setItem('rider_map_style', 'google-night')
    expect(loadMapStyle('rider_map_style')).toBe('standard')
  })

  it('uses a free dark map: the standard OpenStreetMap tiles, darkened by CSS (no paid provider)', () => {
    expect(MAP_STYLES.dark.url).toBe(MAP_STYLES.standard.url)
    expect(MAP_STYLES.dark.url).toContain('tile.openstreetmap.org')
    expect(MAP_STYLES.dark.attribution).toContain('OpenStreetMap')
    expect(MAP_STYLES.dark.attribution).not.toContain('CARTO')
    expect(MAP_STYLES.satellite.attribution).toContain('Esri')
    // Esri has no imagery past zoom 18 over Bansud: Leaflet must enlarge the
    // zoom-18 photo rather than request "Map data not yet available" tiles.
    expect(MAP_STYLES.satellite.maxNativeZoom).toBe(18)
    expect(MAP_STYLES.dark.containerClass).toBe('map-style-dark')
    // Standard is dimmed (tile filter only); satellite is untouched.
    expect(MAP_STYLES.standard.containerClass).toBe('map-style-standard')
    expect(MAP_STYLES.satellite.containerClass).toBeUndefined()
  })
})
