import { Link, useNavigate } from 'react-router-dom'
import { ApplicationLogo } from '@/shared/components/ApplicationLogo'
import { ArrowRight, MapPin, Building2, Bike } from 'lucide-react'
import { cn } from '@/shared/utils'

const roles = [
  {
    id: 'tourist',
    title: 'Tourist',
    description: 'Explore destinations, book accommodations, order food',
    icon: MapPin,
    gradient: 'from-emerald-500 to-teal-600',
    hoverBorder: 'hover:border-emerald-400',
  },
  {
    id: 'business_owner',
    title: 'Business Owner',
    description: 'Manage your hotel, restaurant, resort, or attraction',
    icon: Building2,
    gradient: 'from-blue-500 to-indigo-600',
    hoverBorder: 'hover:border-primary',
  },
  {
    id: 'rider',
    title: 'Rider / Driver',
    description: 'Deliver food and provide transportation services',
    icon: Bike,
    gradient: 'from-orange-500 to-amber-500',
    hoverBorder: 'hover:border-orange-400',
  },
]

export default function RoleSelectionPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen glass-bg glass-bg-orbs flex flex-col items-center justify-center px-6 py-12">
      <div className="mb-6">
        <Link to="/">
          <ApplicationLogo className="w-30 h-30" />
        </Link>
      </div>

      <div className="w-full max-w-lg px-6 py-8 glass-card rounded-2xl">
        <h1 className="text-2xl font-bold text-center text-ink mb-2">Join TrackTour</h1>
        <p className="text-center text-sm text-ink-soft mb-8">
          How would you like to use the platform?
        </p>

        <div className="space-y-4">
          {roles.map((role) => (
            <button
              key={role.id}
              onClick={() => navigate(role.id === 'rider' ? '/register/rider' : `/register?role=${role.id}`)}
              className={cn(
                'w-full flex items-center gap-4 p-5 rounded-xl border border-white/40 bg-white/60 backdrop-blur-md transition-all duration-200 group text-left',
                role.hoverBorder,
                'hover:bg-white/90 hover:shadow-glass hover:-translate-y-0.5'
              )}
            >
              <div
                className={cn(
                  'w-12 h-12 rounded-xl bg-gradient-to-br flex items-center justify-center text-white shrink-0 shadow-glass',
                  role.gradient
                )}
              >
                <role.icon className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-ink">{role.title}</h3>
                <p className="text-sm text-ink-soft mt-0.5">{role.description}</p>
              </div>
              <ArrowRight className="w-5 h-5 text-ink-soft group-hover:text-primary transition-colors" />
            </button>
          ))}
        </div>
      </div>

      <p className="mt-6 text-sm text-ink-soft">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-primary hover:text-primary-dark">
          Sign In
        </Link>
      </p>
    </div>
  )
}
