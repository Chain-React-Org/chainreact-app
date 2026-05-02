/**
 * Enhanced HubSpot Options Loader with Dynamic Object Support
 * Handles dynamic option loading for HubSpot fields including custom objects
 */

import { ProviderOptionsLoader, LoadOptionsParams, FormattedOption } from '../types';

import { logger } from '@/lib/utils/logger'
import type { HubspotFieldDef } from '@/lib/workflows/nodes/providers/hubspot/types';

const detectDefaultObjectType = (nodeType?: string): string => {
  if (!nodeType) return 'contacts';
  const normalized = nodeType.toLowerCase();

  if (normalized.includes('ticket')) {
    return 'tickets';
  }

  if (normalized.includes('deal')) {
    return 'deals';
  }

  if (normalized.includes('company')) {
    return 'companies';
  }

  return 'contacts';
}

const standardObjectDataTypes: Record<string, string> = {
  contacts: 'hubspot_contact_properties',
  companies: 'hubspot_company_properties',
  deals: 'hubspot_deal_properties',
  tickets: 'hubspot_ticket_properties'
}

const formatPropertyOption = (property: any) => ({
  value: property.name || property.value || property.id,
  label: property.label ? `${property.label} (${property.name})` : property.name || property.value || property.id,
  raw: property
})

export const hubspotDynamicOptionsLoader: ProviderOptionsLoader = {
  canHandle(fieldName: string, providerId: string): boolean {
    // Check if this is a HubSpot provider
    if (providerId !== 'hubspot') {
      return false;
    }

    // List of fields this loader can handle
    const supportedFields = [
      'associatedCompanyId',
      'associatedContactId',
      'dealId',
      'jobtitle',
      'department',
      'industry',
      // New dynamic fields
      'objectType',
      'properties',
      'recordId',
      'identifierProperty',
    ];

    return supportedFields.includes(fieldName);
  },

  async loadOptions(params: LoadOptionsParams): Promise<FormattedOption[]> {
    const { fieldName, integrationId, searchQuery, dependsOnValue } = params;

    console.log('⭐ [HubSpot Loader] loadOptions CALLED for field:', fieldName, params);

    if (!integrationId) {
      console.error('❌ [HubSpot Loader] No integration ID provided');
      return [{
        value: '',
        label: 'Please connect your HubSpot account first',
        disabled: true
      }];
    }

    console.log('⭐ [HubSpot Loader] Has integration ID, continuing...');

    try {
      // Handle dynamic object type field
      if (fieldName === 'objectType') {
        const response = await fetch('/api/integrations/hubspot/objects', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error('Failed to fetch HubSpot objects');
        }

        const objects = await response.json();
        return objects.map((obj: any) => ({
          value: obj.value,
          label: obj.label,
          metadata: { isCustom: obj.isCustom }
        }));
      }

      // Handle dynamic properties field (depends on objectType)
      if (fieldName === 'properties') {
        const objectType =
          params.extraOptions?.objectType ||
          dependsOnValue ||
          detectDefaultObjectType(params.nodeType);

        const standardDataType = standardObjectDataTypes[objectType];
        const hasCustomObjectContext = Boolean(params.extraOptions?.objectType || dependsOnValue);

        // For standard HubSpot objects (contacts/companies/deals/tickets) without custom context,
        // use the same data endpoint as other fields so options stay consistent.
        if (standardDataType && !hasCustomObjectContext) {
          const requestBody = {
            integrationId,
            dataType: standardDataType,
            options: { searchQuery }
          };

          const response = await fetch('/api/integrations/hubspot/data', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
          });

          if (!response.ok) {
            throw new Error(`Failed to fetch ${objectType} properties`);
          }

          const result = await response.json();
          return (result.data || []).map((prop: any) => formatPropertyOption(prop));
        }

        // Fallback to the advanced schema-aware endpoint for custom objects
        const shouldIncludeReadOnly =
          params.nodeType?.includes('_get_') ||
          params.nodeType?.includes('_search_') ||
          params.nodeType?.includes('_list_') ||
          params.nodeType?.includes('retrieve');

        const queryParams = new URLSearchParams({
          objectType,
          ...(shouldIncludeReadOnly ? { includeReadOnly: 'true' } : {})
        });

        const response = await fetch(`/api/integrations/hubspot/properties?${queryParams.toString()}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch properties for ${objectType}`);
        }

        const properties: HubspotFieldDef[] = await response.json();

        return properties.map(prop => ({
          ...formatPropertyOption(prop),
          metadata: {
            type: prop.type,
            required: prop.required,
            description: prop.description,
            group: prop.group,
            options: prop.options,
            hubspotType: prop.hubspotType,
            isProperty: true,
          }
        }));
      }

      // Handle record ID field (depends on objectType)
      if (fieldName === 'recordId') {
        const objectType = dependsOnValue || 'contacts';

        const requestBody = {
          integrationId,
          dataType: `hubspot_${objectType}`,
          options: { searchQuery, limit: 100 }
        };

        const response = await fetch('/api/integrations/hubspot/data', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch ${objectType} records`);
        }

        const result = await response.json();

        // Format based on object type
        return (result.data || []).map((record: any) => {
          let label = '';

          if (objectType === 'contacts') {
            const name = [record.properties?.firstname, record.properties?.lastname]
              .filter(Boolean)
              .join(' ') || record.properties?.email || `Contact ${record.id}`;
            label = record.properties?.email ? `${name} (${record.properties.email})` : name;
          } else if (objectType === 'companies') {
            label = record.properties?.name || `Company ${record.id}`;
          } else if (objectType === 'deals') {
            label = record.properties?.dealname || `Deal ${record.id}`;
          } else {
            // For custom objects, try to find a name property
            label = record.properties?.name ||
                   record.properties?.title ||
                   `${objectType} ${record.id}`;
          }

          return {
            value: record.id,
            label
          };
        });
      }

      // Handle identifier property field (for upsert)
      if (fieldName === 'identifierProperty') {
        const objectType = dependsOnValue || 'contacts';

        const response = await fetch(`/api/integrations/hubspot/properties?objectType=${objectType}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch properties for ${objectType}`);
        }

        const properties: HubspotFieldDef[] = await response.json();

        // Filter to properties that can be used as identifiers (unique values)
        const identifierProperties = properties.filter(prop =>
          !prop.readOnly &&
          (prop.name === 'email' || // Email for contacts
           prop.name === 'name' || // Name for companies
           prop.name === 'domain' || // Domain for companies
           prop.hubspotType === 'string' || // Any string property could potentially be unique
           prop.hubspotType === 'enumeration') // Or enum
        );

        return identifierProperties.map(prop => ({
          value: prop.name,
          label: prop.label,
          metadata: {
            description: prop.description
          }
        }));
      }

      // Shared fields also covered by hubspotOptionsLoader. Whichever loader
      // canHandle()-claims them first wins; this branch is the dynamic
      // loader's path when the base loader didn't claim the field.
      logger.info('🔍 [HubSpot Loader] Handling shared field:', fieldName);

      const fieldToDataType: Record<string, string> = {
        listId: 'hubspot_lists',
        associatedCompanyId: 'hubspot_companies',
        associatedContactId: 'hubspot_contacts',
        dealId: 'hubspot_deals',
        jobtitle: 'hubspot_job_titles',
        department: 'hubspot_departments',
        industry: 'hubspot_industries',
      };

      const dataType = fieldToDataType[fieldName];
      logger.info('🔍 [HubSpot Loader] Data type mapping:', { fieldName, dataType });

      if (!dataType) {
        logger.warn(`No data type mapping for HubSpot field: ${fieldName}`);
        return [];
      }

      const requestBody = {
        integrationId,
        dataType,
        options: { searchQuery }
      };

      logger.info('🔍 [HubSpot Loader] About to fetch data:', requestBody);

      const response = await fetch('/api/integrations/hubspot/data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });

      logger.debug('[HubSpot Loader] Fetch response status:', response.status);

      if (!response.ok) {
        throw new Error(`Failed to fetch HubSpot ${dataType}`);
      }

      const result = await response.json();

      // Format the response based on data type
      if (dataType === 'hubspot_companies') {
        return (result.data || []).map((company: any) => ({
          value: company.id,
          label: company.properties?.name || `Company ${company.id}`
        }));
      }

      if (dataType === 'hubspot_contacts') {
        return (result.data || []).map((contact: any) => {
          const name = [contact.properties?.firstname, contact.properties?.lastname]
            .filter(Boolean)
            .join(' ') || contact.properties?.email || `Contact ${contact.id}`;
          return {
            value: contact.id,
            label: contact.properties?.email ? `${name} (${contact.properties.email})` : name
          };
        });
      }

      if (dataType === 'hubspot_deals') {
        return (result.data || []).map((deal: any) => ({
          value: deal.id,
          label: deal.properties?.dealname || `Deal ${deal.id}`
        }));
      }

      // For simple string options
      if (['hubspot_job_titles', 'hubspot_departments', 'hubspot_industries'].includes(dataType)) {
        return (result.data || []).map((item: any) => ({
          value: typeof item === 'string' ? item : item.value || item.id,
          label: typeof item === 'string' ? item : item.label || item.name || item.value
        }));
      }

      // Default mapping
      return (result.data || []).map((item: any) => ({
        value: item.id || item.value,
        label: item.name || item.label || item.title || `Item ${item.id}`
      }));

    } catch (error) {
      logger.error(`Error loading HubSpot ${fieldName} options:`, error);
      return [];
    }
  },

  // Define field dependencies
  getFieldDependencies(fieldName: string): string[] {
    // Properties, recordId, and identifierProperty depend on objectType
    if (['properties', 'recordId', 'identifierProperty'].includes(fieldName)) {
      return ['objectType'];
    }
    return [];
  }
};
