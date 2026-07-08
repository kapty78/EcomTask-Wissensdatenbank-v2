"use client";

import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface HyperspeedBackgroundProps {
  className?: string;
  color?: string;
  particleCount?: number;
  speed?: number;
  /** Statt fullscreen-fixed im Eltern-Element (position:absolute) laufen. */
  contained?: boolean;
  /** Trail-Fade-Farbe — sollte zur Hintergrundfarbe des Containers passen. */
  fadeColor?: string;
}

interface Particle {
  x: number;
  y: number;
  z: number;
  prevX?: number;
  prevY?: number;
  isGolden?: boolean;
  x2d?: number;
  y2d?: number;
  radius?: number;
}

export const HyperspeedBackground: React.FC<HyperspeedBackgroundProps> = ({
  className = "",
  color = "#ffffff",
  particleCount = 100,
  speed = 1,
  contained = false,
  fadeColor = "rgba(30, 30, 30, 0.4)",
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particles = useRef<Particle[]>([]);
  const rafID = useRef<number | null>(null);
  const [caughtCount, setCaughtCount] = React.useState(0);
  const [hasWon, setHasWon] = React.useState(false);
  const [isSwipingOut, setIsSwipingOut] = React.useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size
    const resizeCanvas = () => {
      if (contained && canvas.parentElement) {
        canvas.width = canvas.parentElement.clientWidth;
        canvas.height = canvas.parentElement.clientHeight;
      } else {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      }
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    let resizeObserver: ResizeObserver | null = null;
    if (contained && canvas.parentElement) {
      resizeObserver = new ResizeObserver(resizeCanvas);
      resizeObserver.observe(canvas.parentElement);
    }

    // Initialize particles
    const initParticles = () => {
      particles.current = [];
      for (let i = 0; i < particleCount; i++) {
        particles.current.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          z: Math.random() * canvas.width,
          isGolden: Math.random() < 0.01, // 1% chance for golden particle
        });
      }
    };
    initParticles();

    // Animation loop
    const animate = () => {
      if (!ctx || !canvas) return;

      // Semi-transparent fill to create trail effect
      ctx.fillStyle = fadeColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      particles.current.forEach((particle) => {
        // Store previous position
        particle.prevX = particle.x;
        particle.prevY = particle.y;

        // Calculate position based on z (depth)
        const scale = canvas.width / particle.z;
        const x2d = (particle.x - centerX) * scale + centerX;
        const y2d = (particle.y - centerY) * scale + centerY;
        
        // Store position and radius for click detection
        const radius = scale * 1.5;
        particle.x2d = x2d;
        particle.y2d = y2d;
        particle.radius = radius;

        // Move particle towards viewer (decrease z)
        particle.z -= speed * 2;

        // Reset particle when it gets too close
        if (particle.z < 1) {
          particle.x = Math.random() * canvas.width;
          particle.y = Math.random() * canvas.height;
          particle.z = canvas.width;
          particle.prevX = undefined;
          particle.prevY = undefined;
          particle.isGolden = Math.random() < 0.01; // Re-roll golden chance
        }

        // Choose color based on whether particle is golden
        const particleColor = particle.isGolden ? "#FFD700" : color;

        // Draw particle trail
        if (particle.prevX !== undefined && particle.prevY !== undefined) {
          const prevScale = canvas.width / (particle.z + speed * 2);
          const prevX = (particle.x - centerX) * prevScale + centerX;
          const prevY = (particle.y - centerY) * prevScale + centerY;

          ctx.beginPath();
          ctx.moveTo(prevX, prevY);
          ctx.lineTo(x2d, y2d);

          // Opacity based on depth
          const opacity = 1 - particle.z / canvas.width;
          ctx.strokeStyle = `${particleColor}${Math.floor(opacity * 255).toString(16).padStart(2, "0")}`;
          ctx.lineWidth = scale * 1.5;
          ctx.stroke();
        }

        // Draw particle dot
        ctx.beginPath();
        ctx.arc(x2d, y2d, radius * 0.7, 0, Math.PI * 2);
        const opacity = 1 - particle.z / canvas.width;
        ctx.fillStyle = `${particleColor}${Math.floor(opacity * 255).toString(16).padStart(2, "0")}`;
        ctx.fill();
        
        // Add glow effect for golden particles
        if (particle.isGolden) {
          ctx.shadowBlur = 15;
          ctx.shadowColor = "#FFD700";
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      });

      rafID.current = requestAnimationFrame(animate);
    };

    animate();

    // Click handler for golden particles
    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      // Check if click hit any golden particle
      for (const particle of particles.current) {
        if (!particle.isGolden) continue;
        if (
          particle.x2d !== undefined &&
          particle.y2d !== undefined &&
          particle.radius !== undefined
        ) {
          const dx = clickX - particle.x2d;
          const dy = clickY - particle.y2d;
          const distance = Math.sqrt(dx * dx + dy * dy);

          // Larger click radius for golden particles (3x the visual size)
          if (distance <= particle.radius * 3) {
            // Hit! Increment counter
            setCaughtCount((prev) => {
              const newCount = prev + 1;
              if (newCount >= 5) {
                setHasWon(true);
                // Nach 6 Sekunden mit Swipe-Animation verschwinden
                setTimeout(() => {
                  setIsSwipingOut(true);
                  // Nach Animation zurücksetzen
                  setTimeout(() => {
                    setCaughtCount(0);
                    setHasWon(false);
                    setIsSwipingOut(false);
                  }, 500); // Animation duration
                }, 6000);
              }
              return newCount;
            });
            
            // Reset the golden particle
            particle.isGolden = false;
            break;
          }
        }
      }
    };

    canvas.addEventListener("click", handleClick);

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      resizeObserver?.disconnect();
      canvas.removeEventListener("click", handleClick);
      if (rafID.current) {
        cancelAnimationFrame(rafID.current);
      }
    };
  }, [color, particleCount, speed, contained, fadeColor]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className={cn(
          contained ? "absolute inset-0" : "fixed inset-0",
          className
        )}
        style={{
          zIndex: 0,
          cursor: "pointer",
          pointerEvents: "auto"
        }}
      />
      
      {/* Schlichter Counter rechts oben */}
      {caughtCount > 0 && (
        <div
          className={cn(
            contained ? "absolute" : "fixed",
            "top-4 right-4 z-50 pointer-events-none transition-all duration-500"
          )}
          style={{
            transform: isSwipingOut ? 'translateX(200px)' : 'translateX(0)',
            opacity: isSwipingOut ? 0 : 1
          }}
        >
          <div 
            className="text-white text-sm font-bold"
            style={{
              fontFamily: 'Courier New, monospace'
            }}
          >
            {hasWon ? 'genug gespielt!' : `${caughtCount}/5`}
          </div>
        </div>
      )}
      
      <style jsx>{`
        @keyframes swipeOut {
          from {
            transform: translateX(0);
            opacity: 1;
          }
          to {
            transform: translateX(200px);
            opacity: 0;
          }
        }
      `}</style>
    </>
  );
};

