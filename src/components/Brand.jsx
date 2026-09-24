/** App logo: a blue mark and the product name. */
export default function Brand({ className = 'text-lg' }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold text-gray-900 ${className}`}>
      <svg viewBox="0 0 32 32" className="h-[1.4em] w-[1.4em]" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill="#2563eb" />
        <path d="M9 22.5c2.2-.3 3.6-1.6 5-3.8l5.8-9.2a2 2 0 0 1 3.4 2.1l-5.9 9.1c-1.4 2.2-3.3 3.3-6 3.3H9z" fill="#fff" />
        <path d="M9 25h14" stroke="#bfdbfe" strokeWidth="2" strokeLinecap="round" />
      </svg>
      DocSign
    </span>
  )
}
