/**
 * Provider Registry
 * Central registry for all provider-specific option loaders
 */

import { ProviderOptionsLoader, ProviderRegistry as IProviderRegistry } from './types';
import { DiscordOptionsLoader } from './discord/discordOptionsLoader';
import { AirtableOptionsLoader } from './airtable/airtableOptionsLoader';
import { FacebookOptionsLoader } from './facebook/facebookOptionsLoader';
import { hubspotOptionsLoader } from './hubspot/hubspotOptionsLoader';
import { hubspotDynamicOptionsLoader } from './hubspot/hubspotDynamicOptionsLoader';
import { onenoteOptionsLoader } from './onenote/optionsLoader';
import { notionOptionsLoader } from './notion/options';
import { GoogleDriveOptionsLoader } from './google-drive/GoogleDriveOptionsLoader';
import { GoogleSheetsOptionsLoader } from './google-sheets/GoogleSheetsOptionsLoader';
import { DropboxOptionsLoader } from './dropbox/dropboxOptionsLoader';
import { outlookOptionsLoader } from './microsoft-outlook/OutlookOptionsLoader';
import { TeamsOptionsLoader } from './teams/TeamsOptionsLoader';
import { GoogleCalendarOptionsLoader } from './google-calendar/GoogleCalendarOptionsLoader';
import { MicrosoftExcelOptionsLoader } from './microsoft-excel/MicrosoftExcelOptionsLoader';
import { AIOptionsLoader } from './ai/AIOptionsLoader';
import { GitHubOptionsLoader } from './github/GitHubOptionsLoader';
import { MondayOptionsLoader } from './monday/MondayOptionsLoader';
import { MailchimpOptionsLoader } from './mailchimp/MailchimpOptionsLoader';
import { TwitterOptionsLoader } from './twitter/TwitterOptionsLoader';
import { GoogleAnalyticsOptionsLoader } from './google-analytics/GoogleAnalyticsOptionsLoader';
import { GmailOptionsLoader } from './gmail/GmailOptionsLoader';
import { SlackOptionsLoader } from './slack/slackOptionsLoader';
import { GumroadOptionsLoader } from './gumroad/gumroadOptionsLoader';
import { StorageOptionsLoader } from './storage/StorageOptionsLoader';
import { ManyChatOptionsLoader } from './manychat/ManyChatOptionsLoader';
import { StripeOptionsLoader } from './stripe/StripeOptionsLoader';

import { logger } from '@/lib/utils/logger'

class ProviderRegistryImpl implements IProviderRegistry {
  private loaders: Map<string, ProviderOptionsLoader[]>;

  constructor() {
    this.loaders = new Map();
    this.registerDefaultLoaders();
  }

  /**
   * Register default provider loaders
   */
  private registerDefaultLoaders(): void {
    // Register Discord loader
    this.register('discord', new DiscordOptionsLoader());
    
    // Register Airtable loader
    this.register('airtable', new AirtableOptionsLoader());
    
    // Register Facebook loader
    this.register('facebook', new FacebookOptionsLoader());
    
    // Register both HubSpot loaders. The base loader covers fixed lookups
    // (listId, contactId, ownerId, etc.); the dynamic loader covers the
    // dynamic-object schema (objectType / properties / recordId /
    // identifierProperty) plus a few overlapping shared fields.
    this.register('hubspot', hubspotOptionsLoader);
    this.register('hubspot', hubspotDynamicOptionsLoader);
    
    // Register OneNote loader for both possible provider IDs
    this.register('microsoft-onenote', onenoteOptionsLoader);
    this.register('onenote', onenoteOptionsLoader);
    
    // Register Notion loader
    this.register('notion', notionOptionsLoader);
    
    // Register Google Drive loader
    this.register('google-drive', new GoogleDriveOptionsLoader());

    // Register Google Sheets loader
    this.register('google-sheets', new GoogleSheetsOptionsLoader());

    // Register Dropbox loader
    this.register('dropbox', new DropboxOptionsLoader());

    // Register Microsoft Outlook loader
    this.register('microsoft-outlook', outlookOptionsLoader);

    // Register Microsoft Teams loader
    this.register('teams', new TeamsOptionsLoader());
    this.register('microsoft-teams', new TeamsOptionsLoader());

    // Register Google Calendar loader
    this.register('google-calendar', new GoogleCalendarOptionsLoader());

    // Register Microsoft Excel loader
    this.register('microsoft-excel', new MicrosoftExcelOptionsLoader());

    // Register AI Agent loader
    this.register('ai', new AIOptionsLoader());

    // Register GitHub loader
    this.register('github', new GitHubOptionsLoader());

    // Register Monday.com loader
    this.register('monday', new MondayOptionsLoader());

    // Register Mailchimp loader
    this.register('mailchimp', new MailchimpOptionsLoader());

    // Register Twitter loader
    this.register('twitter', new TwitterOptionsLoader());

    // Register Google Analytics loader
    this.register('google-analytics', new GoogleAnalyticsOptionsLoader());

    // Register Gmail loader
    this.register('gmail', new GmailOptionsLoader());
    // Register Storage loader for Gmail (for download attachment to storage)
    this.register('gmail', new StorageOptionsLoader());

    // Register Slack loader
    this.register('slack', new SlackOptionsLoader());

    // Register Gumroad loader
    this.register('gumroad', new GumroadOptionsLoader());

    // Register ManyChat loader
    this.register('manychat', new ManyChatOptionsLoader());

    // Register Stripe loader
    this.register('stripe', new StripeOptionsLoader());

    // Additional providers can be registered here as they're implemented
    // this.register('trello', new TrelloOptionsLoader());
  }

  /**
   * Register a loader for a specific provider
   */
  register(providerId: string, loader: ProviderOptionsLoader): void {
    if (!this.loaders.has(providerId)) {
      this.loaders.set(providerId, []);
    }
    
    const providerLoaders = this.loaders.get(providerId)!;
    
    // Check if loader already exists (avoid duplicates)
    const exists = providerLoaders.some(l => 
      l.constructor.name === loader.constructor.name
    );
    
    if (!exists) {
      providerLoaders.push(loader);
      logger.debug(`✅ [Registry] Registered loader for ${providerId}: ${loader.constructor.name}`);
    }
  }

  /**
   * Get a loader that can handle the specific field for a provider
   */
  getLoader(providerId: string, fieldName: string): ProviderOptionsLoader | null {
    logger.debug(`🔍 [Registry] Looking for loader:`, { providerId, fieldName });

    const providerLoaders = this.loaders.get(providerId);

    if (!providerLoaders) {
      logger.warn(`❌ [Registry] No loaders registered for provider: ${providerId}`);
      logger.debug(`[Registry] Available providers:`, Array.from(this.loaders.keys()));
      return null;
    }

    logger.debug(`[Registry] Found ${providerLoaders.length} loader(s) for ${providerId}`);

    // Find the first loader that can handle this field
    for (const loader of providerLoaders) {
      logger.debug(`[Registry] Checking ${loader.constructor.name} for field: ${fieldName}`);
      if (loader.canHandle(fieldName, providerId)) {
        logger.debug(`✅ [Registry] Found loader: ${loader.constructor.name} for ${providerId}.${fieldName}`);
        return loader;
      }
    }

    logger.warn(`❌ [Registry] No loader can handle field ${fieldName} for provider ${providerId}`);
    return null;
  }

  /**
   * Check if there's a loader for the given provider and field
   */
  hasLoader(providerId: string, fieldName: string): boolean {
    return this.getLoader(providerId, fieldName) !== null;
  }

  /**
   * Get all registered provider IDs
   */
  getProviderIds(): string[] {
    return Array.from(this.loaders.keys());
  }

  /**
   * Clear all registered loaders
   */
  clear(): void {
    this.loaders.clear();
  }

  /**
   * Re-initialize with default loaders
   */
  reset(): void {
    this.clear();
    this.registerDefaultLoaders();
  }
}

// Export singleton instance
export const providerRegistry = new ProviderRegistryImpl();

// Export type for dependency injection if needed
export type ProviderRegistry = ProviderRegistryImpl;