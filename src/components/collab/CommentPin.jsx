/** A comment pinned to the page: a speech bubble whose point is where it was pinned (bottom left). */
export default function CommentPin({ number, active = false, preview = false }) {
  return (
    <div
      className={`w-full h-full rounded-full rounded-bl-none flex items-center justify-center text-[11px] font-semibold text-white shadow-md ring-2 transition-transform ${
        active ? 'bg-blue-600 ring-blue-200 scale-110' : 'bg-gray-900 ring-white'
      } ${preview ? 'opacity-80' : 'cursor-pointer'}`}
      data-testid={preview ? undefined : 'comment-pin'}
    >
      {number}
    </div>
  )
}
