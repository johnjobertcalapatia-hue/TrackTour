import FilterDropdown from '@/features/tourist/components/FilterDropdown'

export interface MunicipalityOption {
  id: number
  name: string
}

/**
 * Green municipality pill for the Explore list (see FilterDropdown for why
 * it is not a native <select>). `value` is the municipality id as a string;
 * '' = all municipalities.
 */
export default function MunicipalityFilter({ value, options, onChange, className }: {
  value: string
  options: MunicipalityOption[]
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <FilterDropdown
      id="explore-municipality"
      testId="explore-municipality-wrap"
      label="Municipality"
      allLabel="All municipalities"
      value={value}
      options={options}
      onChange={onChange}
      className={className}
    />
  )
}
