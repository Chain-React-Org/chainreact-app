"use client"

import { useState } from "react"

const C = "#F97316"

const ROUTER_OPTIONS = [
  { id: "R1", name: "Y-Fork (dot)", svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="6" fill="${C}"/><circle cx="8" cy="12" r="2.5" fill="white"/><path d="M10.5 12L17 7" stroke="white" stroke-width="2.5" stroke-linecap="round"/><path d="M10.5 12L17 17" stroke="white" stroke-width="2.5" stroke-linecap="round"/></svg>` },
  { id: "R2", name: "Fork (line)", svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="6" fill="${C}"/><path d="M7 12H11" stroke="white" stroke-width="2.5" stroke-linecap="round"/><path d="M11 12L17 7" stroke="white" stroke-width="2.5" stroke-linecap="round"/><path d="M11 12L17 17" stroke="white" stroke-width="2.5" stroke-linecap="round"/></svg>` },
  { id: "R3", name: "Three-way split", svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="6" fill="${C}"/><circle cx="7" cy="12" r="2" fill="white"/><path d="M9 12L18 6" stroke="white" stroke-width="2" stroke-linecap="round"/><path d="M9 12H18" stroke="white" stroke-width="2" stroke-linecap="round"/><path d="M9 12L18 18" stroke="white" stroke-width="2" stroke-linecap="round"/><circle cx="18" cy="6" r="1.5" fill="white" opacity="0.5"/><circle cx="18" cy="12" r="1.5" fill="white" opacity="0.5"/><circle cx="18" cy="18" r="1.5" fill="white" opacity="0.5"/></svg>` },
  { id: "R4", name: "Curved fork", svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="6" fill="${C}"/><path d="M6 12H10" stroke="white" stroke-width="2.5" stroke-linecap="round"/><path d="M10 12C13 12 15 8 18 7" stroke="white" stroke-width="2.5" stroke-linecap="round" fill="none"/><path d="M10 12C13 12 15 16 18 17" stroke="white" stroke-width="2.5" stroke-linecap="round" fill="none"/></svg>` },
  { id: "R5", name: "Route map (dots)", svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="6" fill="${C}"/><circle cx="8" cy="12" r="3" fill="white"/><circle cx="8" cy="12" r="1.5" fill="${C}"/><path d="M11 12L18 7" stroke="white" stroke-width="2" stroke-linecap="round"/><path d="M11 12L18 17" stroke="white" stroke-width="2" stroke-linecap="round"/><circle cx="18" cy="7" r="1.5" fill="white"/><circle cx="18" cy="17" r="1.5" fill="white"/></svg>` },
  { id: "R6", name: "Arrow split with heads", svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="6" fill="${C}"/><path d="M5 12H10L15 7H19" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 12L15 17H19" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 5L19 7L17 9" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 15L19 17L17 19" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>` },
  { id: "R7", name: "Signpost", svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="6" fill="${C}"/><path d="M12 5V19" stroke="white" stroke-width="2" stroke-linecap="round"/><path d="M8 8H16L18 10L16 12H8V8Z" fill="white"/><path d="M16 14H8L6 16L8 18H16V14Z" fill="white" opacity="0.6"/></svg>` },
  { id: "R8", name: "Shuffle", svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="6" fill="${C}"/><path d="M5 8H8L16 16H19" stroke="white" stroke-width="2.5" stroke-linecap="round"/><path d="M5 16H8L16 8H19" stroke="white" stroke-width="2.5" stroke-linecap="round"/><path d="M17 6L19 8L17 10" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 14L19 16L17 18" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>` },
  { id: "R9", name: "Git branch", svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="6" fill="${C}"/><path d="M9 5V19" stroke="white" stroke-width="2.5" stroke-linecap="round"/><path d="M9 12C12 12 15 9 15 6" stroke="white" stroke-width="2.5" stroke-linecap="round" fill="none"/><circle cx="9" cy="17" r="2" fill="${C}" stroke="white" stroke-width="1.5"/><circle cx="15" cy="6" r="2" fill="${C}" stroke="white" stroke-width="1.5"/></svg>` },
  { id: "R10", name: "Tree branch (org chart)", svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="6" fill="${C}"/><rect x="9" y="4" width="6" height="4" rx="1.5" fill="white"/><path d="M12 8V11" stroke="white" stroke-width="2" stroke-linecap="round"/><path d="M6 11H18" stroke="white" stroke-width="2" stroke-linecap="round"/><path d="M6 11V14" stroke="white" stroke-width="2" stroke-linecap="round"/><path d="M12 11V14" stroke="white" stroke-width="2" stroke-linecap="round"/><path d="M18 11V14" stroke="white" stroke-width="2" stroke-linecap="round"/><rect x="3.5" y="14" width="5" height="3.5" rx="1" fill="white" opacity="0.7"/><rect x="9.5" y="14" width="5" height="3.5" rx="1" fill="white" opacity="0.7"/><rect x="15.5" y="14" width="5" height="3.5" rx="1" fill="white" opacity="0.7"/></svg>` },
]

const LOOP_OPTIONS = [
  { id: "LP1", name: "Circular arrow (single)", svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="6" fill="${C}"/><path d="M17 8C17 8 15 5 12 5C8.5 5 6 8 6 12C6 16 8.5 19 12 19C15 19 17 16.5 17 16.5" stroke="white" stroke-width="2.5" stroke-linecap="round" fill="none"/><path d="M17 5V8H14" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>` },
  { id: "LP2", name: "Infinity loop", svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="6" fill="${C}"/><path d="M8 12C8 10 6.5 8 4.5 8C2.5 8 1 10 1 12C1 14 2.5 16 4.5 16C6.5 16 8 14 8 12Z" stroke="white" stroke-width="2.5" fill="none" transform="translate(3,0)"/><path d="M16 12C16 14 17.5 16 19.5 16C21.5 16 23 14 23 12C23 10 21.5 8 19.5 8C17.5 8 16 10 16 12Z" stroke="white" stroke-width="2.5" fill="none" transform="translate(-3,0)"/></svg>` },
  { id: "LP3", name: "Repeat arrows (dual)", svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="6" fill="${C}"/><path d="M5 10C5 7 8 5 12 5C16 5 19 7 19 10" stroke="white" stroke-width="2.5" stroke-linecap="round" fill="none"/><path d="M19 14C19 17 16 19 12 19C8 19 5 17 5 14" stroke="white" stroke-width="2.5" stroke-linecap="round" fill="none"/><path d="M17 7L19 10L16 10" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M7 17L5 14L8 14" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>` },
  { id: "LP4", name: "Cycle / 3-arrows", svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="6" fill="${C}"/><path d="M12 5L15 9H9L12 5Z" fill="white"/><path d="M18 16L14 18L16 13L18 16Z" fill="white" opacity="0.7"/><path d="M6 16L10 18L8 13L6 16Z" fill="white" opacity="0.7"/><path d="M14 8C16 9 18 12 17 15" stroke="white" stroke-width="1.5" stroke-linecap="round" fill="none"/><path d="M7 15C6 12 8 9 10 8" stroke="white" stroke-width="1.5" stroke-linecap="round" fill="none"/><path d="M10 18H14" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg>` },
  { id: "LP5", name: "Number hash #", svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="6" fill="${C}"/><path d="M9 5L7 19" stroke="white" stroke-width="2.5" stroke-linecap="round"/><path d="M17 5L15 19" stroke="white" stroke-width="2.5" stroke-linecap="round"/><path d="M5 9H19" stroke="white" stroke-width="2.5" stroke-linecap="round"/><path d="M5 15H19" stroke="white" stroke-width="2.5" stroke-linecap="round"/></svg>` },
]

export default function IconPreviewPage() {
  const [size, setSize] = useState(32)

  return (
    <div className="max-w-6xl mx-auto py-10 px-6 space-y-10">
      <div>
        <h1 className="text-3xl font-bold mb-2">Router & Loop — Pick Again</h1>
        <p className="text-gray-500">The saved files didn&apos;t match your picks. Reconfirm which ones you want.</p>
      </div>

      <div className="flex items-center gap-3 sticky top-4 z-10 bg-white/80 dark:bg-gray-950/80 backdrop-blur py-3 px-4 rounded-lg border">
        <span className="text-sm text-gray-500 font-medium">Size:</span>
        {[20, 24, 32, 40, 48, 64].map(s => (
          <button key={s} onClick={() => setSize(s)}
            className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${size === s ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}
          >{s}px</button>
        ))}
      </div>

      {/* Current (incorrect) files */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold text-red-600 uppercase tracking-wider">Currently Saved (incorrect)</h2>
        <div className="flex gap-4">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20">
            <img src="/integrations/logic-router.svg" style={{ width: 28, height: 28 }} alt="" className="object-contain" />
            <span className="text-xs font-medium">Router (current file)</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20">
            <img src="/integrations/logic-loop.svg" style={{ width: 28, height: 28 }} alt="" className="object-contain" />
            <span className="text-xs font-medium">Loop (current file)</span>
          </div>
        </div>
      </div>

      {/* Router options */}
      <div className="space-y-4 border-t pt-8">
        <h2 className="text-lg font-bold">Router Options</h2>
        <p className="text-sm text-gray-500">Route workflow to different paths based on conditions</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {ROUTER_OPTIONS.map(opt => (
            <div key={opt.id} className="border rounded-xl p-4 space-y-2 hover:shadow-md transition-shadow bg-white dark:bg-gray-900">
              <div className="flex items-center gap-3">
                <div style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: opt.svg }} />
                <div style={{ width: 20, height: 20 }} dangerouslySetInnerHTML={{ __html: opt.svg }} className="opacity-50" />
              </div>
              <p className="text-sm font-semibold">{opt.id}: {opt.name}</p>
              <div className="flex items-center gap-1.5 pt-2 border-t">
                <img src="/integrations/gmail.svg" className="w-6 h-6" alt="" />
                <span className="text-gray-300 text-xs">›</span>
                <div style={{ width: 24, height: 24 }} dangerouslySetInnerHTML={{ __html: opt.svg }} />
                <span className="text-gray-300 text-xs">›</span>
                <img src="/integrations/slack.svg" className="w-6 h-6" alt="" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Loop options */}
      <div className="space-y-4 border-t pt-8">
        <h2 className="text-lg font-bold">Loop Options</h2>
        <p className="text-sm text-gray-500">Iterate through items or repeat actions N times</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {LOOP_OPTIONS.map(opt => (
            <div key={opt.id} className="border rounded-xl p-4 space-y-2 hover:shadow-md transition-shadow bg-white dark:bg-gray-900">
              <div className="flex items-center gap-3">
                <div style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: opt.svg }} />
                <div style={{ width: 20, height: 20 }} dangerouslySetInnerHTML={{ __html: opt.svg }} className="opacity-50" />
              </div>
              <p className="text-sm font-semibold">{opt.id}: {opt.name}</p>
              <div className="flex items-center gap-1.5 pt-2 border-t">
                <img src="/integrations/gmail.svg" className="w-6 h-6" alt="" />
                <span className="text-gray-300 text-xs">›</span>
                <div style={{ width: 24, height: 24 }} dangerouslySetInnerHTML={{ __html: opt.svg }} />
                <span className="text-gray-300 text-xs">›</span>
                <img src="/integrations/slack.svg" className="w-6 h-6" alt="" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
