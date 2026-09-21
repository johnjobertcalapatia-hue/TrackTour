import { cn } from '@/shared/utils'

interface SkeletonProps {
  className?: string
  count?: number
}

export function Skeleton({ className, count = 1 }: SkeletonProps) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'animate-pulse rounded-xl bg-gray-200/70',
            className
          )}
        />
      ))}
    </>
  )
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-10">
      <Skeleton className="h-[220px] lg:h-[280px] w-full rounded-[24px]" />
      <Skeleton className="h-16 w-full rounded-2xl" />
      <div className="space-y-8">
        {[0, 1, 2].map((s) => (
          <div key={s} className="space-y-4">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-12 w-80" />
            <div className="flex gap-4 overflow-hidden">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-56 w-[250px] shrink-0 rounded-[20px]" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-4">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton key={j} className="h-8 flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}
