/**
 * ACTION_NAME Action Handler Template
 * 
 * This template can be used to quickly scaffold new integration actions.
 * Replace all placeholder text with your implementation.
 */

import { getIntegrationCredentials } from "@/lib/integrations/getDecryptedAccessToken"
import { resolveValue } from "@/lib/workflows/actions/core/resolveValue"

import { logger } from '@/lib/utils/logger'

/**
 * Action metadata for UI display and reference
 */
export const ACTION_METADATA = {
  key: "provider_action_name", // Unique key in format: provider_action_name
  name: "Human-Readable Action Name", // User-friendly action name
  description: "Short description of what this action does", // 1-2 sentence description
  icon: "icon-name" // Icon to use in the UI
};

/**
 * Standard interface for action parameters
 */
export interface ActionParams {
  userId: string
  config: Record<string, any>
  input: Record<string, any>
}

/**
 * Standard interface for action results
 */
export interface ActionResult {
  success: boolean
  output?: Record<string, any>
  message?: string
  error?: string
}

/**
 * DESCRIBE_YOUR_ACTION
 * 
 * @param params - Standard action parameters
 * @returns Action result with success/failure and any outputs
 */
export async function actionName(params: ActionParams): Promise<ActionResult> {
  try {
    const { userId, config, input } = params
    
    // 1. Get credentials from the database
    const credentials = await getIntegrationCredentials(userId, "provider_id")
    
    // 2. Resolve any templated values in the config
    const resolvedConfig = resolveValue(config, {
      input,
      // Add any other context needed
    })
    
    // 3. Extract required parameters from the resolved config
    const { param1, param2 } = resolvedConfig
    
    // 4. Validate required parameters
    if (!param1) {
      return {
        success: false,
        error: "Missing required parameter: param1"
      }
    }
    
    // 5. Make API request
    const response = await fetch("https://api.example.com/endpoint", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${credentials.accessToken}`
      },
      body: JSON.stringify({
        // Your request payload
      })
    })
    
    // 6. Handle API response
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API error (${response.status}): ${errorText}`)
    }
    
    const data = await response.json()
    
    // 7. Return success result with any outputs
    return {
      success: true,
      output: {
        // Map any outputs from the API response
        result: data.result,
        // Add any other outputs needed
      },
      message: "Action completed successfully"
    }
    
  } catch (error: any) {
    // 8. Handle errors and return failure result
    logger.error("Action failed:", error)
    return {
      success: false,
      error: error.message || "Unknown error occurred"
    }
  }
} 