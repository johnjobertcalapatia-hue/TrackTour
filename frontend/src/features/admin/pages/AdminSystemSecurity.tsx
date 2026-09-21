import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { API_ENDPOINTS } from '@/shared/constants'
import { Shield, Key, Lock, AlertTriangle, Users } from 'lucide-react'

interface SecurityConfig {
  two_factor_enabled: boolean
  password_min_length: number
  max_login_attempts: number
  lockout_duration_minutes: number
  session_lifetime_minutes: number
  require_email_verification: boolean
  allowed_ip_ranges: string[] | null
  last_password_change: string | null
}

interface SecurityLog {
  id: number
  event: string
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

export default function AdminSystemSecurity() {
  const { data: config, isLoading: loadingConfig } = useQuery({
    queryKey: ['admin-system-security'],
    queryFn: () => get<SecurityConfig>(API_ENDPOINTS.ADMIN.SYSTEM_SECURITY),
  })

  const { data: logsData, isLoading: loadingLogs } = useQuery({
    queryKey: ['admin-security-logs'],
    queryFn: () => get<{ data: SecurityLog[] }>('/admin/system/security/logs'),
  })

  const securitySettings = config ? [
    { label: 'Two-Factor Authentication', value: config.two_factor_enabled ? 'Enabled' : 'Disabled', icon: Key, enabled: config.two_factor_enabled },
    { label: 'Minimum Password Length', value: `${config.password_min_length} characters`, icon: Lock, enabled: true },
    { label: 'Max Login Attempts', value: `${config.max_login_attempts} attempts`, icon: AlertTriangle, enabled: true },
    { label: 'Lockout Duration', value: `${config.lockout_duration_minutes} minutes`, icon: Lock, enabled: true },
    { label: 'Session Lifetime', value: `${config.session_lifetime_minutes} minutes`, icon: Users, enabled: true },
    { label: 'Email Verification Required', value: config.require_email_verification ? 'Yes' : 'No', icon: Shield, enabled: config.require_email_verification },
  ] : []

  const logs = logsData?.data ?? []

  return (
    <div>
      <div className="rounded-2xl bg-white border border-[#E2E8E3] shadow-tourism p-6 mb-6 relative overflow-hidden">
        <div className="absolute inset-0 opacity-5 pointer-events-none">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="tourism-pattern-admin-security" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
                <circle cx="20" cy="20" r="1.5" fill="#16803C" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#tourism-pattern-admin-security)" />
          </svg>
        </div>
        <div className="relative z-10">
          <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">Security Settings</h1>
          <p className="mt-1 text-sm lg:text-base text-[#6B7280]">Manage authentication and security policies</p>
        </div>
      </div>

      {!loadingConfig && config && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
          {securitySettings.map((setting) => {
            const Icon = setting.icon
            return (
              <div
                key={setting.label}
                className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism p-5"
              >
                <div className="flex items-start gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    setting.enabled ? 'bg-[#EAF6ED]' : 'bg-gray-100'
                  }`}>
                    <Icon className={`w-5 h-5 ${setting.enabled ? 'text-[#16803C]' : 'text-gray-500'}`} />
                  </div>
                  <div>
                    <p className="text-sm text-[#6B7280]">{setting.label}</p>
                    <p className="mt-1 text-lg font-semibold text-[#17201A]">{setting.value}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism">
        <div className="px-5 lg:px-6 py-4 border-b border-[#E2E8E3] flex items-center gap-2">
          <Shield className="w-5 h-5 text-[#16803C]" />
          <h2 className="text-lg font-semibold text-[#17201A]">Security Event Log</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E2E8E3] bg-[#F9FAFB]">
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Event</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">IP Address</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">User Agent</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8E3]">
              {!loadingLogs && logs.map((log) => (
                <tr key={log.id} className="hover:bg-[#F3F8F4] transition-colors">
                  <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-[#FFF7D6] text-amber-700 border border-amber-200 text-xs font-medium capitalize">
                      {log.event.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-5 lg:px-6 py-3 text-[#6B7280] font-mono text-xs whitespace-nowrap">{log.ip_address || '—'}</td>
                  <td className="px-5 lg:px-6 py-3 text-[#6B7280] text-xs max-w-xs truncate">{log.user_agent || '—'}</td>
                  <td className="px-5 lg:px-6 py-3 text-[#6B7280] whitespace-nowrap">{log.created_at}</td>
                </tr>
              ))}
              {loadingLogs && (
                <tr>
                  <td colSpan={4} className="px-5 lg:px-6 py-8 text-center text-[#6B7280]">Loading...</td>
                </tr>
              )}
              {!loadingLogs && logs.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 lg:px-6 py-12 text-center text-[#6B7280]">No security events recorded</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
