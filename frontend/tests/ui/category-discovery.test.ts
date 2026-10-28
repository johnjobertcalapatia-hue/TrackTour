import { describe, expect, it } from 'vitest'
import {
  getDiscoveryGroup,
  isDiningCategory,
  isHotelRestaurantCombination,
  HOTEL_RESTAURANT_COMBINATION_CATEGORY_ID,
} from '@/shared/utils/category'

describe('discovery group classification', () => {
  it('classifies Hotel & Restaurant Combination as accommodation by name', () => {
    expect(getDiscoveryGroup('Hotel & Restaurant Combination')).toBe('accommodation')
    expect(isHotelRestaurantCombination('Hotel & Restaurant Combination')).toBe(true)
    expect(isDiningCategory('Hotel & Restaurant Combination')).toBe(false)
  })

  it('treats seed category ID 3 as accommodation when name is missing or combo-like', () => {
    expect(getDiscoveryGroup(null, HOTEL_RESTAURANT_COMBINATION_CATEGORY_ID)).toBe('accommodation')
    expect(getDiscoveryGroup('Hotel & Restaurant Combination', 3)).toBe('accommodation')
  })

  it('does not force id 3 over a pure Restaurant name (production id drift)', () => {
    expect(getDiscoveryGroup('Restaurant', 3)).toBe('dining')
  })

  it('keeps plain restaurants as dining', () => {
    expect(getDiscoveryGroup('Restaurant')).toBe('dining')
    expect(getDiscoveryGroup('Café')).toBe('dining')
    expect(getDiscoveryGroup('Food Hub')).toBe('dining')
  })

  it('classifies resorts/hotels as accommodation', () => {
    expect(getDiscoveryGroup('Resort')).toBe('accommodation')
    expect(getDiscoveryGroup('Hotel')).toBe('accommodation')
    expect(getDiscoveryGroup('Homestay')).toBe('accommodation')
  })

  it('keeps accommodation names that contain spot terms as accommodation (PHP parity)', () => {
    expect(getDiscoveryGroup('Beach Resort')).toBe('accommodation')
    expect(getDiscoveryGroup('Mountain Resort')).toBe('accommodation')
    expect(getDiscoveryGroup('Private Resort')).toBe('accommodation')
  })

  it('classifies attractions as spot', () => {
    expect(getDiscoveryGroup('Tourist Attraction')).toBe('spot')
    expect(getDiscoveryGroup('Attractions')).toBe('spot')
    expect(getDiscoveryGroup('Farm Tourism')).toBe('spot')
  })

  it('returns other for unfamiliar categories instead of hiding them', () => {
    expect(getDiscoveryGroup('Souvenir Shop')).toBe('other')
    expect(getDiscoveryGroup('Dive Shop')).toBe('other')
  })
})
