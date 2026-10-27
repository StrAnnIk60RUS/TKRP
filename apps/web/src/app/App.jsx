import React, { Suspense, lazy, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { UserRoleProvider } from './providers/UserRoleContext'
import Layout from '../shared/ui/Layout'
import ParticleBackground from '../shared/ui/ParticleBackground'
import ErrorBoundary from '../shared/ui/ErrorBoundary'
import { useIsAuthenticated } from '../shared/ui/AuthGate'
import { initBreadcrumbListeners } from '../shared/lib/telemetry/breadcrumbs'
import { initGlobalCrashReporting } from '../shared/lib/telemetry/clientReporter'
import './styles/App.css'

const HomePage = lazy(() => import('../pages/home/ui/HomePage'))
const ContentPlanPage = lazy(() => import('../pages/content-plan/ui/ContentPlanPage'))
const AnalyticsPage = lazy(() => import('../pages/analytics/ui/AnalyticsPage'))
const LoginPage = lazy(() => import('../pages/auth/ui/LoginPage'))
const RegisterPage = lazy(() => import('../pages/auth/ui/RegisterPage'))
const NotFoundPage = lazy(() => import('../pages/not-found/ui/NotFoundPage'))

const PageFallback = () => (
  <div className="loading-state" style={{ padding: '40px', textAlign: 'center' }}>
    <div className="spinner"></div>
    <p>Загрузка страницы...</p>
  </div>
)

const AuthenticatedOnly = ({ children }) => {
  const isAuthenticated = useIsAuthenticated()
  return isAuthenticated ? children : <LoginPage />
}

function App() {
  useEffect(() => {
    initBreadcrumbListeners()
    initGlobalCrashReporting()
  }, [])

  return (
    <Router>
      <ErrorBoundary>
        <UserRoleProvider>
          <ParticleBackground />
          <Layout>
            <Suspense fallback={<PageFallback />}>
              <Routes>
                <Route path="/" element={<AuthenticatedOnly><HomePage /></AuthenticatedOnly>} />
                <Route path="/content-plan" element={<AuthenticatedOnly><ContentPlanPage /></AuthenticatedOnly>} />
                <Route path="/analytics" element={<AuthenticatedOnly><AnalyticsPage /></AuthenticatedOnly>} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </Suspense>
          </Layout>
        </UserRoleProvider>
      </ErrorBoundary>
    </Router>
  )
}

export default App
