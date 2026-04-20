import {
  Home,
  Zap,
  Layers,
  LayoutGrid,
  Plug,
  Sparkles,
  BarChart3,
  Users,
  Building,
  Shield,
  Settings,
  UserCircle,
  LifeBuoy,
  CreditCard,
  Receipt,
  User,
  type LucideIcon,
} from "lucide-react"

export interface NavItem {
  id: string
  label: string
  href: string
  icon: LucideIcon
  badge?: string
}

export interface NavSection {
  id: string
  label: string
  icon: LucideIcon
  href: string
  children: NavItem[]
}

export function getNavSections(isAdmin: boolean): NavSection[] {
  const sections: NavSection[] = [
    {
      id: "workflows",
      label: "Workflows",
      icon: Zap,
      href: "/workflows",
      children: [
        { id: "workflows", label: "Workflows", href: "/workflows", icon: Zap },
      ],
    },
    {
      id: "templates",
      label: "Templates",
      icon: Layers,
      href: "/templates",
      children: [
        { id: "templates", label: "Templates", href: "/templates", icon: Layers },
      ],
    },
    {
      id: "apps",
      label: "Connections",
      icon: Plug,
      href: "/connections",
      children: [
        { id: "connections", label: "Connections", href: "/connections", icon: Plug },
      ],
    },
    {
      id: "ai-assistant",
      label: "Assistant",
      icon: Sparkles,
      href: "/ai-assistant",
      children: [
        { id: "ai-assistant", label: "Assistant", href: "/ai-assistant", icon: Sparkles },
      ],
    },
    {
      id: "analytics",
      label: "Analytics",
      icon: BarChart3,
      href: "/analytics",
      children: [
        { id: "analytics", label: "Analytics Dashboard", href: "/analytics", icon: BarChart3 },
      ],
    },
    {
      id: "organization",
      label: "Organization",
      icon: Building,
      href: "/org",
      children: [
        { id: "org", label: "Organization", href: "/org", icon: Building },
      ],
    },
    {
      id: "teams",
      label: "Teams",
      icon: Users,
      href: "/teams",
      children: [
        { id: "teams", label: "Teams", href: "/teams", icon: Users },
      ],
    },
    {
      id: "billing",
      label: "Billing",
      icon: CreditCard,
      href: "/subscription",
      children: [
        { id: "subscription", label: "Subscription", href: "/subscription", icon: CreditCard },
        { id: "payments", label: "Payments", href: "/payments", icon: Receipt },
      ],
    },
    {
      id: "settings",
      label: "Settings",
      icon: Settings,
      href: "/settings",
      children: [
        { id: "settings-account", label: "Account", href: "/settings", icon: User },
      ],
    },
  ]

  if (isAdmin) {
    sections.push({
      id: "admin",
      label: "Admin",
      icon: Shield,
      href: "/admin",
      children: [
        { id: "admin", label: "Admin Panel", href: "/admin", icon: Shield },
      ],
    })
  }

  return sections
}

/**
 * Given a pathname, determine which nav section is active.
 */
export function getActiveSectionId(pathname: string, sections: NavSection[]): string | null {
  for (const section of sections) {
    for (const child of section.children || []) {
      if (pathname === child.href || pathname.startsWith(child.href + "/")) {
        return section.id
      }
    }
    // Match the section's own href (e.g. /settings matches the settings section)
    if (pathname === section.href || pathname.startsWith(section.href + "/")) {
      return section.id
    }
  }
  return sections[0]?.id ?? null
}
