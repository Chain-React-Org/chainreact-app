import { ActionResult } from './core/executeWait';
import { getDecryptedAccessToken } from './core/getDecryptedAccessToken';
import { resolveValue } from './core/resolveValue';

import { logger } from '@/lib/utils/logger'
import type { ExecuteRequest } from '@/lib/workflows/nodes/providers/hubspot/types';

/**
 * Create a HubSpot object with dynamic fields
 */
export async function createHubSpotObject(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const resolvedConfig = resolveValue(config, input);
    const { objectType, properties, associations } = resolvedConfig;

    if (!objectType) {
      throw new Error("Object type is required");
    }

    if (!properties || Object.keys(properties).length === 0) {
      throw new Error("At least one property is required");
    }

    // Get access token
    const accessToken = await getDecryptedAccessToken(userId, "hubspot");

    // Prepare request for execute endpoint
    const executeRequest: ExecuteRequest = {
      accountId: userId,
      objectType,
      op: "create",
      properties,
      associations,
    };

    // Call our execute API
    const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ''}/api/integrations/hubspot/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`, // Pass token for auth validation
      },
      body: JSON.stringify(executeRequest),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to create ${objectType}`);
    }

    const result = await response.json();

    return {
      success: true,
      output: {
        id: result.data.id,
        properties: result.data.properties,
        createdAt: result.data.createdAt,
        updatedAt: result.data.updatedAt,
        objectType,
        hubspotResponse: result.data,
      },
      message: result.message || `HubSpot ${objectType} created successfully`,
    };
  } catch (error: any) {
    logger.error("HubSpot create object error:", error);
    return {
      success: false,
      output: {},
      message: error.message || `Failed to create HubSpot object`,
    };
  }
}

/**
 * Update a HubSpot object with dynamic fields
 */
export async function updateHubSpotObject(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const resolvedConfig = resolveValue(config, input);
    const { objectType, recordId, properties } = resolvedConfig;

    if (!objectType) {
      throw new Error("Object type is required");
    }

    if (!recordId) {
      throw new Error("Record ID is required");
    }

    if (!properties || Object.keys(properties).length === 0) {
      throw new Error("At least one property must be updated");
    }

    // Get access token
    const accessToken = await getDecryptedAccessToken(userId, "hubspot");

    // Prepare request for execute endpoint
    const executeRequest: ExecuteRequest = {
      accountId: userId,
      objectType,
      op: "update",
      recordId,
      properties,
    };

    // Call our execute API
    const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ''}/api/integrations/hubspot/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(executeRequest),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to update ${objectType}`);
    }

    const result = await response.json();

    return {
      success: true,
      output: {
        id: result.data.id,
        properties: result.data.properties,
        updatedAt: result.data.updatedAt,
        objectType,
        hubspotResponse: result.data,
      },
      message: result.message || `HubSpot ${objectType} updated successfully`,
    };
  } catch (error: any) {
    logger.error("HubSpot update object error:", error);
    return {
      success: false,
      output: {},
      message: error.message || `Failed to update HubSpot object`,
    };
  }
}

/**
 * Upsert a HubSpot object (create or update based on identifier)
 */
export async function upsertHubSpotObject(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const resolvedConfig = resolveValue(config, input);
    const { objectType, identifierProperty, identifierValue, properties, associations } = resolvedConfig;

    if (!objectType) {
      throw new Error("Object type is required");
    }

    if (!identifierProperty) {
      throw new Error("Identifier property is required");
    }

    if (!identifierValue) {
      throw new Error("Identifier value is required");
    }

    if (!properties || Object.keys(properties).length === 0) {
      throw new Error("At least one property is required");
    }

    // Get access token
    const accessToken = await getDecryptedAccessToken(userId, "hubspot");

    // Make sure identifier property is included in properties
    const propertiesWithIdentifier = {
      ...properties,
      [identifierProperty]: identifierValue,
    };

    // Prepare request for execute endpoint
    const executeRequest: ExecuteRequest = {
      accountId: userId,
      objectType,
      op: "upsert",
      identifierProperty,
      identifierValue,
      properties: propertiesWithIdentifier,
      associations,
    };

    // Call our execute API
    const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ''}/api/integrations/hubspot/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(executeRequest),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to upsert ${objectType}`);
    }

    const result = await response.json();

    return {
      success: true,
      output: {
        id: result.data.id,
        properties: result.data.properties,
        operation: result.data.operation, // "create" or "update"
        createdAt: result.data.createdAt,
        updatedAt: result.data.updatedAt,
        objectType,
        hubspotResponse: result.data,
      },
      message: result.message || `HubSpot ${objectType} ${result.data.operation}d successfully`,
    };
  } catch (error: any) {
    logger.error("HubSpot upsert object error:", error);
    return {
      success: false,
      output: {},
      message: error.message || `Failed to upsert HubSpot object`,
    };
  }
}

/**
 * Refresh HubSpot property schemas
 */
export async function refreshHubSpotProperties(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const resolvedConfig = resolveValue(config, input);
    const { objectType } = resolvedConfig;

    // Call the cache clear endpoint
    const url = objectType
      ? `/api/integrations/hubspot/properties?objectType=${objectType}`
      : `/api/integrations/hubspot/properties`;

    const response = await fetch(url, {
      method: 'POST',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to refresh properties");
    }

    const result = await response.json();

    return {
      success: true,
      output: {
        message: result.message,
        objectType: objectType || 'all',
      },
      message: objectType
        ? `HubSpot ${objectType} properties refreshed successfully`
        : "All HubSpot property schemas refreshed successfully",
    };
  } catch (error: any) {
    logger.error("HubSpot refresh properties error:", error);
    return {
      success: false,
      output: {},
      message: error.message || "Failed to refresh HubSpot properties",
    };
  }
}