import { Link } from 'react-router-dom'
import { SearchX } from 'lucide-react'

/** True when an API error is a 404 (the record does not exist any more). */
export function isNotFoundError(error: unknown): boolean {
  return (error as { response?: { status?: number } } | null)?.response?.status === 404
}

/**
 * Shown instead of a place page whose record is gone (404) — e.g. a
 * restaurant still listed in the browser's Recently Viewed after it was
 * removed. Offers a way back instead of a dead end.
 *
 * NOT for closed places: a closed restaurant still loads (info + menu,
 * ordering off); only a missing / unapproved record answers 404.
 */
export function PlaceUnavailable({ title, message, backTo, backLabel }: {
  title: string
  message: string
  backTo: string
  backLabel: string
}) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <SearchX className="mx-auto mb-4 h-12 w-12 text-[#56615B]/40" aria-hidden="true" />
      <h1 className="text-lg font-bold text-[#17201B]">{title}</h1>
      <p className="mt-1 text-sm text-[#56615B]">{message}</p>
      <Link
        to={backTo}
        className="mt-5 inline-flex h-10 items-center rounded-full bg-[#087F3F] px-5 text-sm font-semibold text-white hover:bg-[#056B35]"
      >
        {backLabel}
      </Link>
    </div>
  )
}
