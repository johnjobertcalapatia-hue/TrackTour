import { useState } from 'react'

const LIMIT = 220

/** A post caption; long ones are cut with "See more" (and "See less"). */
export default function PostCaption({ text, className = '', full = false }: { text: string | null; className?: string; full?: boolean }) {
  const [open, setOpen] = useState(full)
  if (!text) return null
  const long = text.length > LIMIT
  const shown = open || !long ? text : `${text.slice(0, LIMIT).trimEnd()}…`

  return (
    <p className={`whitespace-pre-line break-words ${className}`}>
      {shown}
      {long && !full && (
        <>
          {' '}
          <button type="button" onClick={() => setOpen((v) => !v)} className="font-semibold text-[#087F3F] hover:underline" aria-expanded={open}>
            {open ? 'See less' : 'See more'}
          </button>
        </>
      )}
    </p>
  )
}
