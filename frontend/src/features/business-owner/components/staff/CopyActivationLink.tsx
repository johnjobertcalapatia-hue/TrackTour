import { useState } from 'react'

/** The activation link, shown only when the invitation email could not be sent. */
export function CopyActivationLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
      <input readOnly value={url} aria-label="Activation link" className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-[#17201A]" onFocus={(e) => e.target.select()} />
      <button
        type="button"
        onClick={() => { void navigator.clipboard?.writeText(url); setCopied(true) }}
        className="shrink-0 rounded-lg bg-[#16803C] px-3 py-2 text-xs font-semibold text-white hover:bg-[#126B32]"
      >
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  )
}
