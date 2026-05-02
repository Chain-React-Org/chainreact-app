import { ExecutionContext } from "../workflowExecutionService"
import { executeAction } from "@/lib/workflows/executeNode"

import { logger } from '@/lib/utils/logger'

export class SlackIntegrationService {
  private dispatch(node: any, context: ExecutionContext) {
    return executeAction({
      node,
      input: context.data,
      userId: context.userId,
      workflowId: context.workflowId,
    })
  }

  async execute(node: any, context: ExecutionContext): Promise<any> {
    const nodeType = node.data.type

    switch (nodeType) {
      case "slack_send_message":
      case "slack_action_send_message": // Handle both naming conventions
        return await this.executeSendMessage(node, context)
      case "slack_send_dm":
        return await this.executeSendDirectMessage(node, context)
      case "slack_create_channel":
      case "slack_action_create_channel": // Handle both naming conventions
        return await this.executeCreateChannel(node, context)
      case "slack_invite_user":
        return await this.executeInviteUser(node, context)
      case "slack_set_status":
        return await this.executeSetStatus(node, context)
      default:
        throw new Error(`Unknown Slack action: ${nodeType}`)
    }
  }

  private async executeSendMessage(node: any, context: ExecutionContext) {
    logger.info("💬 Executing Slack send message")
    
    const config = node.data.config || {}
    const channel = this.resolveValue(config.channel, context)
    const message = this.resolveValue(config.message || config.text, context)
    const username = this.resolveValue(config.username, context)
    const iconEmoji = this.resolveValue(config.icon_emoji, context)

    if (!channel || !message) {
      throw new Error("Slack send message requires 'channel' and 'message' fields")
    }

    if (context.testMode) {
      return {
        type: "slack_send_message",
        channel,
        message,
        username,
        iconEmoji,
        status: "sent (test mode)",
        timestamp: new Date().toISOString()
      }
    }

    return await this.dispatch(node, context)
  }

  private async executeSendDirectMessage(node: any, context: ExecutionContext) {
    logger.info("💬 Executing Slack send direct message")
    
    const config = node.data.config || {}
    const user = this.resolveValue(config.user || config.userId, context)
    const message = this.resolveValue(config.message || config.text, context)

    if (!user || !message) {
      throw new Error("Slack send DM requires 'user' and 'message' fields")
    }

    if (context.testMode) {
      return {
        type: "slack_send_dm",
        user,
        message,
        status: "sent (test mode)",
        timestamp: new Date().toISOString()
      }
    }

    return await this.dispatch(node, context)
  }

  private async executeCreateChannel(node: any, context: ExecutionContext) {
    logger.info("🆕 Executing Slack create channel")
    
    const config = node.data.config || {}
    const name = this.resolveValue(config.name, context)
    const isPrivate = this.resolveValue(config.is_private || config.private, context) || false
    const topic = this.resolveValue(config.topic, context)
    const purpose = this.resolveValue(config.purpose, context)

    if (!name) {
      throw new Error("Slack create channel requires 'name' field")
    }

    if (context.testMode) {
      return {
        type: "slack_create_channel",
        name,
        isPrivate,
        topic,
        purpose,
        status: "created (test mode)",
        channelId: "test-channel-id"
      }
    }

    return await this.dispatch(node, context)
  }

  private async executeInviteUser(node: any, context: ExecutionContext) {
    logger.info("➕ Executing Slack invite user")
    
    const config = node.data.config || {}
    const channel = this.resolveValue(config.channel, context)
    const user = this.resolveValue(config.user || config.userId, context)

    if (!channel || !user) {
      throw new Error("Slack invite user requires 'channel' and 'user' fields")
    }

    if (context.testMode) {
      return {
        type: "slack_invite_user",
        channel,
        user,
        status: "invited (test mode)"
      }
    }

    return await this.dispatch(node, context)
  }

  private async executeSetStatus(node: any, context: ExecutionContext) {
    logger.info("📊 Executing Slack set status")
    
    const config = node.data.config || {}
    const statusText = this.resolveValue(config.status_text || config.text, context)
    const statusEmoji = this.resolveValue(config.status_emoji || config.emoji, context)
    const statusExpiration = this.resolveValue(config.status_expiration, context)

    if (!statusText) {
      throw new Error("Slack set status requires 'status_text' field")
    }

    if (context.testMode) {
      return {
        type: "slack_set_status",
        statusText,
        statusEmoji,
        statusExpiration,
        status: "set (test mode)"
      }
    }

    return await this.dispatch(node, context)
  }

  private resolveValue(value: any, context: ExecutionContext): any {
    if (typeof value === 'string' && context.dataFlowManager) {
      return context.dataFlowManager.resolveVariable(value)
    }
    return value
  }
}