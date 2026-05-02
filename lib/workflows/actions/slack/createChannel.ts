import { ActionResult } from '../core'
import { requireExplicitField } from '../core/requireExplicitField'
import { getIntegrationCredentials } from "@/lib/integrations/getDecryptedAccessToken"
import { resolveValue } from "../core/resolveValue"

import { logger } from '@/lib/utils/logger'

export interface CreateChannelParams {
  userId: string
  config: Record<string, any>
  input: Record<string, any>
}

export async function createSlackChannel(params: CreateChannelParams): Promise<ActionResult> {
  try {
    const { userId, config, input } = params

    // Resolve any templated values in the config first so the require check
    // sees the same shape that the rest of the handler uses.
    const resolvedConfig = resolveValue(config, {
      input,
    })

    // Q11 — isPrivate is a workspace-wide channel-creation decision
    // (public exposes the channel to the entire workspace). Previous silent
    // default `false` removed; workflow author must explicitly choose.
    // Runs BEFORE the OAuth credential fetch so a misconfigured workflow
    // fails fast without consuming network.
    const missingRequired = requireExplicitField(resolvedConfig, 'isPrivate')
    if (missingRequired) return missingRequired as unknown as ActionResult

    // Get Slack OAuth token
    const credentials = await getIntegrationCredentials(userId, "slack")

    // Extract parameters
    const {
      workspace,
      channelName,
      isPrivate,
      purpose,
      topic,
      initialMembers = [],
      autoArchiveSettings,
      customChannelHeader
    } = resolvedConfig
    
    // 4. Validate required parameters
    if (!channelName) {
      return {
        success: false,
        error: "Missing required parameter: channelName"
      }
    }

    if (channelName.length < 1 || channelName.length > 80) {
      return {
        success: false,
        error: "Channel name must be between 1 and 80 characters"
      }
    }
    
    // 5. Sanitize channel name (Slack will auto-sanitize, but we can help)
    const sanitizedName = channelName
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-_]/g, '')

    // 6. Create the channel
    const createResponse = await fetch('https://slack.com/api/conversations.create', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: sanitizedName,
        is_private: isPrivate
      })
    })

    if (!createResponse.ok) {
      const errorText = await createResponse.text()
      throw new Error(`Slack API error (${createResponse.status}): ${errorText}`)
    }

    const createData = await createResponse.json()
    
    if (!createData.ok) {
      throw new Error(`Slack API error: ${createData.error}`)
    }

    const channelId = createData.channel?.id
    if (!channelId) {
      throw new Error("Channel created but no channel ID returned")
    }

    const results: any = {
      channelId,
      channelName: createData.channel?.name || sanitizedName,
      isPrivate: isPrivate,
      channel: createData.channel
    }

    // 7. Invite initial members if provided
    if (initialMembers && initialMembers.length > 0) {
      try {
        const inviteResponse = await fetch('https://slack.com/api/conversations.invite', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${credentials.accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            channel: channelId,
            users: initialMembers.join(',')
          })
        })

        if (inviteResponse.ok) {
          const inviteData = await inviteResponse.json()
          if (inviteData.ok) {
            results.invitedMembers = initialMembers
          } else {
            logger.warn(`Warning: Failed to invite members: ${inviteData.error}`)
          }
        }
      } catch (inviteError) {
        logger.warn(`Warning: Failed to invite members:`, inviteError)
      }
    }

    // 8. Set purpose if provided
    if (purpose) {
      try {
        const purposeResponse = await fetch('https://slack.com/api/conversations.setPurpose', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${credentials.accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            channel: channelId,
            purpose: purpose
          })
        })

        if (purposeResponse.ok) {
          const purposeData = await purposeResponse.json()
          if (purposeData.ok) {
            results.purpose = purpose
          } else {
            logger.warn(`Warning: Failed to set purpose: ${purposeData.error}`)
          }
        }
      } catch (purposeError) {
        logger.warn(`Warning: Failed to set purpose:`, purposeError)
      }
    }

    // 9. Set topic if provided
    if (topic) {
      try {
        const topicResponse = await fetch('https://slack.com/api/conversations.setTopic', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${credentials.accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            channel: channelId,
            topic: topic
          })
        })

        if (topicResponse.ok) {
          const topicData = await topicResponse.json()
          if (topicData.ok) {
            results.topic = topic
          } else {
            logger.warn(`Warning: Failed to set topic: ${topicData.error}`)
          }
        }
      } catch (topicError) {
        logger.warn(`Warning: Failed to set topic:`, topicError)
      }
    }

    // 10. Set auto-archive settings if provided
    if (autoArchiveSettings && autoArchiveSettings !== "none") {
      try {
        const archiveResponse = await fetch('https://slack.com/api/conversations.setTopic', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${credentials.accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            channel: channelId,
            topic: `Auto-archive after ${autoArchiveSettings} days of inactivity`
          })
        })

        if (archiveResponse.ok) {
          const archiveData = await archiveResponse.json()
          if (archiveData.ok) {
            results.autoArchiveSettings = autoArchiveSettings
          } else {
            logger.warn(`Warning: Failed to set auto-archive settings: ${archiveData.error}`)
          }
        }
      } catch (archiveError) {
        logger.warn(`Warning: Failed to set auto-archive settings:`, archiveError)
      }
    }

    // 11. Set custom channel header if provided
    if (customChannelHeader) {
      try {
        const headerResponse = await fetch('https://slack.com/api/conversations.setTopic', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${credentials.accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            channel: channelId,
            topic: customChannelHeader
          })
        })

        if (headerResponse.ok) {
          const headerData = await headerResponse.json()
          if (headerData.ok) {
            results.customHeader = customChannelHeader
          } else {
            logger.warn(`Warning: Failed to set custom header: ${headerData.error}`)
          }
        }
      } catch (headerError) {
        logger.warn(`Warning: Failed to set custom header:`, headerError)
      }
    }

    // 12. Return success result with outputs
    return {
      success: true,
      output: results,
      message: `Channel "${sanitizedName}" created successfully`
    }
    
  } catch (error: any) {
    // 13. Handle errors and return failure result
    logger.error("Slack create channel failed:", error)
    return {
      success: false,
      error: error.message || "Failed to create Slack channel"
    }
  }
} 