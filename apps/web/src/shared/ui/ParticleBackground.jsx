import React, { useEffect, useRef } from 'react'

const PARTICLE_COUNT = 80
const CONNECT_DISTANCE = 150
const PARTICLE_SPEED = 0.3
const DOT_RADIUS = 2

function ParticleBackground() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    let animationId
    let particles = []

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      initParticles()
    }

    const initParticles = () => {
      particles = Array.from({ length: PARTICLE_COUNT }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * PARTICLE_SPEED,
        vy: (Math.random() - 0.5) * PARTICLE_SPEED,
      }))
    }

    const isDark = () => document.body.classList.contains('theme-light') === false

    const draw = () => {
      const dark = isDark()
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const dotColor = dark ? 'rgba(255, 255, 255, 0.6)' : 'rgba(26, 26, 46, 0.5)'

      // Draw lines between nearby particles
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x
          const dy = particles[i].y - particles[j].y
          const dist = Math.hypot(dx, dy)

          if (dist < CONNECT_DISTANCE) {
            const opacity = (1 - dist / CONNECT_DISTANCE) * 0.4
            const colors = dark ? [[120, 119, 198], [255, 119, 198], [119, 198, 255]] : [[100, 116, 139], [148, 163, 184]]
            const [r, g, b] = colors[(i + j) % colors.length]
            ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`
            ctx.lineWidth = 0.8
            ctx.beginPath()
            ctx.moveTo(particles[i].x, particles[i].y)
            ctx.lineTo(particles[j].x, particles[j].y)
            ctx.stroke()
          }
        }
      }

      // Draw dots and update positions
      particles.forEach((p) => {
        ctx.beginPath()
        ctx.arc(p.x, p.y, DOT_RADIUS, 0, Math.PI * 2)
        ctx.fillStyle = dotColor
        ctx.fill()

        p.x += p.vx
        p.y += p.vy

        if (p.x < 0 || p.x > canvas.width) p.vx *= -1
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1
        p.x = Math.max(0, Math.min(canvas.width, p.x))
        p.y = Math.max(0, Math.min(canvas.height, p.y))
      })

      animationId = requestAnimationFrame(draw)
    }

    resize()
    window.addEventListener('resize', resize)
    draw()

    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(animationId)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="particle-background"
      aria-hidden="true"
    />
  )
}

export default ParticleBackground
