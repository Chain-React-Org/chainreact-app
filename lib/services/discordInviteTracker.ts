import { Client, GuildMember, Invite, Collection } from "discord.js"
import { createSupabaseServiceClient } from "@/utils/supabase/server"

import { logger } from '@/lib/utils/logger'

interface InviteData {
  code: string
  uses: number
  inviterId?: string
  maxUses?: number
  maxAge?: number
  channelId?: string
  channelName?: string
}

function normalizeInviteCode(value?: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null

  // Remove protocol if provided
  const withoutProtocol = trimmed.replace(/^https?:\/\//i, '')
  const segments = withoutProtocol.split('/')
  const lastSegment = segments[segments.length - 1]
  if (!lastSegment) return null

  const code = lastSegment.split('?')[0].split('#')[0]
  return code || null
}

class DiscordInviteTracker {
  private client: Client
  private inviteCache: Map<string, Map<string, InviteData>> = new Map()
  private isInitialized: boolean = false
  private static instance: DiscordInviteTracker | null = null

  private constructor() {
    this.client = new Client({
      intents: [
        "Guilds",
        "GuildMembers",
        "GuildInvites",
        "GuildMessages",
        "MessageContent"
      ]
    })

    this.setupEventListeners()
  }

  static getInstance(): DiscordInviteTracker {
    if (!DiscordInviteTracker.instance) {
      DiscordInviteTracker.instance = new DiscordInviteTracker()
    }
    return DiscordInviteTracker.instance
  }

  private setupEventListeners() {
    // Bot is ready
    this.client.once("ready", async () => {
      logger.info(`Discord Invite Tracker Bot logged in as ${this.client.user?.tag}`)
      await this.cacheAllInvites()
      this.isInitialized = true
    })

    // Cache invites when bot joins a new guild
    this.client.on("guildCreate", async (guild) => {
      await this.cacheGuildInvites(guild.id)
    })

    // Update cache when new invite is created
    this.client.on("inviteCreate", async (invite) => {
      if (!invite.guild) return

      const guildInvites = this.inviteCache.get(invite.guild.id) || new Map()
      guildInvites.set(invite.code, {
        code: invite.code,
        uses: invite.uses || 0,
        inviterId: invite.inviter?.id,
        maxUses: invite.maxUses || undefined,
        maxAge: invite.maxAge || undefined,
        channelId: invite.channel?.id,
        channelName: invite.channel?.name || invite.channel?.id
      })
      this.inviteCache.set(invite.guild.id, guildInvites)
    })

    // Remove from cache when invite is deleted
    this.client.on("inviteDelete", (invite) => {
      if (!invite.guild) return

      const guildInvites = this.inviteCache.get(invite.guild.id)
      if (guildInvites) {
        guildInvites.delete(invite.code)
      }
    })

    // Track when a member joins
    this.client.on("guildMemberAdd", async (member: GuildMember) => {
      await this.handleMemberJoin(member)
    })
  }

  private async cacheAllInvites() {
    const guilds = this.client.guilds.cache
    for (const [guildId] of guilds) {
      await this.cacheGuildInvites(guildId)
    }
  }

  private async cacheGuildInvites(guildId: string) {
    try {
      const guild = await this.client.guilds.fetch(guildId)
      const invites = await guild.invites.fetch()

      const inviteMap = new Map<string, InviteData>()
      invites.forEach((invite) => {
        inviteMap.set(invite.code, {
          code: invite.code,
          uses: invite.uses || 0,
          inviterId: invite.inviter?.id,
          maxUses: invite.maxUses || undefined,
          maxAge: invite.maxAge || undefined,
          channelId: invite.channel?.id,
          channelName: invite.channel?.name || invite.channel?.id
        })
      })

      this.inviteCache.set(guildId, inviteMap)
    } catch (error) {
      logger.error(`Failed to cache invites for guild ${guildId}:`, error)
    }
  }

  private async handleMemberJoin(member: GuildMember) {
    try {
      const guildId = member.guild.id
      const oldInvites = this.inviteCache.get(guildId)
      if (!oldInvites) return

      // Fetch current invites
      const currentInvites = await member.guild.invites.fetch()

      // Find which invite was used by comparing uses
      let usedInvite: Invite | undefined

      currentInvites.forEach((invite) => {
        const oldInvite = oldInvites.get(invite.code)
        if (oldInvite && invite.uses && invite.uses > oldInvite.uses) {
          usedInvite = invite
        }
      })

      // Update cache with new invite data
      const newInviteMap = new Map<string, InviteData>()
      currentInvites.forEach((invite) => {
        newInviteMap.set(invite.code, {
          code: invite.code,
          uses: invite.uses || 0,
          inviterId: invite.inviter?.id,
          maxUses: invite.maxUses || undefined,
          maxAge: invite.maxAge || undefined,
          channelId: invite.channel?.id,
          channelName: invite.channel?.name || invite.channel?.id
        })
      })
      this.inviteCache.set(guildId, newInviteMap)

      if (usedInvite) {
        const normalizedCode = normalizeInviteCode(usedInvite.code) || usedInvite.code
        logger.info(`Member ${member.user.tag} joined using invite ${normalizedCode}`)

        // Check for role assignment based on invite
        await this.assignRoleBasedOnInvite(member, normalizedCode)

        // Trigger workflows for member join with invite data
        await this.triggerMemberJoinWorkflow(member, usedInvite)
      } else {
        // Check if it's a vanity URL or direct invite
        logger.info(`Member ${member.user.tag} joined but couldn't determine invite used`)

        // Still trigger workflow but without invite data
        await this.triggerMemberJoinWorkflow(member, null)
      }
    } catch (error) {
      logger.error("Error handling member join:", error)
    }
  }

  private async assignRoleBasedOnInvite(member: GuildMember, inviteCode: string) {
    try {
      const supabase = await createSupabaseServiceClient()

      const normalizedInviteCode = normalizeInviteCode(inviteCode)
      if (!normalizedInviteCode) {
        return
      }

      // Check for hardcoded config first (for internal use)
      if (
        process.env.DISCORD_AUTO_ROLE_INVITE &&
        process.env.DISCORD_AUTO_ROLE_ID &&
        process.env.DISCORD_GUILD_ID &&
        normalizeInviteCode(process.env.DISCORD_AUTO_ROLE_INVITE) === normalizedInviteCode &&
        member.guild.id === process.env.DISCORD_GUILD_ID
      ) {
        const roleId = process.env.DISCORD_AUTO_ROLE_ID

        try {
          await member.roles.add(roleId)
          logger.info(`Assigned role ${roleId} to ${member.user.tag} via hardcoded config`)
        } catch (error) {
          logger.error(`Failed to assign role ${roleId}:`, error)
        }
        return
      }

      // Check database for invite-role mapping
      const { data: mapping } = await supabase
        .from("discord_invite_roles")
        .select("role_id")
        .eq("server_id", member.guild.id)
        .eq("invite_code", normalizedInviteCode)
        .single()

      if (mapping) {
        try {
          await member.roles.add(mapping.role_id)
          logger.info(`Assigned role ${mapping.role_id} to ${member.user.tag} based on invite ${inviteCode}`)
        } catch (error) {
          logger.error(`Failed to assign role ${mapping.role_id}:`, error)
        }
      }
    } catch (error) {
      logger.error("Error assigning role based on invite:", error)
    }
  }

  private async triggerMemberJoinWorkflow(member: GuildMember, invite: Invite | null) {
    try {
      const supabase = await createSupabaseServiceClient()

      // Find trigger nodes with Discord member join trigger type from normalized table
      const { data: triggerNodes, error: nodesError } = await supabase
        .from("workflow_nodes")
        .select("id, workflow_id, node_type, label, config, is_trigger")
        .eq("node_type", "discord_trigger_member_join")
        .eq("is_trigger", true)

      if (nodesError) {
        logger.error('[Discord] Failed to load member join trigger nodes:', nodesError)
        return
      }

      if (!triggerNodes || triggerNodes.length === 0) return

      // Get unique workflow IDs
      const workflowIds = [...new Set(triggerNodes.map(n => n.workflow_id))]

      // Load workflows that are active
      const { data: workflows, error: workflowsError } = await supabase
        .from("workflows")
        .select("id, name, user_id, status")
        .in("id", workflowIds)
        .eq("status", "active")

      if (workflowsError) {
        logger.error('[Discord] Failed to load member join workflows:', workflowsError)
        return
      }

      logger.info('[Discord] Evaluating member join workflows', {
        workflowsCount: workflows?.length || 0,
        guildId: member.guild.id
      })

      if (!workflows || workflows.length === 0) return

      // Map trigger nodes by workflow ID for quick lookup
      const triggerNodesByWorkflow = new Map<string, any[]>()
      for (const node of triggerNodes) {
        if (!triggerNodesByWorkflow.has(node.workflow_id)) {
          triggerNodesByWorkflow.set(node.workflow_id, [])
        }
        triggerNodesByWorkflow.get(node.workflow_id)!.push({
          id: node.id,
          type: node.node_type,
          data: {
            type: node.node_type,
            label: node.label,
            config: node.config || {},
            isTrigger: node.is_trigger,
            ...(node.config || {}) // Hoist config fields to top-level data so handlers that read node.data.X directly still work alongside ones that read node.data.config.X
          }
        })
      }

      // Prepare trigger data
      const inviteCode = normalizeInviteCode(invite?.code || undefined)
      const triggerData = {
        memberId: member.id,
        memberTag: member.user.tag,
        memberUsername: member.user.username,
        memberDiscriminator: member.user.discriminator,
        memberAvatar: member.user.avatar,
        guildId: member.guild.id,
        guildName: member.guild.name,
        joinedAt: member.joinedAt?.toISOString(),
        inviteCode: inviteCode,
        inviteUrl: inviteCode ? `https://discord.gg/${inviteCode}` : null,
        inviterTag: invite?.inviter?.tag || null,
        inviterId: invite?.inviter?.id || null,
        inviteUses: invite?.uses || null,
        inviteMaxUses: invite?.maxUses || null,
        inviteChannelId: invite?.channel?.id || null,
        inviteChannelName: invite?.channel?.name || invite?.channel?.id || null,
        timestamp: new Date().toISOString()
      }

      // Execute workflows
      for (const workflow of workflows) {
        // Get trigger node for this workflow
        const workflowTriggerNodes = triggerNodesByWorkflow.get(workflow.id) || []
        const triggerNode = workflowTriggerNodes.find((n: any) => n.type === "discord_trigger_member_join")
        if (!triggerNode) continue

        // Check if guild matches (if specified in trigger config)
        if (triggerNode.data?.guildId && triggerNode.data.guildId !== member.guild.id) {
          logger.info('[Discord] Skipping workflow due to guild mismatch', {
            workflowId: workflow.id,
            expected: triggerNode.data.guildId,
            actual: member.guild.id
          })
          continue
        }

        // Check invite filter if specified
        const filterCode = normalizeInviteCode(triggerNode.data?.inviteFilter)
        if (filterCode && filterCode !== inviteCode) {
          logger.info('[Discord] Skipping workflow due to invite filter mismatch', {
            workflowId: workflow.id,
            expected: filterCode,
            actual: inviteCode
          })
          continue
        }

        // Check channel filter if specified
        const channelFilter = triggerNode.data?.channelFilter
        if (channelFilter && channelFilter !== triggerData.inviteChannelId) {
          logger.info('[Discord] Skipping workflow due to channel filter mismatch', {
            workflowId: workflow.id,
            expected: channelFilter,
            actual: triggerData.inviteChannelId
          })
          continue
        }

        // Execute workflow
        try {
          const { AdvancedExecutionEngine } = await import('@/lib/execution/advancedExecutionEngine')
          const executionEngine = new AdvancedExecutionEngine()
          const executionSession = await executionEngine.createExecutionSession(
            workflow.id,
            workflow.user_id,
            'webhook',
            {
              inputData: triggerData,
              webhookEvent: {
                provider: 'discord',
                changeType: 'member_join',
                metadata: triggerData,
                event: triggerData
              }
            }
          )

          await executionEngine.executeWorkflowAdvanced(executionSession.id, triggerData)
          logger.info('[Discord] Workflow triggered successfully for member join', {
            workflowId: workflow.id,
            memberId: member.id,
            inviteCode
          })
        } catch (executionError) {
          logger.error(`Failed to execute workflow ${workflow.id} for member join`, executionError)
        }
      }
    } catch (error) {
      logger.error("Error triggering member join workflow:", error)
    }
  }

  async initialize() {
    if (this.isInitialized) {
      logger.info("Discord Invite Tracker already initialized")
      return
    }

    const token = process.env.DISCORD_BOT_TOKEN
    if (!token) {
      logger.error("Discord bot token not found in environment variables")
      return
    }

    try {
      await this.client.login(token)
    } catch (error) {
      logger.error("Failed to initialize Discord Invite Tracker:", error)
    }
  }

  async shutdown() {
    if (this.client) {
      await this.client.destroy()
      this.isInitialized = false
    }
  }

  // Public method to get current invite data for a guild
  async getGuildInvites(guildId: string): Promise<InviteData[]> {
    const invites = this.inviteCache.get(guildId)
    return invites ? Array.from(invites.values()) : []
  }

  // Public method to manually refresh invite cache for a guild
  async refreshGuildInvites(guildId: string) {
    await this.cacheGuildInvites(guildId)
  }
}

export const discordInviteTracker = DiscordInviteTracker.getInstance()
