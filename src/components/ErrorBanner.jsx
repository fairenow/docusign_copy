export default function ErrorBanner({ children, className = 'mb-4' }) {
  if (!children) return null
  return (
    <p role="alert" className={`${className} px-3.5 py-3 rounded-lg bg-red-50 ring-1 ring-inset ring-red-600/15 text-red-700 text-sm`}>
      {children}
    </p>
  )
}
