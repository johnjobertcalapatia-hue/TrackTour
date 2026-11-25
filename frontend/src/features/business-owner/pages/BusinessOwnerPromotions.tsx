import { Link, useSearchParams } from 'react-router-dom'
import { BadgePercent, LayoutGrid, Megaphone, Plus, Tag } from 'lucide-react'
import PostsPanel from '../components/promotions/PostsPanel'
import SalesPanel from '../components/promotions/SalesPanel'
import BadgesPanel from '../components/promotions/BadgesPanel'
import { useBusinessPortal } from '../services/business-portal'
import { sellsFood } from '../services/promotions'
import { dealsCopy, portalKind } from '../services/business-profile-kind'

const FOOD_TABS = [
  { key: 'posts', label: 'Posts', icon: LayoutGrid },
  { key: 'sales', label: 'Sales', icon: Tag },
] as const
/** Resorts, tourist attractions and other businesses without a menu: no dishes to put on sale. */
const DEAL_TABS = [
  { key: 'posts', label: 'Posts', icon: LayoutGrid },
  { key: 'sales', label: 'Deals', icon: BadgePercent },
] as const
type TabKey = (typeof FOOD_TABS)[number]['key']

/**
 * Deals & Posts (the Promotions page): Posts, laid out like a social feed, and
 * Sales (dish sales, plus the original label-only badges below them). The tab
 * is kept in ?tab= so other pages can link straight to it; the old
 * ?tab=badges link opens Sales, where badges now live.
 *
 * Resorts and tourist attractions (any business without a menu) get Posts and
 * Deals: the "20% OFF" deals tourists see on the business page and in the
 * Stays & Attractions deals, without dish sales.
 */
export default function BusinessOwnerPromotions() {
  const portal = useBusinessPortal()
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const tab: TabKey = raw === 'sales' || raw === 'badges' || raw === 'deals' ? 'sales' : 'posts'
  const food = sellsFood(portal.businesses, portal.businessId)
  const copy = dealsCopy(portalKind(portal.businesses, portal.businessId))
  const TABS = food ? FOOD_TABS : DEAL_TABS

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 rounded-[24px] border border-[#E2ECE4] bg-gradient-to-r from-[#EAF4EC] via-[#F2F7F1] to-[#F6F4EE] px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#0F4D2B] text-[#F4B400]"><Megaphone className="h-6 w-6" aria-hidden="true" /></span>
          <div>
            <h1 className="text-2xl font-bold text-[#17201B] lg:text-3xl">Deals &amp; Posts</h1>
            <p className="mt-0.5 text-sm text-[#5E6B63]">{copy.subtitle}</p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link to={`${portal.prefix}/promotions/posts/new`} className="inline-flex items-center gap-2 rounded-xl border border-[#16803C] bg-[#fff] px-4 py-2.5 text-sm font-semibold text-[#16803C] hover:bg-[#F3F8F4]">
            <Plus className="h-4 w-4" aria-hidden="true" /> Create Post
          </Link>
          {food ? (
            <Link to={`${portal.prefix}/promotions/sales/new`} className="inline-flex items-center gap-2 rounded-xl bg-[#16803C] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#126B32]">
              <Plus className="h-4 w-4" aria-hidden="true" /> Create Sale
            </Link>
          ) : (
            <Link to={`${portal.prefix}/promotions/create`} className="inline-flex items-center gap-2 rounded-xl bg-[#16803C] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#126B32]">
              <Plus className="h-4 w-4" aria-hidden="true" /> Create Deal
            </Link>
          )}
        </div>
      </div>

      <div role="tablist" aria-label="Deals and posts" className="flex gap-1 border-b border-[#E2E8E3]">
        {TABS.map((t) => {
          const active = t.key === tab
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`promo-tab-${t.key}`}
              aria-selected={active}
              aria-controls={`promo-panel-${t.key}`}
              onClick={() => setParams(t.key === 'posts' ? {} : { tab: t.key })}
              className={`-mb-px inline-flex items-center gap-2 border-b-[3px] px-5 py-3 text-sm font-semibold transition ${
                active ? 'border-[#16803C] text-[#16803C]' : 'border-transparent text-[#5E6B63] hover:text-[#17201B]'
              }`}
            >
              <t.icon className="h-4 w-4" aria-hidden="true" /> {t.label}
            </button>
          )
        })}
      </div>

      <div role="tabpanel" id={`promo-panel-${tab}`} aria-labelledby={`promo-tab-${tab}`}>
        {tab === 'posts' && <PostsPanel />}
        {tab === 'sales' && (food ? (
          <div className="space-y-5">
            <SalesPanel />
            <BadgesPanel />
          </div>
        ) : <BadgesPanel variant="deals" explainer={copy.dealsExplainer} />)}
      </div>
    </div>
  )
}
