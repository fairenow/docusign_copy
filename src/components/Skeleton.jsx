/** Grey shapes shown while something loads, in the layout it will have. */

const bar = 'bg-gray-200 rounded animate-pulse'

/** Rows of a list (envelopes, templates). */
export function SkeletonRows({ count = 4 }) {
  return (
    <ul className="divide-y divide-gray-200 bg-white border border-gray-200 rounded-xl overflow-hidden" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex items-center gap-4 px-4 py-4" data-testid="skeleton-row">
          <div className="flex-1 space-y-2">
            <div className={`${bar} h-4`} style={{ width: `${50 - i * 6}%` }} />
            <div className={`${bar} h-3 w-2/3`} />
          </div>
          <div className={`${bar} h-5 w-20 rounded-full`} />
          <div className={`${bar} h-3 w-24 hidden sm:block`} />
        </li>
      ))}
    </ul>
  )
}

/** Page-shaped placeholders (US Letter proportions unless sizes are known). */
export function PageSkeletons({ count = 1, width = 612, height = 792 }) {
  return Array.from({ length: Math.min(count, 3) }, (_, i) => (
    <div
      key={i}
      className="mx-auto mt-3 sm:mt-8 bg-white shadow-sm p-[6%] space-y-3"
      style={{ width, maxWidth: '100%', aspectRatio: `${width} / ${height}` }}
      data-testid="page-skeleton"
      aria-hidden="true"
    >
      <div className={`${bar} h-5 w-1/2 mx-auto mb-6`} />
      {Array.from({ length: 9 }, (_, j) => (
        <div key={j} className={`${bar} h-2.5`} style={{ width: `${[92, 88, 95, 70, 90, 85, 93, 60, 80][j]}%` }} />
      ))}
    </div>
  ))
}

/** A whole screen with a top bar, a document and a side panel (editor, signing page). */
export function DocumentScreenSkeleton({ pages = 1, panel = true }) {
  return (
    <div className="h-screen flex flex-col bg-gray-100" aria-busy="true" aria-label="Loading">
      <div className="h-16 px-4 bg-white border-b border-gray-200 flex items-center gap-4 flex-shrink-0">
        <div className={`${bar} h-8 w-8`} />
        <div className="flex-1 space-y-2">
          <div className={`${bar} h-4 w-56 max-w-full`} />
          <div className={`${bar} h-3 w-32`} />
        </div>
        <div className={`${bar} h-9 w-24`} />
      </div>
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-hidden px-2 sm:px-8"><PageSkeletons count={pages} /></div>
        {panel && (
          <div className="hidden md:block w-80 bg-white border-l border-gray-200 p-4 space-y-4">
            {[40, 90, 75, 90, 60].map((w, i) => <div key={i} className={`${bar} h-4`} style={{ width: `${w}%` }} />)}
          </div>
        )}
      </div>
    </div>
  )
}
