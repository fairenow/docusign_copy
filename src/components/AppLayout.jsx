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
  `px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'}`

const tabClass = ({ isActive }) =>
  `relative flex-1 flex flex-col items-center gap-1 pt-2.5 pb-2 text-[11px] font-medium transition-colors ${isActive ? 'text-gray-900' : 'text-gray-400'}`

const initialsOf = (name = '') => name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('')

/** Header shared by signed-in pages; on phones the pages are a tab bar at the bottom. */
export default function AppLayout() {
  const { user, profile, signOut } = useAuth()
  const name = profile?.full_name || user?.email

  return (
    <div className="min-h-screen flex flex-col bg-gray-100">
      <header className="sticky top-0 z-30 h-14 sm:h-16 px-4 sm:px-8 bg-white/85 backdrop-blur-md border-b border-gray-200/80 flex items-center justify-between gap-4 flex-shrink-0">
        <div className="flex items-center gap-8 min-w-0">
          <Brand />
          <nav className="hidden md:flex gap-1" aria-label="Pages">
            {LINKS.map(link => <NavLink key={link.to} to={link.to} end={link.end} className={navClass}>{link.label}</NavLink>)}
          </nav>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 text-sm min-w-0">
          <span className="hidden sm:flex items-center gap-2.5 text-gray-600 min-w-0" title={user?.email}>
            <span className="w-8 h-8 flex-shrink-0 rounded-full bg-gradient-to-br from-gray-700 to-gray-900 text-white text-xs font-semibold flex items-center justify-center" aria-hidden="true">
              {initialsOf(name)}
            </span>
            <span className="truncate max-w-[14rem] font-medium">{name}</span>
          </span>
          <button onClick={signOut} className="icon-btn w-9 h-9" title="Sign out" aria-label="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </header>
      <main className="flex-1 flex flex-col min-h-0 pb-16 md:pb-0">
        <Outlet />
      </main>
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white/90 backdrop-blur-md border-t border-gray-200/80 flex pb-[env(safe-area-inset-bottom)]"
        aria-label="Pages"
      >
        {LINKS.map(({ to, label, short, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={tabClass}>
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute top-0 inset-x-6 h-0.5 rounded-full bg-gray-900" aria-hidden="true" />}
                <Icon size={21} strokeWidth={isActive ? 2.2 : 1.8} aria-hidden="true" />
                {short ?? label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
