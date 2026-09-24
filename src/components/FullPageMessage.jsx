export default function FullPageMessage({ title, children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-900 p-8">
      <div className="max-w-md text-center">
        <h1 className="text-xl text-gray-100 font-semibold mb-2">{title}</h1>
        {children && <div className="text-dark-400 text-sm leading-relaxed">{children}</div>}
      </div>
    </div>
  )
}
