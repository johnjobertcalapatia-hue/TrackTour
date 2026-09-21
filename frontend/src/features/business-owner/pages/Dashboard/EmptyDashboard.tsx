import { ClipboardCheck, Leaf } from 'lucide-react'

export function EmptyDashboard({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="relative mb-4">
        <div className="w-20 h-20 rounded-full bg-[#EAF6ED] flex items-center justify-center">
          <ClipboardCheck className="w-10 h-10 text-[#16803C]" />
        </div>
        <Leaf className="absolute -top-2 -right-3 w-6 h-6 text-[#126B32]/40" />
        <Leaf className="absolute -bottom-2 -left-3 w-5 h-5 text-[#16803C]/40 rotate-[-25deg]" />
      </div>
      <p className="text-base font-semibold text-[#17201A]">{title}</p>
      <p className="mt-1 text-sm text-[#647067] max-w-sm">{description}</p>
    </div>
  )
}
