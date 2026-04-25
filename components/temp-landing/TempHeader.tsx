"use client"

import React from "react"
import Link from "next/link"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { Menu, X, ArrowRight } from "lucide-react"
import { useAuthStore } from "@/stores/authStore"

const navLinks = [
  { label: "Docs", href: "/docs" },
  { label: "Templates", href: "/templates/showcase" },
  { label: "Enterprise", href: "/enterprise" },
]

export function TempHeader() {
  const router = useRouter()
  const { user } = useAuthStore()
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [scrolled, setScrolled] = React.useState(false)
  // Defer auth-dependent CTA text until after mount so SSR ("Get started free")
  // matches initial client render before localStorage hydrates the auth store.
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
    const handleScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  const isAuthed = mounted && !!user

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 border-b transition-[background-color,border-color,backdrop-filter] duration-300 ease-in-out"
      style={{
        backgroundColor: scrolled ? "rgba(2,6,23,0.85)" : "transparent",
        borderColor: scrolled ? "rgba(51,65,85,0.3)" : "transparent",
        backdropFilter: scrolled ? "blur(24px)" : "none",
        WebkitBackdropFilter: scrolled ? "blur(24px)" : "none",
      }}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between h-14 px-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <Image
            src="/logo_transparent.png"
            alt="ChainReact"
            width={24}
            height={24}
            className="brightness-0 invert"
          />
          <span className="text-sm font-semibold tracking-tight text-white">
            ChainReact
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="px-3 py-1.5 text-[13px] font-medium rounded-md text-slate-400 hover:text-white transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Desktop CTA */}
        <div className="hidden md:flex items-center gap-3">
          {isAuthed ? (
            <button
              onClick={() => router.push("/workflows")}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium h-8 px-4 rounded-md bg-white text-slate-900 hover:bg-slate-100 transition-colors"
            >
              Dashboard
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <>
              <Link
                href="/auth/login"
                className="text-[13px] font-medium text-slate-400 hover:text-white transition-colors"
              >
                Sign in
              </Link>
              <Link
                href="/auth/register"
                className="inline-flex items-center gap-1.5 text-[13px] font-medium h-8 px-4 rounded-md bg-white text-slate-900 hover:bg-slate-100 transition-colors"
              >
                Get started
              </Link>
            </>
          )}
        </div>

        {/* Mobile menu button */}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="md:hidden p-1.5 text-white"
          aria-label="Toggle menu"
        >
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden bg-slate-900 border-t border-slate-800 shadow-lg">
          <div className="px-4 py-3 space-y-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="block w-full px-3 py-2.5 text-sm text-slate-400 hover:text-white hover:bg-slate-800 rounded-md transition-colors"
              >
                {link.label}
              </Link>
            ))}
            <div className="pt-2 border-t border-slate-800 mt-2">
              <Link
                href={isAuthed ? "/workflows" : "/auth/register"}
                onClick={() => setMenuOpen(false)}
                className="block w-full text-center bg-white text-slate-900 text-sm font-medium py-2.5 rounded-md hover:bg-slate-100 transition-colors"
              >
                {isAuthed ? "Dashboard" : "Get started free"}
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
