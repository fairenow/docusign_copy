import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import RequireAuth from './auth/RequireAuth'
import AppLayout from './components/AppLayout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import './index.css'

// PDF-heavy pages are loaded on demand so /login and the dashboard stay small
const lazyPage = (load) => async () => ({ Component: (await load()).default })

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/quick-sign', lazy: lazyPage(() => import('./pages/QuickSignPage')) },
  // Signers arriving from an emailed link: no account needed
  { path: '/sign/:token', lazy: lazyPage(() => import('./pages/SigningPage')) },
  // Team members signing from the dashboard
  {
    path: '/envelopes/:envelopeId/sign',
    lazy: async () => {
      const { default: SigningPage } = await import('./pages/SigningPage')
      return { element: <RequireAuth><SigningPage /></RequireAuth> }
    }
  },
  {
    element: <RequireAuth><AppLayout /></RequireAuth>,
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/envelopes/:envelopeId', lazy: lazyPage(() => import('./pages/EnvelopeEditorPage')) }
    ]
  },
  { path: '*', element: <Navigate to="/" replace /> }
])

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </React.StrictMode>
)
