export default function LoadingOverlay({ visible }) {
  if (!visible) return null

  return (
    <div className="fixed inset-0 bg-white/90 flex items-center justify-center z-50">
      <div className="w-12 h-12 border-4 border-gray-200 border-t-blue-500 rounded-full spinner" />
    </div>
  )
}
