import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Info, Loader2, Save } from 'lucide-react'
import { apiErrorMessage, get, put } from '@/shared/services/api'
import { Alert } from '@/shared/components/Alert'
import CommissionRatesForm, { type RateDraft } from '@/shared/components/CommissionRatesForm'
import { STAGE_ONE_NOTICE, townDraft, townPayload, type EffectiveRates, type Limits, type Rates, type TownOverrides } from '@/shared/finance/commission-rates'

interface MunicipalRates {
  municipality: { id: number; name: string }
  effective: EffectiveRates
  overrides: TownOverrides
  district_defaults: Rates
  /** Bansud's allowed range for each of this town's rates. */
  limits: Limits
}

const QUERY_KEY = ['municipal-commission-rates']

/**
 * Municipal Tourism Office — this town's own commission rates (Earnings
 * Stage 1, §R2). A blank field uses the Bansud district default.
 */
export default function MunicipalCommissionRates() {
  const queryClient = useQueryClient()
  const { data, isLoading, isError } = useQuery({ queryKey: QUERY_KEY, queryFn: () => get<MunicipalRates>('/municipal/commission-rates') })
  const [draft, setDraft] = useState<RateDraft>({})
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    if (data) setDraft(townDraft(data.overrides))
  }, [data])

  const save = useMutation({
    mutationFn: () => put('/municipal/commission-rates', townPayload(draft)),
    onSuccess: () => {
      setNotice({ type: 'success', message: 'Your commission rates were saved.' })
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    },
    onError: (error) => setNotice({ type: 'error', message: apiErrorMessage(error, 'The rates could not be saved.') }),
  })

  if (isLoading) return <p className="text-sm text-[#6B7280]">Loading commission rates…</p>
  if (isError || !data) return <Alert type="error" message="Commission rates could not be loaded." />

  const town = data.municipality.name

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#17201A]">Commission rates — {town}</h1>
          <p className="mt-1 text-sm text-[#6B7280]">
            Rates for food orders from {town} restaurants and rides by {town} drivers. Leave a field blank to use the Bansud district default. Each rate must stay within the range Bansud allows.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setNotice(null); save.mutate() }}
          disabled={save.isPending}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#16803C] px-4 py-2 text-sm font-medium text-white hover:bg-[#126B32] disabled:opacity-50"
        >
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save rates
        </button>
      </div>

      <div className="flex gap-2 rounded-xl border border-[#F3D88A] bg-[#FFF8E1] px-3 py-2 text-xs text-[#7C5A00]" role="note">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>{STAGE_ONE_NOTICE}</p>
      </div>

      {notice && <Alert type={notice.type} message={notice.message} onDismiss={() => setNotice(null)} />}

      <CommissionRatesForm
        mode="town"
        draft={draft}
        onChange={(f, v) => setDraft((d) => ({ ...d, [f]: v }))}
        fallback={data.district_defaults}
        districtInfo={{ platformNetPercent: data.effective.rates.platform_net_percent, fastOptions: data.effective.fast_amount_options }}
        limits={data.limits}
        disabled={save.isPending}
      />
    </div>
  )
}
