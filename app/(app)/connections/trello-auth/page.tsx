'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

import { logger } from '@/lib/utils/logger'

export default function TrelloAuthCallback() {
  const router = useRouter()

  useEffect(() => {
    // Trello returns the token in the URL fragment (after #)
    const handleTrelloAuth = async () => {
      try {
        // Get the fragment from the URL
        const fragment = window.location.hash.substring(1)
        
        if (!fragment) {
          throw new Error('No token found in URL')
        }

        // Parse the fragment to get the token
        const params = new URLSearchParams(fragment)
        const token = params.get('token')
        
        // Get state from query params (before the #)
        const urlParams = new URLSearchParams(window.location.search)
        const state = urlParams.get('state')
        
        if (!token) {
          throw new Error('No token found in URL fragment')
        }

        // Decode the state to get userId
        let userId = null
        if (state) {
          try {
            const stateData = JSON.parse(atob(state))
            userId = stateData.userId
          } catch (e) {
            logger.error('Failed to parse state:', e)
          }
        }

        if (!userId) {
          throw new Error('User ID not found in state')
        }

        // Send the token to our backend to save
        const response = await fetch('/api/integrations/trello/process-token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            token,
            userId,
          }),
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.message || 'Failed to save Trello integration')
        }

        // Create OAuth response data
        const timestamp = Date.now()
        const storageKey = `oauth_response_trello_${timestamp}`
        const oauthData = {
          type: 'oauth-complete',
          success: true,
          provider: 'trello',
          message: 'Trello connected successfully',
          timestamp: new Date().toISOString()
        }
        
        // Method 1: Try BroadcastChannel (works across same-origin contexts)
        try {
          const channel = new BroadcastChannel('oauth_channel')
          channel.postMessage(oauthData)
          logger.info('Sent OAuth response via BroadcastChannel')
          channel.close()
        } catch (e) {
          logger.info('BroadcastChannel not available or failed:', e)
        }
        
        // Method 2: Store in localStorage (both current and parent if possible)
        localStorage.setItem(storageKey, JSON.stringify(oauthData))
        logger.info('Stored OAuth response in localStorage with key:', storageKey)
        
        // Method 3: PostMessage to parent window
        if (window.opener) {
          window.opener.postMessage({
            type: 'oauth-complete',
            success: true,
            provider: 'trello',
            message: 'Trello connected successfully'
          }, window.location.origin)
          logger.info('Sent OAuth response via postMessage')
          
          // Try to access parent localStorage (may fail due to COOP)
          try {
            window.opener.localStorage.setItem(storageKey, JSON.stringify(oauthData))
            logger.info('Also stored in parent localStorage')
          } catch (e) {
            logger.info('Could not access parent localStorage due to COOP')
          }
        }

        // Show success message with app theme
        document.body.innerHTML = `
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: system-ui, -apple-system, sans-serif; background: white;">
            <div style="text-align: center; padding: 2rem; background: #f3f4f6; border-radius: 12px; border: 2px solid #d1d5db;">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" style="margin: 0 auto 1rem; color: #10b981;">
                <path d="M9 11L12 14L22 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M21 12V19C21 20.1046 20.1046 21 19 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3H16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <h2 style="margin: 0 0 0.5rem; color: #111827; font-weight: 600;">Success!</h2>
              <p style="margin: 0 0 1rem; color: #6b7280;">Trello has been connected successfully.</p>
              <p style="margin: 0; color: #9ca3af; font-size: 0.875rem;">This window will close automatically...</p>
            </div>
          </div>
        `

        // Close the window after a short delay
        setTimeout(() => {
          window.close()
        }, 2000)

      } catch (error: any) {
        logger.error('Trello auth error:', error)
        
        // Send error message to parent window if it exists
        if (window.opener) {
          window.opener.postMessage({
            type: 'oauth-complete',
            success: false,
            provider: 'trello',
            error: error.message || 'Failed to connect Trello'
          }, window.location.origin)
          
          // ALSO store in parent window's localStorage for COOP restrictions
          try {
            const timestamp = Date.now()
            const storageKey = `oauth_response_trello_${timestamp}`
            const oauthData = JSON.stringify({
              type: 'oauth-complete',
              success: false,
              provider: 'trello',
              error: error.message || 'Failed to connect Trello',
              timestamp: new Date().toISOString()
            })
            
            // Try to store in parent window's localStorage
            window.opener.localStorage.setItem(storageKey, oauthData)
            logger.info('Stored OAuth error in parent localStorage with key:', storageKey)
          } catch (e) {
            logger.info('Could not access parent localStorage due to COOP, will rely on postMessage')
          }
        } else {
          // No parent window, store in current window's localStorage as fallback
          const timestamp = Date.now()
          const storageKey = `oauth_response_trello_${timestamp}`
          localStorage.setItem(storageKey, JSON.stringify({
            type: 'oauth-complete',
            success: false,
            provider: 'trello',
            error: error.message || 'Failed to connect Trello',
            timestamp: new Date().toISOString()
          }))
          logger.info('No parent window, stored OAuth error in current localStorage with key:', storageKey)
        }

        // Show error message with app theme
        document.body.innerHTML = `
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: system-ui, -apple-system, sans-serif; background: white;">
            <div style="text-align: center; padding: 2rem; background: #fef2f2; border-radius: 12px; border: 2px solid #fca5a5;">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" style="margin: 0 auto 1rem; color: #ef4444;">
                <path d="M12 9V13M12 17H12.01M12 3C7.02944 3 3 7.02944 3 12C3 16.9706 7.02944 21 12 21C16.9706 21 21 16.9706 21 12C21 7.02944 16.9706 3 12 3Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <h2 style="margin: 0 0 0.5rem; color: #111827; font-weight: 600;">Connection Failed</h2>
              <p style="margin: 0 0 1rem; color: #6b7280;">${error.message || 'Failed to connect Trello'}</p>
              <p style="margin: 0; color: #9ca3af; font-size: 0.875rem;">This window will close automatically...</p>
            </div>
          </div>
        `

        // Close the window after a longer delay for errors
        setTimeout(() => {
          window.close()
        }, 3000)
      }
    }

    handleTrelloAuth()
  }, [router])

  return (
    <div style={{ 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center', 
      height: '100vh',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      background: 'white'
    }}>
      <div style={{ 
        textAlign: 'center',
        padding: '2rem',
        background: '#f9fafb',
        borderRadius: '12px',
        border: '2px solid #e5e7eb'
      }}>
        <div style={{
          width: '48px',
          height: '48px',
          border: '3px solid #e5e7eb',
          borderTop: '3px solid #6b7280',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
          margin: '0 auto 1rem'
        }}></div>
        <h2 style={{ margin: '0 0 0.5rem', color: '#111827', fontWeight: '600' }}>Connecting to Trello</h2>
        <p style={{ margin: 0, color: '#6b7280', fontSize: '0.875rem' }}>Please wait while we complete the connection...</p>
      </div>
      <style jsx>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}