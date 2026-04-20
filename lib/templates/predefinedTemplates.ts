import type {
  AirtableFieldSchema,
  AirtableTableSchema,
  TemplateIntegrationSetup,
} from '@/types/templateSetup'

export interface PredefinedTemplate {
  id: string
  name: string
  description: string
  category: string
  tags: string[]
  integrations: string[]
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  estimatedTime: string // e.g., "5 mins", "15 mins"
  workflow_json: {
    nodes: any[]
    edges: any[]
  }
  airtableSetup?: {
    baseName: string // Suggested base name
    copyUrl?: string
    tables: AirtableTableSchema[]
  }
  integrationSetups?: TemplateIntegrationSetup[]
}

export const predefinedTemplates: PredefinedTemplate[] = [
  // ============== AI AGENT TESTING TEMPLATES ==============

  // AI Agent Complete Test Workflow
  {
    id: "ai-agent-test-workflow",
    name: "AI Agent Test Workflow - Customer Service",
    description: "Classifies Discord support messages with AI, then creates Airtable records, sends notifications, or emails based on the route.",
    category: "AI Automation",
    tags: ["ai-router", "ai-message", "airtable", "discord", "gmail"],
    integrations: ["airtable", "discord", "gmail"],
    difficulty: "intermediate",
    estimatedTime: "6 mins",
    workflow_json: {
      nodes: [
        {
          id: "discord-trigger-1",
          type: "discord_trigger_new_message",
          position: { x: 100, y: 300 },
          data: {
            type: "discord_trigger_new_message",
            title: "New Discord Message",
            config: {
              channelId: "",
              includeBot: false
            },
            isTrigger: true,
            needsConfiguration: true
          }
        },
        {
          id: "ai-router-helpdesk",
          type: "ai_router",
          position: { x: 380, y: 300 },
          data: {
            type: "ai_router",
            title: "Route Customer Request",
            config: {
              template: "custom",
              systemPrompt: "You are a customer support triage bot. Classify the incoming Discord message into one of: support_request, feedback, newsletter_signup. Provide a short reason and confidence.",
              model: "gpt-4o-mini",
              apiSource: "chainreact",
              memory: "workflow",
              outputPaths: [
                { id: "support_request", name: "Support Request", description: "Technical help needed", color: "#ef4444", condition: { type: "ai_decision", minConfidence: 0.6 } },
                { id: "feedback", name: "Feedback", description: "Product feedback or ideas", color: "#3b82f6", condition: { type: "ai_decision", minConfidence: 0.6 } },
                { id: "newsletter_signup", name: "Newsletter Signup", description: "Signup or marketing interest", color: "#10b981", condition: { type: "ai_decision", minConfidence: 0.6 } },
                { id: "general", name: "General", description: "Everything else", color: "#6b7280", condition: { type: "fallback" } }
              ],
              decisionMode: "single",
              includeReasoning: true,
              temperature: 0.2,
              maxRetries: 1,
              timeout: 30,
              costLimit: 0.5
            },
            needsConfiguration: false
          }
        },
        {
          id: "ai-message-support",
          type: "ai_message",
          position: { x: 620, y: 120 },
          data: {
            type: "ai_message",
            title: "Summarize Support Request",
            config: {
              model: "gpt-4o-mini",
              apiSource: "chainreact",
              temperature: 0.3,
              contextNodeIds: ["discord-trigger-1"],
              userPrompt: "Discord support request: {{discord-trigger-1.content}}. Summarize the problem, suggest a priority (Low/Medium/High), and craft a short acknowledgement response.",
              outputFields: "summary | Problem summary\npriority | Priority level\nresponse_message | Short acknowledgement message",
              includeRawOutput: false,
              memoryNotes: "Use prior support history if available."
            },
            needsConfiguration: false
          }
        },
        {
          id: "airtable-support-ticket",
          type: "airtable_action_create_record",
          position: { x: 860, y: 120 },
          data: {
            type: "airtable_action_create_record",
            title: "Create Support Ticket",
            config: {
              baseId: "",
              tableName: "",
              fields: {
                "Ticket Summary": "{{ai-message-support.summary}}",
                "Priority": "{{ai-message-support.priority}}",
                "Status": "Open",
                "Channel": "{{discord-trigger-1.channelName}}"
              }
            },
            needsConfiguration: true
          }
        },
        {
          id: "discord-support-response",
          type: "discord_action_send_message",
          position: { x: 1100, y: 120 },
          data: {
            type: "discord_action_send_message",
            title: "Reply in Discord",
            config: {
              webhookUrl: "",
              message: "{{ai-message-support.response_message}}",
              username: "Support Bot"
            },
            needsConfiguration: true
          }
        },
        {
          id: "ai-message-feedback",
          type: "ai_message",
          position: { x: 620, y: 300 },
          data: {
            type: "ai_message",
            title: "Summarize Feedback",
            config: {
              model: "gpt-4o-mini",
              apiSource: "chainreact",
              temperature: 0.4,
              contextNodeIds: ["discord-trigger-1"],
              userPrompt: "Customer feedback message: {{discord-trigger-1.content}}. Extract the main idea and sentiment, and suggest a short acknowledgement.",
              outputFields: "insight | Feedback insight\nsentiment | Sentiment\nacknowledgement | Acknowledgement message",
              includeRawOutput: false
            },
            needsConfiguration: false
          }
        },
        {
          id: "airtable-feedback-log",
          type: "airtable_action_create_record",
          position: { x: 860, y: 300 },
          data: {
            type: "airtable_action_create_record",
            title: "Log Feedback",
            config: {
              baseId: "",
              tableName: "",
              fields: {
                "Feedback Insight": "{{ai-message-feedback.insight}}",
                "Sentiment": "{{ai-message-feedback.sentiment}}",
                "Source": "Discord"
              }
            },
            needsConfiguration: true
          }
        },
        {
          id: "discord-feedback-response",
          type: "discord_action_send_message",
          position: { x: 1100, y: 300 },
          data: {
            type: "discord_action_send_message",
            title: "Acknowledge Feedback",
            config: {
              webhookUrl: "",
              message: "{{ai-message-feedback.acknowledgement}}",
              username: "Feedback Bot"
            },
            needsConfiguration: true
          }
        },
        {
          id: "ai-message-newsletter",
          type: "ai_message",
          position: { x: 620, y: 480 },
          data: {
            type: "ai_message",
            title: "Craft Newsletter Welcome",
            config: {
              model: "gpt-4o-mini",
              apiSource: "chainreact",
              temperature: 0.5,
              contextNodeIds: ["discord-trigger-1"],
              userPrompt: "A Discord user asked about the newsletter: {{discord-trigger-1.content}}. Draft a friendly welcome email body and extract their email if mentioned.",
              outputFields: "welcome_email | Welcome email body\nextracted_email | Email address if present",
              includeRawOutput: true
            },
            needsConfiguration: false
          }
        },
        {
          id: "airtable-newsletter",
          type: "airtable_action_create_record",
          position: { x: 860, y: 480 },
          data: {
            type: "airtable_action_create_record",
            title: "Add Newsletter Subscriber",
            config: {
              baseId: "",
              tableName: "",
              fields: {
                "Name": "",
                "Email": "{{ai-message-newsletter.extracted_email}}",
                "Source": "Discord",
                "Status": "Subscribed"
              }
            },
            needsConfiguration: true
          }
        },
        {
          id: "gmail-newsletter-welcome",
          type: "gmail_action_send_email",
          position: { x: 1100, y: 480 },
          data: {
            type: "gmail_action_send_email",
            title: "Send Welcome Email",
            config: {
              to: "{{ai-message-newsletter.extracted_email}}",
              subject: "Welcome to our newsletter!",
              body: "{{ai-message-newsletter.welcome_email}}",
              isHtml: false
            },
            needsConfiguration: true
          }
        },
        {
          id: "discord-general-log",
          type: "discord_action_send_message",
          position: { x: 860, y: 620 },
          data: {
            type: "discord_action_send_message",
            title: "General Log",
            config: {
              webhookUrl: "",
              message: "General inquiry from {{discord-trigger-1.authorName}}: {{discord-trigger-1.content}}",
              username: "Support Bot"
            },
            needsConfiguration: true
          }
        }
      ],
      edges: [
        { id: "edge-main-1", source: "discord-trigger-1", target: "ai-router-helpdesk" },
        { id: "edge-support-1", source: "ai-router-helpdesk", target: "ai-message-support", sourceHandle: "support_request" },
        { id: "edge-support-2", source: "ai-message-support", target: "airtable-support-ticket" },
        { id: "edge-support-3", source: "airtable-support-ticket", target: "discord-support-response" },
        { id: "edge-feedback-1", source: "ai-router-helpdesk", target: "ai-message-feedback", sourceHandle: "feedback" },
        { id: "edge-feedback-2", source: "ai-message-feedback", target: "airtable-feedback-log" },
        { id: "edge-feedback-3", source: "airtable-feedback-log", target: "discord-feedback-response" },
        { id: "edge-newsletter-1", source: "ai-router-helpdesk", target: "ai-message-newsletter", sourceHandle: "newsletter_signup" },
        { id: "edge-newsletter-2", source: "ai-message-newsletter", target: "airtable-newsletter" },
        { id: "edge-newsletter-3", source: "airtable-newsletter", target: "gmail-newsletter-welcome" },
        { id: "edge-general-1", source: "ai-router-helpdesk", target: "discord-general-log", sourceHandle: "general" }
      ]
    },
    airtableSetup: {
      baseName: "Customer Service Automation",
      copyUrl: "https://airtable.com/appGadmc5iofbblAF/shrA0WFxEyMspzon5/tbltP3UGYxaQW5y8b/viw9lF6mS4W38LxFv",
      tables: [
        {
          tableName: "Support Tickets",
          description: "Tracks support requests routed by AI",
          fields: [
            {
              name: "Ticket Summary",
              type: "longText",
              description: "AI-generated summary of the support request"
            },
            {
              name: "Priority",
              type: "singleSelect",
              options: ["Low", "Medium", "High"],
              description: "Priority level assigned by AI"
            },
            {
              name: "Status",
              type: "singleSelect",
              options: ["Open", "In Progress", "Resolved", "Closed"],
              description: "Current status of the ticket"
            },
            {
              name: "Channel",
              type: "singleLineText",
              description: "Source channel (e.g., Discord channel name)"
            }
          ]
        },
          {
            tableName: "Feedback Log",
            description: "Captures customer feedback messages",
            fields: [
              {
                name: "Feedback Insight",
                type: "longText",
                description: "AI-extracted main insight from feedback"
              },
              {
                name: "Feedback Summary",
                type: "longText",
                description: "Short summary of the feedback message"
              },
              {
                name: "Customer",
                type: "singleLineText",
                description: "Name or handle of the customer who shared the feedback"
              },
              {
                name: "Sentiment",
                type: "singleSelect",
                options: ["Positive", "Neutral", "Negative"],
                description: "Sentiment analysis (e.g., Positive, Negative, Neutral)"
              },
              {
                name: "Confidence",
                type: "number",
                description: "General AI confidence score for this classification"
              },
              {
                name: "Source",
                type: "singleLineText",
                description: "Origin of feedback (e.g., Discord)"
              }
            ]
          },
        {
          tableName: "Newsletter Subscribers",
          description: "Manages newsletter subscription requests",
          fields: [
            {
              name: "Name",
              type: "singleLineText",
              description: "Subscriber's name"
            },
            {
              name: "Email",
              type: "email",
              description: "Subscriber's email address"
            },
            {
              name: "Source",
              type: "singleLineText",
              description: "Where the signup came from (e.g., Discord)"
            },
            {
              name: "Status",
              type: "singleSelect",
              options: ["Subscribed", "Unsubscribed", "Pending"],
              description: "Current subscription status"
            }
          ]
        }
      ]
    },
    integrationSetups: [
      {
        type: "airtable",
        baseName: "Customer Service Automation",
        copyUrl: "https://airtable.com/appGadmc5iofbblAF/shrA0WFxEyMspzon5/tbltP3UGYxaQW5y8b/viw9lF6mS4W38LxFv",
        instructions: [
          "Click \"Duplicate Template Base\" below to open Airtable, then press Copy Base at the top of the page and choose the workspace that should own it.",
          "Confirm the Support Tickets, Feedback Log, and Newsletter Subscribers tables appear in the copied base.",
          "Import the CSV files below (or rebuild the fields manually) before you run the workflow."
        ],
        tables: [
          {
            tableName: "Support Tickets",
            description: "Tracks support requests routed by AI",
            fields: [
              {
                name: "Ticket Summary",
                type: "longText",
                description: "AI-generated summary of the support request"
              },
              {
                name: "Priority",
                type: "singleSelect",
                options: ["Low", "Medium", "High"],
                description: "Priority level assigned by AI"
              },
              {
                name: "Status",
                type: "singleSelect",
                options: ["Open", "In Progress", "Resolved", "Closed"],
                description: "Current status of the ticket"
              },
              {
                name: "Channel",
                type: "singleLineText",
                description: "Source channel (e.g., Discord channel name)"
              }
            ]
          },
          {
            tableName: "Feedback Log",
            description: "Captures customer feedback messages",
            fields: [
              {
                name: "Feedback Insight",
                type: "longText",
                description: "AI-extracted main insight from feedback"
              },
              {
                name: "Feedback Summary",
                type: "longText",
                description: "Short summary of the feedback message"
              },
              {
                name: "Customer",
                type: "singleLineText",
                description: "Name or handle of the customer who shared the feedback"
              },
              {
                name: "Sentiment",
                type: "singleSelect",
                options: ["Positive", "Neutral", "Negative"],
                description: "Sentiment analysis (e.g., Positive, Negative, Neutral)"
              },
              {
                name: "Confidence",
                type: "number",
                description: "General AI confidence score for this classification"
              },
              {
                name: "Source",
                type: "singleLineText",
                description: "Origin of feedback (e.g., Discord)"
              }
            ]
          },
          {
            tableName: "Newsletter Subscribers",
            description: "Manages newsletter subscription requests",
            fields: [
              {
                name: "Name",
                type: "singleLineText",
                description: "Subscriber's name"
              },
              {
                name: "Email",
                type: "email",
                description: "Subscriber's email address"
              },
              {
                name: "Source",
                type: "singleLineText",
                description: "Where the signup came from (e.g., Discord)"
              },
              {
                name: "Status",
                type: "singleSelect",
                options: ["Subscribed", "Unsubscribed", "Pending"],
                description: "Current subscription status"
              }
            ]
          }
        ]
      }
    ]
  },

  // ============== CUSTOMER SERVICE TEMPLATES ==============

  // Discord Customer Support
  {
    id: "discord-customer-support",
    name: "Discord Customer Support Bot",
    description: "Automatically respond to support requests in Discord, create tickets, and escalate to team members",
    category: "Customer Service",
    tags: ["discord", "support", "automation", "tickets"],
    integrations: ["discord", "notion"],
    difficulty: "intermediate",
    estimatedTime: "10 mins",
    workflow_json: {
      nodes: [
        {
          id: "trigger-1",
          type: "discord_trigger_new_message",
          position: { x: 100, y: 100 },
          data: {
            name: "New Discord Message",
            config: {
              channel: "{{DISCORD_CHANNEL_ID}}",
              keywords: ["help", "support", "issue", "problem", "bug"]
            }
          }
        },
        {
          id: "action-1",
          type: "discord_action_send_message",
          position: { x: 300, y: 100 },
          data: {
            name: "Acknowledge Request",
            config: {
              message: "Thank you for reaching out! A support agent will assist you shortly. Ticket #{{RANDOM_ID}} has been created."
            }
          }
        },
        {
          id: "action-2",
          type: "notion_action_create_page",
          position: { x: 500, y: 100 },
          data: {
            name: "Create Support Ticket",
            config: {
              database: "{{NOTION_TICKETS_DB}}",
              properties: {
                title: "Support Request from {{trigger.username}}",
                status: "Open",
                priority: "Medium",
                message: "{{trigger.message}}"
              }
            }
          }
        }
      ],
      edges: [
        { id: "e1", source: "trigger-1", target: "action-1" },
        { id: "e2", source: "action-1", target: "action-2" }
      ]
    }
  },

  // Slack Customer Support
  {
    id: "slack-customer-support",
    name: "Slack Customer Support System",
    description: "Handle customer inquiries in Slack, categorize them, and route to appropriate teams",
    category: "Customer Service",
    tags: ["slack", "support", "routing", "categorization"],
    integrations: ["slack"],
    difficulty: "intermediate",
    estimatedTime: "15 mins",
    workflow_json: {
      nodes: [
        {
          id: "trigger-1",
          type: "slack_trigger_new_message",
          position: { x: 100, y: 120 },
          data: {
            type: "slack_trigger_new_message",
            title: "New Support Request",
            config: {
              channel: "#support"
            },
            isTrigger: true,
            needsConfiguration: true
          }
        },
        {
          id: "ai-router-slack",
          type: "ai_router",
          position: { x: 320, y: 160 },
          data: {
            type: "ai_router",
            title: "Classify Support Request",
            config: {
              template: "custom",
              systemPrompt: "Classify the Slack message into technical, billing, account_access, or general. Return JSON with category and reasoning.",
              model: "gpt-4o-mini",
              apiSource: "chainreact",
              memory: "workflow",
              outputPaths: [
                { id: "technical", name: "Technical", description: "Send to engineering", color: "#3b82f6", condition: { type: "ai_decision", minConfidence: 0.6 } },
                { id: "billing", name: "Billing", description: "Payment or billing issues", color: "#f59e0b", condition: { type: "ai_decision", minConfidence: 0.6 } },
                { id: "account", name: "Account Access", description: "Login or access problem", color: "#10b981", condition: { type: "ai_decision", minConfidence: 0.6 } },
                { id: "general", name: "General", description: "Catch-all", color: "#6b7280", condition: { type: "fallback" } }
              ],
              decisionMode: "single",
              includeReasoning: true,
              temperature: 0.2,
              costLimit: 0.3
            },
            needsConfiguration: false
          }
        },
        {
          id: "slack-route-tech",
          type: "slack_action_send_message",
          position: { x: 560, y: 40 },
          data: {
            type: "slack_action_send_message",
            title: "Notify Tech Team",
            config: {
              channel: "#tech-support",
              message: "🔧 Technical request from {{trigger.user.name}}: {{trigger.text}}"
            },
            needsConfiguration: true
          }
        },
        {
          id: "slack-route-billing",
          type: "slack_action_send_message",
          position: { x: 560, y: 160 },
          data: {
            type: "slack_action_send_message",
            title: "Notify Billing Team",
            config: {
              channel: "#billing-support",
              message: "💳 Billing inquiry from {{trigger.user.name}}: {{trigger.text}}"
            },
            needsConfiguration: true
          }
        },
        {
          id: "slack-route-account",
          type: "slack_action_send_message",
          position: { x: 560, y: 280 },
          data: {
            type: "slack_action_send_message",
            title: "Notify Account Team",
            config: {
              channel: "#account-access",
              message: "🔐 Account access issue for {{trigger.user.name}}: {{trigger.text}}"
            },
            needsConfiguration: true
          }
        },
        {
          id: "slack-route-general",
          type: "slack_action_send_message",
          position: { x: 560, y: 400 },
          data: {
            type: "slack_action_send_message",
            title: "Log General Inquiry",
            config: {
              channel: "#support-queue",
              message: "📝 General inquiry from {{trigger.user.name}}: {{trigger.text}}"
            },
            needsConfiguration: true
          }
        }
      ],
      edges: [
        { id: "e1", source: "trigger-1", target: "ai-router-slack" },
        { id: "e2", source: "ai-router-slack", target: "slack-route-tech", sourceHandle: "technical" },
        { id: "e3", source: "ai-router-slack", target: "slack-route-billing", sourceHandle: "billing" },
        { id: "e4", source: "ai-router-slack", target: "slack-route-account", sourceHandle: "account" },
        { id: "e5", source: "ai-router-slack", target: "slack-route-general", sourceHandle: "general" }
      ]
    }
  },

  // Teams Customer Support
  {
    id: "teams-customer-support",
    name: "Microsoft Teams Support Hub",
    description: "Manage support requests in Teams with automatic ticket creation and status updates",
    category: "Customer Service",
    tags: ["teams", "microsoft", "support", "tickets"],
    integrations: ["teams", "airtable"],
    difficulty: "intermediate",
    estimatedTime: "12 mins",
    workflow_json: {
      nodes: [
        {
          id: "trigger-1",
          type: "teams_trigger_new_message",
          position: { x: 100, y: 100 },
          data: {
            name: "Support Channel Message",
            config: {
              channel: "Support Requests"
            }
          }
        },
        {
          id: "action-1",
          type: "teams_action_send_message",
          position: { x: 300, y: 100 },
          data: {
            name: "Confirm Receipt",
            config: {
              message: "✅ We've received your request and will respond within 2 hours."
            }
          }
        },
        {
          id: "action-2",
          type: "airtable_action_create_record",
          position: { x: 500, y: 100 },
          data: {
            name: "Log Ticket",
            config: {
              table: "Support Tickets",
              fields: {
                "Customer": "{{trigger.user}}",
                "Issue": "{{trigger.message}}",
                "Status": "Open",
                "Created": "{{NOW}}"
              }
            }
          }
        }
      ],
      edges: [
        { id: "e1", source: "trigger-1", target: "action-1" },
        { id: "e2", source: "action-1", target: "action-2" }
      ]
    },
    airtableSetup: {
      baseName: "Teams Support Desk",
      copyUrl: "https://airtable.com/appGadmc5iofbblAF/shrA0WFxEyMspzon5/tbltP3UGYxaQW5y8b/viw9lF6mS4W38LxFv",
      tables: [
        {
          tableName: "Support Tickets",
          description: "Track incoming Microsoft Teams support conversations",
          fields: [
            {
              name: "Customer",
              type: "singleLineText",
              description: "Name of the teammate or customer asking for help"
            },
            {
              name: "Issue",
              type: "longText",
              description: "Full message content captured from Teams"
            },
            {
              name: "Status",
              type: "singleSelect",
              options: ["Open", "In Progress", "Resolved", "Closed"],
              description: "Ticket progress managed by the support team"
            },
            {
              name: "Created",
              type: "date",
              description: "When the ticket was created in Airtable"
            }
          ]
        }
      ]
    },
    integrationSetups: [
      {
        type: "airtable",
        baseName: "Teams Support Desk",
        copyUrl: "https://airtable.com/appGadmc5iofbblAF/shrA0WFxEyMspzon5/tbltP3UGYxaQW5y8b/viw9lF6mS4W38LxFv",
        instructions: [
          "Click \"Duplicate Template Base\" below to open Airtable, then press Copy Base at the top of the page and choose the workspace that should own it.",
          "Confirm the Support Tickets table is in the copied base with the fields listed below.",
          "Import the CSV file below (or rebuild the fields manually) before you run the workflow."
        ],
        tables: [
          {
            tableName: "Support Tickets",
            description: "Track incoming Microsoft Teams support conversations",
            fields: [
              {
                name: "Customer",
                type: "singleLineText",
                description: "Name of the teammate or customer asking for help"
              },
              {
                name: "Issue",
                type: "longText",
                description: "Full message content captured from Teams"
              },
              {
                name: "Status",
                type: "singleSelect",
                options: ["Open", "In Progress", "Resolved", "Closed"],
                description: "Ticket progress managed by the support team"
              },
              {
                name: "Created",
                type: "date",
                description: "When the ticket was created in Airtable"
              }
            ]
          }
        ]
      }
    ]
  },

  // ============== SALES & CRM TEMPLATES ==============

  // Lead Nurturing Pipeline
  {
    id: "lead-nurturing-pipeline",
    name: "Automated Lead Nurturing",
    description: "Automatically nurture leads with personalized email sequences based on their engagement",
    category: "Sales & CRM",
    tags: ["sales", "email", "nurturing", "automation"],
    integrations: ["gmail", "hubspot"],
    difficulty: "advanced",
    estimatedTime: "20 mins",
    workflow_json: {
      nodes: [
        {
          id: "trigger-1",
          type: "hubspot_trigger_new_contact",
          position: { x: 100, y: 100 },
          data: {
            name: "New Lead Added",
            config: {
              list: "New Leads"
            }
          }
        },
        {
          id: "action-1",
          type: "gmail_action_send_email",
          position: { x: 300, y: 100 },
          data: {
            name: "Welcome Email",
            config: {
              to: "{{trigger.email}}",
              subject: "Welcome to {{COMPANY_NAME}}!",
              body: "Hi {{trigger.firstName}}, thank you for your interest..."
            }
          }
        },
        {
          id: "delay-1",
          type: "logic_delay",
          position: { x: 500, y: 100 },
          data: {
            name: "Wait 3 Days",
            config: {
              delay: 259200 // 3 days in seconds
            }
          }
        },
        {
          id: "action-2",
          type: "gmail_action_send_email",
          position: { x: 700, y: 100 },
          data: {
            name: "Follow-up Email",
            config: {
              to: "{{trigger.email}}",
              subject: "Quick question for you",
              body: "Hi {{trigger.firstName}}, I wanted to follow up..."
            }
          }
        }
      ],
      edges: [
        { id: "e1", source: "trigger-1", target: "action-1" },
        { id: "e2", source: "action-1", target: "delay-1" },
        { id: "e3", source: "delay-1", target: "action-2" }
      ]
    }
  },

  // Deal Stage Automation
  {
    id: "deal-stage-automation",
    name: "Deal Stage Automation",
    description: "Automatically update deal stages and notify team members when deals progress",
    category: "Sales & CRM",
    tags: ["crm", "deals", "pipeline", "notifications"],
    integrations: ["hubspot", "slack"],
    difficulty: "intermediate",
    estimatedTime: "15 mins",
    workflow_json: {
      nodes: [
        {
          id: "trigger-1",
          type: "hubspot_trigger_deal_updated",
          position: { x: 100, y: 100 },
          data: {
            name: "Deal Stage Changed",
            config: {
              property: "dealstage"
            }
          }
        },
        {
          id: "condition-1",
          type: "logic_condition",
          position: { x: 300, y: 100 },
          data: {
            name: "Check Stage",
            config: {
              conditions: [
                { field: "{{trigger.dealstage}}", operator: "equals", value: "closedwon" }
              ]
            }
          }
        },
        {
          id: "action-1",
          type: "slack_action_send_message",
          position: { x: 500, y: 50 },
          data: {
            name: "Celebrate Win",
            config: {
              channel: "#sales-wins",
              message: "🎉 Deal closed! {{trigger.dealname}} - ${{trigger.amount}}"
            }
          }
        },
        {
          id: "action-2",
          type: "hubspot_action_create_task",
          position: { x: 500, y: 150 },
          data: {
            name: "Create Onboarding Task",
            config: {
              title: "Start onboarding for {{trigger.dealname}}",
              assignedTo: "{{trigger.owner}}"
            }
          }
        }
      ],
      edges: [
        { id: "e1", source: "trigger-1", target: "condition-1" },
        { id: "e2", source: "condition-1", target: "action-1", sourceHandle: "true" },
        { id: "e3", source: "condition-1", target: "action-2", sourceHandle: "true" }
      ]
    }
  },

  // ============== PRODUCTIVITY TEMPLATES ==============

  // Task Management Automation
  {
    id: "task-management-automation",
    name: "Smart Task Manager",
    description: "Automatically create, assign, and track tasks across different platforms",
    category: "Productivity",
    tags: ["tasks", "project management", "automation", "tracking"],
    integrations: ["trello", "slack", "google_calendar"],
    difficulty: "intermediate",
    estimatedTime: "15 mins",
    workflow_json: {
      nodes: [
        {
          id: "trigger-1",
          type: "gmail_trigger_new_email",
          position: { x: 100, y: 100 },
          data: {
            name: "Task Request Email",
            config: {
              subject: "[TASK]"
            }
          }
        },
        {
          id: "action-1",
          type: "trello_action_create_card",
          position: { x: 300, y: 100 },
          data: {
            name: "Create Trello Card",
            config: {
              board: "{{TRELLO_BOARD_ID}}",
              list: "To Do",
              name: "{{trigger.subject}}",
              description: "{{trigger.body}}"
            }
          }
        },
        {
          id: "action-2",
          type: "google_calendar_action_create_event",
          position: { x: 500, y: 100 },
          data: {
            name: "Add to Calendar",
            config: {
              summary: "Work on: {{trigger.subject}}",
              start: "{{TOMORROW_9AM}}",
              duration: 60
            }
          }
        },
        {
          id: "action-3",
          type: "slack_action_send_message",
          position: { x: 700, y: 100 },
          data: {
            name: "Notify Team",
            config: {
              channel: "#tasks",
              message: "New task created: {{trigger.subject}} - assigned to {{trigger.assignee}}"
            }
          }
        }
      ],
      edges: [
        { id: "e1", source: "trigger-1", target: "action-1" },
        { id: "e2", source: "action-1", target: "action-2" },
        { id: "e3", source: "action-2", target: "action-3" }
      ]
    }
  },

  // Meeting Notes Organizer
  {
    id: "meeting-notes-organizer",
    name: "Meeting Notes Automation",
    description: "Automatically organize and distribute meeting notes after calendar events",
    category: "Productivity",
    tags: ["meetings", "notes", "organization", "distribution"],
    integrations: ["google_calendar", "notion", "gmail"],
    difficulty: "intermediate",
    estimatedTime: "10 mins",
    workflow_json: {
      nodes: [
        {
          id: "trigger-1",
          type: "google_calendar_trigger_event_ended",
          position: { x: 100, y: 100 },
          data: {
            name: "Meeting Ended",
            config: {}
          }
        },
        {
          id: "action-1",
          type: "notion_action_create_page",
          position: { x: 300, y: 100 },
          data: {
            name: "Create Notes Page",
            config: {
              database: "{{MEETING_NOTES_DB}}",
              properties: {
                title: "{{trigger.summary}} - {{trigger.date}}",
                attendees: "{{trigger.attendees}}",
                date: "{{trigger.date}}"
              }
            }
          }
        },
        {
          id: "action-2",
          type: "gmail_action_send_email",
          position: { x: 500, y: 100 },
          data: {
            name: "Send Notes Link",
            config: {
              to: "{{trigger.attendees}}",
              subject: "Meeting Notes: {{trigger.summary}}",
              body: "Meeting notes are available here: {{action-1.url}}"
            }
          }
        }
      ],
      edges: [
        { id: "e1", source: "trigger-1", target: "action-1" },
        { id: "e2", source: "action-1", target: "action-2" }
      ]
    }
  },

  // ============== DATA SYNC TEMPLATES ==============

  // CRM to Spreadsheet Sync
  {
    id: "crm-spreadsheet-sync",
    name: "CRM to Spreadsheet Sync",
    description: "Keep Google Sheets synchronized with your CRM data",
    category: "Data Sync",
    tags: ["sync", "crm", "spreadsheet", "data"],
    integrations: ["hubspot", "google_sheets"],
    difficulty: "intermediate",
    estimatedTime: "10 mins",
    workflow_json: {
      nodes: [
        {
          id: "trigger-1",
          type: "schedule_trigger",
          position: { x: 100, y: 100 },
          data: {
            name: "Daily Sync",
            config: {
              cron: "0 0 * * *" // Midnight daily
            }
          }
        },
        {
          id: "action-1",
          type: "hubspot_action_get_contacts",
          position: { x: 300, y: 100 },
          data: {
            name: "Get All Contacts",
            config: {
              limit: 1000
            }
          }
        },
        {
          id: "loop-1",
          type: "logic_loop",
          position: { x: 500, y: 100 },
          data: {
            name: "Process Each Contact",
            config: {
              items: "{{action-1.contacts}}"
            }
          }
        },
        {
          id: "action-2",
          type: "google_sheets_action_update_row",
          position: { x: 700, y: 100 },
          data: {
            name: "Update Sheet",
            config: {
              spreadsheet: "{{SYNC_SHEET_ID}}",
              sheet: "Contacts",
              key: "email",
              data: {
                "Email": "{{loop-1.item.email}}",
                "Name": "{{loop-1.item.name}}",
                "Company": "{{loop-1.item.company}}",
                "Last Updated": "{{NOW}}"
              }
            }
          }
        }
      ],
      edges: [
        { id: "e1", source: "trigger-1", target: "action-1" },
        { id: "e2", source: "action-1", target: "loop-1" },
        { id: "e3", source: "loop-1", target: "action-2", sourceHandle: "loop" }
      ]
    }
  },

  // Database Backup Automation
  {
    id: "database-backup",
    name: "Automated Database Backup",
    description: "Regularly backup your Airtable or Notion databases to Google Drive",
    category: "Data Sync",
    tags: ["backup", "database", "automation", "storage"],
    integrations: ["airtable", "google_drive"],
    difficulty: "advanced",
    estimatedTime: "15 mins",
    workflow_json: {
      nodes: [
        {
          id: "trigger-1",
          type: "schedule_trigger",
          position: { x: 100, y: 100 },
          data: {
            name: "Weekly Backup",
            config: {
              cron: "0 0 * * 0" // Sunday midnight
            }
          }
        },
        {
          id: "action-1",
          type: "airtable_action_export_base",
          position: { x: 300, y: 100 },
          data: {
            name: "Export Airtable",
            config: {
              base: "{{AIRTABLE_BASE_ID}}",
              format: "csv"
            }
          }
        },
        {
          id: "action-2",
          type: "google_drive_action_upload_file",
          position: { x: 500, y: 100 },
          data: {
            name: "Upload to Drive",
            config: {
              folder: "Backups",
              filename: "airtable_backup_{{DATE}}.csv",
              content: "{{action-1.data}}"
            }
          }
        },
        {
          id: "action-3",
          type: "gmail_action_send_email",
          position: { x: 700, y: 100 },
          data: {
            name: "Confirm Backup",
            config: {
              to: "{{ADMIN_EMAIL}}",
              subject: "Backup Completed - {{DATE}}",
              body: "Database backup completed successfully. File: {{action-2.url}}"
            }
          }
        }
      ],
      edges: [
        { id: "e1", source: "trigger-1", target: "action-1" },
        { id: "e2", source: "action-1", target: "action-2" },
        { id: "e3", source: "action-2", target: "action-3" }
      ]
    }
  },

  // ============== NOTIFICATION TEMPLATES ==============

  // Multi-Channel Alert System
  {
    id: "multi-channel-alerts",
    name: "Multi-Channel Alert System",
    description: "Send critical alerts across multiple channels simultaneously",
    category: "Notifications",
    tags: ["alerts", "monitoring", "notifications", "critical"],
    integrations: ["slack", "discord", "teams", "gmail"],
    difficulty: "beginner",
    estimatedTime: "8 mins",
    workflow_json: {
      nodes: [
        {
          id: "trigger-1",
          type: "webhook_trigger",
          position: { x: 100, y: 100 },
          data: {
            name: "Alert Webhook",
            config: {}
          }
        },
        {
          id: "action-1",
          type: "slack_action_send_message",
          position: { x: 300, y: 50 },
          data: {
            name: "Slack Alert",
            config: {
              channel: "#alerts",
              message: "🚨 ALERT: {{trigger.message}}"
            }
          }
        },
        {
          id: "action-2",
          type: "discord_action_send_message",
          position: { x: 300, y: 150 },
          data: {
            name: "Discord Alert",
            config: {
              channel: "alerts",
              message: "🚨 ALERT: {{trigger.message}}"
            }
          }
        },
        {
          id: "action-3",
          type: "teams_action_send_message",
          position: { x: 300, y: 250 },
          data: {
            name: "Teams Alert",
            config: {
              channel: "Alerts",
              message: "🚨 ALERT: {{trigger.message}}"
            }
          }
        },
        {
          id: "action-4",
          type: "gmail_action_send_email",
          position: { x: 300, y: 350 },
          data: {
            name: "Email Alert",
            config: {
              to: "{{ALERT_EMAIL_LIST}}",
              subject: "🚨 Critical Alert",
              body: "Alert Details: {{trigger.message}}"
            }
          }
        }
      ],
      edges: [
        { id: "e1", source: "trigger-1", target: "action-1" },
        { id: "e2", source: "trigger-1", target: "action-2" },
        { id: "e3", source: "trigger-1", target: "action-3" },
        { id: "e4", source: "trigger-1", target: "action-4" }
      ]
    }
  },

  // ============== HR TEMPLATES ==============

  // Employee Onboarding
  {
    id: "employee-onboarding",
    name: "Employee Onboarding Automation",
    description: "Automate the entire employee onboarding process from offer acceptance to first day",
    category: "HR",
    tags: ["hr", "onboarding", "employee", "automation"],
    integrations: ["gmail", "slack", "google_calendar", "notion"],
    difficulty: "advanced",
    estimatedTime: "20 mins",
    workflow_json: {
      nodes: [
        {
          id: "trigger-1",
          type: "gmail_trigger_new_email",
          position: { x: 100, y: 100 },
          data: {
            name: "Offer Accepted",
            config: {
              subject: "[OFFER ACCEPTED]"
            }
          }
        },
        {
          id: "action-1",
          type: "notion_action_create_page",
          position: { x: 300, y: 100 },
          data: {
            name: "Create Employee Record",
            config: {
              database: "{{EMPLOYEES_DB}}",
              properties: {
                name: "{{trigger.employee_name}}",
                email: "{{trigger.employee_email}}",
                start_date: "{{trigger.start_date}}",
                department: "{{trigger.department}}"
              }
            }
          }
        },
        {
          id: "action-2",
          type: "slack_action_invite_user",
          position: { x: 500, y: 50 },
          data: {
            name: "Add to Slack",
            config: {
              email: "{{trigger.employee_email}}",
              channels: ["#general", "#{{trigger.department}}"]
            }
          }
        },
        {
          id: "action-3",
          type: "google_calendar_action_create_event",
          position: { x: 500, y: 150 },
          data: {
            name: "Schedule Orientation",
            config: {
              summary: "Orientation - {{trigger.employee_name}}",
              start: "{{trigger.start_date}} 09:00",
              duration: 120,
              attendees: ["{{trigger.employee_email}}", "{{HR_EMAIL}}"]
            }
          }
        },
        {
          id: "action-4",
          type: "gmail_action_send_email",
          position: { x: 500, y: 250 },
          data: {
            name: "Welcome Email",
            config: {
              to: "{{trigger.employee_email}}",
              subject: "Welcome to the team!",
              body: "Welcome aboard! Your first day is {{trigger.start_date}}. We've scheduled your orientation and added you to our systems."
            }
          }
        }
      ],
      edges: [
        { id: "e1", source: "trigger-1", target: "action-1" },
        { id: "e2", source: "action-1", target: "action-2" },
        { id: "e3", source: "action-1", target: "action-3" },
        { id: "e4", source: "action-1", target: "action-4" }
      ]
    }
  },

  {
    id: "ai-message-support-reply",
    name: "AI Message - Support Reply",
    description: "Drafts a helpful reply whenever a new Discord support message arrives and sends it via Gmail.",
    category: "AI Automation",
    tags: ["ai-message", "support", "discord", "gmail"],
    integrations: ["discord", "gmail"],
    difficulty: "beginner",
    estimatedTime: "3 mins",
    workflow_json: {
      nodes: [
        {
          id: "discord-trigger-support",
          type: "discord_trigger_new_message",
          position: { x: 120, y: 260 },
          data: {
            type: "discord_trigger_new_message",
            title: "New Discord Support Message",
            config: {
              channelId: "",
              includeBot: false
            },
            isTrigger: true,
            needsConfiguration: true
          }
        },
        {
          id: "ai-message-1",
          type: "ai_message",
          position: { x: 420, y: 260 },
          data: {
            type: "ai_message",
            title: "Draft Support Reply",
            config: {
              model: "gpt-4o-mini",
              apiSource: "chainreact",
              temperature: 0.4,
              systemPrompt: "You are a helpful, empathetic support specialist. You acknowledge customer frustration, provide clear steps, and keep answers concise.",
              userPrompt: "A customer wrote:\n\"{{trigger.message.content}}\"\n\nWrite a short reply that acknowledges their issue, explains what happens next, and offers further help if needed.",
              outputFields: "reply_subject | Short subject line for email\nreply_body | Friendly support reply\nsummary | One sentence summary of the issue",
              includeRawOutput: true
            },
            needsConfiguration: false
          }
        },
        {
          id: "gmail-send-reply",
          type: "gmail_action_send_email",
          position: { x: 720, y: 260 },
          data: {
            type: "gmail_action_send_email",
            title: "Send Support Reply",
            config: {
              to: "",
              subject: "{{ai-message-1.reply_subject}}",
              body: "{{ai-message-1.reply_body}}",
              isHtml: false
            },
            needsConfiguration: true
          }
        }
      ],
      edges: [
        { id: "edge-support-1", source: "discord-trigger-support", target: "ai-message-1" },
        { id: "edge-support-2", source: "ai-message-1", target: "gmail-send-reply" }
      ]
    }
  },
  {
    id: "ai-helpdesk-triage-router",
    name: "AI Helpdesk Triage Router",
    description: "Classify incoming support emails and notify the right team automatically.",
    category: "AI Automation",
    tags: ["ai-router", "support", "gmail", "slack"],
    integrations: ["gmail", "slack"],
    difficulty: "intermediate",
    estimatedTime: "8 mins",
    workflow_json: {
      nodes: [
        {
          id: "gmail-trigger-support",
          type: "gmail_trigger_new_email",
          position: { x: 120, y: 320 },
          data: {
            type: "gmail_trigger_new_email",
            title: "New Support Email",
            config: {
              labelIds: [],
              includeSpamTrash: false
            },
            isTrigger: true,
            needsConfiguration: true
          }
        },
        {
          id: "ai-router-support",
          type: "ai_router",
          position: { x: 420, y: 320 },
          data: {
            type: "ai_router",
            title: "Route Request",
            config: {
              template: "support_router",
              model: "gpt-4o-mini",
              apiSource: "chainreact",
              memory: "workflow",
              outputPaths: [
                { id: "bug_report", name: "Bug Report", description: "Notify engineering", color: "#ef4444", condition: { type: "ai_decision", minConfidence: 0.7 } },
                { id: "feature_request", name: "Feature Request", description: "Notify product", color: "#3b82f6", condition: { type: "ai_decision", minConfidence: 0.7 } },
                { id: "support_query", name: "Support Query", description: "Send to support", color: "#10b981", condition: { type: "ai_decision", minConfidence: 0.7 } },
                { id: "sales_inquiry", name: "Sales Inquiry", description: "Forward to sales", color: "#f59e0b", condition: { type: "ai_decision", minConfidence: 0.7 } },
                { id: "general", name: "General", description: "Catch-all", color: "#6b7280", condition: { type: "fallback" } }
              ]
            },
            needsConfiguration: false
          }
        },
        {
          id: "slack-notify-bug",
          type: "slack_action_send_message",
          position: { x: 720, y: 140 },
          data: {
            type: "slack_action_send_message",
            title: "Notify Engineering",
            config: {
              channel: "",
              text: "New bug report detected. Subject: {{trigger.email.subject}}"
            },
            needsConfiguration: true
          }
        },
        {
          id: "slack-notify-feature",
          type: "slack_action_send_message",
          position: { x: 720, y: 240 },
          data: {
            type: "slack_action_send_message",
            title: "Notify Product",
            config: {
              channel: "",
              text: "New feature request. Subject: {{trigger.email.subject}}"
            },
            needsConfiguration: true
          }
        },
        {
          id: "slack-notify-support",
          type: "slack_action_send_message",
          position: { x: 720, y: 340 },
          data: {
            type: "slack_action_send_message",
            title: "Support Queue",
            config: {
              channel: "",
              text: "Support question received from {{trigger.email.from}}"
            },
            needsConfiguration: true
          }
        },
        {
          id: "slack-notify-sales",
          type: "slack_action_send_message",
          position: { x: 720, y: 440 },
          data: {
            type: "slack_action_send_message",
            title: "Sales Alert",
            config: {
              channel: "",
              text: "Sales inquiry detected. Subject: {{trigger.email.subject}}"
            },
            needsConfiguration: true
          }
        },
        {
          id: "slack-notify-general",
          type: "slack_action_send_message",
          position: { x: 720, y: 540 },
          data: {
            type: "slack_action_send_message",
            title: "General Inbox",
            config: {
              channel: "",
              text: "General message received. Subject: {{trigger.email.subject}}"
            },
            needsConfiguration: true
          }
        }
      ],
      edges: [
        { id: "edge-support-route", source: "gmail-trigger-support", target: "ai-router-support" },
        { id: "edge-route-bug", source: "ai-router-support", target: "slack-notify-bug", sourceHandle: "bug_report" },
        { id: "edge-route-feature", source: "ai-router-support", target: "slack-notify-feature", sourceHandle: "feature_request" },
        { id: "edge-route-support", source: "ai-router-support", target: "slack-notify-support", sourceHandle: "support_query" },
        { id: "edge-route-sales", source: "ai-router-support", target: "slack-notify-sales", sourceHandle: "sales_inquiry" },
        { id: "edge-route-general", source: "ai-router-support", target: "slack-notify-general", sourceHandle: "general" }
      ]
    }
  },
  {
    id: "newsletter-content-generator",
    name: "Newsletter Content Generator",
    description: "Turn a drafted Google Doc into a Mailchimp campaign with AI-generated subject and preview text.",
    category: "AI Automation",
    tags: ["ai-message", "google-docs", "mailchimp", "newsletter"],
    integrations: ["google-docs", "mailchimp"],
    difficulty: "intermediate",
    estimatedTime: "7 mins",
    workflow_json: {
      nodes: [
        {
          id: "gdocs-trigger-newsletter",
          type: "google_docs_trigger_document_updated",
          position: { x: 120, y: 300 },
          data: {
            type: "google_docs_trigger_document_updated",
            title: "Newsletter Draft Updated",
            config: {
              folderId: ""
            },
            isTrigger: true,
            needsConfiguration: true
          }
        },
        {
          id: "ai-message-newsletter",
          type: "ai_message",
          position: { x: 420, y: 300 },
          data: {
            type: "ai_message",
            title: "Generate Campaign Copy",
            config: {
              model: "gpt-4o-mini",
              apiSource: "chainreact",
              temperature: 0.3,
              systemPrompt: "You are a marketing copywriter. Create compelling newsletter subject lines and preview text.",
              userPrompt: "Draft newsletter content:\n{{trigger.document.content}}\n\nProduce final copy.",
              outputFields: "campaign_subject | Concise subject line\ncampaign_preview | Preview text\nhtml_body | HTML body content",
              includeRawOutput: true
            },
            needsConfiguration: false
          }
        },
        {
          id: "mailchimp-create-campaign",
          type: "mailchimp_action_create_campaign",
          position: { x: 720, y: 260 },
          data: {
            type: "mailchimp_action_create_campaign",
            title: "Create Mailchimp Campaign",
            config: {
              audienceId: "",
              subjectLine: "{{ai-message-newsletter.campaign_subject}}",
              previewText: "{{ai-message-newsletter.campaign_preview}}",
              fromName: "",
              replyTo: ""
            },
            needsConfiguration: true
          }
        },
        {
          id: "mailchimp-send-campaign",
          type: "mailchimp_action_send_campaign",
          position: { x: 960, y: 260 },
          data: {
            type: "mailchimp_action_send_campaign",
            title: "Send Campaign",
            config: {
              campaignId: "{{mailchimp-create-campaign.campaignId}}",
              scheduleTime: ""
            },
            needsConfiguration: true
          }
        }
      ],
      edges: [
        { id: "edge-newsletter-1", source: "gdocs-trigger-newsletter", target: "ai-message-newsletter" },
        { id: "edge-newsletter-2", source: "ai-message-newsletter", target: "mailchimp-create-campaign" },
        { id: "edge-newsletter-3", source: "mailchimp-create-campaign", target: "mailchimp-send-campaign" }
      ]
    }
  },
  {
    id: "customer-follow-up-sequencer",
    name: "Customer Follow-up Sequencer",
    description: "Send a thank-you email and two automated follow-ups after a successful payment.",
    category: "Sales & CRM",
    tags: ["ai-message", "stripe", "gmail", "slack"],
    integrations: ["stripe", "gmail", "slack"],
    difficulty: "intermediate",
    estimatedTime: "10 mins",
    workflow_json: {
      nodes: [
        {
          id: "stripe-trigger-payment",
          type: "stripe_trigger_new_payment",
          position: { x: 100, y: 260 },
          data: {
            type: "stripe_trigger_new_payment",
            title: "New Payment",
            config: {
              descriptionKeywords: []
            },
            isTrigger: true,
            needsConfiguration: true
          }
        },
        {
          id: "ai-message-followup",
          type: "ai_message",
          position: { x: 360, y: 260 },
          data: {
            type: "ai_message",
            title: "Draft Follow-up Emails",
            config: {
              model: "gpt-4o-mini",
              apiSource: "chainreact",
              temperature: 0.5,
              systemPrompt: "You are a customer success manager writing friendly follow-up emails.",
              userPrompt: "Payment details: {{trigger.payment}}. Customer email: {{trigger.customer.email}}. Draft thank-you and two follow-up messages.",
              outputFields: "first_subject | Immediate thank-you subject\nfirst_body | Immediate thank-you body\nsecond_subject | Follow-up subject (after 2 days)\nsecond_body | Follow-up body (after 2 days)\nthird_subject | Final follow-up subject (after 5 days)\nthird_body | Final follow-up body (after 5 days)",
              includeRawOutput: true
            },
            needsConfiguration: false
          }
        },
        {
          id: "gmail-send-thankyou",
          type: "gmail_action_send_email",
          position: { x: 600, y: 200 },
          data: {
            type: "gmail_action_send_email",
            title: "Send Thank You",
            config: {
              to: "{{trigger.customer.email}}",
              subject: "{{ai-message-followup.first_subject}}",
              body: "{{ai-message-followup.first_body}}",
              isHtml: false
            },
            needsConfiguration: true
          }
        },
        {
          id: "delay-two-days",
          type: "delay",
          position: { x: 840, y: 200 },
          data: {
            type: "delay",
            title: "Wait 2 Days",
            config: {
              waitType: "duration",
              duration: 2,
              unit: "days"
            },
            needsConfiguration: false
          }
        },
        {
          id: "gmail-followup-1",
          type: "gmail_action_send_email",
          position: { x: 1080, y: 200 },
          data: {
            type: "gmail_action_send_email",
            title: "Follow-up Email",
            config: {
              to: "{{trigger.customer.email}}",
              subject: "{{ai-message-followup.second_subject}}",
              body: "{{ai-message-followup.second_body}}",
              isHtml: false
            },
            needsConfiguration: true
          }
        },
        {
          id: "delay-five-days",
          type: "delay",
          position: { x: 1320, y: 200 },
          data: {
            type: "delay",
            title: "Wait 3 More Days",
            config: {
              waitType: "duration",
              duration: 3,
              unit: "days"
            },
            needsConfiguration: false
          }
        },
        {
          id: "gmail-followup-2",
          type: "gmail_action_send_email",
          position: { x: 1560, y: 200 },
          data: {
            type: "gmail_action_send_email",
            title: "Final Follow-up",
            config: {
              to: "{{trigger.customer.email}}",
              subject: "{{ai-message-followup.third_subject}}",
              body: "{{ai-message-followup.third_body}}",
              isHtml: false
            },
            needsConfiguration: true
          }
        },
        {
          id: "slack-notify-success",
          type: "slack_action_send_message",
          position: { x: 1080, y: 360 },
          data: {
            type: "slack_action_send_message",
            title: "Notify Success Team",
            config: {
              channel: "",
              text: "Follow-up sequence started for {{trigger.customer.email}}"
            },
            needsConfiguration: true
          }
        }
      ],
      edges: [
        { id: "edge-followup-1", source: "stripe-trigger-payment", target: "ai-message-followup" },
        { id: "edge-followup-2", source: "ai-message-followup", target: "gmail-send-thankyou" },
        { id: "edge-followup-3", source: "gmail-send-thankyou", target: "delay-two-days" },
        { id: "edge-followup-4", source: "delay-two-days", target: "gmail-followup-1" },
        { id: "edge-followup-5", source: "gmail-followup-1", target: "delay-five-days" },
        { id: "edge-followup-6", source: "delay-five-days", target: "gmail-followup-2" },
        { id: "edge-followup-7", source: "ai-message-followup", target: "slack-notify-success" }
      ]
    }
  },
  {
    id: "sales-demo-scheduler",
    name: "Sales Demo Scheduler",
    description: "Respond to new HubSpot leads with a personalized email and schedule a demo meeting.",
    category: "Sales & CRM",
    tags: ["ai-message", "hubspot", "gmail", "google-calendar", "slack"],
    integrations: ["hubspot", "gmail", "google-calendar", "slack"],
    difficulty: "intermediate",
    estimatedTime: "9 mins",
    workflow_json: {
      nodes: [
        {
          id: "hubspot-trigger-lead",
          type: "hubspot_trigger_contact_created",
          position: { x: 120, y: 280 },
          data: {
            type: "hubspot_trigger_contact_created",
            title: "New HubSpot Lead",
            config: {
              pipelineId: ""
            },
            isTrigger: true,
            needsConfiguration: true
          }
        },
        {
          id: "ai-message-demo",
          type: "ai_message",
          position: { x: 400, y: 280 },
          data: {
            type: "ai_message",
            title: "Draft Demo Invite",
            config: {
              model: "gpt-4o-mini",
              apiSource: "chainreact",
              temperature: 0.4,
              systemPrompt: "You are a sales rep who writes concise demo invitations.",
              userPrompt: "Lead details: {{trigger.contact}}. Draft an email inviting them to a demo and include a short summary for Slack.",
              outputFields: "email_subject | Email subject line\nemail_body | Email body text\nslack_summary | One sentence summary",
              includeRawOutput: true
            },
            needsConfiguration: false
          }
        },
        {
          id: "gmail-send-demo",
          type: "gmail_action_send_email",
          position: { x: 660, y: 220 },
          data: {
            type: "gmail_action_send_email",
            title: "Send Demo Invite",
            config: {
              to: "{{trigger.contact.email}}",
              subject: "{{ai-message-demo.email_subject}}",
              body: "{{ai-message-demo.email_body}}",
              isHtml: false
            },
            needsConfiguration: true
          }
        },
        {
          id: "calendar-create-demo",
          type: "google_calendar_action_create_event",
          position: { x: 920, y: 220 },
          data: {
            type: "google_calendar_action_create_event",
            title: "Schedule Demo",
            config: {
              calendarId: "",
              summary: "Demo with {{trigger.contact.firstname}} {{trigger.contact.lastname}}",
              description: "Requested demo. Email reference: {{ai-message-demo.email_body}}",
              startTime: "",
              endTime: ""
            },
            needsConfiguration: true
          }
        },
        {
          id: "slack-notify-demo",
          type: "slack_action_send_message",
          position: { x: 660, y: 360 },
          data: {
            type: "slack_action_send_message",
            title: "Alert Sales Channel",
            config: {
              channel: "",
              text: "New demo scheduled: {{ai-message-demo.slack_summary}}"
            },
            needsConfiguration: true
          }
        }
      ],
      edges: [
        { id: "edge-demo-1", source: "hubspot-trigger-lead", target: "ai-message-demo" },
        { id: "edge-demo-2", source: "ai-message-demo", target: "gmail-send-demo" },
        { id: "edge-demo-3", source: "gmail-send-demo", target: "calendar-create-demo" },
        { id: "edge-demo-4", source: "ai-message-demo", target: "slack-notify-demo" }
      ]
    }
  },
  {
    id: "incident-postmortem-builder",
    name: "Incident Postmortem Builder",
    description: "Summarize resolved incidents and document a postmortem in Notion automatically.",
    category: "DevOps",
    tags: ["ai-message", "slack", "notion"],
    integrations: ["slack", "notion"],
    difficulty: "intermediate",
    estimatedTime: "6 mins",
    workflow_json: {
      nodes: [
        {
          id: "slack-trigger-incident",
          type: "slack_trigger_message_channels",
          position: { x: 120, y: 280 },
          data: {
            type: "slack_trigger_message_channels",
            title: "Incident Resolved Message",
            config: {
              channel: ""
            },
            isTrigger: true,
            needsConfiguration: true
          }
        },
        {
          id: "ai-message-postmortem",
          type: "ai_message",
          position: { x: 400, y: 280 },
          data: {
            type: "ai_message",
            title: "Summarize Incident",
            config: {
              model: "gpt-4o-mini",
              apiSource: "chainreact",
              temperature: 0.4,
              systemPrompt: "You are an SRE generating structured postmortem summaries.",
              userPrompt: "Incident update: {{trigger.message.text}}. Create a summary, timeline, and follow-up actions.",
              outputFields: "summary | High-level summary\ntimeline | Timeline bullet list\nactions | Follow-up actions",
              includeRawOutput: true
            },
            needsConfiguration: false
          }
        },
        {
          id: "notion-create-postmortem",
          type: "notion_action_create_page",
          position: { x: 680, y: 220 },
          data: {
            type: "notion_action_create_page",
            title: "Create Postmortem Page",
            config: {
              parentId: "",
              title: "Postmortem - {{trigger.message.user.name}} - {{trigger.message.ts}}",
              content: "## Summary\n{{ai-message-postmortem.summary}}\n\n## Timeline\n{{ai-message-postmortem.timeline}}\n\n## Follow-up Actions\n{{ai-message-postmortem.actions}}"
            },
            needsConfiguration: true
          }
        },
        {
          id: "slack-notify-postmortem",
          type: "slack_action_send_message",
          position: { x: 680, y: 360 },
          data: {
            type: "slack_action_send_message",
            title: "Share Postmortem",
            config: {
              channel: "",
              text: "Postmortem summary created in Notion."
            },
            needsConfiguration: true
          }
        }
      ],
      edges: [
        { id: "edge-postmortem-1", source: "slack-trigger-incident", target: "ai-message-postmortem" },
        { id: "edge-postmortem-2", source: "ai-message-postmortem", target: "notion-create-postmortem" },
        { id: "edge-postmortem-3", source: "notion-create-postmortem", target: "slack-notify-postmortem" }
      ]
    }
  },

  // ============== MARKETING TEMPLATES ==============

  {
    id: "mailchimp-subscriber-welcome",
    name: "Mailchimp Subscriber Welcome Sequence",
    description: "Automatically send a personalized welcome email and follow-up when someone subscribes to your Mailchimp audience.",
    category: "Marketing",
    tags: ["mailchimp", "email", "onboarding", "welcome"],
    integrations: ["mailchimp", "gmail"],
    difficulty: "beginner",
    estimatedTime: "5 mins",
    workflow_json: {
      nodes: [
        {
          id: "mailchimp-trigger",
          type: "mailchimp_trigger_new_subscriber",
          position: { x: 100, y: 260 },
          data: { type: "mailchimp_trigger_new_subscriber", title: "New Subscriber", config: {}, isTrigger: true, needsConfiguration: true }
        },
        {
          id: "ai-welcome",
          type: "ai_message",
          position: { x: 380, y: 260 },
          data: {
            type: "ai_message", title: "Draft Welcome Email", config: {
              model: "gpt-4o-mini", apiSource: "chainreact", temperature: 0.4,
              userPrompt: "Write a warm, short welcome email for new subscriber {{mailchimp-trigger.email}}. Include a thank-you, what they can expect, and a friendly CTA.",
              outputFields: "subject | Email subject line\nbody | Email body HTML"
            }, needsConfiguration: false
          }
        },
        {
          id: "gmail-welcome",
          type: "gmail_action_send_email",
          position: { x: 660, y: 260 },
          data: { type: "gmail_action_send_email", title: "Send Welcome Email", config: { to: "{{mailchimp-trigger.email}}", subject: "{{ai-welcome.subject}}", body: "{{ai-welcome.body}}" }, needsConfiguration: true }
        }
      ],
      edges: [
        { id: "e1", source: "mailchimp-trigger", target: "ai-welcome" },
        { id: "e2", source: "ai-welcome", target: "gmail-welcome" }
      ]
    }
  },
  {
    id: "ai-blog-to-newsletter",
    name: "AI Blog-to-Newsletter Pipeline",
    description: "When a Google Doc is updated, AI generates newsletter content and creates a Mailchimp campaign automatically.",
    category: "Marketing",
    tags: ["blog", "newsletter", "ai", "mailchimp", "google-docs"],
    integrations: ["google_docs", "mailchimp"],
    difficulty: "intermediate",
    estimatedTime: "8 mins",
    workflow_json: {
      nodes: [
        {
          id: "gdocs-trigger",
          type: "google_docs_trigger_document_updated",
          position: { x: 100, y: 260 },
          data: { type: "google_docs_trigger_document_updated", title: "Doc Updated", config: {}, isTrigger: true, needsConfiguration: true }
        },
        {
          id: "ai-newsletter",
          type: "ai_message",
          position: { x: 380, y: 260 },
          data: {
            type: "ai_message", title: "Generate Newsletter", config: {
              model: "gpt-4o-mini", apiSource: "chainreact", temperature: 0.5,
              userPrompt: "Based on this blog post content: {{gdocs-trigger.content}}, generate a compelling email newsletter. Include a catchy subject line, preview text, and formatted body.",
              outputFields: "subject | Email subject\npreview | Preview text\nbody | Newsletter HTML body"
            }, needsConfiguration: false
          }
        },
        {
          id: "mailchimp-campaign",
          type: "mailchimp_action_create_campaign",
          position: { x: 660, y: 260 },
          data: { type: "mailchimp_action_create_campaign", title: "Create Campaign", config: { subject: "{{ai-newsletter.subject}}", previewText: "{{ai-newsletter.preview}}", html: "{{ai-newsletter.body}}" }, needsConfiguration: true }
        }
      ],
      edges: [
        { id: "e1", source: "gdocs-trigger", target: "ai-newsletter" },
        { id: "e2", source: "ai-newsletter", target: "mailchimp-campaign" }
      ]
    }
  },
  {
    id: "hubspot-to-mailchimp-sync",
    name: "HubSpot Lead to Mailchimp Sync",
    description: "When a new contact is created in HubSpot, automatically add them to your Mailchimp audience and notify your team on Slack.",
    category: "Marketing",
    tags: ["hubspot", "mailchimp", "sync", "leads"],
    integrations: ["hubspot", "mailchimp", "slack"],
    difficulty: "beginner",
    estimatedTime: "5 mins",
    workflow_json: {
      nodes: [
        {
          id: "hubspot-trigger",
          type: "hubspot_trigger_new_contact",
          position: { x: 100, y: 260 },
          data: { type: "hubspot_trigger_new_contact", title: "New HubSpot Contact", config: {}, isTrigger: true, needsConfiguration: true }
        },
        {
          id: "mailchimp-add",
          type: "mailchimp_action_add_subscriber",
          position: { x: 380, y: 200 },
          data: { type: "mailchimp_action_add_subscriber", title: "Add to Mailchimp", config: { email: "{{hubspot-trigger.email}}", firstName: "{{hubspot-trigger.firstname}}", lastName: "{{hubspot-trigger.lastname}}" }, needsConfiguration: true }
        },
        {
          id: "slack-notify",
          type: "slack_action_send_message",
          position: { x: 380, y: 360 },
          data: { type: "slack_action_send_message", title: "Notify Team", config: { channel: "#marketing", message: "New lead synced to Mailchimp: {{hubspot-trigger.email}}" }, needsConfiguration: true }
        }
      ],
      edges: [
        { id: "e1", source: "hubspot-trigger", target: "mailchimp-add" },
        { id: "e2", source: "hubspot-trigger", target: "slack-notify" }
      ]
    }
  },
  {
    id: "ai-content-repurposer",
    name: "AI Content Repurposer",
    description: "Takes long-form content from Google Docs and generates social media posts, email snippets, and blog summaries using AI.",
    category: "Marketing",
    tags: ["ai", "content", "repurpose", "social-media"],
    integrations: ["google_docs", "google_sheets", "slack"],
    difficulty: "intermediate",
    estimatedTime: "8 mins",
    workflow_json: {
      nodes: [
        {
          id: "gdocs-trigger",
          type: "google_docs_trigger_document_updated",
          position: { x: 100, y: 260 },
          data: { type: "google_docs_trigger_document_updated", title: "Content Updated", config: {}, isTrigger: true, needsConfiguration: true }
        },
        {
          id: "ai-repurpose",
          type: "ai_message",
          position: { x: 380, y: 260 },
          data: {
            type: "ai_message", title: "Repurpose Content", config: {
              model: "gpt-4o-mini", apiSource: "chainreact", temperature: 0.6,
              userPrompt: "From this content: {{gdocs-trigger.content}}, generate: 1) A LinkedIn post (professional tone), 2) A tweet-length post (under 280 chars), 3) An email snippet (2-3 sentences), 4) A one-paragraph blog summary.",
              outputFields: "linkedin_post | LinkedIn post\ntweet | Short social post\nemail_snippet | Email snippet\nblog_summary | Blog summary"
            }, needsConfiguration: false
          }
        },
        {
          id: "sheets-log",
          type: "google_sheets_action_add_row",
          position: { x: 660, y: 200 },
          data: { type: "google_sheets_action_add_row", title: "Log to Sheets", config: { values: { "LinkedIn": "{{ai-repurpose.linkedin_post}}", "Tweet": "{{ai-repurpose.tweet}}", "Email": "{{ai-repurpose.email_snippet}}", "Summary": "{{ai-repurpose.blog_summary}}" } }, needsConfiguration: true }
        },
        {
          id: "slack-share",
          type: "slack_action_send_message",
          position: { x: 660, y: 360 },
          data: { type: "slack_action_send_message", title: "Share in Slack", config: { channel: "#content", message: "New content variants ready!\n\nLinkedIn: {{ai-repurpose.linkedin_post}}\n\nTweet: {{ai-repurpose.tweet}}" }, needsConfiguration: true }
        }
      ],
      edges: [
        { id: "e1", source: "gdocs-trigger", target: "ai-repurpose" },
        { id: "e2", source: "ai-repurpose", target: "sheets-log" },
        { id: "e3", source: "ai-repurpose", target: "slack-share" }
      ]
    }
  },

  // ============== FINANCE TEMPLATES ==============

  {
    id: "stripe-invoice-processor",
    name: "Stripe Invoice Processor",
    description: "When a Stripe payment is received, AI categorizes the transaction, logs it to Google Sheets, and sends a receipt email.",
    category: "Finance",
    tags: ["stripe", "invoices", "accounting", "google-sheets"],
    integrations: ["stripe", "google_sheets", "gmail"],
    difficulty: "intermediate",
    estimatedTime: "7 mins",
    workflow_json: {
      nodes: [
        {
          id: "stripe-trigger",
          type: "stripe_trigger_payment_received",
          position: { x: 100, y: 260 },
          data: { type: "stripe_trigger_payment_received", title: "Payment Received", config: {}, isTrigger: true, needsConfiguration: true }
        },
        {
          id: "ai-categorize",
          type: "ai_message",
          position: { x: 380, y: 260 },
          data: {
            type: "ai_message", title: "Categorize Expense", config: {
              model: "gpt-4o-mini", apiSource: "chainreact", temperature: 0.2,
              userPrompt: "Categorize this payment: Amount: {{stripe-trigger.amount}}, Description: {{stripe-trigger.description}}, Customer: {{stripe-trigger.customer_email}}. Categories: Software, Services, Subscription, One-time Purchase, Other.",
              outputFields: "category | Expense category\nsummary | Short transaction summary"
            }, needsConfiguration: false
          }
        },
        {
          id: "sheets-log",
          type: "google_sheets_action_add_row",
          position: { x: 660, y: 200 },
          data: { type: "google_sheets_action_add_row", title: "Log Transaction", config: { values: { "Date": "{{stripe-trigger.created}}", "Amount": "{{stripe-trigger.amount}}", "Category": "{{ai-categorize.category}}", "Customer": "{{stripe-trigger.customer_email}}", "Summary": "{{ai-categorize.summary}}" } }, needsConfiguration: true }
        },
        {
          id: "gmail-receipt",
          type: "gmail_action_send_email",
          position: { x: 660, y: 360 },
          data: { type: "gmail_action_send_email", title: "Send Receipt", config: { to: "{{stripe-trigger.customer_email}}", subject: "Payment Receipt - {{stripe-trigger.amount}}", body: "Thank you for your payment of {{stripe-trigger.amount}}. Transaction: {{ai-categorize.summary}}" }, needsConfiguration: true }
        }
      ],
      edges: [
        { id: "e1", source: "stripe-trigger", target: "ai-categorize" },
        { id: "e2", source: "ai-categorize", target: "sheets-log" },
        { id: "e3", source: "ai-categorize", target: "gmail-receipt" }
      ]
    }
  },
  {
    id: "revenue-dashboard-updater",
    name: "Revenue Dashboard Updater",
    description: "Automatically logs every Stripe payment to a Google Sheets revenue dashboard and posts a summary to Slack.",
    category: "Finance",
    tags: ["stripe", "revenue", "dashboard", "google-sheets"],
    integrations: ["stripe", "google_sheets", "slack"],
    difficulty: "beginner",
    estimatedTime: "5 mins",
    workflow_json: {
      nodes: [
        {
          id: "stripe-trigger",
          type: "stripe_trigger_payment_received",
          position: { x: 100, y: 260 },
          data: { type: "stripe_trigger_payment_received", title: "Payment Received", config: {}, isTrigger: true, needsConfiguration: true }
        },
        {
          id: "sheets-update",
          type: "google_sheets_action_add_row",
          position: { x: 380, y: 200 },
          data: { type: "google_sheets_action_add_row", title: "Update Dashboard", config: { values: { "Date": "{{stripe-trigger.created}}", "Amount": "{{stripe-trigger.amount}}", "Customer": "{{stripe-trigger.customer_email}}", "Status": "{{stripe-trigger.status}}" } }, needsConfiguration: true }
        },
        {
          id: "slack-update",
          type: "slack_action_send_message",
          position: { x: 380, y: 360 },
          data: { type: "slack_action_send_message", title: "Revenue Update", config: { channel: "#revenue", message: "Payment received: {{stripe-trigger.amount}} from {{stripe-trigger.customer_email}}" }, needsConfiguration: true }
        }
      ],
      edges: [
        { id: "e1", source: "stripe-trigger", target: "sheets-update" },
        { id: "e2", source: "stripe-trigger", target: "slack-update" }
      ]
    }
  },
  {
    id: "expense-report-from-email",
    name: "AI Expense Report from Email",
    description: "Emails with [EXPENSE] in the subject are classified by AI into categories (travel, software, meals, other), logged to Airtable, and finance is notified.",
    category: "Finance",
    tags: ["expenses", "email", "ai-router", "airtable", "accounting"],
    integrations: ["gmail", "airtable", "slack"],
    difficulty: "advanced",
    estimatedTime: "10 mins",
    workflow_json: {
      nodes: [
        {
          id: "gmail-trigger",
          type: "gmail_trigger_new_email",
          position: { x: 100, y: 280 },
          data: { type: "gmail_trigger_new_email", title: "Expense Email", config: { subjectFilter: "[EXPENSE]" }, isTrigger: true, needsConfiguration: true }
        },
        {
          id: "ai-router-expense",
          type: "ai_router",
          position: { x: 380, y: 280 },
          data: {
            type: "ai_router", title: "Classify Expense", config: {
              template: "custom",
              systemPrompt: "Classify this expense email into: travel, software, meals, or other. Extract amount and vendor if mentioned.",
              model: "gpt-4o-mini", apiSource: "chainreact", memory: "workflow",
              outputPaths: [
                { id: "travel", name: "Travel", description: "Travel expenses", color: "#3b82f6", condition: { type: "ai_decision", minConfidence: 0.6 } },
                { id: "software", name: "Software", description: "Software purchases", color: "#8b5cf6", condition: { type: "ai_decision", minConfidence: 0.6 } },
                { id: "meals", name: "Meals", description: "Meals and entertainment", color: "#f59e0b", condition: { type: "ai_decision", minConfidence: 0.6 } },
                { id: "other", name: "Other", description: "Other expenses", color: "#6b7280", condition: { type: "fallback" } }
              ],
              decisionMode: "single", includeReasoning: true, temperature: 0.2
            }, needsConfiguration: false
          }
        },
        {
          id: "airtable-log",
          type: "airtable_action_create_record",
          position: { x: 660, y: 200 },
          data: { type: "airtable_action_create_record", title: "Log Expense", config: { fields: { "Subject": "{{gmail-trigger.subject}}", "From": "{{gmail-trigger.from}}", "Category": "{{ai-router-expense.selectedPath}}", "Date": "{{gmail-trigger.date}}" } }, needsConfiguration: true }
        },
        {
          id: "slack-finance",
          type: "slack_action_send_message",
          position: { x: 660, y: 380 },
          data: { type: "slack_action_send_message", title: "Notify Finance", config: { channel: "#finance", message: "New expense logged: {{gmail-trigger.subject}} - Category: {{ai-router-expense.selectedPath}}" }, needsConfiguration: true }
        }
      ],
      edges: [
        { id: "e1", source: "gmail-trigger", target: "ai-router-expense" },
        { id: "e2", source: "ai-router-expense", target: "airtable-log" },
        { id: "e3", source: "ai-router-expense", target: "slack-finance" }
      ]
    }
  },

  // ============== ADDITIONAL NOTIFICATION TEMPLATES ==============

  {
    id: "stripe-payment-alert-hub",
    name: "Stripe Payment Alert Hub",
    description: "Get instant Slack and email notifications with AI-generated summaries whenever a Stripe payment is received.",
    category: "Notifications",
    tags: ["stripe", "alerts", "payment", "slack", "gmail"],
    integrations: ["stripe", "slack", "gmail"],
    difficulty: "beginner",
    estimatedTime: "5 mins",
    workflow_json: {
      nodes: [
        {
          id: "stripe-trigger",
          type: "stripe_trigger_payment_received",
          position: { x: 100, y: 260 },
          data: { type: "stripe_trigger_payment_received", title: "Payment Received", config: {}, isTrigger: true, needsConfiguration: true }
        },
        {
          id: "ai-summarize",
          type: "ai_message",
          position: { x: 380, y: 260 },
          data: {
            type: "ai_message", title: "Summarize Payment", config: {
              model: "gpt-4o-mini", apiSource: "chainreact", temperature: 0.3,
              userPrompt: "Summarize this payment for team notification: Amount: {{stripe-trigger.amount}}, Customer: {{stripe-trigger.customer_email}}, Status: {{stripe-trigger.status}}.",
              outputFields: "summary | Payment summary\nslack_message | Formatted Slack message"
            }, needsConfiguration: false
          }
        },
        {
          id: "slack-alert",
          type: "slack_action_send_message",
          position: { x: 660, y: 200 },
          data: { type: "slack_action_send_message", title: "Slack Alert", config: { channel: "#payments", message: "{{ai-summarize.slack_message}}" }, needsConfiguration: true }
        },
        {
          id: "gmail-alert",
          type: "gmail_action_send_email",
          position: { x: 660, y: 360 },
          data: { type: "gmail_action_send_email", title: "Email Alert", config: { subject: "Payment: {{stripe-trigger.amount}}", body: "{{ai-summarize.summary}}" }, needsConfiguration: true }
        }
      ],
      edges: [
        { id: "e1", source: "stripe-trigger", target: "ai-summarize" },
        { id: "e2", source: "ai-summarize", target: "slack-alert" },
        { id: "e3", source: "ai-summarize", target: "gmail-alert" }
      ]
    }
  },
  {
    id: "airtable-record-notifier",
    name: "New Airtable Record Notifier",
    description: "When a new record is added to Airtable, AI formats a notification and sends it to Discord and Slack.",
    category: "Notifications",
    tags: ["airtable", "notifications", "discord", "slack"],
    integrations: ["airtable", "discord", "slack"],
    difficulty: "beginner",
    estimatedTime: "5 mins",
    workflow_json: {
      nodes: [
        {
          id: "airtable-trigger",
          type: "airtable_trigger_new_record",
          position: { x: 100, y: 260 },
          data: { type: "airtable_trigger_new_record", title: "New Record", config: {}, isTrigger: true, needsConfiguration: true }
        },
        {
          id: "ai-format",
          type: "ai_message",
          position: { x: 380, y: 260 },
          data: {
            type: "ai_message", title: "Format Notification", config: {
              model: "gpt-4o-mini", apiSource: "chainreact", temperature: 0.3,
              userPrompt: "Format a clean notification message for this new Airtable record: {{airtable-trigger.fields}}. Keep it concise.",
              outputFields: "message | Notification message"
            }, needsConfiguration: false
          }
        },
        {
          id: "discord-notify",
          type: "discord_action_send_message",
          position: { x: 660, y: 200 },
          data: { type: "discord_action_send_message", title: "Discord Notification", config: { message: "{{ai-format.message}}" }, needsConfiguration: true }
        },
        {
          id: "slack-notify",
          type: "slack_action_send_message",
          position: { x: 660, y: 360 },
          data: { type: "slack_action_send_message", title: "Slack Notification", config: { message: "{{ai-format.message}}" }, needsConfiguration: true }
        }
      ],
      edges: [
        { id: "e1", source: "airtable-trigger", target: "ai-format" },
        { id: "e2", source: "ai-format", target: "discord-notify" },
        { id: "e3", source: "ai-format", target: "slack-notify" }
      ]
    }
  },

  // ============== ADDITIONAL PRODUCTIVITY TEMPLATES ==============

  {
    id: "email-to-trello-task",
    name: "Email to Trello Task",
    description: "AI extracts task details from incoming emails and creates Trello cards with priority and due dates, then notifies the team on Slack.",
    category: "Productivity",
    tags: ["email", "trello", "tasks", "ai", "automation"],
    integrations: ["gmail", "trello", "slack"],
    difficulty: "beginner",
    estimatedTime: "5 mins",
    workflow_json: {
      nodes: [
        {
          id: "gmail-trigger",
          type: "gmail_trigger_new_email",
          position: { x: 100, y: 260 },
          data: { type: "gmail_trigger_new_email", title: "New Email", config: {}, isTrigger: true, needsConfiguration: true }
        },
        {
          id: "ai-extract",
          type: "ai_message",
          position: { x: 380, y: 260 },
          data: {
            type: "ai_message", title: "Extract Task", config: {
              model: "gpt-4o-mini", apiSource: "chainreact", temperature: 0.2,
              userPrompt: "From this email (Subject: {{gmail-trigger.subject}}, Body: {{gmail-trigger.body}}), extract: task title, priority (Low/Medium/High), and a brief description.",
              outputFields: "title | Task title\npriority | Priority level\ndescription | Brief task description"
            }, needsConfiguration: false
          }
        },
        {
          id: "trello-card",
          type: "trello_action_create_card",
          position: { x: 660, y: 200 },
          data: { type: "trello_action_create_card", title: "Create Trello Card", config: { name: "{{ai-extract.title}}", desc: "Priority: {{ai-extract.priority}}\n\n{{ai-extract.description}}" }, needsConfiguration: true }
        },
        {
          id: "slack-notify",
          type: "slack_action_send_message",
          position: { x: 660, y: 360 },
          data: { type: "slack_action_send_message", title: "Notify Team", config: { message: "New task from email: {{ai-extract.title}} ({{ai-extract.priority}} priority)" }, needsConfiguration: true }
        }
      ],
      edges: [
        { id: "e1", source: "gmail-trigger", target: "ai-extract" },
        { id: "e2", source: "ai-extract", target: "trello-card" },
        { id: "e3", source: "ai-extract", target: "slack-notify" }
      ]
    }
  },
  {
    id: "monday-task-from-slack",
    name: "Monday.com Task from Slack",
    description: "AI parses Slack messages to extract task details and creates Monday.com items with a Gmail confirmation.",
    category: "Productivity",
    tags: ["slack", "monday", "tasks", "ai"],
    integrations: ["slack", "monday", "gmail"],
    difficulty: "intermediate",
    estimatedTime: "6 mins",
    workflow_json: {
      nodes: [
        {
          id: "slack-trigger",
          type: "slack_trigger_new_message",
          position: { x: 100, y: 260 },
          data: { type: "slack_trigger_new_message", title: "Slack Message", config: {}, isTrigger: true, needsConfiguration: true }
        },
        {
          id: "ai-parse",
          type: "ai_message",
          position: { x: 380, y: 260 },
          data: {
            type: "ai_message", title: "Parse Task Details", config: {
              model: "gpt-4o-mini", apiSource: "chainreact", temperature: 0.2,
              userPrompt: "Extract task details from this Slack message: {{slack-trigger.text}}. Return task name, description, and priority.",
              outputFields: "name | Task name\ndescription | Task description\npriority | Priority"
            }, needsConfiguration: false
          }
        },
        {
          id: "monday-item",
          type: "monday_action_create_item",
          position: { x: 660, y: 200 },
          data: { type: "monday_action_create_item", title: "Create Monday Item", config: { itemName: "{{ai-parse.name}}" }, needsConfiguration: true }
        },
        {
          id: "gmail-confirm",
          type: "gmail_action_send_email",
          position: { x: 660, y: 360 },
          data: { type: "gmail_action_send_email", title: "Email Confirmation", config: { subject: "Task Created: {{ai-parse.name}}", body: "A new Monday.com task was created from Slack: {{ai-parse.name}} - {{ai-parse.description}}" }, needsConfiguration: true }
        }
      ],
      edges: [
        { id: "e1", source: "slack-trigger", target: "ai-parse" },
        { id: "e2", source: "ai-parse", target: "monday-item" },
        { id: "e3", source: "ai-parse", target: "gmail-confirm" }
      ]
    }
  },
  {
    id: "meeting-notes-to-notion",
    name: "Meeting Notes to Notion with AI Summary",
    description: "After a Google Calendar event, AI generates a meeting summary and creates a Notion page, then emails the summary to attendees.",
    category: "Productivity",
    tags: ["meetings", "notion", "ai", "calendar", "notes"],
    integrations: ["google_calendar", "notion", "gmail"],
    difficulty: "intermediate",
    estimatedTime: "7 mins",
    workflow_json: {
      nodes: [
        {
          id: "calendar-trigger",
          type: "google_calendar_trigger_event_ended",
          position: { x: 100, y: 260 },
          data: { type: "google_calendar_trigger_event_ended", title: "Meeting Ended", config: {}, isTrigger: true, needsConfiguration: true }
        },
        {
          id: "ai-summary",
          type: "ai_message",
          position: { x: 380, y: 260 },
          data: {
            type: "ai_message", title: "Generate Summary", config: {
              model: "gpt-4o-mini", apiSource: "chainreact", temperature: 0.4,
              userPrompt: "Generate a structured meeting notes template for: {{calendar-trigger.summary}}. Include sections for: Key Decisions, Action Items, and Next Steps.",
              outputFields: "title | Notes page title\ncontent | Meeting notes content\nemail_summary | Brief email summary"
            }, needsConfiguration: false
          }
        },
        {
          id: "notion-page",
          type: "notion_action_create_page",
          position: { x: 660, y: 200 },
          data: { type: "notion_action_create_page", title: "Create Notion Page", config: { title: "{{ai-summary.title}}", content: "{{ai-summary.content}}" }, needsConfiguration: true }
        },
        {
          id: "gmail-attendees",
          type: "gmail_action_send_email",
          position: { x: 660, y: 360 },
          data: { type: "gmail_action_send_email", title: "Email Attendees", config: { subject: "Meeting Notes: {{calendar-trigger.summary}}", body: "{{ai-summary.email_summary}}" }, needsConfiguration: true }
        }
      ],
      edges: [
        { id: "e1", source: "calendar-trigger", target: "ai-summary" },
        { id: "e2", source: "ai-summary", target: "notion-page" },
        { id: "e3", source: "ai-summary", target: "gmail-attendees" }
      ]
    }
  },
  {
    id: "document-backup-pipeline",
    name: "Document Backup Pipeline",
    description: "When a new file is added to Google Drive, automatically back it up to Dropbox and OneDrive with an email confirmation.",
    category: "Productivity",
    tags: ["backup", "google-drive", "dropbox", "onedrive"],
    integrations: ["google_drive", "dropbox", "onedrive", "gmail"],
    difficulty: "beginner",
    estimatedTime: "4 mins",
    workflow_json: {
      nodes: [
        {
          id: "drive-trigger",
          type: "google_drive_trigger_new_file",
          position: { x: 100, y: 260 },
          data: { type: "google_drive_trigger_new_file", title: "New File in Drive", config: {}, isTrigger: true, needsConfiguration: true }
        },
        {
          id: "dropbox-upload",
          type: "dropbox_action_upload_file",
          position: { x: 380, y: 160 },
          data: { type: "dropbox_action_upload_file", title: "Backup to Dropbox", config: { path: "/backups/{{drive-trigger.name}}" }, needsConfiguration: true }
        },
        {
          id: "onedrive-upload",
          type: "onedrive_action_upload_file",
          position: { x: 380, y: 360 },
          data: { type: "onedrive_action_upload_file", title: "Backup to OneDrive", config: { path: "/backups/{{drive-trigger.name}}" }, needsConfiguration: true }
        },
        {
          id: "gmail-confirm",
          type: "gmail_action_send_email",
          position: { x: 660, y: 260 },
          data: { type: "gmail_action_send_email", title: "Confirmation Email", config: { subject: "File Backed Up: {{drive-trigger.name}}", body: "Your file '{{drive-trigger.name}}' has been backed up to Dropbox and OneDrive." }, needsConfiguration: true }
        }
      ],
      edges: [
        { id: "e1", source: "drive-trigger", target: "dropbox-upload" },
        { id: "e2", source: "drive-trigger", target: "onedrive-upload" },
        { id: "e3", source: "dropbox-upload", target: "gmail-confirm" }
      ]
    }
  },

  // ============== ADDITIONAL DATA SYNC TEMPLATES ==============

  {
    id: "airtable-to-sheets-sync",
    name: "Airtable to Google Sheets Sync",
    description: "When a new record is added to Airtable, automatically sync it as a new row in Google Sheets and notify the team on Slack.",
    category: "Data Sync",
    tags: ["airtable", "google-sheets", "sync", "data"],
    integrations: ["airtable", "google_sheets", "slack"],
    difficulty: "beginner",
    estimatedTime: "4 mins",
    workflow_json: {
      nodes: [
        {
          id: "airtable-trigger",
          type: "airtable_trigger_new_record",
          position: { x: 100, y: 260 },
          data: { type: "airtable_trigger_new_record", title: "New Airtable Record", config: {}, isTrigger: true, needsConfiguration: true }
        },
        {
          id: "sheets-add",
          type: "google_sheets_action_add_row",
          position: { x: 380, y: 200 },
          data: { type: "google_sheets_action_add_row", title: "Add to Sheets", config: { values: { "Name": "{{airtable-trigger.Name}}", "Status": "{{airtable-trigger.Status}}", "Date": "{{airtable-trigger.Date}}" } }, needsConfiguration: true }
        },
        {
          id: "slack-notify",
          type: "slack_action_send_message",
          position: { x: 380, y: 360 },
          data: { type: "slack_action_send_message", title: "Notify Team", config: { message: "Airtable record synced to Sheets: {{airtable-trigger.Name}}" }, needsConfiguration: true }
        }
      ],
      edges: [
        { id: "e1", source: "airtable-trigger", target: "sheets-add" },
        { id: "e2", source: "airtable-trigger", target: "slack-notify" }
      ]
    }
  },
  {
    id: "sheets-to-airtable-sync",
    name: "Google Sheets to Airtable Sync",
    description: "When a new row is added to Google Sheets, create a corresponding record in Airtable and send a Gmail confirmation.",
    category: "Data Sync",
    tags: ["google-sheets", "airtable", "sync", "data"],
    integrations: ["google_sheets", "airtable", "gmail"],
    difficulty: "beginner",
    estimatedTime: "4 mins",
    workflow_json: {
      nodes: [
        {
          id: "sheets-trigger",
          type: "google_sheets_trigger_new_row",
          position: { x: 100, y: 260 },
          data: { type: "google_sheets_trigger_new_row", title: "New Sheets Row", config: {}, isTrigger: true, needsConfiguration: true }
        },
        {
          id: "airtable-create",
          type: "airtable_action_create_record",
          position: { x: 380, y: 200 },
          data: { type: "airtable_action_create_record", title: "Create Airtable Record", config: {}, needsConfiguration: true }
        },
        {
          id: "gmail-confirm",
          type: "gmail_action_send_email",
          position: { x: 380, y: 360 },
          data: { type: "gmail_action_send_email", title: "Send Confirmation", config: { subject: "Record synced to Airtable", body: "A new row from Google Sheets has been synced to Airtable." }, needsConfiguration: true }
        }
      ],
      edges: [
        { id: "e1", source: "sheets-trigger", target: "airtable-create" },
        { id: "e2", source: "sheets-trigger", target: "gmail-confirm" }
      ]
    }
  },
  {
    id: "cross-platform-file-sync",
    name: "Cross-Platform File Sync",
    description: "When a new file is added to Dropbox, automatically sync it to Google Drive and OneDrive for cross-platform backup.",
    category: "Data Sync",
    tags: ["dropbox", "google-drive", "onedrive", "file-sync"],
    integrations: ["dropbox", "google_drive", "onedrive"],
    difficulty: "beginner",
    estimatedTime: "3 mins",
    workflow_json: {
      nodes: [
        {
          id: "dropbox-trigger",
          type: "dropbox_trigger_new_file",
          position: { x: 100, y: 260 },
          data: { type: "dropbox_trigger_new_file", title: "New File in Dropbox", config: {}, isTrigger: true, needsConfiguration: true }
        },
        {
          id: "gdrive-upload",
          type: "google_drive_action_upload_file",
          position: { x: 380, y: 180 },
          data: { type: "google_drive_action_upload_file", title: "Upload to Drive", config: {}, needsConfiguration: true }
        },
        {
          id: "onedrive-upload",
          type: "onedrive_action_upload_file",
          position: { x: 380, y: 360 },
          data: { type: "onedrive_action_upload_file", title: "Upload to OneDrive", config: {}, needsConfiguration: true }
        }
      ],
      edges: [
        { id: "e1", source: "dropbox-trigger", target: "gdrive-upload" },
        { id: "e2", source: "dropbox-trigger", target: "onedrive-upload" }
      ]
    }
  },
  {
    id: "hubspot-contact-sheets-report",
    name: "HubSpot Contact to Sheets Report",
    description: "When a HubSpot contact is updated, log changes to Google Sheets and send a Gmail alert for high-value contacts.",
    category: "Data Sync",
    tags: ["hubspot", "google-sheets", "crm", "reporting"],
    integrations: ["hubspot", "google_sheets", "gmail"],
    difficulty: "intermediate",
    estimatedTime: "6 mins",
    workflow_json: {
      nodes: [
        {
          id: "hubspot-trigger",
          type: "hubspot_trigger_contact_updated",
          position: { x: 100, y: 260 },
          data: { type: "hubspot_trigger_contact_updated", title: "Contact Updated", config: {}, isTrigger: true, needsConfiguration: true }
        },
        {
          id: "sheets-log",
          type: "google_sheets_action_add_row",
          position: { x: 380, y: 260 },
          data: { type: "google_sheets_action_add_row", title: "Log to Sheets", config: { values: { "Email": "{{hubspot-trigger.email}}", "Name": "{{hubspot-trigger.firstname}} {{hubspot-trigger.lastname}}", "Company": "{{hubspot-trigger.company}}", "Updated": "{{hubspot-trigger.lastmodifieddate}}" } }, needsConfiguration: true }
        },
        {
          id: "gmail-alert",
          type: "gmail_action_send_email",
          position: { x: 660, y: 260 },
          data: { type: "gmail_action_send_email", title: "Alert for High-Value", config: { subject: "High-Value Contact Updated: {{hubspot-trigger.email}}", body: "Contact {{hubspot-trigger.firstname}} {{hubspot-trigger.lastname}} has been updated in HubSpot." }, needsConfiguration: true }
        }
      ],
      edges: [
        { id: "e1", source: "hubspot-trigger", target: "sheets-log" },
        { id: "e2", source: "sheets-log", target: "gmail-alert" }
      ]
    }
  },

  // ============== ADDITIONAL HR TEMPLATES ==============

  {
    id: "new-employee-it-checklist",
    name: "New Employee IT Setup Checklist",
    description: "When a new hire email arrives, AI extracts details, creates a Trello IT checklist card, sets up an orientation calendar event, and sends a Teams welcome message.",
    category: "HR",
    tags: ["onboarding", "trello", "calendar", "teams", "new-hire"],
    integrations: ["gmail", "trello", "google_calendar", "teams"],
    difficulty: "advanced",
    estimatedTime: "10 mins",
    workflow_json: {
      nodes: [
        {
          id: "gmail-trigger",
          type: "gmail_trigger_new_email",
          position: { x: 100, y: 280 },
          data: { type: "gmail_trigger_new_email", title: "New Hire Email", config: { subjectFilter: "[NEW HIRE]" }, isTrigger: true, needsConfiguration: true }
        },
        {
          id: "ai-extract",
          type: "ai_message",
          position: { x: 380, y: 280 },
          data: {
            type: "ai_message", title: "Extract Hire Details", config: {
              model: "gpt-4o-mini", apiSource: "chainreact", temperature: 0.2,
              userPrompt: "From this new hire email: {{gmail-trigger.body}}, extract: full name, role/title, start date, and manager name.",
              outputFields: "name | Full name\nrole | Job title\nstart_date | Start date\nmanager | Manager name"
            }, needsConfiguration: false
          }
        },
        {
          id: "trello-card",
          type: "trello_action_create_card",
          position: { x: 660, y: 160 },
          data: { type: "trello_action_create_card", title: "Create IT Checklist", config: { name: "IT Setup: {{ai-extract.name}} - {{ai-extract.role}}", desc: "Start date: {{ai-extract.start_date}}\nManager: {{ai-extract.manager}}\n\nChecklist:\n- [ ] Laptop provisioned\n- [ ] Email account created\n- [ ] Slack/Teams access\n- [ ] VPN setup\n- [ ] Badge access" }, needsConfiguration: true }
        },
        {
          id: "calendar-event",
          type: "google_calendar_action_create_event",
          position: { x: 660, y: 320 },
          data: { type: "google_calendar_action_create_event", title: "Orientation Event", config: { summary: "Orientation: {{ai-extract.name}}", description: "New hire orientation for {{ai-extract.name}} ({{ai-extract.role}})" }, needsConfiguration: true }
        },
        {
          id: "teams-welcome",
          type: "teams_action_send_message",
          position: { x: 660, y: 460 },
          data: { type: "teams_action_send_message", title: "Teams Welcome", config: { message: "Welcome {{ai-extract.name}} joining as {{ai-extract.role}}! Start date: {{ai-extract.start_date}}. Manager: {{ai-extract.manager}}" }, needsConfiguration: true }
        }
      ],
      edges: [
        { id: "e1", source: "gmail-trigger", target: "ai-extract" },
        { id: "e2", source: "ai-extract", target: "trello-card" },
        { id: "e3", source: "ai-extract", target: "calendar-event" },
        { id: "e4", source: "ai-extract", target: "teams-welcome" }
      ]
    }
  },

  // ============== ADDITIONAL SALES & CRM TEMPLATES ==============

  {
    id: "stripe-customer-lifecycle",
    name: "Stripe Customer Lifecycle Tracker",
    description: "Track Stripe payments, update HubSpot contacts, and send different Slack notifications for new vs repeat customers.",
    category: "Sales & CRM",
    tags: ["stripe", "hubspot", "lifecycle", "crm"],
    integrations: ["stripe", "hubspot", "slack"],
    difficulty: "intermediate",
    estimatedTime: "7 mins",
    workflow_json: {
      nodes: [
        {
          id: "stripe-trigger",
          type: "stripe_trigger_payment_received",
          position: { x: 100, y: 260 },
          data: { type: "stripe_trigger_payment_received", title: "Payment Received", config: {}, isTrigger: true, needsConfiguration: true }
        },
        {
          id: "hubspot-update",
          type: "hubspot_action_update_contact",
          position: { x: 380, y: 260 },
          data: { type: "hubspot_action_update_contact", title: "Update HubSpot", config: { email: "{{stripe-trigger.customer_email}}", properties: { last_payment_date: "{{stripe-trigger.created}}", total_spent: "{{stripe-trigger.amount}}" } }, needsConfiguration: true }
        },
        {
          id: "slack-new-customer",
          type: "slack_action_send_message",
          position: { x: 660, y: 180 },
          data: { type: "slack_action_send_message", title: "New Customer Alert", config: { channel: "#sales", message: "New customer! {{stripe-trigger.customer_email}} - {{stripe-trigger.amount}}" }, needsConfiguration: true }
        },
        {
          id: "slack-repeat",
          type: "slack_action_send_message",
          position: { x: 660, y: 360 },
          data: { type: "slack_action_send_message", title: "Repeat Purchase", config: { channel: "#sales", message: "Repeat purchase from {{stripe-trigger.customer_email}} - {{stripe-trigger.amount}}" }, needsConfiguration: true }
        }
      ],
      edges: [
        { id: "e1", source: "stripe-trigger", target: "hubspot-update" },
        { id: "e2", source: "hubspot-update", target: "slack-new-customer" },
        { id: "e3", source: "hubspot-update", target: "slack-repeat" }
      ]
    }
  },
  {
    id: "ai-lead-scoring",
    name: "AI Lead Scoring",
    description: "When a new HubSpot contact is created, AI scores the lead 1-10, and high-scoring leads trigger a Slack alert and are logged to Google Sheets.",
    category: "Sales & CRM",
    tags: ["hubspot", "ai", "lead-scoring", "sales"],
    integrations: ["hubspot", "google_sheets", "slack"],
    difficulty: "advanced",
    estimatedTime: "8 mins",
    workflow_json: {
      nodes: [
        {
          id: "hubspot-trigger",
          type: "hubspot_trigger_new_contact",
          position: { x: 100, y: 260 },
          data: { type: "hubspot_trigger_new_contact", title: "New Contact", config: {}, isTrigger: true, needsConfiguration: true }
        },
        {
          id: "ai-score",
          type: "ai_message",
          position: { x: 380, y: 260 },
          data: {
            type: "ai_message", title: "Score Lead", config: {
              model: "gpt-4o-mini", apiSource: "chainreact", temperature: 0.2,
              userPrompt: "Score this lead 1-10 based on: Email: {{hubspot-trigger.email}}, Company: {{hubspot-trigger.company}}, Job Title: {{hubspot-trigger.jobtitle}}. Consider company size signals, seniority, and domain quality.",
              outputFields: "score | Lead score (1-10)\nreason | Scoring rationale"
            }, needsConfiguration: false
          }
        },
        {
          id: "sheets-log",
          type: "google_sheets_action_add_row",
          position: { x: 660, y: 200 },
          data: { type: "google_sheets_action_add_row", title: "Log Lead", config: { values: { "Email": "{{hubspot-trigger.email}}", "Company": "{{hubspot-trigger.company}}", "Score": "{{ai-score.score}}", "Reason": "{{ai-score.reason}}" } }, needsConfiguration: true }
        },
        {
          id: "slack-hot-lead",
          type: "slack_action_send_message",
          position: { x: 660, y: 360 },
          data: { type: "slack_action_send_message", title: "Hot Lead Alert", config: { channel: "#sales-hot-leads", message: "Hot lead (Score: {{ai-score.score}}/10): {{hubspot-trigger.email}} at {{hubspot-trigger.company}}. Reason: {{ai-score.reason}}" }, needsConfiguration: true }
        }
      ],
      edges: [
        { id: "e1", source: "hubspot-trigger", target: "ai-score" },
        { id: "e2", source: "ai-score", target: "sheets-log" },
        { id: "e3", source: "ai-score", target: "slack-hot-lead" }
      ]
    }
  },

  // ============== ADDITIONAL CUSTOMER SERVICE TEMPLATES ==============

  {
    id: "ai-email-support-triage",
    name: "AI Email Support Triage",
    description: "Incoming support emails are classified by AI into bug, feature, support, sales, or general, then routed to the right Slack channel and logged in Airtable.",
    category: "Customer Service",
    tags: ["email", "ai-router", "support", "triage", "airtable"],
    integrations: ["gmail", "slack", "airtable"],
    difficulty: "advanced",
    estimatedTime: "10 mins",
    workflow_json: {
      nodes: [
        {
          id: "gmail-trigger",
          type: "gmail_trigger_new_email",
          position: { x: 100, y: 280 },
          data: { type: "gmail_trigger_new_email", title: "Support Email", config: {}, isTrigger: true, needsConfiguration: true }
        },
        {
          id: "ai-router-triage",
          type: "ai_router",
          position: { x: 380, y: 280 },
          data: {
            type: "ai_router", title: "Triage Email", config: {
              template: "custom",
              systemPrompt: "Classify this support email into: bug_report, feature_request, support_question, sales_inquiry, or general. Extract a brief summary.",
              model: "gpt-4o-mini", apiSource: "chainreact", memory: "workflow",
              outputPaths: [
                { id: "bug", name: "Bug Report", description: "Software bugs", color: "#ef4444", condition: { type: "ai_decision", minConfidence: 0.6 } },
                { id: "feature", name: "Feature Request", description: "Feature ideas", color: "#8b5cf6", condition: { type: "ai_decision", minConfidence: 0.6 } },
                { id: "support", name: "Support", description: "Help needed", color: "#3b82f6", condition: { type: "ai_decision", minConfidence: 0.6 } },
                { id: "sales", name: "Sales", description: "Sales inquiries", color: "#10b981", condition: { type: "ai_decision", minConfidence: 0.6 } },
                { id: "general", name: "General", description: "Everything else", color: "#6b7280", condition: { type: "fallback" } }
              ],
              decisionMode: "single", includeReasoning: true, temperature: 0.2
            }, needsConfiguration: false
          }
        },
        {
          id: "slack-route",
          type: "slack_action_send_message",
          position: { x: 660, y: 200 },
          data: { type: "slack_action_send_message", title: "Route to Slack", config: { message: "New {{ai-router-triage.selectedPath}} from {{gmail-trigger.from}}: {{gmail-trigger.subject}}" }, needsConfiguration: true }
        },
        {
          id: "airtable-ticket",
          type: "airtable_action_create_record",
          position: { x: 660, y: 380 },
          data: { type: "airtable_action_create_record", title: "Create Ticket", config: { fields: { "Subject": "{{gmail-trigger.subject}}", "From": "{{gmail-trigger.from}}", "Category": "{{ai-router-triage.selectedPath}}", "Date": "{{gmail-trigger.date}}" } }, needsConfiguration: true }
        }
      ],
      edges: [
        { id: "e1", source: "gmail-trigger", target: "ai-router-triage" },
        { id: "e2", source: "ai-router-triage", target: "slack-route" },
        { id: "e3", source: "ai-router-triage", target: "airtable-ticket" }
      ]
    }
  },
  {
    id: "outlook-to-monday-tickets",
    name: "Outlook to Monday.com Tickets",
    description: "Support emails in Outlook are processed by AI to extract issue details, create Monday.com items, and send an auto-reply.",
    category: "Customer Service",
    tags: ["outlook", "monday", "support", "tickets"],
    integrations: ["outlook", "monday"],
    difficulty: "intermediate",
    estimatedTime: "6 mins",
    workflow_json: {
      nodes: [
        {
          id: "outlook-trigger",
          type: "outlook_trigger_new_email",
          position: { x: 100, y: 260 },
          data: { type: "outlook_trigger_new_email", title: "Support Email", config: {}, isTrigger: true, needsConfiguration: true }
        },
        {
          id: "ai-extract",
          type: "ai_message",
          position: { x: 380, y: 260 },
          data: {
            type: "ai_message", title: "Extract Issue", config: {
              model: "gpt-4o-mini", apiSource: "chainreact", temperature: 0.2,
              userPrompt: "From this support email (Subject: {{outlook-trigger.subject}}, Body: {{outlook-trigger.body}}), extract: issue title, priority (Low/Medium/High/Critical), and a brief description.",
              outputFields: "title | Issue title\npriority | Priority level\ndescription | Issue description"
            }, needsConfiguration: false
          }
        },
        {
          id: "monday-item",
          type: "monday_action_create_item",
          position: { x: 660, y: 200 },
          data: { type: "monday_action_create_item", title: "Create Ticket", config: { itemName: "[{{ai-extract.priority}}] {{ai-extract.title}}" }, needsConfiguration: true }
        },
        {
          id: "outlook-reply",
          type: "outlook_action_send_email",
          position: { x: 660, y: 360 },
          data: { type: "outlook_action_send_email", title: "Auto-Reply", config: { to: "{{outlook-trigger.from}}", subject: "Re: {{outlook-trigger.subject}}", body: "Thank you for contacting support. Your ticket has been created and our team will respond within 24 hours." }, needsConfiguration: true }
        }
      ],
      edges: [
        { id: "e1", source: "outlook-trigger", target: "ai-extract" },
        { id: "e2", source: "ai-extract", target: "monday-item" },
        { id: "e3", source: "ai-extract", target: "outlook-reply" }
      ]
    }
  },
  {
    id: "discord-community-manager",
    name: "Discord Community Manager",
    description: "AI classifies Discord messages into questions, feedback, or spam, then responds appropriately and logs everything to Airtable.",
    category: "Customer Service",
    tags: ["discord", "ai-router", "community", "moderation"],
    integrations: ["discord", "airtable"],
    difficulty: "intermediate",
    estimatedTime: "8 mins",
    workflow_json: {
      nodes: [
        {
          id: "discord-trigger",
          type: "discord_trigger_new_message",
          position: { x: 100, y: 280 },
          data: { type: "discord_trigger_new_message", title: "New Message", config: {}, isTrigger: true, needsConfiguration: true }
        },
        {
          id: "ai-router-community",
          type: "ai_router",
          position: { x: 380, y: 280 },
          data: {
            type: "ai_router", title: "Classify Message", config: {
              template: "custom",
              systemPrompt: "Classify this Discord community message into: question (needs help), feedback (product ideas/suggestions), or spam (irrelevant/promotional). Provide a helpful auto-response for questions.",
              model: "gpt-4o-mini", apiSource: "chainreact", memory: "workflow",
              outputPaths: [
                { id: "question", name: "Question", description: "Needs help", color: "#3b82f6", condition: { type: "ai_decision", minConfidence: 0.6 } },
                { id: "feedback", name: "Feedback", description: "Product feedback", color: "#10b981", condition: { type: "ai_decision", minConfidence: 0.6 } },
                { id: "spam", name: "Spam", description: "Irrelevant content", color: "#ef4444", condition: { type: "fallback" } }
              ],
              decisionMode: "single", includeReasoning: true, temperature: 0.3
            }, needsConfiguration: false
          }
        },
        {
          id: "discord-response",
          type: "discord_action_send_message",
          position: { x: 660, y: 200 },
          data: { type: "discord_action_send_message", title: "Auto-Respond", config: { message: "{{ai-router-community.reasoning}}" }, needsConfiguration: true }
        },
        {
          id: "airtable-log",
          type: "airtable_action_create_record",
          position: { x: 660, y: 380 },
          data: { type: "airtable_action_create_record", title: "Log Message", config: { fields: { "Message": "{{discord-trigger.content}}", "Category": "{{ai-router-community.selectedPath}}", "Author": "{{discord-trigger.author}}", "Date": "{{discord-trigger.timestamp}}" } }, needsConfiguration: true }
        }
      ],
      edges: [
        { id: "e1", source: "discord-trigger", target: "ai-router-community" },
        { id: "e2", source: "ai-router-community", target: "discord-response" },
        { id: "e3", source: "ai-router-community", target: "airtable-log" }
      ]
    }
  },

  // ============== ADDITIONAL AI AUTOMATION TEMPLATES ==============

  {
    id: "smart-email-classifier",
    name: "Smart Email Classifier & Responder",
    description: "AI classifies incoming emails into urgent, important, FYI, or spam, drafts appropriate responses for each, and logs everything to Airtable.",
    category: "AI Automation",
    tags: ["email", "ai-router", "classifier", "automation"],
    integrations: ["gmail", "airtable"],
    difficulty: "advanced",
    estimatedTime: "10 mins",
    workflow_json: {
      nodes: [
        {
          id: "gmail-trigger",
          type: "gmail_trigger_new_email",
          position: { x: 100, y: 280 },
          data: { type: "gmail_trigger_new_email", title: "Incoming Email", config: {}, isTrigger: true, needsConfiguration: true }
        },
        {
          id: "ai-router-classify",
          type: "ai_router",
          position: { x: 380, y: 280 },
          data: {
            type: "ai_router", title: "Classify Email", config: {
              template: "custom",
              systemPrompt: "Classify this email into: urgent (needs immediate action), important (needs action today), fyi (informational only), or spam (promotional/irrelevant). Consider the sender, subject, and content.",
              model: "gpt-4o-mini", apiSource: "chainreact", memory: "workflow",
              outputPaths: [
                { id: "urgent", name: "Urgent", description: "Needs immediate action", color: "#ef4444", condition: { type: "ai_decision", minConfidence: 0.6 } },
                { id: "important", name: "Important", description: "Needs action today", color: "#f59e0b", condition: { type: "ai_decision", minConfidence: 0.6 } },
                { id: "fyi", name: "FYI", description: "Informational only", color: "#3b82f6", condition: { type: "ai_decision", minConfidence: 0.6 } },
                { id: "spam", name: "Spam", description: "Promotional/irrelevant", color: "#6b7280", condition: { type: "fallback" } }
              ],
              decisionMode: "single", includeReasoning: true, temperature: 0.2
            }, needsConfiguration: false
          }
        },
        {
          id: "ai-draft-response",
          type: "ai_message",
          position: { x: 660, y: 200 },
          data: {
            type: "ai_message", title: "Draft Response", config: {
              model: "gpt-4o-mini", apiSource: "chainreact", temperature: 0.4,
              userPrompt: "Draft a brief, professional response to this email from {{gmail-trigger.from}} with subject '{{gmail-trigger.subject}}'. Category: {{ai-router-classify.selectedPath}}.",
              outputFields: "response | Draft email response"
            }, needsConfiguration: false
          }
        },
        {
          id: "airtable-log",
          type: "airtable_action_create_record",
          position: { x: 660, y: 380 },
          data: { type: "airtable_action_create_record", title: "Log Email", config: { fields: { "Subject": "{{gmail-trigger.subject}}", "From": "{{gmail-trigger.from}}", "Category": "{{ai-router-classify.selectedPath}}", "Draft Response": "{{ai-draft-response.response}}" } }, needsConfiguration: true }
        }
      ],
      edges: [
        { id: "e1", source: "gmail-trigger", target: "ai-router-classify" },
        { id: "e2", source: "ai-router-classify", target: "ai-draft-response" },
        { id: "e3", source: "ai-router-classify", target: "airtable-log" }
      ]
    }
  },
  {
    id: "ai-meeting-prep-assistant",
    name: "AI Meeting Prep Assistant",
    description: "Before a Google Calendar meeting, AI generates an agenda, talking points, and attendee research, then saves it to Notion and emails the organizer.",
    category: "AI Automation",
    tags: ["calendar", "ai", "meeting-prep", "notion", "gmail"],
    integrations: ["google_calendar", "notion", "gmail"],
    difficulty: "intermediate",
    estimatedTime: "7 mins",
    workflow_json: {
      nodes: [
        {
          id: "calendar-trigger",
          type: "google_calendar_trigger_event_start",
          position: { x: 100, y: 260 },
          data: { type: "google_calendar_trigger_event_start", title: "Upcoming Meeting", config: {}, isTrigger: true, needsConfiguration: true }
        },
        {
          id: "ai-prep",
          type: "ai_message",
          position: { x: 380, y: 260 },
          data: {
            type: "ai_message", title: "Generate Prep", config: {
              model: "gpt-4o-mini", apiSource: "chainreact", temperature: 0.5,
              userPrompt: "Prepare briefing for meeting: {{calendar-trigger.summary}}. Attendees: {{calendar-trigger.attendees}}. Generate: 1) Meeting agenda (3-5 items), 2) Key talking points, 3) Suggested questions. Keep it concise and actionable.",
              outputFields: "title | Prep document title\nagenda | Meeting agenda\ntalking_points | Key talking points\nquestions | Suggested questions\nemail_brief | Short email briefing"
            }, needsConfiguration: false
          }
        },
        {
          id: "notion-prep",
          type: "notion_action_create_page",
          position: { x: 660, y: 200 },
          data: { type: "notion_action_create_page", title: "Save to Notion", config: { title: "{{ai-prep.title}}", content: "## Agenda\n{{ai-prep.agenda}}\n\n## Talking Points\n{{ai-prep.talking_points}}\n\n## Questions\n{{ai-prep.questions}}" }, needsConfiguration: true }
        },
        {
          id: "gmail-brief",
          type: "gmail_action_send_email",
          position: { x: 660, y: 360 },
          data: { type: "gmail_action_send_email", title: "Email Brief", config: { subject: "Meeting Prep: {{calendar-trigger.summary}}", body: "{{ai-prep.email_brief}}" }, needsConfiguration: true }
        }
      ],
      edges: [
        { id: "e1", source: "calendar-trigger", target: "ai-prep" },
        { id: "e2", source: "ai-prep", target: "notion-prep" },
        { id: "e3", source: "ai-prep", target: "gmail-brief" }
      ]
    }
  }
]

// Helper function to get templates by category
export function getTemplatesByCategory(category: string): PredefinedTemplate[] {
  if (category === "all") return predefinedTemplates
  return predefinedTemplates.filter(t => t.category === category)
}

// Helper function to get templates by integration
export function getTemplatesByIntegration(integration: string): PredefinedTemplate[] {
  return predefinedTemplates.filter(t => t.integrations.includes(integration))
}

// Helper function to search templates
export function getTemplateById(id: string): PredefinedTemplate | undefined {
  return predefinedTemplates.find(t => t.id === id)
}

export function searchTemplates(query: string): PredefinedTemplate[] {
  const lowerQuery = query.toLowerCase()
  return predefinedTemplates.filter(t => 
    t.name.toLowerCase().includes(lowerQuery) ||
    t.description.toLowerCase().includes(lowerQuery) ||
    t.tags.some(tag => tag.toLowerCase().includes(lowerQuery)) ||
    t.integrations.some(int => int.toLowerCase().includes(lowerQuery))
  )
}

// Get unique categories
export const templateCategories = Array.from(new Set(predefinedTemplates.map(t => t.category))).sort()

// Get unique integrations
export const templateIntegrations = Array.from(new Set(predefinedTemplates.flatMap(t => t.integrations))).sort()
