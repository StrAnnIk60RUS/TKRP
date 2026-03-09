import React from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import HomePage from './pages/HomePage'
import ContentPlanPage from './pages/ContentPlanPage'
import './App.css'

function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/content-plan" element={<ContentPlanPage />} />
        </Routes>
      </Layout>
    </Router>
  )
}

export default App
