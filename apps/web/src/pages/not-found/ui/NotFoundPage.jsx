import React from 'react'
import { Link } from 'react-router-dom'
import { isUserAuthenticated } from '../../../shared/ui/AuthGate'
import './NotFoundPage.css'

const NotFoundPage = () => {
  const loggedIn = isUserAuthenticated()

  return (
    <div className="not-found-page">
      <div className="page-header">
        <h1>404</h1>
        <p className="page-subtitle">
          The page you requested does not exist or has been moved. Please check
          the address or go to one of the pages below.
        </p>
      </div>
      <div className="page-content">
        <div className="not-found-links">
          {loggedIn ? (
            <Link to="/" className="not-found-link">
              ← To home
            </Link>
          ) : (
            <>
              <Link to="/login" className="not-found-link">
                Login
              </Link>
              <Link to="/register" className="not-found-link">
                Registration
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default NotFoundPage
