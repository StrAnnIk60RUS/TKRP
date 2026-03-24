import React from 'react'
import './PreviewModal.css'

const PreviewModal = ({ data, onConfirm, onCancel, filename }) => {
  const jsonString = JSON.stringify(data, null, 2)

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Предпросмотр данных</h3>
          <button className="modal-close" onClick={onCancel}>×</button>
        </div>
        
        <div className="modal-body">
          <div className="preview-info">
            <p><strong>Файл:</strong> {filename}</p>
            <p><strong>Размер:</strong> {(jsonString.length / 1024).toFixed(2)} KB</p>
          </div>
          
          <div className="preview-structure">
            <h4>Структура данных:</h4>
            <div className="structure-tree">
              <div className="tree-item">
                <strong>project_info</strong>
                <ul>
                  <li>name: {data.project_info?.name || 'не указано'}</li>
                  <li>activity_specification: {data.project_info?.activity_specification?.substring(0, 50) || 'не указано'}...</li>
                </ul>
              </div>
              <div className="tree-item">
                <strong>target_audience</strong>
                <ul>
                  <li>gender: {data.target_audience?.gender || 'не указано'}</li>
                  <li>age_range: {data.target_audience?.age_range?.min}-{data.target_audience?.age_range?.max} лет</li>
                  <li>social_status: {data.target_audience?.social_status || 'не указано'}</li>
                </ul>
              </div>
              <div className="tree-item">
                <strong>content_plan_parameters</strong>
                <ul>
                  <li>timeline: {data.content_plan_parameters?.timeline?.start_date} - {data.content_plan_parameters?.timeline?.end_date}</li>
                  <li>min_publications: {data.content_plan_parameters?.min_publications}</li>
                  <li>platforms: {data.content_plan_parameters?.platforms?.join(', ') || 'не выбрано'}</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="preview-json">
            <h4>JSON предпросмотр:</h4>
            <pre className="json-preview">{jsonString}</pre>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onCancel}>
            <span>Отмена</span>
          </button>
          <button className="btn-primary" onClick={onConfirm}>
            <span>Скачать файл</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default PreviewModal
