import LandingNav from './components/LandingNav'
import LandingFooter from './components/LandingFooter'
import TouristFoodItemDetail from '@/features/tourist/pages/TouristFoodItemDetail'

const POPPINS = { fontFamily: "'Poppins', ui-sans-serif, system-ui, sans-serif" }

/**
 * Public food item page (/explore/food/item/:id): the same food item page
 * tourists see, inside the public site's navigation and footer. Guests add to
 * the guest cart and sign in to check out.
 */
export default function LandingFoodItemPage() {
  return (
    <div className="min-h-screen bg-[#FAFAF5] text-[#17201A]" style={POPPINS}>
      <header className="relative bg-gradient-to-br from-[#062814] via-[#0B5D2E] to-[#1F7A45] pb-4">
        <LandingNav active="explore" />
      </header>
      <div className="mx-auto max-w-[1500px] px-5 py-8 lg:px-8">
        <TouristFoodItemDetail />
      </div>
      <LandingFooter badge="Bansud, Oriental Mindoro" />
    </div>
  )
}
