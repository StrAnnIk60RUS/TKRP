import React from 'react'
import ProjectForm from '../components/ProjectForm'
import './HomePage.css'

const HomePage = () => {
  return (
    <div className="home-page">
      <div className="page-header">
        <h1>Создание контент-плана</h1>
        <p className="page-subtitle">
          Заполните форму с данными о вашем IT-проекте и загрузите данные конкурентов для генерации контент-плана
        </p>
      </div>
      <div className="page-content">
        <ProjectForm />
      </div>
    </div>
  )
}

export default HomePage
