export default function LoadingOverlay({ visible, message }) {
  if (!visible) return null

  return (
    <div className="fixed inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center gap-4 z-50 animate-fade-in" role="status" aria-live="polite">
      <div className="w-10 h-10 border-[3px] border-gray-200 border-t-gray-900 rounded-full spinner" />
      {message && <p className="text-sm font-medium text-gray-700">{message}</p>}
    </div>
  )
}
