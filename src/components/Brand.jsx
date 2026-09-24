/** App logo: the FLMLNK wordmark and the product name. */
export default function Brand({ className = 'text-lg' }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold text-gray-900 ${className}`}>
      <img src="/flmlnk-logo.png" alt="FLMLNK" className="h-[1.2em] w-auto" />
      <span className="text-gray-500 font-medium">Sign</span>
    </span>
  )
}
