import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import RequireAuth from './auth/RequireAuth'
import AppLayout from './components/AppLayout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import EnvelopeEditorPage from './pages/EnvelopeEditorPage'
import QuickSignPage from './pages/QuickSignPage'
import './index.css'

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/quick-sign', element: <QuickSignPage /> },
  {
    element: <RequireAuth><AppLayout /></RequireAuth>,
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/envelopes/:envelopeId', element: <EnvelopeEditorPage /> }
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
