"use client"

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react"
import Link from "next/link"
import { useIntegrationStore } from "@/stores/integrationStore"
import { useAuthStore } from "@/stores/authStore"
import { Button } from "@/components/ui/button"
import { useAutoResizeTextarea } from "@/hooks/use-auto-resize-textarea"
// Badge, Card, CardContent available if needed by data renderers
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import {
  Send,
  Bot,
  User,
  Calendar,
  Mail,
  FileText,
  Sparkles,
  CheckCircle,
  AlertCircle,
  Loader2,
  Users,
  Code,
  DollarSign,
  MessageSquare,
  Zap,
  Clock,
  Workflow,
  Mic,
  Trash2,
  X,
  Search,
  PanelLeftClose,
  PanelLeft,
  Brain,
  Plus
} from "lucide-react"
import { cn } from "@/lib/utils"
import { createClient } from "@/utils/supabase/client"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

import { logger } from '@/lib/utils/logger'
import { usePersonalFeatureGate } from '@/hooks/use-feature-gate'

// Import all data renderers
import {
  EmailRenderer,
  FileRenderer,
  TableRenderer,
  JSONRenderer,
  CodeRenderer,
  MetricsRenderer,
  ListRenderer,
  TaskRenderer,
  ErrorRenderer,
  QuestionRenderer,
  IntegrationConnectionRenderer,
  IntegrationStatusRenderer,
  AppsGridRenderer,
  SourceCitationRenderer
} from './data-renderers'

// Import voice components
import { VoiceDictation } from './VoiceDictation'
// AIAssistantComingSoon removed — voice feature not yet available

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
  metadata?: {
    type?: "calendar" | "email" | "file" | "confirmation" | "social" | "crm" | "ecommerce" |
           "developer" | "productivity" | "communication" | "integration_not_connected" |
           "error" | "notion_page_hierarchy" | "table" | "json" | "code" | "metrics" | "list" |
           "task" | "warning" | "info" | "question" | "integration_connect" | "integration_status" |
           "apps_grid" | "general_help"
    data?: any
    requiresConfirmation?: boolean
    integration?: string
    action?: string
    pages?: any[]
    // Additional fields for enhanced renderers
    tableName?: string
    headers?: string[]
    language?: string
    fileName?: string
    emails?: any[]
    files?: any[]
    tasks?: any[]
    metrics?: any[]
    items?: any[]
    code?: string
    rows?: any[]
    // Question fields
    question?: string
    options?: Array<{
      id: string
      label: string
      value: any
      description?: string
      icon?: string
    }>
    questionId?: string
    // Integration connection fields
    provider?: string
    providerName?: string
    oauthUrl?: string
    // Integration status fields
    connectedDate?: string
    status?: string
    // Apps grid fields
    apps?: Array<{
      id: string
      name: string
      connected: boolean
      status?: string
    }>
    // Flag for locally-generated responses (not from API)
    local?: boolean
  }
  conversationId?: string
}

interface Conversation {
  id: string
  title: string
  created_at: string
  updated_at: string
  preview: string
}

// Typing animation component for conversation titles
function TypingText({ text, onComplete }: { text: string, onComplete?: () => void }) {
  const [displayedText, setDisplayedText] = useState("")
  const [currentIndex, setCurrentIndex] = useState(0)

  useEffect(() => {
    if (currentIndex < text.length) {
      const timeout = setTimeout(() => {
        setDisplayedText(prev => prev + text[currentIndex])
        setCurrentIndex(prev => prev + 1)
      }, 30) // 30ms per character for smooth typing

      return () => clearTimeout(timeout)
    } else if (onComplete) {
      // Wait a bit after finishing before calling onComplete
      const timeout = setTimeout(onComplete, 1000)
      return () => clearTimeout(timeout)
    }
  }, [currentIndex, text, onComplete])

  return <>{displayedText}</>
}

export default function AIAssistantContent() {
  const aiGate = usePersonalFeatureGate('aiAgents')

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [pendingConfirmation, setPendingConfirmation] = useState<any>(null)
  const [conversationId, setConversationId] = useState<string | undefined>(undefined)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [isLoadingConversations, setIsLoadingConversations] = useState(false)
  const [activeConversationTitle, setActiveConversationTitle] = useState<string>("New Chat")
  const [typingConversationId, setTypingConversationId] = useState<string | null>(null)
  const [isDictating, setIsDictating] = useState(false)
  // showAIAssistantModal removed — voice feature not yet available
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [sidebarSearch, setSidebarSearch] = useState("")
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [insights, setInsights] = useState<Array<{ type: string; icon: string; text: string; priority: "info" | "warning" | "success" }>>([])
  const [insightsLoaded, setInsightsLoaded] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const chatContainerRef = useRef<HTMLDivElement>(null)

  // Auto-resize textarea hook
  const { textareaRef: autoResizeRef, resize: resizeInput } = useAutoResizeTextarea({
    minHeight: 48,
    maxHeight: 200,
    value: input,
  })

  // Merge inputRef with autoResizeRef
  const mergedInputRef = useCallback((node: HTMLTextAreaElement | null) => {
    ;(inputRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = node
    ;(autoResizeRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = node
  }, [autoResizeRef])
  const abortControllerRef = useRef<AbortController | null>(null)
  const { toast } = useToast()
  const { integrations } = useIntegrationStore()
  const { user } = useAuthStore()

  // Cleanup function for any pending requests when component unmounts
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Load proactive insights on mount (non-blocking)
  useEffect(() => {
    if (!user || insightsLoaded) return
    const supabase = createClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.access_token) return
      fetch("/api/ai/insights", {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })
        .then(res => res.json())
        .then(data => {
          if (data.insights) setInsights(data.insights)
          setInsightsLoaded(true)
        })
        .catch(() => setInsightsLoaded(true))
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // Load conversations on mount with timeout safety
  useEffect(() => {
    let timeoutId: NodeJS.Timeout
    let mounted = true

    // Safety timeout - if loading takes more than 10 seconds, force it to complete
    timeoutId = setTimeout(() => {
      if (mounted) {
        logger.warn("Conversation loading timed out, forcing completion")
        setIsLoadingConversations(false)
        setConversations([])
      }
    }, 10000)

    loadConversations().finally(() => {
      if (mounted) {
        clearTimeout(timeoutId)
      }
    })

    return () => {
      mounted = false
      clearTimeout(timeoutId)
    }
     
  }, [])

  const loadConversations = async () => {
    setIsLoadingConversations(true)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        logger.info("No session found, skipping conversation load")
        setConversations([])
        setIsLoadingConversations(false)
        return
      }

      logger.info("Loading conversations...")
      const response = await fetch("/api/ai/conversations", {
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
        },
      })

      if (response.ok) {
        const data = await response.json()
        logger.info(`Loaded ${data.conversations?.length || 0} conversations`)
        setConversations(data.conversations || [])
      } else {
        // Table might not exist yet - that's okay
        logger.warn("Could not load conversations:", response.status)
        setConversations([])
      }
    } catch (error) {
      logger.warn("Error loading conversations (table may not exist yet):", error)
      setConversations([])
    } finally {
      setIsLoadingConversations(false)
      logger.info("Conversation loading complete")
    }
  }

  const loadConversation = async (convId: string) => {
    setIsLoading(true)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return

      const response = await fetch(`/api/ai/conversations/${convId}`, {
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
        },
      })

      if (response.ok) {
        const data = await response.json()
        setConversationId(convId)
        setMessages(data.messages || [])
        setActiveConversationTitle(data.title || "New Chat")
        setSidebarOpen(false) // Close sidebar on mobile after selecting
      }
    } catch (error) {
      logger.error("Error loading conversation:", error)
      toast({
        title: "Error",
        description: "Failed to load conversation",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const startNewChat = () => {
    setMessages([])
    setConversationId(undefined)
    setActiveConversationTitle("New Chat")
    setTypingConversationId(null)
    setInput("")
    setIsLoading(false)
    setPendingConfirmation(null)

    // Cancel any pending requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }

  const generateConversationTitle = (firstMessage: string): string => {
    // Take first 50 characters of the message as title
    const title = firstMessage.slice(0, 50)
    return title.length < firstMessage.length ? `${title}...` : title
  }

  const saveConversation = async (convId: string | undefined, title: string, msgs: Message[]): Promise<string | null> => {
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return null

      const preview = msgs[0]?.content.slice(0, 100) || ""

      // Validate UUID format - only send id if it's a valid UUID
      const isValidUUID = convId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(convId)

      const response = await fetch("/api/ai/conversations", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: isValidUUID ? convId : undefined, // Only send valid UUIDs
          title,
          preview,
          messages: msgs,
        }),
      })

      if (!response.ok) {
        logger.error("Failed to save conversation:", await response.text())
        return null
      }

      const data = await response.json()
      return data.conversation?.id || null
    } catch (error) {
      logger.error("Error saving conversation:", error)
      return null
    }
  }

  const deleteConversation = async (convId: string) => {
    try {
      // OPTIMISTIC UPDATE: Remove from UI immediately
      setConversations(prev => prev.filter(c => c.id !== convId))

      // If we deleted the current conversation, start a new chat
      if (conversationId === convId) {
        startNewChat()
      }

      // Close confirmation dialog
      setDeleteConfirmId(null)

      // Background deletion (async, non-blocking)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        logger.error("No session for delete")
        return
      }

      // Fire and forget - don't await, allow multiple deletes in parallel
      fetch(`/api/ai/conversations/${convId}`, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
        },
      }).then(response => {
        if (!response.ok) {
          logger.error("Background delete failed for conversation:", convId)
          // Optionally: Could reload conversations here to restore if delete failed
          // For now, we trust the optimistic update
        }
      }).catch(error => {
        logger.error("Error in background delete:", error)
      })

      // No toast needed - instant UI feedback is better than notification

    } catch (error) {
      logger.error("Error deleting conversation:", error)
      // Reload to restore state if optimistic update failed
      await loadConversations()
      toast({
        title: "Error",
        description: "Failed to delete conversation",
        variant: "destructive",
      })
    }
  }

  const updateConversation = async (convId: string, allCurrentMessages: Message[]) => {
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return

      // Save the complete conversation history
      const response = await fetch(`/api/ai/conversations/${convId}`, {
        method: "PATCH",
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: allCurrentMessages,
        }),
      })

      if (!response.ok) {
        logger.error("Failed to update conversation:", await response.text())
      }
    } catch (error) {
      logger.error("Error updating conversation:", error)
    }
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const getIntegrationIcon = (provider: string) => {
    switch (provider) {
      case "google-calendar":
        return <Calendar className="w-4 h-4" />
      case "gmail":
      case "microsoft-outlook":
        return <Mail className="w-4 h-4" />
      case "google-drive":
      case "onedrive":
      case "dropbox":
      case "box":
        return <FileText className="w-4 h-4" />
      case "slack":
      case "discord":
      case "teams":
        return <Users className="w-4 h-4" />
      case "twitter":
      case "facebook":
      case "instagram":
      case "linkedin":
      case "tiktok":
      case "youtube":
        return <Sparkles className="w-4 h-4" />
      case "github":
      case "gitlab":
        return <Code className="w-4 h-4" />
      case "notion":
      case "trello":
      case "airtable":
        return <FileText className="w-4 h-4" />
      case "hubspot":
      case "shopify":
      case "stripe":
      case "paypal":
        return <DollarSign className="w-4 h-4" />
      default:
        return <Sparkles className="w-4 h-4" />
    }
  }

  const getLocalResponse = (message: string): string | null => {
    // Remove punctuation and normalize
    const lowerMessage = message.toLowerCase().trim().replace(/[?!.,;:]/g, '')

    // Simple greetings - no API call needed
    const greetings = ['hi', 'hello', 'hey', 'howdy', 'greetings', 'good morning', 'good afternoon', 'good evening']
    if (greetings.includes(lowerMessage)) {
      const responses = [
        "Hello! I'm here to help you get the most out of ChainReact.",
        "Hi there! Great to see you.",
        "Hey! Ready to streamline your workflows?",
        "Welcome! Let's get you set up.",
      ]
      const greeting = responses[Math.floor(Math.random() * responses.length)]

      return `${greeting} Here's what I can help you with:

### 🔗 Integrations & Connections
Manage your connected apps-Gmail, Slack, Notion, and more. I can show you what's connected, help you add new integrations, or troubleshoot any connection issues.

### ⚡ Workflows & Automation
View your workflows, check their status, activate or pause them, and get detailed insights into how they're performing.

### 📊 Data & Insights
Query your calendars, browse emails, search files, and pull data from all your productivity tools like Notion, Airtable, and Trello.

### 💡 Help & Guidance
Learn how to build powerful workflows, discover ChainReact features, and get expert tips to optimize your automation.

**What would you like to explore first?**`
    }

    // Acknowledgments - no API call needed
    const acknowledgments = ['thanks', 'thank you', 'thx', 'ty', 'appreciate it', 'ok', 'okay', 'got it', 'understood', 'perfect', 'great', 'awesome', 'nice']
    if (acknowledgments.includes(lowerMessage)) {
      const responses = [
        "You're welcome! Let me know if you need anything else.",
        "Happy to help! What else can I do for you?",
        "Glad I could help! Anything else you'd like to explore?",
        "Anytime! Feel free to ask me anything.",
      ]
      return responses[Math.floor(Math.random() * responses.length)]
    }

    // Help requests - no API call needed
    const helpPatterns = [
      'help', 'what can you do', 'what do you do', 'how can you help',
      'what are your capabilities', 'what can i do', 'show me what you can do'
    ]
    if (helpPatterns.some(pattern => lowerMessage.includes(pattern))) {
      return `I'm here to help! Here's what I can do:

### 🔗 Integrations & Connections
Manage your connected apps-Gmail, Slack, Notion, and more. I can show you what's connected, help you add new integrations, or troubleshoot any connection issues.

### ⚡ Workflows & Automation
View your workflows, check their status, activate or pause them, and get detailed insights into how they're performing.

### 📊 Data & Insights
Query your calendars, browse emails, search files, and pull data from all your productivity tools like Notion, Airtable, and Trello.

### 💡 Help & Guidance
Learn how to build powerful workflows, discover ChainReact features, and get expert tips to optimize your automation.

**What would you like to explore first?**`
    }

    // How to create a workflow - no API call needed
    if (lowerMessage.includes('how') && (lowerMessage.includes('create workflow') || lowerMessage.includes('make workflow') || lowerMessage.includes('build workflow'))) {
      return `Creating a workflow is easy! Here's how:

### 📝 Step-by-Step:
1. Go to the [Workflows page](/workflows)
2. Click the **"Create Workflow"** button
3. Choose a trigger (what starts your workflow)
4. Add actions (what happens when triggered)
5. Configure your nodes by clicking on them
6. Connect them together
7. Click **"Activate"** when you're ready!

### 💡 Pro Tips:
- Start with a template to get going faster
- Use the AI agent node for intelligent automation
- Test your workflow before activating it

**Want me to show you your active workflows or help with something specific?**`
    }

    // What apps/integrations are available - use local data
    const isAskingAboutAvailable = (
      (lowerMessage.includes('what') || lowerMessage.includes('which') || lowerMessage.includes('show')) &&
      (lowerMessage.includes('apps') || lowerMessage.includes('integrations')) &&
      (lowerMessage.includes('available') || lowerMessage.includes('can i') || lowerMessage.includes('are there'))
    ) || lowerMessage === 'what apps are available' || lowerMessage === 'what integrations are available'

    if (isAskingAboutAvailable) {
      // Return a special marker that we'll handle with the apps grid
      return '__SHOW_APPS_GRID__'
    }

    // Pricing questions - no API call needed
    if (lowerMessage.includes('pricing') || lowerMessage.includes('how much') || lowerMessage.includes('cost') || lowerMessage.includes('price')) {
      return `Great question! Here's our pricing structure:

### 💰 Pricing Plans:
- **Free Tier**: Perfect for getting started
- **Pro Plan**: Advanced features and more workflows
- **Enterprise**: Custom solutions for teams

For detailed pricing and features, check out our [Pricing page](/pricing).

**Want to know what plan you're currently on or need help upgrading?**`
    }

    return null
  }

  const handleSendMessage = async (messageText?: string, selectedOptionId?: string) => {
    const finalMessage = messageText || input.trim()
    if (!finalMessage || isLoading) return

    // Check for local responses first (saves API costs)
    const localResponse = getLocalResponse(finalMessage)
    if (localResponse && !selectedOptionId) {
      const userMessage: Message = {
        id: Date.now().toString(),
        role: "user",
        content: finalMessage,
        timestamp: new Date(),
      }

      // Special handling for apps grid
      if (localResponse === '__SHOW_APPS_GRID__') {
        // Build apps list from integration store
        const allProviders = [
          { id: 'gmail', name: 'Gmail' },
          { id: 'microsoft-outlook', name: 'Microsoft Outlook' },
          { id: 'slack', name: 'Slack' },
          { id: 'discord', name: 'Discord' },
          { id: 'microsoft-teams', name: 'Microsoft Teams' },
          { id: 'notion', name: 'Notion' },
          { id: 'airtable', name: 'Airtable' },
          { id: 'trello', name: 'Trello' },
          { id: 'google-sheets', name: 'Google Sheets' },
          { id: 'microsoft-onenote', name: 'Microsoft OneNote' },
          { id: 'google-drive', name: 'Google Drive' },
          { id: 'microsoft-onedrive', name: 'Microsoft OneDrive' },
          { id: 'dropbox', name: 'Dropbox' },
          { id: 'box', name: 'Box' },
          { id: 'hubspot', name: 'HubSpot' },
          { id: 'stripe', name: 'Stripe' },
          { id: 'shopify', name: 'Shopify' },
          { id: 'paypal', name: 'PayPal' },
          { id: 'github', name: 'GitHub' },
          { id: 'gitlab', name: 'GitLab' },
          { id: 'twitter', name: 'Twitter' },
          { id: 'facebook', name: 'Facebook' },
          { id: 'instagram', name: 'Instagram' },
          { id: 'linkedin', name: 'LinkedIn' },
          { id: 'tiktok', name: 'TikTok' },
          { id: 'youtube', name: 'YouTube' },
          { id: 'google-calendar', name: 'Google Calendar' }
        ]

        const apps = allProviders.map(provider => {
          const integration = integrations.find(i => i.provider === provider.id)

          let connectedDate = undefined
          let expiresDate = undefined

          if (integration) {
            connectedDate = new Date(integration.created_at).toLocaleDateString('en-US', {
              month: 'numeric',
              day: 'numeric',
              year: 'numeric'
            })

            if (integration.expires_at) {
              expiresDate = new Date(integration.expires_at).toLocaleDateString('en-US', {
                month: 'numeric',
                day: 'numeric',
                year: 'numeric'
              })
            }
          }

          return {
            id: provider.id,
            name: provider.name,
            connected: !!integration,
            status: integration?.status,
            connectedDate,
            expiresDate
          }
        })

        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "Here are the apps available on ChainReact:",
          timestamp: new Date(),
          metadata: {
            type: "apps_grid",
            apps,
            local: true
          }
        }

        const newMessages = [...messages, userMessage, assistantMessage]
        setMessages(newMessages)
        if (!messageText) setInput("")

        // Save conversation
        if (!conversationId) {
          const conversationTitle = generateConversationTitle(finalMessage)
          setActiveConversationTitle(conversationTitle)

          const newConversationId = await saveConversation(undefined, conversationTitle, [userMessage, assistantMessage])

          if (newConversationId) {
            setConversationId(newConversationId)
            setTypingConversationId(newConversationId)
            await loadConversations()
          }
        } else {
          await updateConversation(conversationId, newMessages)
        }

        return
      }

      // Regular local response
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: localResponse,
        timestamp: new Date(),
        metadata: { type: "general_help", local: true }
      }

      const newMessages = [...messages, userMessage, assistantMessage]
      setMessages(newMessages)
      if (!messageText) setInput("")

      // Generate conversation title and save - important for complete history!
      if (!conversationId) {
        const conversationTitle = generateConversationTitle(finalMessage)
        setActiveConversationTitle(conversationTitle)

        // Save the conversation and get the generated UUID from the database
        const newConversationId = await saveConversation(undefined, conversationTitle, [userMessage, assistantMessage])

        if (newConversationId) {
          setConversationId(newConversationId)
          setTypingConversationId(newConversationId) // Trigger typing animation
          await loadConversations() // Refresh the conversation list
        }
      } else {
        // Update existing conversation with ALL messages
        await updateConversation(conversationId, newMessages)
      }

      return
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: finalMessage,
      timestamp: new Date(),
    }

    setMessages(prev => [...prev, userMessage])
    if (!messageText) setInput("")  // Only clear input if it came from the input field
    setIsLoading(true)

    // Cancel any existing requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    let retryCount = 0
    const maxRetries = 2

    while (retryCount <= maxRetries) {
      try {
        // Get the current session token
        const supabase = createClient()
        
        // First validate user authentication
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser()
        
        if (userError || !user) {
          throw new Error("Not authenticated")
        }

        // Then get session for access token
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) {
          throw new Error("Session expired. Please log in again.")
        }

        // Create a new AbortController and store the reference
        abortControllerRef.current = new AbortController()
        const timeoutId = setTimeout(() => {
          if (abortControllerRef.current) abortControllerRef.current.abort()
        }, 30000) // 30 second timeout

        const response = await fetch("/api/ai/assistant", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            message: userMessage.content,
            conversationId,
            selectedOptionId
          }),
          signal: abortControllerRef.current.signal,
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          const errorText = await response.text()
          logger.error("API Error:", response.status, errorText)
          throw new Error(`API error: ${response.status} - ${errorText}`)
        }

        const data = await response.json()

        if (!data || !data.content) {
          throw new Error("Invalid response format from API")
        }

        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: data.content,
          timestamp: new Date(),
          metadata: data.metadata,
          conversationId: data.conversationId
        }

        const allMessages = [...messages, userMessage, assistantMessage]
        setMessages(allMessages)

        // Store conversation ID for subsequent messages
        const previousConversationId = conversationId

        // Check if this is the first API message or if we're transitioning from local to API
        const isFirstApiMessage = !previousConversationId

        if (isFirstApiMessage) {
          // This is the first message - save the conversation and get the UUID
          const conversationTitle = generateConversationTitle(
            messages.find(m => m.role === 'user')?.content || userMessage.content
          )
          setActiveConversationTitle(conversationTitle)

          // Save and get the generated conversation ID
          const newConversationId = await saveConversation(data.conversationId || undefined, conversationTitle, allMessages)

          if (newConversationId) {
            setConversationId(newConversationId)
            setTypingConversationId(newConversationId) // Trigger typing animation
            await loadConversations() // Refresh the conversation list
          }
        } else {
          // Update existing conversation with ALL messages
          await updateConversation(previousConversationId, allMessages)
        }

        if (data.metadata?.requiresConfirmation) {
          setPendingConfirmation(data.metadata)
        }

        // Success - break out of retry loop
        break

      } catch (error) {
        // Clear the abortControllerRef if it was aborted
        if (error instanceof Error && error.name === 'AbortError') {
          abortControllerRef.current = null;
        }
        
        logger.error(`Error sending message (attempt ${retryCount + 1}):`, error)
        
        // If this is the last retry, show error
        if (retryCount === maxRetries) {
          let errorMessage = "Failed to send message. Please try again."
          
          if (error instanceof Error) {
            if (error.name === 'AbortError') {
              errorMessage = "Request timed out. Please try again."
            } else if (error.message.includes('API error:')) {
              errorMessage = error.message.replace('API error: ', '')
            } else if (error.message.includes('Not authenticated')) {
              errorMessage = "Session expired. Please refresh the page and try again."
            } else if (error.message.includes('Failed to fetch')) {
              errorMessage = "Network error. Please check your connection and try again."
            }
          }
          
          // Add error message to chat
          const errorAssistantMessage: Message = {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: `Sorry, I encountered an error: ${errorMessage}`,
            timestamp: new Date(),
            metadata: { type: "error" },
          }
          
          setMessages(prev => [...prev, errorAssistantMessage])
          
          toast({
            title: "Error",
            description: errorMessage,
            variant: "destructive",
          })
        } else {
          // Wait before retrying (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retryCount)))
        }
        
        retryCount++
      }
    }
    
    // Clean up the abort controller reference
    abortControllerRef.current = null;
    setIsLoading(false)
  }

  const handleConfirmAction = async (confirmed: boolean) => {
    if (!pendingConfirmation) return

    // Cancel any existing requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    // Create a new AbortController
    abortControllerRef.current = new AbortController();

    try {
      // Get the current session token
      const supabase = createClient()
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()
      
      if (userError || !user) {
        throw new Error("Not authenticated")
      }

      // Then get session for access token
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        throw new Error("Session expired. Please log in again.")
      }

      const response = await fetch("/api/ai/confirm-action", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
          },
        body: JSON.stringify({
          action: pendingConfirmation.action,
          confirmed,
          parameters: pendingConfirmation.parameters,
        }),
        signal: abortControllerRef.current.signal,
      })

      if (!response.ok) {
        throw new Error("Failed to confirm action")
      }

      const data = await response.json()

      const confirmationMessage: Message = {
        id: (Date.now() + 2).toString(),
        role: "assistant",
        content: confirmed ? data.content : "Action cancelled.",
        timestamp: new Date(),
        metadata: confirmed ? { type: "confirmation" } : undefined,
      }

      setMessages(prev => [...prev, confirmationMessage])
    } catch (error) {
      logger.error("Error confirming action:", error)
      toast({
        title: "Error",
        description: "Failed to confirm action. Please try again.",
        variant: "destructive",
      })
    } finally {
      abortControllerRef.current = null;
      setPendingConfirmation(null)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (input.trim()) handleSendMessage()
    }
  }

  const handleDictationUpdate = (text: string) => {
    // Real-time update - replace entire input with transcribed text
    setInput(text)
  }

  const handleDictationTranscript = (text: string) => {
    // Final transcript - set input field
    setInput(text)
  }

  const handleStopDictation = () => {
    // Stop dictation without transcribing
    setIsDictating(false)
  }

  const renderMessageContent = (content: string) => {
    // Convert markdown-style links [text](url) to clickable links
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
    const parts = content.split(linkRegex)
    
    if (parts.length === 1) {
      return <div className="whitespace-pre-wrap">{content}</div>
    }
    
    const elements = []
    for (let i = 0; i < parts.length; i += 3) {
      if (i + 2 < parts.length) {
        // Add text before link
        if (parts[i]) {
          elements.push(<span key={`text-${i}`} className="whitespace-pre-wrap">{parts[i]}</span>)
        }
        // Add link
        elements.push(
          <a 
            key={`link-${i}`}
            href={parts[i + 2]} 
            className="text-orange-600 hover:text-orange-800 underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {parts[i + 1]}
          </a>
        )
      } else {
        // Add remaining text
        elements.push(<span key={`text-${i}`} className="whitespace-pre-wrap">{parts[i]}</span>)
      }
    }
    
    return <div>{elements}</div>
  }

  const renderCalendarView = (events: any[]) => {
    if (!events || events.length === 0) return null

    // Group events by date using the new date field
    const eventsByDate = events.reduce((acc, event) => {
      const dateKey = event.date || new Date(event.start).toDateString()
      
      if (!acc[dateKey]) {
        acc[dateKey] = []
      }
      acc[dateKey].push(event)
      return acc
    }, {} as Record<string, any[]>)

    // Sort dates
    const sortedDates = Object.keys(eventsByDate).sort((a, b) => {
      const dateA = new Date(a)
      const dateB = new Date(b)
      return dateA.getTime() - dateB.getTime()
    })

    return (
      <div className="mt-3 p-4 bg-background rounded-lg border">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="w-5 h-5" />
          <span className="font-medium text-lg">Calendar View</span>
        </div>
        
        <div className="space-y-4">
          {sortedDates.map((dateKey) => {
            const dayEvents = eventsByDate[dateKey]
            const firstEvent = dayEvents[0]
            const displayDate = firstEvent.date || new Date(dateKey).toLocaleDateString('en-US', { 
              weekday: 'long', 
              month: 'long', 
              day: 'numeric' 
            })
            
            return (
              <div key={dateKey} className="border rounded-lg p-3">
                <div className="flex items-center gap-2 mb-3">
                  <div className="text-sm font-medium text-muted-foreground">
                    {displayDate}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ({dayEvents.length} event{dayEvents.length !== 1 ? 's' : ''})
                  </div>
                </div>
                
                <div className="space-y-2">
                  {dayEvents.map((event: any, index: number) => {
                    // Use the pre-formatted times if available, otherwise format them
                    const startTime = event.startTime || new Date(event.start).toLocaleTimeString('en-US', { 
                      hour: 'numeric', 
                      minute: '2-digit',
                      hour12: true 
                    })
                    const endTime = event.endTime || new Date(event.end).toLocaleTimeString('en-US', { 
                      hour: 'numeric', 
                      minute: '2-digit',
                      hour12: true 
                    })
                    
                    // Check if this is a multi-day event
                    const startDate = new Date(event.start)
                    const endDate = new Date(event.end)
                    const isMultiDay = startDate.toDateString() !== endDate.toDateString()
                    
                    // Format dates for display
                    const startDateFormatted = startDate.toLocaleDateString('en-US', { 
                      month: 'short', 
                      day: 'numeric' 
                    })
                    const endDateFormatted = endDate.toLocaleDateString('en-US', { 
                      month: 'short', 
                      day: 'numeric' 
                    })
                    
                    return (
                      <div key={index} className="flex items-start gap-3 p-3 bg-muted/50 rounded-md">
                        <div className="flex-shrink-0 w-2 h-2 bg-primary rounded-full mt-2"></div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm mb-1">{event.title}</div>
                          
                          {/* Time display */}
                          <div className="text-xs text-muted-foreground mb-2">
                            {event.isAllDay ? (
                              <span className="font-medium">
                                {isMultiDay ? `${startDateFormatted} - ${endDateFormatted}` : 'All day'}
                              </span>
                            ) : (
                              <span>
                                {isMultiDay 
                                  ? `${startDateFormatted} ${startTime} - ${endDateFormatted} ${endTime}`
                                  : `${startTime} - ${endTime}`
                                }
                              </span>
                            )}
                          </div>
                          
                          {/* Location */}
                          {event.location && (
                            <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                              <span>📍</span>
                              <span>{event.location}</span>
                            </div>
                          )}
                          
                          {/* Description */}
                          {event.description && (
                            <div className="text-xs text-muted-foreground mb-2">
                              <div className="line-clamp-2">{event.description}</div>
                            </div>
                          )}
                          
                          {/* Calendar name */}
                          <div className="text-xs text-orange-600 font-medium">
                            {event.calendar}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // Relative timestamp helper
  const getRelativeTime = (dateString: string): string => {
    const now = new Date()
    const date = new Date(dateString)
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return "just now"
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  // Group conversations by date category
  const getDateGroup = (dateString: string): string => {
    const now = new Date()
    const date = new Date(dateString)
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffDays === 0) return "Today"
    if (diffDays === 1) return "Yesterday"
    if (diffDays < 7) return "This Week"
    if (diffDays < 30) return "This Month"
    return "Older"
  }

  // Dynamic suggestions based on connected integrations
  const suggestions = useMemo(() => {
    const connected = new Set(
      integrations
        .filter(i => i.status === 'connected')
        .map(i => i.provider)
    )

    const allSuggestions = [
      // Integration-dependent suggestions
      { icon: Calendar, text: "Show me my upcoming calendar events", category: "Calendar", color: "text-amber-500 bg-amber-500/10 dark:bg-amber-500/20", providers: ["google-calendar", "google"] },
      { icon: Mail, text: "What's in my inbox?", category: "Email", color: "text-emerald-500 bg-emerald-500/10 dark:bg-emerald-500/20", providers: ["gmail", "google", "microsoft-outlook"] },
      { icon: FileText, text: "Find my recent documents", category: "Files", color: "text-orange-500 bg-orange-500/10 dark:bg-orange-500/20", providers: ["google-drive", "google", "dropbox", "onedrive"] },
      { icon: FileText, text: "Show my Notion workspace", category: "Productivity", color: "text-rose-500 bg-rose-500/10 dark:bg-rose-500/20", providers: ["notion"] },
      { icon: Code, text: "Show my GitHub repositories", category: "Developer", color: "text-gray-500 bg-gray-500/10 dark:bg-gray-500/20", providers: ["github"] },
      { icon: DollarSign, text: "Show my recent Stripe payments", category: "Payments", color: "text-indigo-500 bg-indigo-500/10 dark:bg-indigo-500/20", providers: ["stripe"] },
      { icon: Users, text: "Show my HubSpot contacts", category: "CRM", color: "text-teal-500 bg-teal-500/10 dark:bg-teal-500/20", providers: ["hubspot"] },
      { icon: MessageSquare, text: "Search my Slack messages", category: "Communication", color: "text-purple-500 bg-purple-500/10 dark:bg-purple-500/20", providers: ["slack"] },
      // Always-available suggestions (no integration needed)
      { icon: Workflow, text: "What workflows do I have active?", category: "Workflows", color: "text-blue-500 bg-blue-500/10 dark:bg-blue-500/20", providers: [] as string[] },
      { icon: Clock, text: "Summarize my recent workflow executions", category: "Analytics", color: "text-violet-500 bg-violet-500/10 dark:bg-violet-500/20", providers: [] as string[] },
      { icon: Zap, text: "How do I create a workflow?", category: "Help", color: "text-cyan-500 bg-cyan-500/10 dark:bg-cyan-500/20", providers: [] as string[] },
    ]

    // Filter: always-available (providers=[]) + those with at least one connected provider
    const available = allSuggestions.filter(s =>
      s.providers.length === 0 || s.providers.some(p => connected.has(p))
    )

    // Prioritize integration-specific, then general, return up to 6
    const integrationSpecific = available.filter(s => s.providers.length > 0)
    const general = available.filter(s => s.providers.length === 0)
    return [...integrationSpecific, ...general].slice(0, 6)
  }, [integrations])

  const handleSuggestionClick = (text: string) => {
    setInput(text)
    // Auto-send after a brief delay so user sees it populate
    setTimeout(() => {
      handleSendMessage(text)
    }, 100)
  }

  if (!aiGate.allowed) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        <p>AI features require a Pro plan or higher.</p>
        <Link href="/subscription" className="text-primary underline mt-2 inline-block">Upgrade your plan</Link>
      </div>
    )
  }

  // Loading skeleton while conversations load
  if (isLoadingConversations) {
    return (
      <div className="flex absolute inset-0 -mb-16">
        {/* Sidebar skeleton */}
        <div className="w-72 border-r bg-muted/20 dark:bg-muted/10 flex flex-col shrink-0">
          <div className="p-4 border-b">
            <div className="animate-pulse flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gray-200 dark:bg-gray-800" />
              <div className="h-5 w-28 rounded bg-gray-200 dark:bg-gray-800" />
            </div>
          </div>
          <div className="flex-1 p-3 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="animate-pulse p-3 rounded-xl space-y-2" style={{ animationDelay: `${i * 100}ms` }}>
                <div className="h-4 w-3/4 rounded bg-gray-200 dark:bg-gray-800" />
                <div className="h-3 w-1/2 rounded bg-gray-200 dark:bg-gray-800" />
              </div>
            ))}
          </div>
          <div className="p-3 border-t">
            <div className="animate-pulse h-9 w-full rounded-lg bg-gray-200 dark:bg-gray-800" />
          </div>
        </div>
        {/* Main area skeleton */}
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="animate-pulse w-16 h-16 rounded-2xl bg-gray-200 dark:bg-gray-800" />
          <div className="animate-pulse h-7 w-48 rounded bg-gray-200 dark:bg-gray-800" />
          <div className="animate-pulse h-4 w-72 rounded bg-gray-200 dark:bg-gray-800" />
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mt-8 px-8 max-w-4xl w-full">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-3" style={{ animationDelay: `${i * 80}ms` }}>
                <div className="w-10 h-10 rounded-xl bg-gray-200 dark:bg-gray-800 mx-auto" />
                <div className="h-4 w-4/5 rounded bg-gray-200 dark:bg-gray-800 mx-auto" />
                <div className="h-3 w-1/2 rounded bg-gray-200 dark:bg-gray-800 mx-auto" />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Filter and group conversations for sidebar rendering
  const filteredConversations = sidebarSearch
    ? conversations.filter(conv =>
        conv.title?.toLowerCase().includes(sidebarSearch.toLowerCase()) ||
        conv.preview?.toLowerCase().includes(sidebarSearch.toLowerCase())
      )
    : conversations

  const groupedConversations = filteredConversations.reduce<Record<string, Conversation[]>>((groups, conv) => {
    const group = getDateGroup(conv.updated_at)
    if (!groups[group]) groups[group] = []
    groups[group].push(conv)
    return groups
  }, {})

  return (
    <div className="flex absolute inset-0 -mb-16">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Chat History Sidebar */}
      <div className={cn(
        "w-72 border-r border-border/50 bg-muted/20 dark:bg-muted/10 flex flex-col shrink-0 transition-transform duration-200 z-50",
        "fixed inset-y-0 left-0 lg:relative lg:translate-x-0",
        sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      )}>
        {/* Sidebar Header */}
        <div className="p-4 border-b border-border/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow-sm">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <h3 className="font-semibold text-sm tracking-tight">Assistant</h3>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden p-1.5 rounded-lg hover:bg-muted transition-colors"
            >
              <PanelLeftClose className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Conversation Search */}
        {conversations.length > 3 && (
          <div className="px-3 py-2 border-b border-border/50">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search conversations..."
                value={sidebarSearch}
                onChange={(e) => setSidebarSearch(e.target.value)}
                className="w-full h-8 pl-8 pr-8 text-xs bg-background border border-border/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
              />
              {sidebarSearch && (
                <button
                  onClick={() => setSidebarSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-muted flex items-center justify-center hover:bg-muted-foreground/20"
                >
                  <X className="w-2.5 h-2.5 text-muted-foreground" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-2">
            {/* Show current "New Chat" if no conversationId */}
            {!conversationId && messages.length === 0 && (
              <button
                className="w-full text-left p-3 rounded-xl bg-primary/10 dark:bg-primary/15 border-l-2 border-primary transition-all duration-200"
              >
                <div className="font-medium text-sm truncate text-foreground">
                  New Chat
                </div>
                <div className="text-xs text-muted-foreground truncate mt-0.5">
                  Start a conversation...
                </div>
              </button>
            )}

            {conversations.length === 0 && conversationId ? (
              <div className="p-6 text-sm text-muted-foreground text-center">
                <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
                No previous conversations
              </div>
            ) : (
              Object.entries(groupedConversations).map(([group, convs]) => (
                <div key={group} className="mb-1">
                  <div className="px-3 py-2 text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider">
                    {group}
                  </div>
                  {convs.map((conversation) => (
                    <div
                      key={conversation.id}
                      className={cn(
                        "group relative w-full rounded-xl transition-all duration-200 mb-0.5",
                        conversationId === conversation.id
                          ? "bg-primary/10 dark:bg-primary/15 border-l-2 border-primary"
                          : "hover:bg-muted/80 dark:hover:bg-muted/40 border-l-2 border-transparent"
                      )}
                    >
                      <button
                        onClick={() => loadConversation(conversation.id)}
                        className="w-full text-left p-3 pr-10"
                      >
                        <div className="font-medium text-sm truncate text-foreground">
                          {typingConversationId === conversation.id ? (
                            <TypingText
                              text={conversation.title}
                              onComplete={() => setTypingConversationId(null)}
                            />
                          ) : (
                            conversation.title
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="text-[11px] text-muted-foreground/60">
                            {getRelativeTime(conversation.updated_at)}
                          </span>
                        </div>
                      </button>
                      {/* Delete button with confirmation */}
                      {deleteConfirmId === conversation.id ? (
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              deleteConversation(conversation.id)
                            }}
                            className="px-2 py-1 text-xs font-medium bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 transition-colors"
                          >
                            Yes
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setDeleteConfirmId(null)
                            }}
                            className="px-2 py-1 text-xs font-medium bg-muted text-muted-foreground rounded-md hover:bg-muted/80 transition-colors"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setDeleteConfirmId(conversation.id)
                          }}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-destructive/10 transition-all duration-200"
                          title="Delete conversation"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive transition-colors" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>

        {/* New Chat Button */}
        <div className="p-3 border-t border-border/50">
          <Button
            onClick={startNewChat}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 border-0 shadow-sm transition-all duration-200"
            size="sm"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Chat
          </Button>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-background">
        {/* Mobile header with sidebar toggle */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border/50 lg:hidden flex-shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <PanelLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <span className="text-sm font-medium truncate">{activeConversationTitle}</span>
          <Button
            onClick={startNewChat}
            variant="ghost"
            size="sm"
            className="ml-auto p-1.5 h-auto"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>

        {/* Empty State / Suggestions - Show when no messages */}
        {messages.length === 0 && (
          <div className="flex-1 overflow-y-auto">
            <div className="flex flex-col items-center justify-center px-4 sm:px-8 py-10 sm:py-16 min-h-full">
              <div
                className="animate-fade-in-up"
                style={{ animationDelay: '0ms', animationFillMode: 'both' }}
              >
                <div className="w-16 h-16 sm:w-20 sm:h-20 bg-primary rounded-2xl flex items-center justify-center mb-6 shadow-lg mx-auto">
                  <Brain className="w-8 h-8 sm:w-10 sm:h-10 text-white" />
                </div>
              </div>
              <h2
                className="text-2xl sm:text-3xl font-bold mb-2 tracking-tight animate-fade-in-up"
                style={{ animationDelay: '100ms', animationFillMode: 'both' }}
              >
                How can I help?
              </h2>
              <p
                className="text-muted-foreground text-center max-w-lg mb-10 sm:mb-12 text-[15px] leading-relaxed animate-fade-in-up"
                style={{ animationDelay: '200ms', animationFillMode: 'both' }}
              >
                Ask me about your workflows, integrations, analytics, or anything about ChainReact.
              </p>

              {/* Proactive Insights */}
              {insights.length > 0 && (
                <div
                  className="w-full max-w-2xl mb-8 space-y-2 animate-fade-in-up"
                  style={{ animationDelay: '250ms', animationFillMode: 'both' }}
                >
                  {insights.map((insight, i) => (
                    <div
                      key={i}
                      className={cn(
                        "flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm border",
                        insight.priority === "warning"
                          ? "bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 text-amber-800 dark:text-amber-300"
                          : insight.priority === "success"
                            ? "bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/20 text-green-800 dark:text-green-300"
                            : "bg-muted/50 border-border text-muted-foreground"
                      )}
                    >
                      {insight.icon === "alert" && <AlertCircle className="w-4 h-4 flex-shrink-0" />}
                      {insight.icon === "check" && <CheckCircle className="w-4 h-4 flex-shrink-0" />}
                      {insight.icon === "zap" && <Zap className="w-4 h-4 flex-shrink-0" />}
                      {insight.icon === "clock" && <Clock className="w-4 h-4 flex-shrink-0" />}
                      {insight.icon === "info" && <Workflow className="w-4 h-4 flex-shrink-0" />}
                      <span>{insight.text}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Suggestion Cards */}
              <div className="w-full max-w-3xl px-2">
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                  {suggestions.map((suggestion, index) => {
                    const Icon = suggestion.icon
                    return (
                      <button
                        key={index}
                        className="animate-fade-in-up group relative text-left p-4 sm:p-5 rounded-2xl border border-border/60 bg-card hover:bg-accent/50 dark:hover:bg-accent/30 hover:border-border hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 cursor-pointer"
                        style={{ animationDelay: `${300 + index * 80}ms`, animationFillMode: 'both' }}
                        onClick={() => handleSuggestionClick(suggestion.text)}
                      >
                        <div className={cn("w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center mb-3 transition-transform duration-300 group-hover:scale-110", suggestion.color)}>
                          <Icon className="w-5 h-5 sm:w-5.5 sm:h-5.5" />
                        </div>
                        <p className="text-[13px] sm:text-sm font-medium leading-snug line-clamp-2 text-foreground/90 mb-1.5">{suggestion.text}</p>
                        <span className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wide">
                          {suggestion.category}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Messages Area - Scrollable - Show when there are messages */}
        {messages.length > 0 && (
          <div ref={chatContainerRef} className="flex-1 overflow-y-auto">
            <div className="w-full">
          {messages.map((message, msgIndex) => (
            <div
              key={message.id}
              className="animate-fade-in-up w-full py-4 sm:py-5 px-4"
              style={{ animationDelay: `${Math.min(msgIndex * 50, 300)}ms`, animationFillMode: 'both' }}
            >
              <div className="max-w-3xl mx-auto">
                {message.role === "user" ? (
                  // User message - right-aligned gradient bubble
                  <div className="flex justify-end">
                    <div className="bg-primary text-white rounded-2xl rounded-br-md px-4 py-3 max-w-[80%] shadow-sm">
                      <div className="text-[15px] leading-relaxed">{renderMessageContent(message.content)}</div>
                    </div>
                  </div>
                ) : (
                  // AI message - left-aligned with avatar
                  <div className="flex gap-3 items-start">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary flex items-center justify-center shadow-sm mt-0.5">
                      <Sparkles className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="bg-gray-100 dark:bg-gray-800/50 rounded-2xl rounded-bl-md px-4 py-3">
                        <div className="prose prose-sm dark:prose-invert max-w-none text-[15px] leading-relaxed">
                  {renderMessageContent(message.content)}

                  {/* Metadata display with new renderers */}
                  {message.metadata && (() => {
                    const { type, data, emails, files, rows, headers, tableName, code, language,
                            fileName, metrics, items, tasks } = message.metadata

                    switch (type) {
                      case "calendar":
                        return data && renderCalendarView(data)

                        case "email":
                          return (emails || data) && (
                            <EmailRenderer emails={emails || data} showBody={true} />
                          )

                        case "file":
                          return (files || data) && (
                            <FileRenderer files={files || data} showThumbnails={true} />
                          )

                        case "table":
                          return rows && (
                            <TableRenderer
                              tableName={tableName}
                              headers={headers}
                              rows={rows}
                              searchable={true}
                              sortable={true}
                            />
                          )

                        case "json":
                          return data && (
                            <JSONRenderer data={data} title={tableName || "JSON Data"} />
                          )

                        case "code":
                          return (code || data) && (
                            <CodeRenderer
                              code={typeof data === 'string' ? data : code || ''}
                              language={language || 'text'}
                              fileName={fileName}
                              lineNumbers={true}
                            />
                          )

                        case "metrics":
                          return (metrics || data) && (
                            <MetricsRenderer
                              metrics={metrics || data}
                              title="Metrics Overview"
                              layout="grid"
                            />
                          )

                        case "list":
                          return (items || data) && (
                            <ListRenderer
                              items={items || data}
                              layout="comfortable"
                            />
                          )

                        case "task":
                          return (tasks || data) && (
                            <TaskRenderer
                              tasks={tasks || data}
                              groupBy="status"
                              showProgress={true}
                            />
                          )

                        case "error":
                          return (
                            <ErrorRenderer
                              error={typeof data === 'string' ? data : message.content}
                              type="error"
                            />
                          )

                        case "warning":
                          return (
                            <ErrorRenderer
                              error={typeof data === 'string' ? data : message.content}
                              type="warning"
                            />
                          )

                        case "web_search":
                        case "document_qa":
                          return message.metadata.sources && message.metadata.sources.length > 0 && (
                            <SourceCitationRenderer sources={message.metadata.sources} />
                          )

                        case "info":
                          // Don't render - content is already shown above
                          return null

                        case "integration_status":
                          return message.metadata.provider && message.metadata.providerName && (
                            <IntegrationStatusRenderer
                              provider={message.metadata.provider}
                              providerName={message.metadata.providerName}
                              status={message.metadata.status || 'connected'}
                              connectedDate={message.metadata?.connectedDate || 'Unknown'}
                              onDisconnect={(provider) => {
                                handleSendMessage(`Disconnect ${message.metadata?.providerName}`)
                              }}
                            />
                          )

                        case "question":
                          return message.metadata.options && (
                            <QuestionRenderer
                              question={message.metadata.question || "Please select an option:"}
                              options={message.metadata.options}
                              onSelect={(optionId) => {
                                // Find the selected option to show what was chosen
                                const selectedOption = message.metadata?.options?.find(opt => opt.id === optionId)
                                if (selectedOption) {
                                  handleSendMessage(`Selected: ${selectedOption.label}`, optionId)
                                }
                              }}
                            />
                          )

                        case "integration_connect":
                          return message.metadata.provider && message.metadata.providerName && message.metadata.oauthUrl && (
                            <IntegrationConnectionRenderer
                              provider={message.metadata.provider}
                              providerName={message.metadata.providerName}
                              oauthUrl={message.metadata.oauthUrl}
                              action={message.metadata.action as 'connect' | 'reconnect' | undefined}
                            />
                          )

                        case "apps_grid":
                          return message.metadata.apps && (
                            <AppsGridRenderer
                              apps={message.metadata.apps}
                              maxDisplay={4}
                            />
                          )

                        case "social":
                        case "crm":
                        case "ecommerce":
                        case "developer":
                        case "communication":
                          // Use ListRenderer for these types with basic summary
                          return data && Array.isArray(data) && data.length > 0 && (
                            <ListRenderer
                              items={data.map((item: any) => ({
                                title: item.title || item.name || item.subject || 'Item',
                                description: item.description || item.snippet,
                                subtitle: item.date || item.created_at,
                                link: item.url || item.webLink
                              }))}
                              title={
                                type === 'social' ? 'Social Media Posts' :
                                type === 'crm' ? 'CRM Records' :
                                type === 'ecommerce' ? 'E-commerce Orders' :
                                type === 'developer' ? 'Repositories' :
                                'Channels'
                              }
                            />
                          )

                        case "productivity":
                          // Keep existing Notion rendering for now (it's already good)
                          return data && (
                            <div className="mt-3 p-3 bg-background rounded-lg border">
                              <div className="flex items-center gap-2 mb-2">
                                <FileText className="w-4 h-4" />
                                <span className="font-medium">Productivity Items</span>
                              </div>
                              <div className="space-y-3">
                                {data.map((item: any, index: number) => (
                                  <div key={index} className="space-y-2">
                                    {/* Main page */}
                                    <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-md">
                                      <div className="flex-shrink-0 w-2 h-2 bg-primary rounded-full mt-2"></div>
                                      <div className="flex-1 min-w-0">
                                        <div className="font-medium text-sm mb-1">
                                          {item.url ? (
                                            <a
                                              href={item.url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="text-orange-600 hover:text-orange-800 underline"
                                            >
                                              {item.title}
                                            </a>
                                          ) : (
                                            item.title
                                          )}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                          {item.provider}
                                          {item.last_edited && (
                                            <span> • Last edited {new Date(item.last_edited).toLocaleDateString()}</span>
                                          )}
                                          {item.created && !item.last_edited && (
                                            <span> • Created {new Date(item.created).toLocaleDateString()}</span>
                                          )}
                                          {item.subpageCount > 0 && (
                                            <span> • {item.subpageCount} subpage{item.subpageCount !== 1 ? 's' : ''}</span>
                                          )}
                                          {item.databaseCount > 0 && (
                                            <span> • {item.databaseCount} database{item.databaseCount !== 1 ? 's' : ''}</span>
                                          )}
                                        </div>
                                      </div>
                                    </div>

                                    {/* Databases with entries by status */}
                                    {item.databases && item.databases.length > 0 && (
                                      <div className="ml-6 space-y-3">
                                        {item.databases.map((database: any, dbIndex: number) => (
                                          <div key={dbIndex} className="space-y-2">
                                            <div className="flex items-start gap-3 p-2 bg-orange-50 dark:bg-orange-950/20 rounded-md border-l-2 border-orange-200 dark:border-orange-800">
                                              <div className="flex-shrink-0 w-1.5 h-1.5 bg-primary rounded-full mt-2"></div>
                                              <div className="flex-1 min-w-0">
                                                <div className="font-medium text-xs mb-1 text-orange-700 dark:text-orange-300">
                                                  📊 {database.title}
                                                </div>
                                                <div className="text-xs text-orange-600 dark:text-orange-400">
                                                  {database.totalEntries} entries
                                                </div>
                                              </div>
                                            </div>

                                            {/* Status categories */}
                                            {Object.entries(database.entriesByStatus || {}).map(([status, entries]) => (
                                              <div key={status} className="ml-4 space-y-1">
                                                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                                  {status} ({(entries as any[]).length})
                                                </div>
                                                {(entries as any[]).map((entry: any, entryIndex: number) => (
                                                  <div key={entryIndex} className="flex items-start gap-3 p-2 bg-background/50 rounded-md border-l border-muted">
                                                    <div className="flex-shrink-0 w-1 h-1 bg-muted-foreground/30 rounded-full mt-2"></div>
                                                    <div className="flex-1 min-w-0">
                                                      <div className="font-medium text-xs mb-1">
                                                        {entry.url ? (
                                                          <a
                                                            href={entry.url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-orange-600 hover:text-orange-800 underline"
                                                          >
                                                            {entry.title}
                                                          </a>
                                                        ) : (
                                                          entry.title
                                                        )}
                                                      </div>
                                                      <div className="text-xs text-muted-foreground">
                                                        {entry.last_edited && (
                                                          <span>Last edited {new Date(entry.last_edited).toLocaleDateString()}</span>
                                                        )}
                                                      </div>
                                                    </div>
                                                  </div>
                                                ))}
                                              </div>
                                            ))}
                                          </div>
                                        ))}
                                      </div>
                                    )}

                                    {/* Subpages */}
                                    {item.subpages && item.subpages.length > 0 && (
                                      <div className="ml-6 space-y-1">
                                        {item.subpages.map((subpage: any, subIndex: number) => (
                                          <div key={subIndex} className="flex items-start gap-3 p-2 bg-background/50 rounded-md border-l-2 border-muted">
                                            <div className="flex-shrink-0 w-1.5 h-1.5 bg-muted-foreground/50 rounded-full mt-2"></div>
                                            <div className="flex-1 min-w-0">
                                              <div className="font-medium text-xs mb-1">
                                                {subpage.url ? (
                                                  <a
                                                    href={subpage.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-orange-600 hover:text-orange-800 underline"
                                                  >
                                                    {subpage.title}
                                                  </a>
                                                ) : (
                                                  subpage.title
                                                )}
                                              </div>
                                              <div className="text-xs text-muted-foreground">
                                                {subpage.type === 'child_database' ? 'Database' : 'Page'}
                                              </div>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )

                        default:
                          return null
                      }
                    })()}
                    
                    {message.metadata?.type === "integration_not_connected" && (
                      <div className="mt-3 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                        <div className="flex items-center gap-2 mb-2">
                          <AlertCircle className="w-4 h-4 text-orange-600" />
                          <span className="font-medium text-orange-800">Integration Not Connected</span>
                        </div>
                        <p className="text-sm text-orange-700 mb-3">
                          You need to connect {message.metadata.integration} to use this feature.
                        </p>
                        <a
                          href="/integrations"
                          className="inline-flex items-center gap-2 text-sm text-orange-600 hover:text-orange-800 underline"
                        >
                          Go to Integrations Page
                        </a>
                      </div>
                    )}
                    
                    {message.metadata?.type === "confirmation" && (
                      <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                        <div className="flex items-center gap-2 text-green-700">
                          <CheckCircle className="w-4 h-4" />
                          <span className="font-medium">Action completed successfully</span>
                        </div>
                      </div>
                    )}
                    
                    {message.metadata?.type === "notion_page_hierarchy" && message.metadata.pages && (
                      <div className="mt-3 p-3 bg-background rounded-lg border">
                        <div className="font-medium mb-2 text-lg text-orange-700">Notion Page Hierarchy</div>
                        <ul className="space-y-4">
                          {message.metadata.pages.map((page: any) => (
                            <li key={page.id}>
                              <a
                                href={page.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-lg font-semibold text-primary hover:underline"
                              >
                                {page.title}
                              </a>
                              {page.subpages && page.subpages.length > 0 && (
                                <ul className="ml-6 mt-2 space-y-1 list-disc">
                                  {page.subpages.map((sub: any) => (
                                    <li key={sub.id}>
                                      <a
                                        href={sub.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-orange-400 hover:underline"
                                      >
                                        {sub.title}
                                      </a>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                  )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="animate-fade-in w-full py-4 sm:py-5 px-4">
              <div className="max-w-3xl mx-auto">
                <div className="flex gap-3 items-start">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary flex items-center justify-center shadow-sm">
                    <Sparkles className="w-4 h-4 text-white" />
                  </div>
                  <div className="bg-gray-100 dark:bg-gray-800/50 rounded-2xl rounded-bl-md px-4 py-3">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <div className="flex gap-1">
                        <div className="w-2 h-2 rounded-full bg-muted-foreground animate-pulse" style={{ animationDelay: '0ms' }} />
                        <div className="w-2 h-2 rounded-full bg-muted-foreground animate-pulse" style={{ animationDelay: '150ms' }} />
                        <div className="w-2 h-2 rounded-full bg-muted-foreground animate-pulse" style={{ animationDelay: '300ms' }} />
                      </div>
                      <span className="text-sm ml-1">Thinking...</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

            <div ref={messagesEndRef} />
            </div>
          </div>
        )}

        {/* Confirmation Dialog - Above input */}
        {pendingConfirmation && (
          <div className="border-t border-yellow-200 dark:border-yellow-900/50 bg-yellow-50 dark:bg-yellow-950/30 px-8 py-3">
            <div className="max-w-3xl mx-auto">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium text-yellow-800 dark:text-yellow-300">Confirm Action</p>
                  <p className="text-sm text-yellow-700 dark:text-yellow-400/80 mt-1">
                    Are you sure you want to {pendingConfirmation.action}?
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleConfirmAction(true)}
                    className="bg-yellow-600 hover:bg-yellow-700 text-white"
                  >
                    Confirm
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleConfirmAction(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Input Area - At Bottom */}
        <div className="border-t border-border/50 bg-card/80 backdrop-blur-sm px-4 sm:px-8 py-4">
          <div className="max-w-3xl mx-auto">
            <div className="relative flex gap-3 items-end bg-background rounded-2xl border border-border/60 shadow-sm focus-within:shadow-md focus-within:border-primary/40 dark:focus-within:border-primary/30 transition-all duration-300 p-1.5">
              {/* Input with inline microphone */}
              <div className="flex-1 relative">
                <textarea
                  ref={mergedInputRef}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value)
                    resizeInput()
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about your documents, integrations, or workflows..."
                  rows={1}
                  aria-label="Ask about integrations, workflows, or ChainReact"
                  className="flex w-full bg-transparent px-1 py-2 text-[15px] pr-10 placeholder:text-muted-foreground/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                  style={{ minHeight: '36px', maxHeight: '200px' }}
                  disabled={isLoading}
                  autoFocus
                />
                {/* Microphone/X button inside input */}
                <button
                  onClick={() => {
                    if (isDictating) {
                      handleStopDictation()
                    } else {
                      setIsDictating(true)
                    }
                  }}
                  disabled={isLoading}
                  className={cn(
                    "absolute right-0 bottom-1 p-1.5 rounded-lg transition-all duration-200",
                    "hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed",
                    isDictating && "text-destructive hover:bg-destructive/10"
                  )}
                  title={isDictating ? "Stop dictation" : "Voice dictation"}
                >
                  {isDictating ? (
                    <X className="w-4.5 h-4.5" />
                  ) : (
                    <Mic className="w-4.5 h-4.5 text-muted-foreground/50 hover:text-muted-foreground transition-colors" />
                  )}
                </button>

                {/* Floating microphone indicator */}
                {isDictating && input && (
                  <div
                    className="absolute pointer-events-none"
                    style={{
                      left: `${Math.min(input.length * 8 + 16, inputRef.current?.offsetWidth ? inputRef.current.offsetWidth - 60 : 0)}px`,
                      top: '-32px',
                    }}
                  >
                    <div className="bg-primary text-white rounded-full p-2 shadow-lg animate-pulse">
                      <Mic className="w-4 h-4" />
                    </div>
                  </div>
                )}
              </div>

              <Button
                onClick={() => handleSendMessage()}
                disabled={isLoading || !input.trim()}
                size="sm"
                className={cn(
                  "h-9 px-3 rounded-xl flex-shrink-0 transition-all duration-300",
                  input.trim()
                    ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm border-0"
                    : "bg-muted text-muted-foreground border-0"
                )}
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Voice Dictation Overlay */}
      {isDictating && (
        <VoiceDictation
          onTranscript={handleDictationTranscript}
          onUpdate={handleDictationUpdate}
          onClose={() => setIsDictating(false)}
        />
      )}

    </div>
  )
} 