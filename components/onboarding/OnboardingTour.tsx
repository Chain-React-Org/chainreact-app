"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter, usePathname } from "next/navigation"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import {
  X,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  CheckCircle,
  Zap,
  ArrowRight,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useOnboardingTour, mainTourSteps, TourStep } from "@/hooks/useOnboardingTour"
import { useAuthStore } from "@/stores/authStore"

interface OnboardingTourProps {
  className?: string
}

/**
 * Interactive Onboarding Tour Component
 *
 * Provides a step-by-step walkthrough for new users.
 * Uses spotlight highlighting and tooltips to guide users.
 */
export function OnboardingTour({ className }: OnboardingTourProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { user } = useAuthStore()

  const {
    isActive,
    currentStep,
    hasSeenWelcome,
    autoStartTour,
    completedTours,
    startTour,
    nextStep,
    prevStep,
    skipTour,
    completeTour,
  } = useOnboardingTour()

  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)
  const [isMounted, setIsMounted] = useState(false)

  const currentStepData = mainTourSteps[currentStep]
  const progress = ((currentStep + 1) / mainTourSteps.length) * 100
  const isFirstStep = currentStep === 0
  const isLastStep = currentStep === mainTourSteps.length - 1
  const isCenterStep = currentStepData?.placement === 'center'

  // Mount check
  useEffect(() => {
    setIsMounted(true)
  }, [])

  // Auto-start tour for new users
  useEffect(() => {
    // Don't auto-start if tour is already active (prevents restart on navigation)
    if (isActive) return

    if (
      isMounted &&
      user &&
      autoStartTour &&
      !hasSeenWelcome &&
      !completedTours.includes('main') &&
      pathname === '/workflows'
    ) {
      // Delay slightly to ensure page is loaded
      const timer = setTimeout(() => {
        startTour()
      }, 1000)
      return () => clearTimeout(timer)
    }
  }, [isMounted, user, autoStartTour, hasSeenWelcome, completedTours, pathname, startTour, isActive])

  // Update target element position
  const updateTargetPosition = useCallback(() => {
    if (!currentStepData || isCenterStep) {
      setTargetRect(null)
      return
    }

    const element = document.querySelector(currentStepData.target)
    if (element) {
      const rect = element.getBoundingClientRect()
      setTargetRect(rect)
    } else {
      setTargetRect(null)
    }
  }, [currentStepData, isCenterStep])

  // Track target element position
  useEffect(() => {
    if (!isActive) return

    updateTargetPosition()

    // Update on scroll/resize
    const handleUpdate = () => updateTargetPosition()
    window.addEventListener('scroll', handleUpdate, true)
    window.addEventListener('resize', handleUpdate)

    return () => {
      window.removeEventListener('scroll', handleUpdate, true)
      window.removeEventListener('resize', handleUpdate)
    }
  }, [isActive, currentStep, updateTargetPosition])

  // Handle navigation between tour steps
  useEffect(() => {
    if (!isActive || !currentStepData) return

    // Navigate to required page if needed
    if (currentStepData.page && pathname !== currentStepData.page) {
      router.push(currentStepData.page)
    }
  }, [isActive, currentStep, currentStepData, pathname, router])

  const handleNext = () => {
    if (isLastStep) {
      completeTour()
    } else {
      nextStep()
    }
  }

  const handleSkip = () => {
    skipTour()
  }

  if (!isMounted || !isActive) return null

  const tooltipPosition = getTooltipPosition(targetRect, currentStepData?.placement || 'bottom')

  return createPortal(
    <div className={cn("fixed inset-0 z-[9999]", className)}>
      {/* Backdrop with spotlight */}
      <div className="absolute inset-0 bg-black/60 transition-opacity duration-300" />

      {/* Spotlight cutout */}
      {targetRect && !isCenterStep && (
        <div
          className="absolute rounded-lg ring-4 ring-primary ring-offset-4 ring-offset-transparent transition-all duration-300 pointer-events-none"
          style={{
            top: targetRect.top - 8,
            left: targetRect.left - 8,
            width: targetRect.width + 16,
            height: targetRect.height + 16,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)',
          }}
        />
      )}

      {/* Tooltip Card */}
      <Card
        className={cn(
          "absolute shadow-2xl border-2 max-w-md transition-all duration-300",
          isCenterStep && "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
        )}
        style={!isCenterStep ? tooltipPosition : undefined}
      >
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-primary/10">
                <Sparkles className="w-4 h-4 text-primary" />
              </div>
              <span className="text-xs font-medium text-muted-foreground">
                Step {currentStep + 1} of {mainTourSteps.length}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleSkip}
              aria-label="Close onboarding tour"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
          <Progress value={progress} className="h-1 mt-2" />
        </CardHeader>

        <CardContent className="space-y-4">
          <div>
            <CardTitle className="text-lg mb-2">{currentStepData?.title}</CardTitle>
            <CardDescription className="text-sm">
              {currentStepData?.description}
            </CardDescription>
          </div>

          {/* Navigation Buttons */}
          <div className="flex items-center justify-between pt-2">
            <div>
              {!isFirstStep && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={prevStep}
                  className="gap-1"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Back
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSkip}
              >
                Skip Tour
              </Button>
              <Button
                size="sm"
                onClick={handleNext}
                className="gap-1"
              >
                {isLastStep ? (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    Get Started
                  </>
                ) : (
                  <>
                    Next
                    <ChevronRight className="w-4 h-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Step indicators */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 p-2 rounded-full bg-white/90 dark:bg-gray-900/90 shadow-lg">
        {mainTourSteps.map((_, index) => (
          <div
            key={index}
            className={cn(
              "w-2 h-2 rounded-full transition-all",
              index === currentStep
                ? "w-6 bg-primary"
                : index < currentStep
                  ? "bg-primary/50"
                  : "bg-gray-300 dark:bg-gray-600"
            )}
          />
        ))}
      </div>
    </div>,
    document.body
  )
}

/**
 * Calculate tooltip position based on target element and placement
 */
function getTooltipPosition(
  rect: DOMRect | null,
  placement: TourStep['placement']
): React.CSSProperties {
  if (!rect) {
    return {
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
    }
  }

  const padding = 16
  const tooltipWidth = 384 // max-w-md

  switch (placement) {
    case 'top':
      return {
        bottom: window.innerHeight - rect.top + padding,
        left: Math.max(padding, Math.min(rect.left + rect.width / 2 - tooltipWidth / 2, window.innerWidth - tooltipWidth - padding)),
      }
    case 'bottom':
      return {
        top: rect.bottom + padding,
        left: Math.max(padding, Math.min(rect.left + rect.width / 2 - tooltipWidth / 2, window.innerWidth - tooltipWidth - padding)),
      }
    case 'left':
      return {
        top: rect.top,
        right: window.innerWidth - rect.left + padding,
      }
    case 'right':
      return {
        top: rect.top,
        left: rect.right + padding,
      }
    default:
      return {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      }
  }
}

/**
 * Start Tour Button
 * Can be placed anywhere to restart the tour
 */
interface StartTourButtonProps {
  variant?: 'default' | 'outline' | 'ghost'
  size?: 'default' | 'sm' | 'lg' | 'icon'
  className?: string
}

export function StartTourButton({
  variant = 'outline',
  size = 'sm',
  className,
}: StartTourButtonProps) {
  const { startTour, resetTour, completedTours } = useOnboardingTour()

  const handleClick = () => {
    // Reset if already completed
    if (completedTours.includes('main')) {
      resetTour()
    }
    // Use setTimeout to ensure state is updated
    setTimeout(() => startTour(), 0)
  }

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleClick}
      className={cn("gap-2", className)}
    >
      <Sparkles className="w-4 h-4" />
      Take a Tour
    </Button>
  )
}

/**
 * Welcome Banner for new users
 * Shows a dismissible welcome message with option to start tour
 */
export function WelcomeBanner() {
  const { hasSeenWelcome, setHasSeenWelcome, startTour, completedTours } = useOnboardingTour()
  const { user } = useAuthStore()
  const [dismissed, setDismissed] = useState(false)

  // Don't show if already seen or tour completed
  if (hasSeenWelcome || dismissed || completedTours.includes('main') || !user) {
    return null
  }

  const handleStartTour = () => {
    startTour()
    setDismissed(true)
  }

  const handleDismiss = () => {
    setHasSeenWelcome(true)
    setDismissed(true)
  }

  return (
    <Card className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-primary/20 mb-6">
      <CardContent className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Zap className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold">Welcome to ChainReact!</h3>
            <p className="text-sm text-muted-foreground">
              New here? Take a quick tour to learn the basics.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleDismiss}>
            Maybe Later
          </Button>
          <Button size="sm" onClick={handleStartTour} className="gap-1">
            Start Tour
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
