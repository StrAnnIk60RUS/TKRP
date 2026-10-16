import React, { useEffect, useState } from 'react'
import { fetchPlanMediaBlob } from '../../../shared/api/enrichmentService'

const PostMediaBlock = ({ media }) => {
  const [src, setSrc] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!media?.url || media.status !== 'ready') {
      setSrc('')
      setError('')
      return undefined
    }
    let objectUrl = ''
    let cancelled = false
    const controller = new AbortController()
    fetchPlanMediaBlob(media.url, { signal: controller.signal })
      .then((blob) => {
        if (cancelled) return
        const typed = media.content_type ? new Blob([blob], { type: media.content_type }) : blob
        objectUrl = URL.createObjectURL(typed)
        setSrc(objectUrl)
        setError('')
      })
      .catch((err) => {
        if (cancelled || err?.name === 'AbortError') return
        setError(err?.message || 'Не удалось загрузить медиа')
      })
    return () => {
      cancelled = true
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [media?.url, media?.status, media?.content_type])

  if (!media?.url || media.status !== 'ready') return null

  return (
    <div className="post-media">
      {error ? (
        <p className="post-media-error">{error}</p>
      ) : src ? (
        media.kind === 'video' ? (
          <video className="post-media-player" src={src} controls playsInline />
        ) : (
          <img className="post-media-player" src={src} alt="Сгенерированное изображение поста" />
        )
      ) : (
        <p className="post-media-note">Загрузка медиа…</p>
      )}
    </div>
  )
}

export default PostMediaBlock
