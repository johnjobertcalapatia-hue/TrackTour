import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { API_ENDPOINTS } from '@/shared/constants'
import { Settings, Globe, Clock } from 'lucide-react'

interface SystemConfig {
  site_name: string
  site_description: string
  site_url: string
  admin_email: string
  timezone: string
  maintenance_mode: boolean
  registration_enabled: boolean
  max_upload_size: number
  sms_provider: string | null
  email_driver: string
  cache_driver: string
  app_env: string
  app_debug: boolean
}

export default function AdminSystemConfig() {
  const { data: config, isLoading } = useQuery({
    queryKey: ['admin-system-config'],
    queryFn: () => get<SystemConfig>(API_ENDPOINTS.ADMIN.SYSTEM_CONFIG),
  })

  if (isLoading) return <TableSkeleton rows={4} cols={2} />

  if (!config) return <div className="text-center py-20 text-[#6B7280]">Unable to load configuration.</div>

  const sections = [
    {
      title: 'Site Settings',
      icon: Globe,
      items: [
        { label: 'Site Name', value: config.site_name },
        { label: 'Site URL', value: config.site_url },
        { label: 'Description', value: config.site_description },
        { label: 'Admin Email', value: config.admin_email },
      ],
    },
    {
      title: 'Application',
      icon: Settings,
      items: [
        { label: 'Environment', value: config.app_env },
        { label: 'Debug Mode', value: config.app_debug ? 'Enabled' : 'Disabled' },
        { label: 'Maintenance Mode', value: config.maintenance_mode ? 'Enabled' : 'Disabled' },
        { label: 'Registration', value: config.registration_enabled ? 'Enabled' : 'Disabled' },
      ],
    },
    {
      title: 'Technical',
      icon: Clock,
      items: [
        { label: 'Timezone', value: config.timezone },
        { label: 'Email Driver', value: config.email_driver },
        { label: 'Cache Driver', value: config.cache_driver },
        { label: 'Max Upload Size', value: `${config.max_upload_size} MB` },
      ],
    },
  ]

  return (
    <div>
      <div className="mb-8">
        <div className="rounded-2xl bg-white border border-[#E2E8E3] shadow-tourism overflow-hidden">
          <div className="relative px-6 py-6">
            <div className="absolute inset-0 opacity-[0.03] pointer-events-none">
              <svg width="100%" height="100%">
                <defs>
                  <pattern id="tourism-pattern" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
                    <circle cx="20" cy="20" r="1.5" fill="#16803C" />
                    <path d="M0 20 L40 20 M20 0 L20 40" stroke="#16803C" strokeWidth="0.3" strokeDasharray="2 4" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#tourism-pattern)" />
              </svg>
            </div>
            <div className="relative">
              <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">System Configuration</h1>
              <p className="mt-1 text-sm lg:text-base text-[#6B7280]">View and manage system settings</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {sections.map((section) => {
          const Icon = section.icon
          return (
            <div key={section.title} className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism">
              <div className="px-6 py-4 border-b border-[#E2E8E3] flex items-center gap-3">
                <div className="w-10 h-10 bg-[#EAF6ED] border border-[#D7E8DB] rounded-xl flex items-center justify-center">
                  <Icon className="w-5 h-5 text-[#16803C]" />
                </div>
                <h2 className="text-lg font-semibold text-[#17201A]">{section.title}</h2>
              </div>
              <div className="p-6">
                <dl className="space-y-4">
                  {section.items.map((item) => (
                    <div key={item.label} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                      <dt className="text-sm text-[#6B7280] sm:w-40 shrink-0">{item.label}</dt>
                      <dd className="text-sm text-[#17201A] font-medium">{item.value || '—'}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
