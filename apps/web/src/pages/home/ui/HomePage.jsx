import React from 'react'
import ProjectForm from '../../../features/project-form/ui/ProjectForm'
import AuthGate from '../../../shared/ui/AuthGate'
import { isUserAuthenticated } from '../../../shared/ui/AuthGate'
import './HomePage.css'

const HomePage = () => {
  return (
    <div className="home-page">
      <div className="page-header">
        <h1>Создание контент-плана</h1>
        <p className="page-subtitle">
          Укажите проект и аудиторию, при необходимости соберите конкурентов по ссылкам, затем соберите черновик и улучшите план
        </p>
      </div>
      <div className="page-content">
        {isUserAuthenticated() ? <ProjectForm /> : <AuthGate />}
      </div>
    </div>
  )
}

export default HomePage
