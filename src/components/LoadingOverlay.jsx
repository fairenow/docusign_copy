export default function LoadingOverlay({ visible, message }) {
  if (!visible) return null

  return (
    <div className="fixed inset-0 bg-white/90 flex flex-col items-center justify-center gap-4 z-50" role="status" aria-live="polite">
      <div className="w-12 h-12 border-4 border-gray-200 border-t-blue-500 rounded-full spinner" />
      {message && <p className="text-sm text-gray-700">{message}</p>}
    </div>
  )
}
