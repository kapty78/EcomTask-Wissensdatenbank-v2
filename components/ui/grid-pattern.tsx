"use client"

import React from "react"
import { cn } from "@/lib/utils"

interface GridPatternProps {
  className?: string
  width?: number
  height?: number
  x?: number
  y?: number
  strokeDasharray?: string
  squares?: Array<[number, number]>
  opacity?: number
}

export const GridPattern: React.FC<GridPatternProps> = ({
  className = "",
  width = 40,
  height = 40,
  x = 0,
  y = 0,
  strokeDasharray = "0",
  squares = [],
  opacity = 0.5,
  ...props
}) => {
  const id = React.useId()

  return (
    <svg
      aria-hidden="true"
      className={cn(
        "pointer-events-none fixed inset-0 h-full w-full stroke-gray-300/10 dark:stroke-white/3",
        className
      )}
      style={{ zIndex: 0 }}
      {...props}
    >
      <defs>
        <pattern
          id={id}
          width={width}
          height={height}
          patternUnits="userSpaceOnUse"
          x={x}
          y={y}
        >
          <path
            d={`M.5 ${height}V.5H${width}`}
            fill="none"
            strokeDasharray={strokeDasharray}
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" strokeWidth={0} fill={`url(#${id})`} />
      {squares && (
        <svg x={x} y={y} className="overflow-visible">
          {squares.map(([x, y], index) => (
            <rect
              strokeWidth="0"
              key={`${x}-${y}-${index}`}
              width={width - 1}
              height={height - 1}
              x={x * width + 1}
              y={y * height + 1}
              className="fill-gray-400/10 dark:fill-white/5 animate-pulse"
              style={{
                animationDelay: `${index * 0.1}s`,
                animationDuration: `${2 + (index % 3)}s`,
              }}
            />
          ))}
        </svg>
      )}
    </svg>
  )
}

