import { ActionResult } from './core/executeWait'
import { getDecryptedAccessToken } from './core/getDecryptedAccessToken'
import { resolveValue } from './core/resolveValue'
import { updateDiscordPresenceForAction } from '@/lib/integrations/discordGateway'

import { logger } from '@/lib/utils/logger'

const DISCORD_MAX_RETRIES = 3
const DISCORD_MIN_RETRY_DELAY_MS = 1000

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return null
}

function parseRetryAfterMs(bodyValue: unknown, headerValue: string | null): number | null {
  const bodySeconds = coerceNumber(bodyValue)
  if (bodySeconds !== null) {
    return Math.max(bodySeconds * 1000, DISCORD_MIN_RETRY_DELAY_MS)
  }

  if (headerValue) {
    const headerSeconds = coerceNumber(headerValue)
    if (headerSeconds !== null) {
      return Math.max(headerSeconds * 1000, DISCORD_MIN_RETRY_DELAY_MS)
    }

    const headerDate = Date.parse(headerValue)
    if (!Number.isNaN(headerDate)) {
      const diffMs = headerDate - Date.now()
      if (diffMs > 0) {
        return Math.max(diffMs, DISCORD_MIN_RETRY_DELAY_MS)
      }
    }
  }

  return null
}

/**
 * Verify that the Discord bot is actually a member of the specified guild
 */
async function verifyBotInGuild(guildId: string): Promise<boolean> {
  try {
    const botToken = process.env.DISCORD_BOT_TOKEN
    const botUserId = process.env.DISCORD_BOT_USER_ID

    if (!botToken || !botUserId) {
      logger.error("Missing Discord bot credentials")
      return false
    }

    // Method 1: Check guild members list
    try {
      const guildMembersUrl = `https://discord.com/api/v10/guilds/${guildId}/members?limit=1000`
      const guildResponse = await fetch(guildMembersUrl, {
        headers: { 
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json"
        }
      })

      if (guildResponse.status === 200) {
        const members = await guildResponse.json()
        const botMember = members.find((member: any) => member.user?.id === botUserId)
        
        if (botMember) {
          logger.info(`✅ Bot verified as member of guild ${guildId}`)
          return true
        }
      }
    } catch (error) {
      logger.error("Error checking guild members:", error)
    }

    // Method 2: Direct member check as fallback
    try {
      const memberUrl = `https://discord.com/api/v10/guilds/${guildId}/members/${botUserId}`
      const memberResponse = await fetch(memberUrl, {
        headers: { 
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json"
        }
      })

      if (memberResponse.status === 200) {
        const memberData = await memberResponse.json()
        if (memberData.user?.id === botUserId) {
          logger.info(`✅ Bot verified in guild ${guildId} via direct check`)
          return true
        }
      }
    } catch (error) {
      logger.error("Error in direct member check:", error)
    }

    logger.info(`❌ Bot is not a member of guild ${guildId}`)
    return false
  } catch (error) {
    logger.error("Error verifying bot in guild:", error)
    return false
  }
}

/**
 * Send a message to a Discord channel
 */
export async function sendDiscordMessage(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    logger.info("🔍 [DISCORD DEBUG] sendDiscordMessage called with:")
    logger.info(`   userId: ${userId}`)
    logger.info(`   config keys:`, Object.keys(config || {}))
    logger.info(`   input keys:`, Object.keys(input || {}))

    // Resolve templated values
    const resolvedConfig = resolveValue(config, input)

    const {
      guildId,
      channelId,
      message,
      embed = false,
      embedTitle,
      embedDescription,
      embedColor,
      embedFields = [],
      embedImage,
      embedThumbnail,
      embedFooter,
      embedTimestamp = false
    } = resolvedConfig

    logger.info(`🔍 [DISCORD DEBUG] Resolved config:`)
    logger.info(`   guildId: ${guildId}`)
    logger.info(`   channelId: ${channelId}`)
    logger.info(`   message: ${message ? 'SET' : 'MISSING'}`)

    if (!guildId || !channelId || !message) {
      throw new Error("Guild ID, Channel ID, and message are required")
    }

    // Get Discord integration
    logger.info(`🔍 [DISCORD DEBUG] Querying Discord integration for userId: ${userId}`)

    // Use service client for webhook-triggered workflows (no cookies in that context)
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!
    )

    const { data: integration, error: integrationError } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "discord")
      .eq("status", "connected")
      .single()

    logger.info(`🔍 [DISCORD DEBUG] Integration query result:`)
    logger.info(`   error:`, integrationError)
    logger.info(`   integration found:`, !!integration)
    if (integration) {
      logger.info(`   integration id: ${integration.id}`)
      logger.info(`   integration provider: ${integration.provider}`)
      logger.info(`   integration status: ${integration.status}`)
      logger.info(`   integration userId: ${integration.user_id}`)
    }

    if (!integration) {
      logger.info(`❌ [DISCORD DEBUG] No Discord integration found for userId: ${userId}`)
      throw new Error("Discord integration not connected")
    }

    // Get bot token for sending messages
    const botToken = process.env.DISCORD_BOT_TOKEN
    if (!botToken) {
      throw new Error("Discord bot token not configured")
    }

    // Verify bot is actually in the guild
    const botInGuild = await verifyBotInGuild(guildId)
    if (!botInGuild) {
      throw new Error(`Discord bot is not a member of the specified server. Please add the bot to the server first.`)
    }

    // Check if bot is in the guild
    const botUserId = process.env.DISCORD_BOT_USER_ID
    if (!botUserId) {
      throw new Error("Discord bot user ID not configured")
    }

    // Verify bot is in the guild and ensure it's online
    updateDiscordPresenceForAction()

    // Prepare message payload
    const payload: any = {
      content: message
    }

    // Add embed if configured
    if (embed && (embedTitle || embedDescription)) {
      payload.embeds = [{
        title: embedTitle,
        description: embedDescription,
        color: embedColor ? parseInt(embedColor.replace('#', ''), 16) : undefined,
        fields: embedFields.map((field: any) => ({
          name: field.name,
          value: field.value,
          inline: field.inline || false
        })),
        image: embedImage ? { url: embedImage } : undefined,
        thumbnail: embedThumbnail ? { url: embedThumbnail } : undefined,
        footer: embedFooter ? { text: embedFooter } : undefined,
        timestamp: embedTimestamp ? new Date().toISOString() : undefined
      }]
    }

    const sendMessageWithRetry = async () => {
      let lastError: Error | null = null

      for (let attempt = 0; attempt < DISCORD_MAX_RETRIES; attempt++) {
        try {
          const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
            method: "POST",
            headers: {
              Authorization: `Bot ${botToken}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
          })

          if (response.ok) {
            return await response.json()
          }

          const errorData = await response.json().catch(() => ({}))
          const baseMessage = `Discord API error: ${response.status} - ${errorData.message || response.statusText}`

          if (response.status === 429) {
            const retryDelay = parseRetryAfterMs((errorData as any)?.retry_after, response.headers.get('retry-after'))
            const retryMessage = attempt < DISCORD_MAX_RETRIES - 1 && retryDelay
              ? `${baseMessage}; retrying in ${retryDelay}ms`
              : `${baseMessage}; retries exhausted`
            lastError = new Error(retryMessage)
            logger.warn(`⚠️ [DISCORD DEBUG] ${retryMessage}`)

            if (retryDelay && attempt < DISCORD_MAX_RETRIES - 1) {
              await sleep(retryDelay)
              continue
            }
          } else if (response.status >= 500 && attempt < DISCORD_MAX_RETRIES - 1) {
            const backoff = DISCORD_MIN_RETRY_DELAY_MS * Math.pow(2, attempt)
            logger.warn(`⚠️ [DISCORD DEBUG] ${baseMessage}; retrying in ${backoff}ms`)
            await sleep(backoff)
            continue
          } else {
            lastError = new Error(baseMessage)
          }

          break
        } catch (fetchError: any) {
          const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError)
          lastError = new Error(`Discord fetch failed: ${errorMessage}`)
          logger.warn(`⚠️ [DISCORD DEBUG] ${lastError.message}`)

          if (attempt < DISCORD_MAX_RETRIES - 1) {
            const backoff = DISCORD_MIN_RETRY_DELAY_MS * Math.pow(2, attempt)
            logger.warn(`⚠️ [DISCORD DEBUG] Retrying in ${backoff}ms (attempt ${attempt + 1}/${DISCORD_MAX_RETRIES})`)
            await sleep(backoff)
            continue
          }

          break
        }
      }

      throw lastError || new Error('Failed to send Discord message after retries')
    }

    const result = await sendMessageWithRetry()

    return {
      success: true,
      output: {
        messageId: result.id,
        channelId: channelId,
        guildId: guildId,
        content: message,
        timestamp: result.timestamp,
        author: {
          id: result.author?.id,
          username: result.author?.username,
          bot: result.author?.bot
        },
        embed: embed,
        discordResponse: result
      },
      message: `Message sent successfully to Discord channel #${result.channel_id}`
    }

  } catch (error: any) {
    return {
      success: false,
      output: {},
      message: error.message || "Failed to send Discord message"
    }
  }
}

/**
 * Create a Discord category
 */
export async function createDiscordCategory(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const resolvedConfig = resolveValue(config, input)
    
    const {
      guildId,
      name,
      private: isPrivate = false,
      position,
      permissionOverwrites = []
    } = resolvedConfig

    if (!guildId || !name) {
      throw new Error("Guild ID and category name are required")
    }

    // Get Discord integration
    // Use service client for webhook-triggered workflows
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!
    )
    
    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "discord")
      .eq("status", "connected")
      .single()

    if (!integration) {
      throw new Error("Discord integration not connected")
    }

    // Get bot token
    const botToken = process.env.DISCORD_BOT_TOKEN
    if (!botToken) {
      throw new Error("Discord bot token not configured")
    }

    // Verify bot is actually in the guild
    const botInGuild = await verifyBotInGuild(guildId)
    if (!botInGuild) {
      throw new Error(`Discord bot is not a member of the specified server. Please add the bot to the server first.`)
    }

    // Check if bot is in the guild
    const botUserId = process.env.DISCORD_BOT_USER_ID
    if (!botUserId) {
      throw new Error("Discord bot user ID not configured")
    }

    // Verify bot is in the guild and ensure it's online
    updateDiscordPresenceForAction()

    // Prepare category payload
    const payload: any = {
      name,
      type: 4 // Category type
    }

    if (position !== undefined) {
      payload.position = position
    }

    // Handle private category by setting up permission overwrites
    const finalPermissionOverwrites = [...permissionOverwrites]
    
    if (isPrivate) {
      // For private categories, deny view permissions to @everyone role
      // This makes the category only visible to roles that have explicit allow permissions
      const everyoneDenyOverwrite = {
        id: guildId, // @everyone role ID is the same as guild ID
        type: 0, // 0 for role, 1 for member
        allow: "0",
        deny: "1024" // VIEW_CHANNEL permission bit
      }
      
      // Add the @everyone deny overwrite if it's not already present
      const hasEveryoneOverwrite = finalPermissionOverwrites.some((overwrite: any) => 
        overwrite.id === guildId && overwrite.type === 0
      )
      
      if (!hasEveryoneOverwrite) {
        finalPermissionOverwrites.push(everyoneDenyOverwrite)
      }
    }

    if (finalPermissionOverwrites.length > 0) {
      payload.permission_overwrites = finalPermissionOverwrites
    }

    // Create category
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`Discord API error: ${response.status} - ${errorData.message || response.statusText}`)
    }

    const result = await response.json()

    return {
      success: true,
      output: {
        categoryId: result.id,
        guildId: guildId,
        name: result.name,
        type: result.type,
        position: result.position,
        permissionOverwrites: result.permission_overwrites,
        discordResponse: result
      },
      message: `Category "${name}" created successfully in Discord server`
    }

  } catch (error: any) {
    return {
      success: false,
      output: {},
      message: error.message || "Failed to create Discord category"
    }
  }
}

/**
 * Delete a Discord category
 */
export async function deleteDiscordCategory(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const resolvedConfig = resolveValue(config, input)
    
    const {
      guildId,
      categoryId,
      moveChannels = true
    } = resolvedConfig

    if (!guildId || !categoryId) {
      throw new Error("Guild ID and category ID are required")
    }

    // Get Discord integration
    // Use service client for webhook-triggered workflows
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!
    )
    
    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "discord")
      .eq("status", "connected")
      .single()

    if (!integration) {
      throw new Error("Discord integration not connected")
    }

    // Get bot token
    const botToken = process.env.DISCORD_BOT_TOKEN
    if (!botToken) {
      throw new Error("Discord bot token not configured")
    }

    // Verify bot is actually in the guild
    const botInGuild = await verifyBotInGuild(guildId)
    if (!botInGuild) {
      throw new Error(`Discord bot is not a member of the specified server. Please add the bot to the server first.`)
    }

    // Verify bot is in the guild and ensure it's online
    updateDiscordPresenceForAction()

    // If moveChannels is true, first move all channels out of the category
    if (moveChannels) {
      try {
        // Get all channels in the category
        const channelsResponse = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
          headers: { Authorization: `Bot ${botToken}` }
        })

        if (channelsResponse.ok) {
          const channels = await channelsResponse.json()
          const categoryChannels = channels.filter((channel: any) => channel.parent_id === categoryId)

          // Move each channel to the general area (no parent_id)
          for (const channel of categoryChannels) {
            await fetch(`https://discord.com/api/v10/channels/${channel.id}`, {
              method: "PATCH",
              headers: {
                Authorization: `Bot ${botToken}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                parent_id: null
              })
            })
          }

          logger.info(`Moved ${categoryChannels.length} channels out of category ${categoryId}`)
        }
      } catch (error) {
        logger.warn("Failed to move channels out of category:", error)
        // Continue with deletion even if moving channels fails
      }
    }

    // Delete the category
    const response = await fetch(`https://discord.com/api/v10/channels/${categoryId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json"
      }
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`Discord API error: ${response.status} - ${errorData.message || response.statusText}`)
    }

    return {
      success: true,
      output: {
        categoryId: categoryId,
        guildId: guildId,
        movedChannels: moveChannels,
        discordResponse: { deleted: true }
      },
      message: `Category deleted successfully${moveChannels ? " (channels moved to general area)" : ""}`
    }

  } catch (error: any) {
    return {
      success: false,
      output: {},
      message: error.message || "Failed to delete Discord category"
    }
  }
}

/**
 * Create a Discord channel
 */
export async function createDiscordChannel(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const resolvedConfig = resolveValue(config, input)
    
    const {
      guildId,
      name,
      type = 0,
      topic,
      nsfw = false,
      parentId,
      position,
      // Text channel specific fields
      rateLimitPerUser,
      defaultAutoArchiveDuration,
      // Voice channel specific fields
      bitrate,
      userLimit,
      rtcRegion,
      // Forum channel specific fields
      defaultReactionEmoji,
      defaultThreadRateLimitPerUser,
      defaultSortOrder,
      defaultForumLayout,
      // Advanced fields
      permissionOverwrites = [],
      availableTags,
      defaultAutoArchiveDurationAdvanced,
      defaultThreadRateLimitPerUserAdvanced,
      bitrateAdvanced,
      userLimitAdvanced
    } = resolvedConfig

    if (!guildId || !name) {
      throw new Error("Guild ID and channel name are required")
    }

    // Get Discord integration
    // Use service client for webhook-triggered workflows
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!
    )
    
    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "discord")
      .eq("status", "connected")
      .single()

    if (!integration) {
      throw new Error("Discord integration not connected")
    }

    // Get bot token
    const botToken = process.env.DISCORD_BOT_TOKEN
    if (!botToken) {
      throw new Error("Discord bot token not configured")
    }

    // Verify bot is actually in the guild
    const botInGuild = await verifyBotInGuild(guildId)
    if (!botInGuild) {
      throw new Error(`Discord bot is not a member of the specified server. Please add the bot to the server first.`)
    }

    // Create channel payload
    const payload: any = {
      name: name,
      type: parseInt(type),
      nsfw: nsfw
    }

    // Add topic only for text-based channels (0, 5, 15, 16)
    if (topic && [0, 5, 15, 16].includes(parseInt(type))) {
      payload.topic = topic
    }

    // Add parent category if specified
    if (parentId) payload.parent_id = parentId
    
    // Add position if specified
    if (position !== undefined) payload.position = position

    // Add text channel specific fields
    if (rateLimitPerUser !== undefined) payload.rate_limit_per_user = rateLimitPerUser
    if (defaultAutoArchiveDuration !== undefined) payload.default_auto_archive_duration = parseInt(defaultAutoArchiveDuration)
    
    // Add voice channel specific fields
    if (bitrate !== undefined) payload.bitrate = bitrate
    if (userLimit !== undefined) payload.user_limit = userLimit
    if (rtcRegion) payload.rtc_region = rtcRegion
    
    // Add forum channel specific fields
    if (defaultReactionEmoji) payload.default_reaction_emoji = defaultReactionEmoji
    if (defaultThreadRateLimitPerUser !== undefined) payload.default_thread_rate_limit_per_user = defaultThreadRateLimitPerUser
    if (defaultSortOrder !== undefined) payload.default_sort_order = parseInt(defaultSortOrder)
    if (defaultForumLayout !== undefined) payload.default_forum_layout = parseInt(defaultForumLayout)
    
    // Add advanced fields (these override basic fields if both are provided)
    if (defaultAutoArchiveDurationAdvanced !== undefined) payload.default_auto_archive_duration = defaultAutoArchiveDurationAdvanced
    if (defaultThreadRateLimitPerUserAdvanced !== undefined) payload.default_thread_rate_limit_per_user = defaultThreadRateLimitPerUserAdvanced
    if (bitrateAdvanced !== undefined) payload.bitrate = bitrateAdvanced
    if (userLimitAdvanced !== undefined) payload.user_limit = userLimitAdvanced
    
    // Add permission overwrites if specified
    if (permissionOverwrites && permissionOverwrites.length > 0) {
      try {
        const parsedOverwrites = typeof permissionOverwrites === 'string' ? JSON.parse(permissionOverwrites) : permissionOverwrites
        payload.permission_overwrites = parsedOverwrites
      } catch (error) {
        logger.warn('Invalid permission overwrites format:', error)
      }
    }
    
    // Add available tags for forum channels
    if (availableTags && parseInt(type) === 15) {
      try {
        const parsedTags = typeof availableTags === 'string' ? JSON.parse(availableTags) : availableTags
        payload.available_tags = parsedTags
      } catch (error) {
        logger.warn('Invalid available tags format:', error)
      }
    }

    // Create channel
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`Discord API error: ${response.status} - ${errorData.message || response.statusText}`)
    }

    const result = await response.json()

    return {
      success: true,
      output: {
        channelId: result.id,
        guildId: guildId,
        name: result.name,
        type: result.type,
        topic: result.topic,
        nsfw: result.nsfw,
        parentId: result.parent_id,
        position: result.position,
        bitrate: result.bitrate,
        userLimit: result.user_limit,
        rateLimitPerUser: result.rate_limit_per_user,
        defaultAutoArchiveDuration: result.default_auto_archive_duration,
        discordResponse: result
      },
      message: `Discord channel #${result.name} created successfully`
    }

  } catch (error: any) {
    return {
      success: false,
      output: {},
      message: error.message || "Failed to create Discord channel"
    }
  }
}

/**
 * Add a role to a Discord user
 */
export async function addDiscordRole(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const resolvedConfig = resolveValue(config, input)
    
    const {
      guildId,
      userId: targetUserId,
      roleId
    } = resolvedConfig

    if (!guildId || !targetUserId || !roleId) {
      throw new Error("Guild ID, User ID, and Role ID are required")
    }

    // Get Discord integration
    // Use service client for webhook-triggered workflows
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!
    )
    
    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "discord")
      .eq("status", "connected")
      .single()

    if (!integration) {
      throw new Error("Discord integration not connected")
    }

    // Get bot token
    const botToken = process.env.DISCORD_BOT_TOKEN
    if (!botToken) {
      throw new Error("Discord bot token not configured")
    }

    // Add role to user
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${targetUserId}/roles/${roleId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json"
      }
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`Discord API error: ${response.status} - ${errorData.message || response.statusText}`)
    }

    return {
      success: true,
      output: {
        guildId: guildId,
        userId: targetUserId,
        roleId: roleId,
        added: true,
        timestamp: new Date().toISOString()
      },
      message: `Role added successfully to user ${targetUserId}`
    }

  } catch (error: any) {
    return {
      success: false,
      output: {},
      message: error.message || "Failed to add Discord role"
    }
  }
} 

/**
 * Send a direct message to a Discord user
 */
export async function sendDiscordDirectMessage(config: any, userId: string, input: Record<string, any>) {
  try {
    const resolvedConfig = resolveValue(config, input)
    const { userId: targetUserId, message } = resolvedConfig
    if (!targetUserId || !message) throw new Error("User ID and message are required")
    const botToken = process.env.DISCORD_BOT_TOKEN
    if (!botToken) throw new Error("Discord bot token not configured")
    // Create DM channel
    const dmResponse = await fetch("https://discord.com/api/v10/users/@me/channels", {
      method: "POST",
      headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recipient_id: targetUserId })
    })
    if (!dmResponse.ok) throw new Error(`Failed to create DM channel: ${dmResponse.status}`)
    const dmChannel = await dmResponse.json()
    // Send message
    const msgResponse = await fetch(`https://discord.com/api/v10/channels/${dmChannel.id}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content: message })
    })
    if (!msgResponse.ok) throw new Error(`Failed to send DM: ${msgResponse.status}`)
    const msgData = await msgResponse.json()
    return { success: true, output: msgData, message: "Direct message sent successfully" }
  } catch (error: any) {
    return { success: false, output: {}, message: error.message || "Failed to send DM" }
  }
}

/**
 * Edit a message in a Discord channel
 */
export async function editDiscordMessage(config: any, userId: string, input: Record<string, any>) {
  try {
    const resolvedConfig = resolveValue(config, input)
    const { channelId, messageId, content } = resolvedConfig

    if (!channelId || !messageId || !content) {
      throw new Error("Channel ID, Message ID, and content are required")
    }

    // Get Discord integration to verify connection
    // Use service client for webhook-triggered workflows
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!
    )
    
    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "discord")
      .eq("status", "connected")
      .single()

    if (!integration) {
      throw new Error("Discord integration not connected")
    }

    // Get bot token
    const botToken = process.env.DISCORD_BOT_TOKEN
    if (!botToken) {
      throw new Error("Discord bot token not configured")
    }

    // Ensure bot is online
    updateDiscordPresenceForAction()

    // Edit the message
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ content })
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))

      // Provide clearer error message for common Discord API limitation
      if (response.status === 403 && (errorData.message?.includes('Cannot edit a message authored by another user') || errorData.code === 50005)) {
        throw new Error("Discord API limitation: Bots can only edit their own messages. To modify content from other users, consider using the 'Delete Message' action followed by 'Send Message' instead.")
      }

      throw new Error(`Discord API error: ${response.status} - ${errorData.message || response.statusText}`)
    }

    const data = await response.json()

    return { 
      success: true, 
      output: {
        messageId: data.id,
        channelId: channelId,
        content: content,
        editedTimestamp: data.edited_timestamp,
        author: {
          id: data.author?.id,
          username: data.author?.username,
          bot: data.author?.bot
        },
        discordResponse: data
      }, 
      message: "Message edited successfully" 
    }
  } catch (error: any) {
    return { 
      success: false, 
      output: {}, 
      message: error.message || "Failed to edit message" 
    }
  }
}

/**
 * Delete message(s) in a Discord channel with filtering options
 */
export async function deleteDiscordMessage(config: any, userId: string, input: Record<string, any>) {
  try {
    const resolvedConfig = resolveValue(config, input)
    const { channelId, messageIds, userIds: filterUserIds, keywords, keywordMatchType = "partial" } = resolvedConfig

    const botToken = process.env.DISCORD_BOT_TOKEN
    if (!botToken) throw new Error("Discord bot token not configured")

    const userIdsToFilter = filterUserIds || []
    
    // If no filters are provided and no messages selected, error out
    if (!messageIds?.length && userIdsToFilter.length === 0 && (!keywords || keywords.length === 0)) {
      throw new Error("Please select messages to delete or provide filter criteria")
    }
    
    let messagesToDelete: string[] = []
    
    // If specific message IDs are provided, use those
    if (messageIds && messageIds.length > 0) {
      messagesToDelete = messageIds
    }
    
    // If filters are provided, fetch and filter messages
    if (userIdsToFilter.length > 0 || (keywords && keywords.length > 0)) {
      // Fetch recent messages from the channel
      const fetchResponse = await fetch(
        `https://discord.com/api/v10/channels/${channelId}/messages?limit=100`,
        {
          headers: { 
            Authorization: `Bot ${botToken}`,
            "Content-Type": "application/json"
          }
        }
      )
      
      if (!fetchResponse.ok) {
        throw new Error(`Failed to fetch messages: ${fetchResponse.status}`)
      }
      
      const messages = await fetchResponse.json()
      
      // Filter messages based on criteria
      const filteredMessages = messages.filter((msg: any) => {
        // Filter by users (multiple)
        if (userIdsToFilter.length > 0 && !userIdsToFilter.includes(msg.author?.id)) {
          return false
        }
        
        // Filter by keywords with different match types
        if (keywords && keywords.length > 0) {
          const messageContent = msg.content || ""
          let hasKeyword = false

          if (keywordMatchType === "exact") {
            // Exact case-sensitive match
            hasKeyword = keywords.some((keyword: string) =>
              messageContent.includes(keyword)
            )
          } else if (keywordMatchType === "whole") {
            // Whole word match (case-insensitive)
            const messageLower = messageContent.toLowerCase()
            hasKeyword = keywords.some((keyword: string) => {
              const keywordLower = keyword.toLowerCase()
              // Create word boundary regex
              const escapedKeyword = keywordLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
              const regex = new RegExp(`\\b${escapedKeyword}\\b`)
              return regex.test(messageLower)
            })
          } else {
            // Default: partial match (case-insensitive)
            const messageLower = messageContent.toLowerCase()
            hasKeyword = keywords.some((keyword: string) =>
              messageLower.includes(keyword.toLowerCase())
            )
          }

          if (!hasKeyword) {
            return false
          }
        }
        
        return true
      })
      
      // Add filtered message IDs to the delete list
      const filteredIds = filteredMessages.map((msg: any) => msg.id)
      messagesToDelete = [...new Set([...messagesToDelete, ...filteredIds])]
    }
    
    // Delete messages
    let deletedCount = 0
    let failedCount = 0
    const errors: string[] = []
    
    // If we have 2 or more messages and they're recent (within 14 days), use bulk delete
    if (messagesToDelete.length >= 2) {
      try {
        // Discord bulk delete endpoint (can delete 2-100 messages at once)
        const bulkResponse = await fetch(
          `https://discord.com/api/v10/channels/${channelId}/messages/bulk-delete`,
          {
            method: "POST",
            headers: { 
              Authorization: `Bot ${botToken}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              messages: messagesToDelete.slice(0, 100) // Max 100 messages per bulk delete
            })
          }
        )
        
        if (bulkResponse.ok) {
          deletedCount = Math.min(messagesToDelete.length, 100)
          
          // If there are more than 100 messages, delete the rest individually
          if (messagesToDelete.length > 100) {
            for (const messageId of messagesToDelete.slice(100)) {
              const response = await fetch(
                `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`,
                {
                  method: "DELETE",
                  headers: { Authorization: `Bot ${botToken}` }
                }
              )
              
              if (response.ok) {
                deletedCount++
              } else {
                failedCount++
                errors.push(`Message ${messageId}: ${response.status}`)
              }
              
              // Add delay to avoid rate limits
              await new Promise(resolve => setTimeout(resolve, 500))
            }
          }
        } else {
          // Bulk delete failed, fall back to individual deletion
          for (const messageId of messagesToDelete) {
            const response = await fetch(
              `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`,
              {
                method: "DELETE",
                headers: { Authorization: `Bot ${botToken}` }
              }
            )
            
            if (response.ok) {
              deletedCount++
            } else {
              failedCount++
              errors.push(`Message ${messageId}: ${response.status}`)
            }
            
            // Add delay to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 500))
          }
        }
      } catch (error) {
        // Fall back to individual deletion
        for (const messageId of messagesToDelete) {
          try {
            const response = await fetch(
              `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`,
              {
                method: "DELETE",
                headers: { Authorization: `Bot ${botToken}` }
              }
            )
            
            if (response.ok) {
              deletedCount++
            } else {
              failedCount++
              errors.push(`Message ${messageId}: ${response.status}`)
            }
          } catch (err) {
            failedCount++
            errors.push(`Message ${messageId}: ${err}`)
          }
          
          // Add delay to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      }
    } else if (messagesToDelete.length === 1) {
      // Single message deletion
      const response = await fetch(
        `https://discord.com/api/v10/channels/${channelId}/messages/${messagesToDelete[0]}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bot ${botToken}` }
        }
      )
      
      if (response.ok) {
        deletedCount = 1
      } else {
        failedCount = 1
        errors.push(`Failed to delete message: ${response.status}`)
      }
    }
    
    // Build result message
    let resultMessage = `Deleted ${deletedCount} message${deletedCount !== 1 ? 's' : ''}`
    if (failedCount > 0) {
      resultMessage += `, ${failedCount} failed`
    }
    if (filterUserId) {
      resultMessage += ` (filtered by user)`
    }
    if (keywords && keywords.length > 0) {
      resultMessage += ` (filtered by keywords: ${keywords.join(', ')})`
    }
    
    return { 
      success: deletedCount > 0, 
      output: { 
        deletedCount, 
        failedCount,
        totalProcessed: messagesToDelete.length,
        errors: errors.length > 0 ? errors : undefined
      }, 
      message: resultMessage 
    }
  } catch (error: any) {
    return { 
      success: false, 
      output: {}, 
      message: error.message || "Failed to delete messages" 
    }
  }
}

/**
 * Fetch messages from a Discord channel with optional filters
 */
export async function fetchDiscordMessages(config: any, userId: string, input: Record<string, any>) {
  try {
    const resolvedConfig = resolveValue(config, input)
    const {
      channelId,
      limit = 20,
      sortOrder = "newest",
      filterType = "none",
      filterAuthor,
      filterContent,
      caseSensitive = false
    } = resolvedConfig

    if (!channelId) {
      throw new Error("Channel ID is required")
    }

    // Get Discord integration to verify user has access
    // Use service client for webhook-triggered workflows
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!
    )
    
    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "discord")
      .eq("status", "connected")
      .single()

    if (!integration) {
      throw new Error("Discord integration not connected")
    }

    const botToken = process.env.DISCORD_BOT_TOKEN
    if (!botToken) {
      throw new Error("Discord bot token not configured")
    }

    // Validate limit - fetch more than needed if filtering to account for filtered out messages
    const baseLimitMultiplier = filterType === "none" ? 1 : 3
    const validatedLimit = Math.min(Math.max(1, limit || 20), 100)
    const fetchLimit = Math.min(validatedLimit * baseLimitMultiplier, 100)

    // Fetch messages from Discord API
    const response = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages?limit=${fetchLimit}`,
      {
        headers: { 
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json"
        }
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`Discord API error: ${response.status} - ${errorData.message || response.statusText}`)
    }

    const messages = await response.json()

    // Apply filters
    let filteredMessages = messages.filter((msg: any) => {
      switch (filterType) {
        case "author":
          return filterAuthor ? msg.author?.id === filterAuthor : true

        case "content":
          if (!filterContent) return true
          const messageContent = msg.content || ""
          return caseSensitive
            ? messageContent.includes(filterContent)
            : messageContent.toLowerCase().includes(filterContent.toLowerCase())

        case "has_attachments":
          return msg.attachments && msg.attachments.length > 0

        case "has_embeds":
          return msg.embeds && msg.embeds.length > 0

        case "is_pinned":
          return msg.pinned === true

        case "from_bots":
          return msg.author?.bot === true

        case "from_humans":
          return msg.author?.bot !== true

        case "has_reactions":
          return msg.reactions && msg.reactions.length > 0

        case "none":
        default:
          return true
      }
    })

    // Apply sorting
    // Discord API returns messages in reverse chronological order (newest first) by default
    if (sortOrder === "oldest") {
      // Reverse to get oldest first
      filteredMessages = filteredMessages.reverse()
    }
    // If sortOrder === "newest", keep as is (already newest first from Discord API)

    // Limit the results to the requested amount
    const limitedMessages = filteredMessages.slice(0, validatedLimit)

    // Process and structure the messages for better output
    const processedMessages = limitedMessages
      // Filter out system messages: only type 0 (default) and not blank unless attachments/embeds
      .filter((msg: any) => {
        // type 0 = default/user message, others are system
        if (msg.type !== 0) return false
        // Show if content is not blank, or if there are attachments or embeds
        const hasContent = (msg.content && msg.content.trim().length > 0)
        const hasAttachments = Array.isArray(msg.attachments) && msg.attachments.length > 0
        const hasEmbeds = Array.isArray(msg.embeds) && msg.embeds.length > 0
        return hasContent || hasAttachments || hasEmbeds
      })
      .map((msg: any) => ({
        id: msg.id,
        content: msg.content,
        timestamp: msg.timestamp,
        edited_timestamp: msg.edited_timestamp,
        author: {
          id: msg.author?.id,
          username: msg.author?.username,
          discriminator: msg.author?.discriminator,
          avatar: msg.author?.avatar,
          bot: msg.author?.bot,
          display_name: msg.member?.nick || msg.author?.username
        },
        channel_id: msg.channel_id,
        guild_id: msg.guild_id,
        mentions: msg.mentions,
        mention_roles: msg.mention_roles,
        mention_everyone: msg.mention_everyone,
        attachments: msg.attachments,
        embeds: msg.embeds,
        reactions: msg.reactions,
        pinned: msg.pinned,
        type: msg.type,
        flags: msg.flags,
        webhook_id: msg.webhook_id,
        tts: msg.tts,
        nonce: msg.nonce,
        referenced_message: msg.referenced_message
      }))

    // Build result message
    let resultMessage = `Successfully fetched ${processedMessages.length} messages from Discord channel`
    if (filterType !== "none") {
      resultMessage += ` (filtered by ${filterType})`
      if (filteredMessages.length !== messages.length) {
        resultMessage += ` - ${filteredMessages.length} matched out of ${messages.length} total`
      }
    }

    return { 
      success: true, 
      output: {
        messages: processedMessages,
        count: processedMessages.length,
        channel_id: channelId,
        limit: validatedLimit,
        filter_type: filterType,
        filter_applied: filterType !== "none",
        total_fetched: messages.length,
        total_after_filter: filteredMessages.length,
        raw_messages: messages // Keep raw data for advanced use cases
      }, 
      message: resultMessage
    }
  } catch (error: any) {
    logger.error("Discord fetch messages error:", error)
    return { 
      success: false, 
      output: {}, 
      message: error.message || "Failed to fetch Discord messages" 
    }
  }
}

/**
 * Add a reaction to a message
 */
export async function addDiscordReaction(config: any, userId: string, input: Record<string, any>) {
  try {
    const resolvedConfig = resolveValue(config, input)
    const { channelId, messageId, emoji } = resolvedConfig
    const botToken = process.env.DISCORD_BOT_TOKEN
    if (!botToken) throw new Error("Discord bot token not configured")
    
    // Support multiple emojis
    let emojiList = [];
    if (Array.isArray(emoji)) {
      emojiList = emoji;
    } else if (emoji) {
      emojiList = [emoji];
    }
    if (emojiList.length === 0) throw new Error("Emoji is required");
    
    const results = [];
    for (const em of emojiList) {
      let emojiValue: string;
      if (typeof em === 'string') {
        emojiValue = em;
      } else if (em && typeof em === 'object') {
        if (em.custom && em.id) {
          emojiValue = `${em.name}:${em.id}`;
        } else if (em.native) {
          emojiValue = em.native;
        } else if (em.value) {
          emojiValue = em.value;
        } else {
          throw new Error("Invalid emoji format");
        }
      } else {
        throw new Error("Invalid emoji format");
      }
      const emojiEncoded = encodeURIComponent(emojiValue);
      const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/reactions/${emojiEncoded}/@me`, {
        method: "PUT",
        headers: { Authorization: `Bot ${botToken}` }
      });
      if (!response.ok) {
        results.push({ emoji: emojiValue, success: false, status: response.status });
      } else {
        results.push({ emoji: emojiValue, success: true });
      }
    }
    return {
      success: results.every(r => r.success),
      output: { channelId, messageId, emojis: results },
      message: results.every(r => r.success)
        ? "All reactions added successfully"
        : `Some reactions failed: ${results.filter(r => !r.success).map(r => r.emoji).join(", ")}`
    }
  } catch (error: any) {
    return { success: false, output: {}, message: error.message || "Failed to add reaction" }
  }
}

/**
 * Remove a reaction from a message
 */
export async function removeDiscordReaction(config: any, userId: string, input: Record<string, any>) {
  try {
    const resolvedConfig = resolveValue(config, input)
    const { channelId, messageId, emoji } = resolvedConfig;

    if (!channelId || !messageId || !emoji) {
      throw new Error("Channel ID, Message ID, and emoji are required");
    }

    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!botToken) throw new Error("Discord bot token not configured");

    // Support multiple emojis
    let emojiList = [];
    if (Array.isArray(emoji)) {
      emojiList = emoji;
    } else if (emoji) {
      emojiList = [emoji];
    }
    if (emojiList.length === 0) throw new Error("Emoji is required");

    const allResults = [];
    for (const em of emojiList) {
      // Handle different emoji formats from the UI
      let emojiIdentifier: string;
      if (typeof em === "string") {
        emojiIdentifier = em;
      } else if (em && typeof em === "object") {
        if (em.custom && em.id) {
          emojiIdentifier = `${em.name}:${em.id}`;
        } else if (em.native) {
          emojiIdentifier = em.native;
        } else if (em.emoji) {
          emojiIdentifier = em.emoji;
        } else if (em.value) {
          emojiIdentifier = em.value;
        } else {
          throw new Error("Invalid emoji format");
        }
      } else {
        throw new Error("Invalid emoji format");
      }

      const emojiEncoded = encodeURIComponent(emojiIdentifier);

      // 1. Fetch all users who reacted with this emoji
      const usersRes = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/reactions/${emojiEncoded}`, {
        headers: { Authorization: `Bot ${botToken}` }
      });
      if (!usersRes.ok) {
        const errorData = await usersRes.json().catch(() => ({}));
        allResults.push({
          emoji: emojiIdentifier,
          success: false,
          error: `Failed to fetch users for reaction: ${usersRes.status} - ${errorData.message || usersRes.statusText}`
        });
        continue;
      }
      
      const users = await usersRes.json();
      if (!Array.isArray(users) || users.length === 0) {
        allResults.push({
          emoji: emojiIdentifier,
          success: true,
          users: [],
          message: `No users found for reaction ${emojiIdentifier}`
        });
        continue;
      }

      // 2. Remove all reactions of this emoji from the message
      const delRes = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/reactions/${emojiEncoded}`, {
        method: "DELETE",
        headers: { Authorization: `Bot ${botToken}` }
      });
      
      if (delRes.ok) {
        allResults.push({ 
          emoji: emojiIdentifier, 
          success: true, 
          usersRemoved: users.length,
          message: `Removed all ${users.length} reactions of ${emojiIdentifier}` 
        });
      } else {
        const errorData = await delRes.json().catch(() => ({}));
        allResults.push({ 
          emoji: emojiIdentifier, 
          success: false, 
          error: `Failed to remove reactions: ${delRes.status} - ${errorData.message || delRes.statusText}` 
        });
      }
    }

    const successfulResults = allResults.filter(r => r.success);
    const failedResults = allResults.filter(r => !r.success);

    return {
      success: failedResults.length === 0,
      output: {
        channelId,
        messageId,
        emojis: allResults,
        removedAt: new Date().toISOString()
      },
      message: failedResults.length === 0
        ? `All reactions removed successfully (${successfulResults.length} emoji(s))`
        : `Some reactions failed: ${failedResults.map(r => r.emoji).join(", ")}. ${successfulResults.length} emoji(s) removed successfully.`
    };
  } catch (error: any) {
    logger.error("Discord remove reaction error:", error);
    return {
      success: false,
      output: {},
      message: error.message || "Failed to remove reaction"
    };
  }
}

 

/**
 * Edit a Discord channel
 */
export async function editDiscordChannel(config: any, userId: string, input: Record<string, any>) {
  try {
    const resolvedConfig = resolveValue(config, input)
    const { guildId, channelId, ...updateFields } = resolvedConfig
    if (!guildId || !channelId) throw new Error("Guild ID and Channel ID are required")
    const botToken = process.env.DISCORD_BOT_TOKEN
    if (!botToken) throw new Error("Discord bot token not configured")
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}` , {
      method: "PATCH",
      headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(updateFields)
    })
    if (!response.ok) throw new Error(`Failed to edit channel: ${response.status}`)
    const data = await response.json()
    return { success: true, output: data, message: "Channel edited successfully" }
  } catch (error: any) {
    return { success: false, output: {}, message: error.message || "Failed to edit channel" }
  }
}

/**
 * Delete a Discord channel
 */
export async function deleteDiscordChannel(config: any, userId: string, input: Record<string, any>) {
  try {
    const resolvedConfig = resolveValue(config, input)
    const { channelId } = resolvedConfig
    if (!channelId) throw new Error("Channel ID is required")
    const botToken = process.env.DISCORD_BOT_TOKEN
    if (!botToken) throw new Error("Discord bot token not configured")
    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}` , {
      method: "DELETE",
      headers: { Authorization: `Bot ${botToken}` }
    })
    if (!response.ok) throw new Error(`Failed to delete channel: ${response.status}`)
    return { success: true, output: {}, message: "Channel deleted successfully" }
  } catch (error: any) {
    return { success: false, output: {}, message: error.message || "Failed to delete channel" }
  }
}

/**
 * List channels in a guild with filtering
 */
export async function listDiscordChannels(config: any, userId: string, input: Record<string, any>) {
  try {
    const resolvedConfig = resolveValue(config, input)
    const { 
      guildId, 
      limit = 50, 
      channelTypes, 
      nameFilter, 
      sortBy = "position", 
      includeArchived = false,
      parentCategory 
    } = resolvedConfig
    
    if (!guildId) throw new Error("Guild ID is required")
    const botToken = process.env.DISCORD_BOT_TOKEN
    if (!botToken) throw new Error("Discord bot token not configured")
    
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
      headers: { Authorization: `Bot ${botToken}` }
    })
    
    if (!response.ok) throw new Error(`Failed to list channels: ${response.status}`)
    let data = await response.json()
    
    // Apply filters
    if (channelTypes && Array.isArray(channelTypes) && channelTypes.length > 0) {
      data = data.filter((channel: any) => channelTypes.includes(channel.type.toString()))
    }
    
    if (nameFilter && nameFilter.trim()) {
      const filterLower = nameFilter.toLowerCase()
      data = data.filter((channel: any) => 
        channel.name && channel.name.toLowerCase().includes(filterLower)
      )
    }
    
    if (parentCategory) {
      data = data.filter((channel: any) => channel.parent_id === parentCategory)
    }
    
    if (!includeArchived) {
      data = data.filter((channel: any) => !channel.archived)
    }

    // NEW: Check bot permissions for each channel and filter out inaccessible ones
    const botUserId = process.env.DISCORD_CLIENT_ID
    if (botUserId) {
      // Get bot's guild member info to check permissions
      const memberUrl = `https://discord.com/api/v10/guilds/${guildId}/members/${botUserId}`
      const memberResponse = await fetch(memberUrl, {
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
      })

      if (memberResponse.status === 200) {
        const memberData = await memberResponse.json()
        const guildPermissions = BigInt(memberData.permissions || 0)
        
        // Check if bot has permission to view and send messages
        const VIEW_CHANNEL = BigInt(0x400)
        const SEND_MESSAGES = BigInt(0x800)
        
        const canViewChannel = (guildPermissions & VIEW_CHANNEL) !== BigInt(0)
        const canSendMessages = (guildPermissions & SEND_MESSAGES) !== BigInt(0)
        
        // If guild permissions are 0, the bot likely has channel-specific permissions
        // In this case, we'll check each channel individually
        const hasGuildPermissions = guildPermissions !== BigInt(0)
        
        if (hasGuildPermissions) {
          // Filter out channels the bot doesn't have access to based on guild permissions
          data = data.filter((channel: any) => {
            return canViewChannel && canSendMessages
          })
        } else {
          // Bot has channel-specific permissions - check each channel individually
          // Use batching to avoid rate limiting
          const BATCH_SIZE = 3
          const channelsWithAccess = []
          
          for (let i = 0; i < data.length; i += BATCH_SIZE) {
            const batch = data.slice(i, i + BATCH_SIZE)
            
            const batchResults = await Promise.all(
              batch.map(async (channel: any) => {
                try {
                  const channelResponse = await fetch(`https://discord.com/api/v10/channels/${channel.id}`, {
                    headers: {
                      Authorization: `Bot ${botToken}`,
                      "Content-Type": "application/json",
                    },
                  })
                  
                  // If bot can access the channel (status 200), assume it can send messages
                  return channelResponse.status === 200 ? channel : null
                } catch (error) {
                  // If we can't check the channel, exclude it to be safe
                  return null
                }
              })
            )
            
            channelsWithAccess.push(...batchResults.filter((channel: any) => channel !== null))
            
            // Add a small delay between batches to avoid rate limiting
            if (i + BATCH_SIZE < data.length) {
              await new Promise(resolve => setTimeout(resolve, 100))
            }
          }
          
          data = channelsWithAccess
        }
      }
    }
    
    // Apply sorting
    switch (sortBy) {
      case "name":
        data.sort((a: any, b: any) => a.name.localeCompare(b.name))
        break
      case "name_desc":
        data.sort((a: any, b: any) => b.name.localeCompare(a.name))
        break
      case "created":
        data.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        break
      case "created_old":
        data.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        break
      case "position":
      default:
        data.sort((a: any, b: any) => a.position - b.position)
        break
    }
    
    // Apply limit
    if (limit && data.length > limit) {
      data = data.slice(0, limit)
    }
    
    return {
      success: true,
      output: data.map((channel: any) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        position: channel.position,
        parent_id: channel.parent_id,
        topic: channel.topic,
        nsfw: channel.nsfw,
        rate_limit_per_user: channel.rate_limit_per_user,
        created_at: channel.created_at
      }))
    }
  } catch (error: any) {
    return {
      success: false,
      message: error.message || "Failed to list Discord channels"
    }
  }
}

/**
 * Fetch guild members with filtering
 */
export async function fetchDiscordGuildMembers(config: any, userId: string, input: Record<string, any>) {
  try {
    const resolvedConfig = resolveValue(config, input)
    const { 
      guildId, 
      limit = 50, 
      nameFilter, 
      roleFilter, 
      sortBy = "joined", 
      includeBots = false 
    } = resolvedConfig
    
    if (!guildId) throw new Error("Guild ID is required")
    const botToken = process.env.DISCORD_BOT_TOKEN
    if (!botToken) throw new Error("Discord bot token not configured")
    
    // Fetch members (Discord API doesn't support filtering, so we fetch all and filter client-side)
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members?limit=1000`, { 
      headers: { Authorization: `Bot ${botToken}` } 
    })
    
    if (!response.ok) throw new Error(`Failed to fetch members: ${response.status}`)
    let data = await response.json()
    
    // Apply filters
    if (!includeBots) {
      data = data.filter((member: any) => !member.user?.bot)
    }
    
    if (nameFilter && nameFilter.trim()) {
      const filterLower = nameFilter.toLowerCase()
      data = data.filter((member: any) => {
        const username = member.user?.username || ""
        const nickname = member.nick || ""
        return username.toLowerCase().includes(filterLower) || 
               nickname.toLowerCase().includes(filterLower)
      })
    }
    
    if (roleFilter) {
      data = data.filter((member: any) => 
        member.roles && member.roles.includes(roleFilter)
      )
    }
    
    // Apply sorting
    switch (sortBy) {
      case "joined":
        data.sort((a: any, b: any) => new Date(b.joined_at).getTime() - new Date(a.joined_at).getTime())
        break
      case "joined_old":
        data.sort((a: any, b: any) => new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime())
        break
      case "name":
        data.sort((a: any, b: any) => {
          const nameA = (a.nick || a.user?.username || "").toLowerCase()
          const nameB = (b.nick || b.user?.username || "").toLowerCase()
          return nameA.localeCompare(nameB)
        })
        break
      case "name_desc":
        data.sort((a: any, b: any) => {
          const nameA = (a.nick || a.user?.username || "").toLowerCase()
          const nameB = (b.nick || b.user?.username || "").toLowerCase()
          return nameB.localeCompare(nameA)
        })
        break
      case "username":
        data.sort((a: any, b: any) => {
          const usernameA = (a.user?.username || "").toLowerCase()
          const usernameB = (b.user?.username || "").toLowerCase()
          return usernameA.localeCompare(usernameB)
        })
        break
      case "username_desc":
        data.sort((a: any, b: any) => {
          const usernameA = (a.user?.username || "").toLowerCase()
          const usernameB = (b.user?.username || "").toLowerCase()
          return usernameB.localeCompare(usernameA)
        })
        break
    }
    
    // Apply limit
    if (limit && limit > 0) {
      data = data.slice(0, limit)
    }
    
    return { 
      success: true, 
      output: data, 
      message: `Fetched ${data.length} members with applied filters` 
    }
  } catch (error: any) {
    return { success: false, output: {}, message: error.message || "Failed to fetch members" }
  }
}

/**
 * List roles in a guild
 */
export async function listDiscordRoles(config: any, userId: string, input: Record<string, any>) {
  try {
    const resolvedConfig = resolveValue(config, input)
    const { guildId } = resolvedConfig
    if (!guildId) throw new Error("Guild ID is required")
    const botToken = process.env.DISCORD_BOT_TOKEN
    if (!botToken) throw new Error("Discord bot token not configured")
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, {
      headers: { Authorization: `Bot ${botToken}` }
    })
    if (!response.ok) throw new Error(`Failed to list roles: ${response.status}`)
    const data = await response.json()
    return { success: true, output: data, message: `Fetched ${data.length} roles` }
  } catch (error: any) {
    return { success: false, output: {}, message: error.message || "Failed to list roles" }
  }
}

/**
 * Create a role in a guild
 */
export async function createDiscordRole(config: any, userId: string, input: Record<string, any>) {
  try {
    const resolvedConfig = resolveValue(config, input)
    const { guildId, ...roleData } = resolvedConfig
    if (!guildId) throw new Error("Guild ID is required")
    const botToken = process.env.DISCORD_BOT_TOKEN
    if (!botToken) throw new Error("Discord bot token not configured")
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, {
      method: "POST",
      headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(roleData)
    })
    if (!response.ok) throw new Error(`Failed to create role: ${response.status}`)
    const data = await response.json()
    return { success: true, output: data, message: "Role created successfully" }
  } catch (error: any) {
    return { success: false, output: {}, message: error.message || "Failed to create role" }
  }
}

/**
 * Update a role in a guild
 */
export async function updateDiscordRole(config: any, userId: string, input: Record<string, any>) {
  try {
    const resolvedConfig = resolveValue(config, input)
    const { guildId, roleId, ...roleData } = resolvedConfig
    if (!guildId || !roleId) throw new Error("Guild ID and Role ID are required")
    const botToken = process.env.DISCORD_BOT_TOKEN
    if (!botToken) throw new Error("Discord bot token not configured")
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles/${roleId}`, {
      method: "PATCH",
      headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(roleData)
    })
    if (!response.ok) throw new Error(`Failed to update role: ${response.status}`)
    const data = await response.json()
    return { success: true, output: data, message: "Role updated successfully" }
  } catch (error: any) {
    return { success: false, output: {}, message: error.message || "Failed to update role" }
  }
}

/**
 * Delete a role in a guild
 */
export async function deleteDiscordRole(config: any, userId: string, input: Record<string, any>) {
  try {
    const resolvedConfig = resolveValue(config, input)
    const { guildId, roleId } = resolvedConfig
    if (!guildId || !roleId) throw new Error("Guild ID and Role ID are required")
    const botToken = process.env.DISCORD_BOT_TOKEN
    if (!botToken) throw new Error("Discord bot token not configured")
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles/${roleId}`, {
      method: "DELETE",
      headers: { Authorization: `Bot ${botToken}` }
    })
    if (!response.ok) throw new Error(`Failed to delete role: ${response.status}`)
    return { success: true, output: {}, message: "Role deleted successfully" }
  } catch (error: any) {
    return { success: false, output: {}, message: error.message || "Failed to delete role" }
  }
}

/**
 * Remove a role from a Discord user
 */
export async function removeDiscordRole(config: any, userId: string, input: Record<string, any>) {
  try {
    const resolvedConfig = resolveValue(config, input)
    const { guildId, userId: targetUserId, roleId } = resolvedConfig
    if (!guildId || !targetUserId || !roleId) throw new Error("Guild ID, User ID, and Role ID are required")
    const botToken = process.env.DISCORD_BOT_TOKEN
    if (!botToken) throw new Error("Discord bot token not configured")
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${targetUserId}/roles/${roleId}`, {
      method: "DELETE",
      headers: { Authorization: `Bot ${botToken}` }
    })
    if (!response.ok) throw new Error(`Failed to remove role: ${response.status}`)
    return { success: true, output: {}, message: `Role removed from user ${targetUserId}` }
  } catch (error: any) {
    return { success: false, output: {}, message: error.message || "Failed to remove role" }
  }
}

/**
 * Kick a member from a guild
 */
export async function kickDiscordMember(config: any, userId: string, input: Record<string, any>) {
  try {
    const resolvedConfig = resolveValue(config, input)
    const { guildId, userId: targetUserId, reason } = resolvedConfig
    if (!guildId || !targetUserId) throw new Error("Guild ID and User ID are required")
    const botToken = process.env.DISCORD_BOT_TOKEN
    if (!botToken) throw new Error("Discord bot token not configured")
    const url = `https://discord.com/api/v10/guilds/${guildId}/members/${targetUserId}`
    const response = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bot ${botToken}` , ...(reason ? { "X-Audit-Log-Reason": encodeURIComponent(reason) } : {}) }
    })
    if (!response.ok) throw new Error(`Failed to kick member: ${response.status}`)
    return { success: true, output: {}, message: `Member ${targetUserId} kicked from guild` }
  } catch (error: any) {
    return { success: false, output: {}, message: error.message || "Failed to kick member" }
  }
}

/**
 * Ban a member from a guild
 */
export async function banDiscordMember(config: any, userId: string, input: Record<string, any>) {
  try {
    const resolvedConfig = resolveValue(config, input)
    const { guildId, userId: targetUserId, deleteMessageSeconds = 0, reason } = resolvedConfig
    if (!guildId || !targetUserId) throw new Error("Guild ID and User ID are required")
    const botToken = process.env.DISCORD_BOT_TOKEN
    if (!botToken) throw new Error("Discord bot token not configured")
    const url = `https://discord.com/api/v10/guilds/${guildId}/bans/${targetUserId}?delete_message_seconds=${deleteMessageSeconds}`
    const response = await fetch(url, {
      method: "PUT",
      headers: { Authorization: `Bot ${botToken}` , ...(reason ? { "X-Audit-Log-Reason": encodeURIComponent(reason) } : {}) }
    })
    if (!response.ok) throw new Error(`Failed to ban member: ${response.status}`)
    return { success: true, output: {}, message: `Member ${targetUserId} banned from guild` }
  } catch (error: any) {
    return { success: false, output: {}, message: error.message || "Failed to ban member" }
  }
}

/**
 * Unban a member from a guild
 */
export async function unbanDiscordMember(config: any, userId: string, input: Record<string, any>) {
  try {
    const resolvedConfig = resolveValue(config, input)
    const { guildId, userId: targetUserId, reason } = resolvedConfig
    if (!guildId || !targetUserId) throw new Error("Guild ID and User ID are required")
    const botToken = process.env.DISCORD_BOT_TOKEN
    if (!botToken) throw new Error("Discord bot token not configured")
    const url = `https://discord.com/api/v10/guilds/${guildId}/bans/${targetUserId}`
    const response = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bot ${botToken}` , ...(reason ? { "X-Audit-Log-Reason": encodeURIComponent(reason) } : {}) }
    })
    if (!response.ok) throw new Error(`Failed to unban member: ${response.status}`)
    return { success: true, output: {}, message: `Member ${targetUserId} unbanned from guild` }
  } catch (error: any) {
    return { success: false, output: {}, message: error.message || "Failed to unban member" }
  }
}
