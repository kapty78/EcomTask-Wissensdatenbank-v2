import React, { useState, useEffect } from "react";

interface ProcessingOverlayProps {
  visible?: boolean;
  message?: string;
  progress?: number; // 0-100
  title?: string;
  showProgress?: boolean;
}

export default function ProcessingOverlay({
  visible = false,
  message = "Bitte diesen Tab nicht schließen oder verlassen, während das Dokument verarbeitet wird.",
  progress = 0,
  title = "Dokument wird verarbeitet",
  showProgress = true
}: ProcessingOverlayProps) {
  const [dots, setDots] = useState('');
  
  // Animierte Punkte für loading
  useEffect(() => {
    if (!visible) return;
    
    const interval = setInterval(() => {
      setDots(prev => {
        if (prev === '...') return '';
        return prev + '.';
      });
    }, 600);
    
    return () => clearInterval(interval);
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      {/* Gradient Animation Hintergrund */}
      <div className="absolute inset-0 opacity-30">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-600/20 via-purple-600/20 to-pink-600/20 animate-pulse"></div>
        <div className="absolute inset-0 bg-gradient-to-tl from-pink-600/10 via-purple-600/10 to-blue-600/10 animate-pulse [animation-delay:1s]"></div>
      </div>
      
      {/* Main Content Card */}
      <div className="relative bg-gray-900/90 backdrop-blur-md border border-gray-700/50 rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
        {/* Animated Border */}
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-blue-500/20 via-purple-500/20 to-pink-500/20 p-[1px]">
          <div className="h-full w-full rounded-2xl bg-gray-900/90"></div>
        </div>
        
        <div className="relative z-10 text-center">
          {/* Animated Icon */}
          <div className="mb-6 relative">
            {/* Rotating outer ring */}
            <div className="w-20 h-20 mx-auto relative">
              <div className="absolute inset-0 border-4 border-gray-600/30 rounded-full"></div>
              <div className="absolute inset-0 border-4 border-transparent border-t-blue-500 rounded-full animate-spin"></div>
              <div className="absolute inset-2 border-2 border-transparent border-t-purple-500 rounded-full animate-spin [animation-direction:reverse] [animation-duration:1.5s]"></div>
              
              {/* Center Icon */}
              <div className="absolute inset-0 flex items-center justify-center">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-blue-400">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <polyline points="14,2 14,8 20,8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <polyline points="10,9 9,9 8,9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>
          </div>
          
          {/* Title */}
          <h3 className="text-xl font-semibold text-white mb-3">
            {title}{dots}
          </h3>
          
          {/* Progress Bar */}
          {showProgress && (
            <div className="mb-4">
              <div className="flex justify-between text-sm text-gray-400 mb-2">
                <span>Fortschritt</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <div className="w-full bg-gray-700/50 rounded-full h-2 overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-300 ease-out relative"
                  style={{ width: `${Math.min(progress, 100)}%` }}
                >
                  {/* Animated shimmer effect */}
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-pulse"></div>
                </div>
              </div>
            </div>
          )}
          
          {/* Message */}
          <p className="text-gray-300 text-sm leading-relaxed mb-4">
            {message}
          </p>
          
          {/* Processing Steps Animation */}
          <div className="flex justify-center space-x-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"
                style={{
                  animationDelay: `${i * 0.3}s`,
                  animationDuration: '1.5s'
                }}
              ></div>
            ))}
          </div>
          
          {/* Additional Info */}
          <div className="mt-6 pt-4 border-t border-gray-700/50">
            <div className="flex items-center justify-center space-x-2 text-xs text-gray-500">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-muted-foreground">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="m12 17 .01 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>Seite nicht schließen oder verlassen</span>
            </div>
          </div>
        </div>
      </div>
      
      {/* Floating particles effect */}
      <div className="absolute inset-0 pointer-events-none">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-blue-400/30 rounded-full animate-bounce"
            style={{
              left: `${20 + i * 15}%`,
              top: `${30 + Math.sin(i) * 20}%`,
              animationDelay: `${i * 0.5}s`,
              animationDuration: `${2 + i * 0.3}s`
            }}
          ></div>
        ))}
      </div>
    </div>
  );
} 