import { ExecutionContext } from '@/types/workflow';
import { ActionResult } from '@/lib/workflows/actions';
import {
  notionCreatePage,
  notionUpdatePage,
  notionRetrievePage,
  notionArchivePage,
  notionDuplicatePage,
  notionAppendBlocks,
  notionUpdateBlock,
  notionDeleteBlock
} from './handlers';

import { logger } from '@/lib/utils/logger'

/**
 * Convert plain text content to Notion block format with markdown-like syntax support
 */
function convertContentToBlocks(content: string): any[] {
  if (!content) return [];

  // Split content by newlines
  const lines = content.split('\n');

  return lines.map(line => {
    const trimmedLine = line.trim();

    // Empty line becomes empty paragraph
    if (!trimmedLine) {
      return {
        type: 'paragraph',
        paragraph: {
          rich_text: []
        }
      };
    }

    // H1 Header: # text
    if (trimmedLine.startsWith('# ')) {
      return {
        type: 'heading_1',
        heading_1: {
          rich_text: [{
            type: 'text',
            text: {
              content: trimmedLine.substring(2).trim()
            }
          }]
        }
      };
    }

    // H2 Header: ## text
    if (trimmedLine.startsWith('## ')) {
      return {
        type: 'heading_2',
        heading_2: {
          rich_text: [{
            type: 'text',
            text: {
              content: trimmedLine.substring(3).trim()
            }
          }]
        }
      };
    }

    // H3 Header: ### text
    if (trimmedLine.startsWith('### ')) {
      return {
        type: 'heading_3',
        heading_3: {
          rich_text: [{
            type: 'text',
            text: {
              content: trimmedLine.substring(4).trim()
            }
          }]
        }
      };
    }

    // Bullet list: - text or * text
    if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('* ')) {
      return {
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [{
            type: 'text',
            text: {
              content: trimmedLine.substring(2).trim()
            }
          }]
        }
      };
    }

    // Numbered list: 1. text (any number followed by .)
    if (/^\d+\.\s/.test(trimmedLine)) {
      const textContent = trimmedLine.replace(/^\d+\.\s/, '').trim();
      return {
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: [{
            type: 'text',
            text: {
              content: textContent
            }
          }]
        }
      };
    }

    // Todo list: [] text or [ ] text (unchecked) or [x] text or [X] text (checked)
    if (trimmedLine.startsWith('[]') || trimmedLine.startsWith('[ ]')) {
      const textContent = trimmedLine.replace(/^\[\s?\]\s?/, '').trim();
      return {
        type: 'to_do',
        to_do: {
          rich_text: [{
            type: 'text',
            text: {
              content: textContent
            }
          }],
          checked: false
        }
      };
    }

    if (trimmedLine.startsWith('[x]') || trimmedLine.startsWith('[X]')) {
      const textContent = trimmedLine.replace(/^\[[xX]\]\s?/, '').trim();
      return {
        type: 'to_do',
        to_do: {
          rich_text: [{
            type: 'text',
            text: {
              content: textContent
            }
          }],
          checked: true
        }
      };
    }

    // Quote/callout: > text
    if (trimmedLine.startsWith('> ')) {
      return {
        type: 'quote',
        quote: {
          rich_text: [{
            type: 'text',
            text: {
              content: trimmedLine.substring(2).trim()
            }
          }]
        }
      };
    }

    // Code block: ``` or lines starting with 4 spaces
    if (trimmedLine.startsWith('```')) {
      const codeContent = trimmedLine.substring(3).trim();
      return {
        type: 'code',
        code: {
          rich_text: [{
            type: 'text',
            text: {
              content: codeContent || ' ' // Notion requires at least one character
            }
          }],
          language: 'plain text'
        }
      };
    }

    // Divider: --- or ***
    if (trimmedLine === '---' || trimmedLine === '***') {
      return {
        type: 'divider',
        divider: {}
      };
    }

    // Default: paragraph
    return {
      type: 'paragraph',
      paragraph: {
        rich_text: [{
          type: 'text',
          text: {
            content: line // Use original line to preserve indentation
          }
        }]
      }
    };
  });
}

/**
 * Create a mock ExecutionContext for handlers
 */
function createContext(userId: string, input: Record<string, any>): ExecutionContext {
  return {
    userId,
    workflowId: '',
    executionId: '',
    nodeId: '',
    testMode: false,
    dataFlowManager: {
      resolveVariable: (value: any) => {
        // Simple variable resolution - just return the value
        // In a real scenario, this would resolve {{variables}}
        if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
          const path = value.slice(2, -2);
          return path.split('.').reduce((acc: any, part: string) => acc?.[part], input);
        }
        return value;
      },
      storeNodeOutput: () => {},
      getNodeOutput: () => ({}),
      getAllOutputs: () => ({})
    } as any
  };
}

/**
 * Execute Create Page action
 */
export async function executeNotionCreatePage(
  config: any,
  userId: string,
  input: Record<string, any>,
  meta?: import('../core/idempotencyKey').HandlerExecutionMeta,
): Promise<ActionResult> {
  const context = createContext(userId, input);

  try {
    // Validate parent selection
    if (!config.parentType) {
      return {
        success: false,
        output: {},
        message: 'Please select where to create the page (Database or Page)'
      };
    }

    if (config.parentType === 'database' && !config.parentDatabase) {
      return {
        success: false,
        output: {},
        message: 'Please select a database to create the page in'
      };
    }

    if (config.parentType === 'page' && !config.parentPage) {
      return {
        success: false,
        output: {},
        message: 'Please select a parent page to create the page under'
      };
    }

    // Map fields for create page
    const createConfig = {
      workspace: config.workspace,
      title: config.title,
      parent_type: config.parentType,
      database_id: config.parentDatabase,
      parent_page_id: config.parentPage,
      icon_type: config.iconType,
      icon_emoji: config.iconEmoji,
      icon_url: config.iconUrl,
      cover_type: config.coverType,
      cover_url: config.coverUrl,
      // Convert content to blocks if provided
      content_blocks: config.contentBlocks || (config.content ? convertContentToBlocks(config.content) : undefined),
      properties: config.properties
    };

    return await notionCreatePage(createConfig, context, meta);
  } catch (error: any) {
    logger.error('Notion create page error:', error);
    return {
      success: false,
      output: {},
      message: error.message || 'Failed to create Notion page'
    };
  }
}

/**
 * Execute Update Page action
 */
export async function executeNotionUpdatePage(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  logger.info('[Notion Update Wrapper] Entering executeNotionUpdatePage', {
    hasPage: !!config.page,
    pageValue: config.page ? String(config.page).substring(0, 40) : 'MISSING',
    hasTitle: !!config.title,
    hasPageFields: !!config.pageFields,
    pageFieldKeys: config.pageFields ? Object.keys(config.pageFields) : [],
    inputKeys: Object.keys(input || {}),
  })

  const context = createContext(userId, input);

  try {
    // Extract block content from pageFields
    const pageFieldsData = config.pageFields || {};
    const blockContent: any[] = [];
    const pageProperties: any = {};

    // Separate block content from page properties
    for (const [key, value] of Object.entries(pageFieldsData)) {
      // Check if this is block content
      if (key === 'todo-items' && value && typeof value === 'object') {
        // Handle todo list blocks
        const todoData = value as any;
        if (todoData.items && Array.isArray(todoData.items)) {
          todoData.items.forEach((item: any) => {
            blockContent.push({
              object: 'block',
              type: 'to_do',
              to_do: {
                rich_text: [{
                  type: 'text',
                  text: {
                    content: item.content || item.text || ''
                  }
                }],
                checked: item.checked || false
              }
            });
          });
        }
      } else if (key.includes('-content') && value) {
        // Handle other content blocks
        if (typeof value === 'string' && value.trim()) {
          blockContent.push({
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{
                type: 'text',
                text: {
                  content: value
                }
              }]
            }
          });
        }
      } else {
        // Regular page property
        pageProperties[key] = value;
      }
    }

    // First update the page properties
    const updateConfig = {
      page_id: config.page,
      title: config.title,
      properties: pageProperties,
      icon_type: config.iconType,
      icon_emoji: config.iconEmoji,
      icon_url: config.iconUrl,
      cover_type: config.coverType,
      cover_url: config.coverUrl
    };
    const updateResult = await notionUpdatePage(updateConfig, context);

    // Handle block updates
    if (updateResult.success) {
      const blockUpdates: any[] = [];
      const blocksToAdd: any[] = [];
      const blocksToDelete: string[] = [];

      // Read explicit block deletions from config (from NotionDeletableBlocksField)
      if (config.blocksToDelete?.selectedBlockIds && Array.isArray(config.blocksToDelete.selectedBlockIds)) {
        blocksToDelete.push(...config.blocksToDelete.selectedBlockIds);
        logger.info(`🗑️ Explicit block deletions from config: ${blocksToDelete.length} blocks`);
      }

      // Process todo items
      if (pageFieldsData['todo-items'] && pageFieldsData['todo-items'].items) {
        const todoItems = pageFieldsData['todo-items'].items;

        for (const item of todoItems) {
          const blockId = item.blockId || item.id;
          if (blockId && !blockId.startsWith('new-')) {
            // Existing block - update it
            blockUpdates.push({
              block_id: blockId,
              to_do: {
                rich_text: [{
                  type: 'text',
                  text: {
                    content: item.content || ''
                  }
                }],
                checked: item.checked || false
              }
            });
          } else {
            // New block - add it
            blocksToAdd.push({
              object: 'block',
              type: 'to_do',
              to_do: {
                rich_text: [{
                  type: 'text',
                  text: {
                    content: item.content || ''
                  }
                }],
                checked: item.checked || false
              }
            });
          }
        }

        // Track deleted items by comparing with originalItems (if provided)
        if (pageFieldsData['todo-items'].originalItems && Array.isArray(pageFieldsData['todo-items'].originalItems)) {
          const originalItems = pageFieldsData['todo-items'].originalItems;
          const originalIds = new Set(
            originalItems
              .map((item: any) => item.blockId || item.id)
              .filter((id: string) => id && !id.startsWith('new-'))
          );
          const currentIds = new Set(
            todoItems
              .map((item: any) => item.blockId || item.id)
              .filter((id: string) => id && !id.startsWith('new-'))
          );

          // Find items that existed originally but are now missing
          for (const originalId of originalIds) {
            if (!currentIds.has(originalId)) {
              blocksToDelete.push(originalId);
              logger.info(`🗑️ Marking todo block for deletion: ${originalId}`);
            }
          }
        }
      }

      // Process other content blocks
      for (const [key, value] of Object.entries(pageFieldsData)) {
        if (key.includes('-content') && value) {
          const blockIdWithDashes = key.replace('-content', '');
          const blockId = blockIdWithDashes.replace(/-/g, '');

          if (blockId && blockId.length === 32) {
            blockUpdates.push({
              block_id: blockId,
              paragraph: {
                rich_text: [{
                  type: 'text',
                  text: {
                    content: value
                  }
                }]
              }
            });
          }
        }
      }

      // Execute block updates
      let updatedCount = 0;
      for (const update of blockUpdates) {
        try {
          const { block_id, ...blockContent } = update;
          await notionUpdateBlock({ block_id, block_content: blockContent }, context);
          updatedCount++;
        } catch (error) {
          logger.warn(`Failed to update block:`, error);
        }
      }

      // Add new blocks
      if (blocksToAdd.length > 0) {
        await notionAppendBlocks({ page_id: config.page, blocks: blocksToAdd }, context);
      }

      // Delete removed blocks if any
      if (blocksToDelete.length > 0) {
        logger.info(`🗑️ Deleting ${blocksToDelete.length} blocks`);
        for (const blockId of blocksToDelete) {
          try {
            await notionDeleteBlock({ block_id: blockId }, context);
          } catch (error) {
            logger.warn(`⚠️ Failed to delete block ${blockId}:`, error);
          }
        }
      }

      return {
        success: true,
        output: {
          ...updateResult.output,
          blocks_updated: updatedCount,
          blocks_added: blocksToAdd.length,
          blocks_deleted: blocksToDelete.length
        }
      };
    }

    return updateResult;
  } catch (error: any) {
    logger.error('[Notion Update Wrapper] executeNotionUpdatePage failed', {
      error: error.message || String(error),
      stack: error.stack?.split('\n').slice(0, 3).join('\n'),
      pageId: config.page || 'unknown',
    });
    return {
      success: false,
      output: {},
      message: error.message || 'Failed to update Notion page'
    };
  }
}

/**
 * Execute Append to Page action
 */
export async function executeNotionAppendToPage(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  const context = createContext(userId, input);

  try {
    // Convert content to blocks
    const appendConfig = {
      page_id: config.page,
      blocks: config.content ? convertContentToBlocks(config.content) : [],
      after: config.after
    };

    return await notionAppendBlocks(appendConfig, context);
  } catch (error: any) {
    logger.error('Notion append to page error:', error);
    return {
      success: false,
      output: {},
      message: error.message || 'Failed to append to Notion page'
    };
  }
}

/**
 * Execute Get Page Details action
 * (Note: This already exists as notionGetPageDetails, but we create a wrapper for consistency)
 */
export async function executeNotionGetPageDetailsAction(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  const context = createContext(userId, input);

  try {
    const getDetailsConfig = {
      page_id: config.page,
      include_properties: config.includeProperties === 'true',
      include_content: config.includeContent === 'true'
    };

    return await notionRetrievePage(getDetailsConfig, context);
  } catch (error: any) {
    logger.error('Notion get page details error:', error);
    return {
      success: false,
      output: {},
      message: error.message || 'Failed to get Notion page details'
    };
  }
}

/**
 * Execute Archive Page action
 */
export async function executeNotionArchivePageAction(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  const context = createContext(userId, input);

  try {
    // Determine page ID based on action type
    // For archive action, use pageToArchive; for unarchive, use pageToUnarchive
    // Also support legacy 'page' field for backward compatibility
    const pageId = config.archiveAction === 'archive'
      ? (config.pageToArchive || config.page)
      : (config.pageToUnarchive || config.page);

    if (!pageId) {
      return {
        success: false,
        output: {},
        message: config.archiveAction === 'archive'
          ? 'Please select a page to archive'
          : 'Please select an archived page to restore'
      };
    }

    const archiveConfig = {
      page_id: pageId,
      archived: config.archiveAction === 'archive' ? 'true' : 'false'
    };

    return await notionArchivePage(archiveConfig, context);
  } catch (error: any) {
    logger.error('Notion archive page error:', error);
    return {
      success: false,
      output: {},
      message: error.message || 'Failed to archive/unarchive Notion page'
    };
  }
}

/**
 * Execute Duplicate Page action
 */
export async function executeNotionDuplicatePageAction(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  const context = createContext(userId, input);

  try {
    const duplicateConfig = {
      source_page_id: config.page,
      destination_type: config.destinationPage ? 'page' : 'same_parent',
      destination_page_id: config.destinationPage,
      title_suffix: config.titleSuffix || ' (Copy)',
      include_content: config.includeContent !== false,
      include_children: config.includeChildren === true
    };

    return await notionDuplicatePage(duplicateConfig, context);
  } catch (error: any) {
    logger.error('Notion duplicate page error:', error);
    return {
      success: false,
      output: {},
      message: error.message || 'Failed to duplicate Notion page'
    };
  }
}
