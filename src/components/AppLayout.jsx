import { NavLink, Outlet } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { useAuth } from '../auth/useAuth'
import Brand from './Brand'

const navClass = ({ isActive }) =>
  `px-3 py-1.5 rounded-lg text-sm transition-colors ${isActive ? 'bg-gray-50 text-gray-900' : 'text-gray-500 hover:text-gray-900'}`

/** Header shared by signed-in pages. */
export default function AppLayout() {
  const { user, profile, signOut } = useAuth()
  const name = profile?.full_name || user?.email

  return (
    <div className="min-h-screen flex flex-col bg-gray-100">
      <header className="h-14 px-5 bg-white border-b border-gray-200 flex items-center justify-between gap-4 flex-shrink-0">
        <div className="flex items-center gap-6">
          <Brand />
          <nav className="flex gap-1">
            <NavLink to="/" end className={navClass}>Envelopes</NavLink>
            <NavLink to="/quick-sign" className={navClass}>Quick sign</NavLink>
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-500 truncate max-w-[16rem]" title={user?.email}>{name}</span>
          <button onClick={signOut} className="p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100" title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </header>
      <main className="flex-1 flex flex-col min-h-0">
        <Outlet />
      </main>
    </div>
  )
}
