import { Navigate, useSearchParams } from 'react-router-dom'

/**
 * /tourist/posts moved into Explore (Deals & Posts is Explore's default view,
 * 2026-11-24). Old links keep working, including ?feed=following|saved.
 */
export default function TouristPosts() {
  const [params] = useSearchParams()
  const feed = params.get('feed')
  return <Navigate to={feed ? `/tourist/explore?feed=${encodeURIComponent(feed)}` : '/tourist/explore'} replace />
}
