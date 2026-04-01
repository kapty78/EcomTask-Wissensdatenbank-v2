"use client"

import dynamic from "next/dynamic"

// Import the actual knowledge page component from the app directory
const KnowledgePageContent = dynamic(() => import("@/app/knowledge/page"), {
  ssr: false
})

// Re-export it as KnowledgeBasePage for use in the dashboard
export default function KnowledgeBasePage() {
  return <KnowledgePageContent />
}
