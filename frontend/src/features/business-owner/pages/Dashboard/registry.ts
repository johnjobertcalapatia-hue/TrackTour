import { RestaurantDashboard } from './RestaurantDashboard'
import { CafeDashboard } from './CafeDashboard'
import { HotelDashboard } from './HotelDashboard'
import { ResortDashboard } from './ResortDashboard'
import { FoodHubDashboard } from './FoodHubDashboard'
import { TouristAttractionDashboard } from './TouristAttractionDashboard'
import { FallbackDashboard } from './FallbackDashboard'
import type { DashboardProps } from './types'

type DashboardComponent = React.ComponentType<DashboardProps>

const dashboardRegistry: Record<string, DashboardComponent> = {
  restaurant: RestaurantDashboard,
  cafe: CafeDashboard,
  hotel: HotelDashboard,
  resort: ResortDashboard,
  food_hub: FoodHubDashboard,
  tourist_attraction: TouristAttractionDashboard,
}

const categoryAliases: Record<string, string> = {
  'café': 'cafe',
  'food hub': 'food_hub',
  'tourist attraction': 'tourist_attraction',
  'hotel & restaurant combination': 'restaurant',
  homestay: 'hotel',
  'tour guide': 'tourist_attraction',
  'travel agency': 'tourist_attraction',
  'souvenir shop': 'restaurant',
  'transport service': 'tourist_attraction',
  'camping site': 'tourist_attraction',
  'dive shop': 'tourist_attraction',
  'event venue': 'tourist_attraction',
  'farm tourism': 'tourist_attraction',
}

function normalizeCategory(category: string): string {
  const lower = category.toLowerCase().trim()
  return categoryAliases[lower] || lower.replace(/\s+/g, '_')
}

export function getDashboardForCategory(category: string): { Component: DashboardComponent; isFallback: boolean } {
  const normalized = normalizeCategory(category)
  const Component = dashboardRegistry[normalized]
  if (Component) return { Component, isFallback: false }
  return { Component: FallbackDashboard, isFallback: true }
}

export const categoryLabels: Record<string, string> = {
  Restaurant: 'Restaurant',
  Café: 'Café',
  'Food Hub': 'Food Hub',
  'Hotel & Restaurant Combination': 'Hotel & Restaurant',
  Hotel: 'Hotel',
  Resort: 'Resort',
  Homestay: 'Homestay',
  'Tourist Attraction': 'Tourist Attraction',
  'Tour Guide': 'Tour Guide',
  'Travel Agency': 'Travel Agency',
  'Souvenir Shop': 'Souvenir Shop',
  'Transport Service': 'Transport Service',
  'Camping Site': 'Camping Site',
  'Dive Shop': 'Dive Shop',
  'Event Venue': 'Event Venue',
  'Farm Tourism': 'Farm Tourism',
}
