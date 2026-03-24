import React from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { UserRoleProvider } from './providers/UserRoleContext'
import Layout from '../shared/ui/Layout'
import ParticleBackground from '../shared/ui/ParticleBackground'
import HomePage from '../pages/home/ui/HomePage'
import ContentPlanPage from '../pages/content-plan/ui/ContentPlanPage'
import './styles/App.css'

function App() {
  return (
    <Router>
      <UserRoleProvider>
        <ParticleBackground />
        <Layout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/content-plan" element={<ContentPlanPage />} />
        </Routes>
      </Layout>
      </UserRoleProvider>
    </Router>
  )
}

export default App
