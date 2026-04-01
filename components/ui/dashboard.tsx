"use client"

import { Sidebar } from "../sidebar/sidebar"
import { SidebarSwitcher } from "../sidebar/sidebar-switcher"
import { Button } from "@nextui-org/react"
import { Tabs } from "./tabs"
import useHotkey from "@/lib/hooks/use-hotkey"
import { cn } from "@/lib/utils"
import { ContentType } from "@/types"
import { IconChevronCompactRight } from "@tabler/icons-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { FC, useState, useEffect, useContext, lazy, Suspense } from "react"
import { useSelectFileHandler } from "../chat/chat-hooks/use-select-file-handler"
import { CommandK } from "../utility/command-k"
import { ChatbotUIContext } from "@/context/context"
import { IconMenu2 } from "@tabler/icons-react"
import { ChatUI as Chat } from "../chat/chat-ui"
import { QuickSettings } from "../chat/quick-settings"

export const SIDEBAR_WIDTH = 350

interface DashboardProps {
  children: React.ReactNode
}

// Dynamically import the KnowledgeBasePage component
const KnowledgeBaseComponent = lazy(
  () => import("@/components/knowledge/KnowledgeBasePage")
)

export const Dashboard: FC<DashboardProps> = ({ children }) => {
  useHotkey("s", () => setShowSidebar(prevState => !prevState))

  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabValue = searchParams.get("tab") || "chats"

  const { handleSelectDeviceFile } = useSelectFileHandler()

  const [contentType, setContentType] = useState<ContentType>(
    tabValue as ContentType
  )
  const [showSidebar, setShowSidebar] = useState(
    localStorage.getItem("showSidebar") === "true"
  )
  const [isDragging, setIsDragging] = useState(false)

  const { profile, selectedWorkspace } = useContext(ChatbotUIContext)

  const handleContentTypeChange = (value: string) => {
    const newContentType = value as ContentType
    setContentType(newContentType)
    if (!showSidebar) {
      setShowSidebar(true)
      localStorage.setItem("showSidebar", "true")
    }

    // Don't navigate for knowledge type
    if (newContentType !== "knowledge") {
      router.replace(`${pathname}?tab=${newContentType}`)
    }
  }

  useEffect(() => {
    if (localStorage.getItem("showSidebar") === null) {
      setShowSidebar(true)
      localStorage.setItem("showSidebar", "true")
    } else {
      setShowSidebar(localStorage.getItem("showSidebar") === "true")
    }
  }, [])

  useEffect(() => {
    const handleResize = () => {
      const isLargeScreen = window.innerWidth > 768
      if (isLargeScreen) {
        setShowSidebar(true)
        localStorage.setItem("showSidebar", "true")
      }
    }

    window.addEventListener("resize", handleResize)
    handleResize()

    return () => window.removeEventListener("resize", handleResize)
  }, [])

  const toggleSidebar = () => {
    const newState = !showSidebar
    setShowSidebar(newState)
    localStorage.setItem("showSidebar", newState.toString())
  }

  useEffect(() => {
    if (!selectedWorkspace || pathname === "/") {
      setContentType("chats")
    }
  }, [selectedWorkspace, pathname])

  if (!profile || !selectedWorkspace) {
    return <div>Loading...</div>
  }

  const onFileDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()

    const files = event.dataTransfer.files
    const file = files[0]

    handleSelectDeviceFile(file)

    setIsDragging(false)
  }

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
  }

  const onDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
  }

  // Render the appropriate component based on content type
  const renderContent = () => {
    if (contentType === "knowledge") {
      return (
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              Loading knowledge base...
            </div>
          }
        >
          <KnowledgeBaseComponent />
        </Suspense>
      )
    }

    return children
  }

  return (
    <div className="flex size-full">
      <CommandK />

      <div
        className={cn(
          "duration-200 dark:border-none " + (showSidebar ? "border-r-2" : "")
        )}
        style={{
          // Sidebar
          minWidth: showSidebar ? `${SIDEBAR_WIDTH}px` : "0px",
          maxWidth: showSidebar ? `${SIDEBAR_WIDTH}px` : "0px",
          width: showSidebar ? `${SIDEBAR_WIDTH}px` : "0px"
        }}
      >
        {showSidebar && (
          <Tabs className="flex h-full" value={contentType}>
            <SidebarSwitcher onContentTypeChange={handleContentTypeChange} />

            <Sidebar contentType={contentType} showSidebar={showSidebar} />
          </Tabs>
        )}
      </div>

      <div
        className="bg-muted/50 relative flex w-screen min-w-[90%] grow flex-col sm:min-w-fit"
        onDrop={onFileDrop}
        onDragOver={onDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
      >
        {isDragging ? (
          <div className="flex h-full items-center justify-center bg-black/50 text-2xl text-white">
            drop file here
          </div>
        ) : (
          renderContent()
        )}

        <Button
          className={cn(
            "absolute left-[4px] top-[50%] z-10 size-[32px] cursor-pointer"
          )}
          style={{
            // marginLeft: showSidebar ? `${SIDEBAR_WIDTH}px` : "0px",
            transform: showSidebar ? "rotate(180deg)" : "rotate(0deg)"
          }}
          variant="ghost"
          isIconOnly
          onClick={toggleSidebar}
        >
          <IconChevronCompactRight size={24} />
        </Button>
      </div>
    </div>
  )
}
