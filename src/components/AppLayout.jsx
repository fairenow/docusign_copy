import { NavLink, Outlet } from 'react-router-dom'
import { FileText, LayoutTemplate, LogOut, PenLine, Zap } from 'lucide-react'
import { useAuth } from '../auth/useAuth'
import Brand from './Brand'

const LINKS = [
  { to: '/', label: 'Envelopes', icon: FileText, end: true },
  { to: '/templates', label: 'Templates', icon: LayoutTemplate },
  { to: '/signatures', label: 'My signatures', short: 'Signatures', icon: PenLine },
  { to: '/quick-sign', label: 'Quick sign', icon: Zap }
]

const navClass = ({ isActive }) =>
  `px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${isActive ? 'bg-gray-50 text-gray-900' : 'text-gray-500 hover:text-gray-900'}`

const tabClass = ({ isActive }) =>
  `flex-1 flex flex-col items-center gap-0.5 py-2 text-[11px] ${isActive ? 'text-blue-600' : 'text-gray-500'}`

/** Header shared by signed-in pages; on phones the pages are a tab bar at the bottom. */
export default function AppLayout() {
  const { user, profile, signOut } = useAuth()
  const name = profile?.full_name || user?.email

  return (
    <div className="min-h-screen flex flex-col bg-gray-100">
      <header className="h-14 px-4 sm:px-5 bg-white border-b border-gray-200 flex items-center justify-between gap-4 flex-shrink-0">
        <div className="flex items-center gap-6 min-w-0">
          <Brand />
          <nav className="hidden md:flex gap-1" aria-label="Pages">
            {LINKS.map(link => <NavLink key={link.to} to={link.to} end={link.end} className={navClass}>{link.label}</NavLink>)}
          </nav>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 text-sm min-w-0">
          <span className="hidden sm:block text-gray-500 truncate max-w-[16rem]" title={user?.email}>{name}</span>
          <button onClick={signOut} className="p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100" title="Sign out" aria-label="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </header>
      <main className="flex-1 flex flex-col min-h-0 pb-16 md:pb-0">
        <Outlet />
      </main>
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-gray-200 flex pb-[env(safe-area-inset-bottom)]"
        aria-label="Pages"
      >
        {LINKS.map(({ to, label, short, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={tabClass}>
            <Icon size={20} aria-hidden="true" />
            {short ?? label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
