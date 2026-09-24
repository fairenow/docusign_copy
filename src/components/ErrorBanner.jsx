export default function ErrorBanner({ children, className = 'mb-4' }) {
  if (!children) return null
  return (
    <p role="alert" className={`${className} p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-700 text-sm`}>
      {children}
    </p>
  )
}
