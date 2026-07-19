"use client"

import type { AgentRichBlock } from "../types"

type ImageBlockData = AgentRichBlock & { type: "image" }

export function ImageBlock({ block, blockIndex }: { block: ImageBlockData; blockIndex: number }) {
  return (
    <figure key={`image-${blockIndex}`} className="overflow-hidden rounded-md border border-border bg-card">
      {block.title && (
        <figcaption className="border-b border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground">
          {block.title}
        </figcaption>
      )}
      <img
        src={block.url}
        alt={block.alt || block.title || ""}
        className="max-h-80 w-full object-contain bg-muted/30"
        loading="lazy"
      />
    </figure>
  )
}
