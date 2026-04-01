"use client"

import { createContext, forwardRef, useContext, useMemo } from "react"
import type { Variants } from "framer-motion"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"
import type { HTMLAttributes, ReactNode } from "react"

interface AnimatedListProps {
  children: ReactNode
  className?: string
  shouldAnimate?: boolean
  stagger?: number
  delay?: number
  duration?: number
}

interface AnimatedListContextValue {
  shouldAnimate: boolean
  itemVariants: Variants
}

const AnimatedListContext = createContext<AnimatedListContextValue | null>(null)

const useAnimatedListContext = () => {
  const context = useContext(AnimatedListContext)

  if (!context) {
    throw new Error("AnimatedListItem muss innerhalb von AnimatedList verwendet werden")
  }

  return context
}

const defaultEase = [0.21, 0.8, 0.33, 1]

export function AnimatedList({
  children,
  className,
  shouldAnimate = true,
  stagger = 0.08,
  delay = 0.12,
  duration = 0.35
}: AnimatedListProps) {
  const itemVariants = useMemo<Variants>(
    () => ({
      hidden: { opacity: 0, y: 16, scale: 0.98 },
      visible: {
        opacity: 1,
        y: 0,
        scale: 1,
        transition: { duration, ease: defaultEase }
      },
      exit: {
        opacity: 0,
        y: -12,
        scale: 0.98,
        transition: { duration: Math.max(duration * 0.75, 0.2), ease: defaultEase }
      }
    }),
    [duration]
  )

  const listVariants = useMemo<Variants>(
    () => ({
      hidden: {},
      visible: {
        transition: {
          staggerChildren: shouldAnimate ? stagger : 0,
          delayChildren: shouldAnimate ? delay : 0
        }
      }
    }),
    [shouldAnimate, stagger, delay]
  )

  const contextValue = useMemo<AnimatedListContextValue>(
    () => ({ shouldAnimate, itemVariants }),
    [shouldAnimate, itemVariants]
  )

  return (
    <AnimatedListContext.Provider value={contextValue}>
      <motion.div
        className={cn("flex flex-col", className)}
        variants={listVariants}
        initial={shouldAnimate ? "hidden" : "visible"}
        animate="visible"
        layout
      >
        {children}
      </motion.div>
    </AnimatedListContext.Provider>
  )
}

interface AnimatedListItemProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

export const AnimatedListItem = forwardRef<HTMLDivElement, AnimatedListItemProps>(
  ({ children, className, ...rest }, ref) => {
    const { shouldAnimate, itemVariants } = useAnimatedListContext()

    if (!shouldAnimate) {
      return (
        <div ref={ref} className={className} {...rest}>
          {children}
        </div>
      )
    }

    return (
      <motion.div
        ref={ref}
        className={className}
        variants={itemVariants}
        layout
        {...rest}
      >
        {children}
      </motion.div>
    )
  }
)

AnimatedListItem.displayName = "AnimatedListItem"









