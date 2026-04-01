"use client"

import { useEffect, useRef } from 'react'

interface Star {
  x: number
  y: number
  z: number
  size: number
  prevX?: number
  prevY?: number
}

interface HyperspeedBackgroundProps {
  color?: string
  particleCount?: number
  speed?: number
}

export function HyperspeedBackground({ 
  color = "#ff55c9", 
  particleCount = 80, 
  speed = 2 
}: HyperspeedBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const starsRef = useRef<Star[]>([])
  const animationFrameRef = useRef<number>()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size
    const resizeCanvas = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)

    // Initialize stars
    const stars: Star[] = []
    
    for (let i = 0; i < particleCount; i++) {
      stars.push({
        x: Math.random() * canvas.width - canvas.width / 2,
        y: Math.random() * canvas.height - canvas.height / 2,
        z: Math.random() * canvas.width,
        size: Math.random() * 1.5
      })
    }
    starsRef.current = stars

    // Helper function to parse hex color to RGB
    const hexToRgb = (hex: string) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
      return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      } : { r: 255, g: 85, b: 201 }
    }

    const rgb = hexToRgb(color)

    // Animation
    const animate = () => {
      ctx.fillStyle = 'rgba(30, 30, 30, 0.2)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      const centerX = canvas.width / 2
      const centerY = canvas.height / 2

      stars.forEach(star => {
        // Save previous position
        star.prevX = star.x / star.z * canvas.width + centerX
        star.prevY = star.y / star.z * canvas.height + centerY

        // Move star closer
        star.z -= speed
        
        // Reset star if it goes past the screen
        if (star.z <= 0) {
          star.z = canvas.width
          star.x = Math.random() * canvas.width - canvas.width / 2
          star.y = Math.random() * canvas.height - canvas.height / 2
          star.prevX = undefined
          star.prevY = undefined
        }

        // Calculate screen position
        const screenX = star.x / star.z * canvas.width + centerX
        const screenY = star.y / star.z * canvas.height + centerY
        
        // Calculate star size based on depth
        const starSize = (1 - star.z / canvas.width) * star.size * 2

        // Draw star trail (hyperspeed effect)
        if (star.prevX !== undefined && star.prevY !== undefined) {
          const gradient = ctx.createLinearGradient(
            star.prevX, 
            star.prevY, 
            screenX, 
            screenY
          )
          
          // Use the provided color for gradient
          gradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`)
          gradient.addColorStop(0.5, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3)`)
          gradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.8)`)
          
          ctx.strokeStyle = gradient
          ctx.lineWidth = starSize
          ctx.lineCap = 'round'
          ctx.beginPath()
          ctx.moveTo(star.prevX, star.prevY)
          ctx.lineTo(screenX, screenY)
          ctx.stroke()
        }

        // Draw star point
        const starGradient = ctx.createRadialGradient(
          screenX, 
          screenY, 
          0, 
          screenX, 
          screenY, 
          starSize
        )
        starGradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1)`)
        starGradient.addColorStop(0.5, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.6)`)
        starGradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`)
        
        ctx.fillStyle = starGradient
        ctx.beginPath()
        ctx.arc(screenX, screenY, starSize, 0, Math.PI * 2)
        ctx.fill()
      })

      animationFrameRef.current = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      window.removeEventListener('resize', resizeCanvas)
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [color, particleCount, speed])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0 }}
    />
  )
}

