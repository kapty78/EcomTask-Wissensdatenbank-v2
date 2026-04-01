"use client";

import React, { useState } from "react";
import { HelpCircle, PanelLeft, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DialogToolbarProps {
  title: string;
  helpTitle: string;
  helpSubtitle: string;
  helpContent: React.ReactNode;
  onClose: () => void;
  onDock?: () => void;
}

export const DialogToolbar: React.FC<DialogToolbarProps> = ({
  title,
  helpTitle,
  helpSubtitle,
  helpContent,
  onClose,
  onDock,
}) => {
  const [showHelp, setShowHelp] = useState(false);

  return (
    <>
      <div className="flex h-8 items-center justify-between rounded-t-xl border-b border-border bg-[#1a1a1a] px-2.5 select-none">
        {/* Left: Help button */}
        <button
          type="button"
          onClick={() => setShowHelp(!showHelp)}
          className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
          title="Hilfe"
        >
          <HelpCircle className="size-3.5" />
        </button>

        {/* Center: Title */}
        <span className="text-xs text-muted-foreground font-medium tracking-wide">
          {title}
        </span>

        {/* Right: Dock + Close */}
        <div className="flex items-center gap-1">
          {onDock && (
            <button
              type="button"
              onClick={onDock}
              className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
              title="Als Seitenleiste anheften"
            >
              <PanelLeft className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
            title="Schließen"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Help panel - slides down */}
      <div
        className={cn(
          "overflow-hidden border-b border-border bg-[#1e1e1e] transition-all duration-300 ease-in-out",
          showHelp ? "max-h-60" : "max-h-0 border-b-0"
        )}
      >
        <div className="p-4 space-y-3">
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-foreground">{helpTitle}</h3>
            <h4 className="text-xs font-medium text-primary">{helpSubtitle}</h4>
          </div>
          <div className="space-y-2 text-foreground text-xs leading-relaxed">
            {helpContent}
          </div>
        </div>
      </div>
    </>
  );
};
