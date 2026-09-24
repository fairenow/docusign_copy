import { NavLink, Outlet } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { useAuth } from '../auth/useAuth'
import Brand from './Brand'

const navClass = ({ isActive }) =>
  `px-3 py-1.5 rounded-lg text-sm transition-colors ${isActive ? 'bg-dark-700 text-white' : 'text-dark-400 hover:text-gray-200'}`

/** Header shared by signed-in pages. */
export default function AppLayout() {
  const { user, profile, signOut } = useAuth()
  const name = profile?.full_name || user?.email

  return (
    <div className="min-h-screen flex flex-col bg-dark-900">
      <header className="h-14 px-5 bg-dark-800 border-b border-dark-700 flex items-center justify-between gap-4 flex-shrink-0">
        <div className="flex items-center gap-6">
          <Brand />
          <nav className="flex gap-1">
            <NavLink to="/" end className={navClass}>Envelopes</NavLink>
            <NavLink to="/quick-sign" className={navClass}>Quick sign</NavLink>
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-dark-400 truncate max-w-[16rem]" title={user?.email}>{name}</span>
          <button onClick={signOut} className="p-2 rounded-lg text-dark-400 hover:text-white hover:bg-dark-700" title="Sign out">
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
