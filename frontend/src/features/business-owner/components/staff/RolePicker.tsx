export interface RoleOption {
  id: number
  name: string
  description?: string | null
}

/**
 * Pick one or more staff roles (Staff Management §5). One employee can hold
 * several roles without a second account; the first ticked is the primary.
 */
export function RolePicker({ roles, value, onChange, error }: {
  roles: RoleOption[]
  value: number[]
  onChange: (ids: number[]) => void
  error?: string
}) {
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])

  return (
    <fieldset>
      <legend className="block text-sm font-medium text-[#4B5563] mb-1.5">Roles (what this staff member can do)</legend>
      {roles.length === 0 ? (
        <p className="text-sm text-[#647067]">Choose a business first to see its roles.</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {roles.map((r) => {
            const checked = value.includes(r.id)
            return (
              <label
                key={r.id}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 text-sm transition ${checked ? 'border-[#16803C] bg-[#EAF6ED]' : 'border-[#E2E8E3] bg-white hover:bg-[#F6F8F4]'}`}
              >
                <input type="checkbox" checked={checked} onChange={() => toggle(r.id)} className="mt-0.5 h-4 w-4 accent-[#16803C]" />
                <span>
                  <span className="block font-medium text-[#17201A]">{r.name}</span>
                  {r.description && <span className="block text-xs text-[#647067]">{r.description}</span>}
                </span>
              </label>
            )
          })}
        </div>
      )}
      <p className="mt-1.5 text-xs text-[#647067]">Tick more than one if the same person covers several jobs.</p>
      {error && <p className="text-[#B91C1C] text-xs mt-1">{error}</p>}
    </fieldset>
  )
}
