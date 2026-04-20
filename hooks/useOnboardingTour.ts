"use client"

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface TourStep {
  id: string
  title: string
  description: string
  target: string // CSS selector for the element to highlight
  placement: 'top' | 'bottom' | 'left' | 'right' | 'center'
  page?: string // Optional: page to navigate to
  action?: 'click' | 'wait' | 'none'
  nextCondition?: string // Optional: condition to proceed
}

interface OnboardingTourState {
  // Tour state
  isActive: boolean
  currentStep: number
  completedTours: string[]
  skippedTours: string[]

  // User preferences
  hasSeenWelcome: boolean
  autoStartTour: boolean

  // Actions
  startTour: (tourId?: string) => void
  nextStep: () => void
  prevStep: () => void
  skipTour: (tourId?: string) => void
  completeTour: (tourId?: string) => void
  resetTour: () => void
  setHasSeenWelcome: (seen: boolean) => void
  setAutoStartTour: (auto: boolean) => void
  goToStep: (step: number) => void
}

/**
 * Main product tour steps
 */
export const mainTourSteps: TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to ChainReact!',
    description: 'Let\'s take a quick tour to help you get started with workflow automation. This will only take a minute.',
    target: 'body',
    placement: 'center',
    action: 'none',
  },
  {
    id: 'sidebar-navigation',
    title: 'Your Navigation Hub',
    description: 'Use the sidebar to navigate between your workflows, templates, connected apps, and assistant.',
    target: '[data-tour="sidebar"]',
    placement: 'right',
    action: 'none',
  },
  {
    id: 'create-workflow',
    title: 'Create Your First Workflow',
    description: 'Click here to create a new workflow. You can start from scratch or use one of our templates.',
    target: '[data-tour="create-workflow"]',
    placement: 'right',
    action: 'click',
  },
  {
    id: 'templates',
    title: 'Explore Templates',
    description: 'Browse our library of pre-built templates to get started quickly. Filter by category or search for specific integrations.',
    target: '[data-tour="templates"]',
    placement: 'right',
    page: '/templates',
    action: 'none',
  },
  {
    id: 'apps',
    title: 'Connect Your Apps',
    description: 'Connect your favorite apps to start automating. We support 20+ integrations including Gmail, Slack, Discord, and more.',
    target: '[data-tour="apps"]',
    placement: 'right',
    page: '/connections',
    action: 'none',
  },
  {
    id: 'ai-assistant',
    title: 'AI-Powered Automation',
    description: 'Use the assistant to build workflows by describing what you want to automate in plain English.',
    target: '[data-tour="ai-assistant"]',
    placement: 'right',
    action: 'none',
  },
  {
    id: 'onboarding-checklist',
    title: 'Track Your Progress',
    description: 'The onboarding checklist helps you complete the essential setup steps. Check it off as you go!',
    target: '[data-tour="onboarding-checklist"]',
    placement: 'left',
    page: '/workflows',
    action: 'none',
  },
  {
    id: 'complete',
    title: 'You\'re All Set!',
    description: 'You\'re ready to start automating! Create your first workflow or explore our templates to get started.',
    target: 'body',
    placement: 'center',
    action: 'none',
  },
]

/**
 * Onboarding tour state management
 */
export const useOnboardingTour = create<OnboardingTourState>()(
  persist(
    (set, get) => ({
      // Initial state
      isActive: false,
      currentStep: 0,
      completedTours: [],
      skippedTours: [],
      hasSeenWelcome: false,
      autoStartTour: true,

      // Actions
      startTour: (tourId = 'main') => {
        const { completedTours, skippedTours, isActive } = get()
        // Don't restart if already active, completed, or skipped
        if (isActive || completedTours.includes(tourId) || skippedTours.includes(tourId)) {
          return
        }
        set({ isActive: true, currentStep: 0 })
      },

      nextStep: () => {
        const { currentStep } = get()
        if (currentStep < mainTourSteps.length - 1) {
          set({ currentStep: currentStep + 1 })
        } else {
          // Tour complete
          get().completeTour()
        }
      },

      prevStep: () => {
        const { currentStep } = get()
        if (currentStep > 0) {
          set({ currentStep: currentStep - 1 })
        }
      },

      skipTour: (tourId = 'main') => {
        const { skippedTours } = get()
        set({
          isActive: false,
          currentStep: 0,
          skippedTours: [...skippedTours, tourId],
          hasSeenWelcome: true,
        })
      },

      completeTour: (tourId = 'main') => {
        const { completedTours } = get()
        set({
          isActive: false,
          currentStep: 0,
          completedTours: [...completedTours, tourId],
          hasSeenWelcome: true,
        })
      },

      resetTour: () => {
        set({
          isActive: false,
          currentStep: 0,
          completedTours: [],
          skippedTours: [],
          hasSeenWelcome: false,
        })
      },

      setHasSeenWelcome: (seen) => {
        set({ hasSeenWelcome: seen })
      },

      setAutoStartTour: (auto) => {
        set({ autoStartTour: auto })
      },

      goToStep: (step) => {
        if (step >= 0 && step < mainTourSteps.length) {
          set({ currentStep: step })
        }
      },
    }),
    {
      name: 'onboarding-tour-state',
      partialize: (state) => ({
        completedTours: state.completedTours,
        skippedTours: state.skippedTours,
        hasSeenWelcome: state.hasSeenWelcome,
        autoStartTour: state.autoStartTour,
      }),
    }
  )
)
