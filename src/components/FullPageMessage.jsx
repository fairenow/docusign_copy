export default function FullPageMessage({ title, children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-8">
      <div className="max-w-md text-center">
        <h1 className="page-title text-4xl mb-3">{title}</h1>
        {children && <div className="text-gray-500 text-sm leading-relaxed">{children}</div>}
      </div>
    </div>
  )
}
