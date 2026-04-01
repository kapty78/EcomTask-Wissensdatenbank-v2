"use client"

import { useEffect, useRef } from 'react'

interface SquaresBackgroundProps {
  squareSize?: number
  color?: string
  opacity?: number
  speed?: number
}

export function SquaresBackground({ 
  squareSize = 40,
  color = "#ff55c9",
  opacity = 0.3,
  speed = 0.5
}: SquaresBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
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

    // Create grid of squares
    const cols = Math.ceil(canvas.width / squareSize) + 1
    const rows = Math.ceil(canvas.height / squareSize) + 1
    
    // Initialize squares with random states
    const squares: { opacity: number, targetOpacity: number, speed: number }[][] = []
    for (let i = 0; i < rows; i++) {
      squares[i] = []
      for (let j = 0; j < cols; j++) {
        squares[i][j] = {
          opacity: Math.random() * opacity,
          targetOpacity: Math.random() * opacity,
          speed: (Math.random() * 0.5 + 0.5) * speed * 0.01
        }
      }
    }

    let time = 0

    // Animation
    const animate = () => {
      time += 0.01

      // Clear canvas
      ctx.fillStyle = '#1e1e1e'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // Draw squares
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
          const square = squares[i][j]
          
          // Animate opacity towards target
          if (Math.abs(square.opacity - square.targetOpacity) < 0.01) {
            square.targetOpacity = Math.random() * opacity
          }
          
          if (square.opacity < square.targetOpacity) {
            square.opacity += square.speed
          } else {
            square.opacity -= square.speed
          }

          // Draw square
          const x = j * squareSize
          const y = i * squareSize
          
          // Add subtle wave effect
          const wave = Math.sin(time + i * 0.1 + j * 0.1) * 0.1
          const finalOpacity = Math.max(0, Math.min(opacity, square.opacity + wave))
          
          ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${finalOpacity})`
          ctx.fillRect(x, y, squareSize - 1, squareSize - 1)

          // Add border for some squares
          if (square.opacity > opacity * 0.7) {
            ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${finalOpacity * 0.5})`
            ctx.lineWidth = 1
            ctx.strokeRect(x, y, squareSize - 1, squareSize - 1)
          }
        }
      }

      animationFrameRef.current = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      window.removeEventListener('resize', resizeCanvas)
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [color, opacity, speed, squareSize])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0 }}
    />
  )
}

