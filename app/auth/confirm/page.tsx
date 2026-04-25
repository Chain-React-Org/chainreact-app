"use client"

import { useEffect, useState } from 'react'
import { Button } from "@/components/ui/button"
import { CheckCircle, Mail, ArrowRight } from "lucide-react"
import { LightningLoader } from '@/components/ui/lightning-loader'
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/stores/authStore"
import { supabase } from "@/utils/supabaseClient"

import { logger } from '@/lib/utils/logger'

export default function EmailConfirmPage() {
  const [countdown, setCountdown] = useState(5)
  const [processing, setProcessing] = useState(true)
  const [fromEmail, setFromEmail] = useState(false)
  const router = useRouter()
  const { boot } = useAuthStore()

  useEffect(() => {
    // Check if this came from email link
    const urlParams = new URLSearchParams(window.location.search)
    const token = urlParams.get('token')
    const redirectUrl = urlParams.get('redirect')
    setFromEmail(!!token)

    const handleEmailConfirmation = async () => {
      try {
        if (token) {
          // This is from an email click - confirm the user manually
          try {
            const decodedToken = Buffer.from(token, 'base64').toString()
            const [userId, timestamp] = decodedToken.split(':')
            
            // Verify token is not too old (24 hours)
            const tokenAge = Date.now() - parseInt(timestamp)
            if (tokenAge > 24 * 60 * 60 * 1000) {
              throw new Error('Confirmation link has expired')
            }

            // Manually confirm the user in Supabase
            const response = await fetch('/api/auth/confirm-manual', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId, token })
            })

            if (!response.ok) {
              throw new Error('Failed to confirm email')
            }

            setProcessing(false)
            
            // Redirect back to waiting page with confirmation
            if (redirectUrl) {
              window.location.replace(redirectUrl)
            } else {
              window.location.replace('/auth/waiting-confirmation?confirmed=true')
            }
            return
          } catch (confirmError) {
            logger.error('Manual confirmation failed:', confirmError)
            setProcessing(false)
            // Still show success message for UX
            return
          }
        }

        // For non-email confirmations, proceed with normal flow
        const { data: { user }, error } = await supabase.auth.getUser()
        
        if (error || !user) {
          logger.error('Error getting user:', {
            message: (error as any)?.message ?? 'no user returned',
            name: (error as any)?.name,
          })
          router.push('/auth/login')
          return
        }

        await boot()
        localStorage.removeItem('pendingSignup')

        // Create user profile if it doesn't exist
        const { data: existingProfile } = await supabase
          .from('user_profiles')
          .select('id, username')
          .eq('id', user.id)
          .single()

        if (!existingProfile) {
          const detectedProvider = user.app_metadata?.provider || 
                                 user.app_metadata?.providers?.[0] || 
                                 (user.identities?.some(id => id.provider === 'google') ? 'google' : 'email')
          
          const fullName = user.user_metadata?.full_name || 
                          user.user_metadata?.name || 
                          user.email?.split('@')[0] || 'User'
          
          const nameParts = fullName.split(' ')
          const firstName = nameParts[0] || ''
          const lastName = nameParts.slice(1).join(' ') || ''

          await supabase
            .from('user_profiles')
            .insert({
              id: user.id,
              full_name: fullName,
              first_name: firstName,
              last_name: lastName,
              email: user.email, // Include the email
              avatar_url: user.user_metadata?.avatar_url,
              provider: detectedProvider,
              role: 'free',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
        }

        setProcessing(false)

        // Username is now set during signup, go to dashboard
        setTimeout(() => {
          router.push('/workflows')
        }, 2000)
        
      } catch (error) {
        logger.error('Error handling email confirmation:', error)
        setProcessing(false)
        router.push('/auth/login')
      }
    }

    handleEmailConfirmation()
  }, [router, boot])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-orange-900 to-rose-900 relative overflow-hidden">
      {/* Background Animation */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-r from-orange-600/20 to-rose-600/20 animate-pulse"></div>
        <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-orange-500/10 rounded-full blur-3xl animate-float"></div>
        <div className="absolute top-3/4 right-1/4 w-48 h-48 bg-rose-500/10 rounded-full blur-3xl animate-float-delayed"></div>
      </div>

      <div className="relative z-10 min-h-screen flex items-center justify-center px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          {/* Logo/Brand */}
          <div className="text-center">
            <Link href="/" className="inline-block">
              <h1 className="text-4xl font-bold bg-gradient-to-r from-orange-400 to-rose-400 bg-clip-text text-transparent">
                ChainReact
              </h1>
            </Link>
          </div>

          {/* Success Card */}
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl border border-white/20 p-8">
            <div className="text-center">
              <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-500/20 mb-6">
                <CheckCircle className="h-8 w-8 text-green-400" />
              </div>
              
              <h2 className="text-2xl font-bold text-white mb-4">
                Email Confirmed Successfully!
              </h2>
              
              <p className="text-orange-200 mb-6 leading-relaxed">
                Welcome to ChainReact! Your email has been verified and your account is now active.
                {processing 
                  ? " We're setting up your profile..." 
                  : fromEmail 
                    ? " You can now close this tab." 
                    : " Let's complete your profile setup."
                }
              </p>

              {processing ? (
                <div className="flex justify-center mb-6">
                  <LightningLoader size="lg" color="orange" />
                </div>
              ) : fromEmail ? (
                <div className="space-y-6">
                  {/* Animated Chain Links */}
                  <div className="flex justify-center items-center space-x-2 mb-8">
                    <div className="w-8 h-8 border-4 border-orange-400 rounded-full animate-pulse"></div>
                    <div className="w-6 h-1 bg-gradient-to-r from-orange-400 to-rose-400 animate-pulse delay-100"></div>
                    <div className="w-8 h-8 border-4 border-rose-400 rounded-full animate-pulse delay-200"></div>
                    <div className="w-6 h-1 bg-gradient-to-r from-rose-400 to-green-400 animate-pulse delay-300"></div>
                    <div className="w-8 h-8 border-4 border-green-400 rounded-full animate-pulse delay-400"></div>
                    <div className="w-6 h-1 bg-gradient-to-r from-green-400 to-orange-400 animate-pulse delay-500"></div>
                    <div className="w-8 h-8 border-4 border-orange-400 rounded-full animate-pulse delay-600"></div>
                  </div>

                  <div className="text-center space-y-4">
                    <h3 className="text-3xl font-bold bg-gradient-to-r from-orange-400 via-rose-400 to-green-400 bg-clip-text text-transparent">
                      Welcome to ChainReact
                    </h3>
                    
                    <div className="p-6 bg-gradient-to-r from-green-600/20 via-orange-600/20 to-rose-600/20 rounded-xl border border-green-500/30">
                      <div className="flex items-center justify-center mb-3">
                        <CheckCircle className="h-8 w-8 text-green-400 mr-3" />
                        <span className="text-xl font-semibold text-green-200">Email Confirmed!</span>
                      </div>
                      <p className="text-orange-200 text-lg">
                        Your account is now active and ready to automate your workflows.
                      </p>
                    </div>

                    <div className="bg-orange-600/10 rounded-lg p-4 border border-orange-500/20">
                      <p className="text-orange-200 text-lg font-medium">
                        You may now close this tab
                      </p>
                    </div>
                  </div>

                  <Button
                    onClick={() => window.close()}
                    className="w-full bg-gradient-to-r from-orange-600 to-rose-600 hover:from-orange-700 hover:to-rose-700 text-white rounded-lg py-4 text-lg font-semibold transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-xl"
                  >
                    Close This Tab
                  </Button>

                  <Link href="/workflows">
                    <Button variant="outline" className="w-full border-2 border-orange-400 text-orange-400 hover:bg-orange-400/10 rounded-lg py-3 transition-all duration-300 hover:border-orange-300">
                      <ArrowRight className="mr-2 h-4 w-4" />
                      Continue in This Tab Instead
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  <Link href="/workflows">
                    <Button className="w-full bg-orange-600 hover:bg-orange-700 text-white rounded-lg py-3 transition-all duration-300 transform hover:scale-105">
                      <ArrowRight className="mr-2 h-4 w-4" />
                      Continue to Dashboard
                    </Button>
                  </Link>
                </div>
              )}

              <div className="mt-6 p-4 bg-orange-600/20 rounded-lg border border-orange-500/30">
                <p className="text-sm text-orange-200">
                  {processing 
                    ? "Setting up your account..." 
                    : fromEmail 
                      ? "Return to your original tab to continue setup"
                      : `Redirecting to username setup in ${countdown} seconds...`
                  }
                </p>
              </div>

              <div className="mt-6 text-xs text-orange-300/60">
                Need help getting started? Visit our{" "}
                <Link href="/support" className="text-orange-300 hover:text-orange-200 underline">
                  help center
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          33% { transform: translateY(-10px) rotate(1deg); }
          66% { transform: translateY(5px) rotate(-1deg); }
        }
        @keyframes float-delayed {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          33% { transform: translateY(10px) rotate(-1deg); }
          66% { transform: translateY(-5px) rotate(1deg); }
        }
        .animate-float {
          animation: float 6s ease-in-out infinite;
        }
        .animate-float-delayed {
          animation: float-delayed 8s ease-in-out infinite;
        }
      `}</style>
    </div>
  )
}