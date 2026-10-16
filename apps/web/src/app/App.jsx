import React from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { UserRoleProvider } from './providers/UserRoleContext'
import Layout from '../shared/ui/Layout'
import ParticleBackground from '../shared/ui/ParticleBackground'
import HomePage from '../pages/home/ui/HomePage'
import ContentPlanPage from '../pages/content-plan/ui/ContentPlanPage'
import LoginPage from '../pages/auth/ui/LoginPage'
import RegisterPage from '../pages/auth/ui/RegisterPage'
import NotFoundPage from '../pages/not-found/ui/NotFoundPage'
import { useIsAuthenticated } from '../shared/ui/AuthGate'
import './styles/App.css'

const AuthenticatedOnly = ({ children }) => {
  const isAuthenticated = useIsAuthenticated()
  return isAuthenticated ? children : <LoginPage />
}

function App() {
  return (
    <Router>
      <UserRoleProvider>
        <ParticleBackground />
        <Layout>
        <Routes>
          <Route path="/" element={<AuthenticatedOnly><HomePage /></AuthenticatedOnly>} />
          <Route path="/content-plan" element={<AuthenticatedOnly><ContentPlanPage /></AuthenticatedOnly>} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Layout>
      </UserRoleProvider>
    </Router>
  )
}

export default App
