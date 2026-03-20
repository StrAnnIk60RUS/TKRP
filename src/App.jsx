import React from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { UserRoleProvider } from './context/UserRoleContext'
import Layout from './components/Layout'
import ParticleBackground from './components/ParticleBackground'
import HomePage from './pages/HomePage'
import ContentPlanPage from './pages/ContentPlanPage'
import './App.css'

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
