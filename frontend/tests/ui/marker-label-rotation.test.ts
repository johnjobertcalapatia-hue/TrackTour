import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { beachPinIcon, businessLogoIcon, pinIcon, profilePinIcon, userPinIcon } from '@/shared/utils/pin-icon'

/** Render an icon's HTML like Leaflet does and return the rotating wrapper. */
function wrapperOf(icon: { options: { html?: string | HTMLElement | false; iconAnchor?: unknown } }) {
  const host = document.createElement('div')
  host.innerHTML = String(icon.options.html)
  return host
}

describe('Restaurant names follow the compass on the rotating map', () => {
  it('the name label is inside the same turning wrapper as its pin (restaurant photo pin)', () => {
    const host = wrapperOf(businessLogoIcon('/storage/logo.png', 'Eksklusibo Grill'))
    expect(host.children).toHaveLength(1)
    const rot = host.firstElementChild as HTMLElement
    expect(rot.classList.contains('marker-rot')).toBe(true)
    expect(rot.textContent).toContain('Eksklusibo Grill')
    // Turns about the pin tip = the Leaflet icon anchor (24, 40).
    expect(rot.style.transformOrigin).toBe('24px 40px')
  })

  it('applies to every pin type on the map, each about its own tip', () => {
    const cases: Array<[string, { options: { html?: string | HTMLElement | false } }, string]> = [
      ['labelled pin', pinIcon('Plain Diner'), '24px 40px'],
      ['beach pin', beachPinIcon, '24px 40px'],
      ['guest location pin', userPinIcon, '24px 40px'],
      ['profile location pin', profilePinIcon(null, 'JD'), '24px 45px'],
    ]
    for (const [name, icon, origin] of cases) {
      const rot = wrapperOf(icon).firstElementChild as HTMLElement
      expect(rot.classList.contains('marker-rot'), name).toBe(true)
      expect(rot.style.transformOrigin, name).toBe(origin)
    }
    expect(wrapperOf(pinIcon('Plain Diner')).querySelector('.marker-rot .marker-label')?.textContent).toBe('Plain Diner')
  })

  it('navigation CSS turns the whole wrapper by the map bearing (not each piece separately)', () => {
    const css = readFileSync(resolve(__dirname, '../../src/index.css'), 'utf8')
    expect(css).toMatch(/\.map-rotator--nav \.leaflet-marker-icon > \.marker-rot \{\s*transform: rotate\(var\(--map-bearing, 0deg\)\);/)
    expect(css).not.toContain('.map-rotator--nav .leaflet-marker-icon > * {')
  })
})
