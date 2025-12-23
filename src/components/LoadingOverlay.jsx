export default function LoadingOverlay({ visible }) {
  if (!visible) return null

  return (
    <div className="fixed inset-0 bg-dark-900/90 flex items-center justify-center z-50">
      <div className="w-12 h-12 border-4 border-dark-700 border-t-blue-500 rounded-full spinner" />
    </div>
  )
}
