import { ActionResult } from './core/executeWait'
import { getDecryptedAccessToken } from './core/getDecryptedAccessToken'
import { resolveValue } from './core/resolveValue'

import { logger } from '@/lib/utils/logger'

/**
 * Create a new HubSpot contact
 */
export async function createHubSpotContact(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const resolvedConfig = resolveValue(config, input)

    // Determine which mode we're in based on the config
    const fieldMode = resolvedConfig.fieldMode || 'basic'

    // Prepare properties based on the mode
    let properties: Record<string, any> = {}

    if (fieldMode === 'all' && resolvedConfig.allProperties) {
      // All fields mode - use all properties directly
      properties = { ...resolvedConfig.allProperties }
    } else if (fieldMode === 'custom' && resolvedConfig.customProperties) {
      // Custom mode - use selected properties
      properties = { ...resolvedConfig.customProperties }
    } else {
      // Basic mode or legacy mode - use individual fields
      const {
        email,
        firstname,
        lastname,
        name, // Legacy support for full name
        phone,
        hs_lead_status,
        // Company Information
        associatedCompanyId,
        jobtitle,
        department,
        industry,
        // Location Information
        address,
        city,
        state,
        zip,
        country,
        // Social Media
        website,
        linkedinbio,
        twitterhandle,
        // Lifecycle Stage
        lifecyclestage,
        company,
        // Legacy fields (keeping for backward compatibility)
        favorite_content_topics,
        preferred_channels,
        additional_properties = [],
        additional_values = {},
        all_available_fields = [],
        all_field_values = {},
        company_fields = [],
        company_field_values = {},
        custom_properties = {}
      } = resolvedConfig

      // Build properties from individual fields
      if (email) properties.email = email
      if (firstname) properties.firstname = firstname
      if (lastname) properties.lastname = lastname
      if (phone) properties.phone = phone
      if (company) properties.company = company
      if (jobtitle) properties.jobtitle = jobtitle
      if (lifecyclestage) properties.lifecyclestage = lifecyclestage
      if (hs_lead_status) properties.hs_lead_status = hs_lead_status
      if (department) properties.department = department
      if (industry) properties.industry = industry
      if (address) properties.address = address
      if (city) properties.city = city
      if (state) properties.state = state
      if (zip) properties.zip = zip
      if (country) properties.country = country
      if (website) properties.website = website
      if (linkedinbio) properties.linkedinbio = linkedinbio
      if (twitterhandle) properties.twitterhandle = twitterhandle
      if (favorite_content_topics) properties.favorite_content_topics = favorite_content_topics
      if (preferred_channels) properties.preferred_channels = preferred_channels

      // Legacy support for name splitting
      if (!firstname && !lastname && name) {
        const nameParts = name.trim().split(' ')
        if (nameParts.length > 0) {
          properties.firstname = nameParts[0]
          if (nameParts.length > 1) {
            properties.lastname = nameParts.slice(1).join(' ')
          }
        }
      }

      // Add additional properties from legacy format
      if (additional_properties && Array.isArray(additional_properties)) {
        additional_properties.forEach(propName => {
          if (additional_values[propName] !== undefined && additional_values[propName] !== null && additional_values[propName] !== '') {
            properties[propName] = additional_values[propName]
          }
        })
      }

      // Add all available fields from legacy format
      if (all_available_fields && Array.isArray(all_available_fields)) {
        all_available_fields.forEach(fieldName => {
          if (all_field_values[fieldName] !== undefined && all_field_values[fieldName] !== null && all_field_values[fieldName] !== '') {
            properties[fieldName] = all_field_values[fieldName]
          }
        })
      }

      // Add custom properties
      if (custom_properties && typeof custom_properties === 'object') {
        Object.assign(properties, custom_properties)
      }
    }

    // Extract company association
    const associatedCompanyId = resolvedConfig.associatedCompanyId

    // Ensure email is present
    if (!properties.email) {
      throw new Error("Email is required")
    }

    // Get HubSpot integration
    const { createSupabaseServerClient } = await import("@/utils/supabase/server")
    const supabase = await createSupabaseServerClient()

    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "hubspot")
      .eq("status", "connected")
      .single()

    if (!integration) {
      throw new Error("HubSpot integration not connected")
    }

    const accessToken = await getDecryptedAccessToken(userId, "hubspot")

    // Get duplicate handling strategy
    const duplicateHandling = resolvedConfig.duplicateHandling || 'fail'

    // Create contact payload
    const payload = {
      properties: properties
    }

    // Attempt to create contact
    let response = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    })

    let result: any
    let wasUpdate = false
    let existingContactId: string | null = null

    // Handle response based on status
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))

      // Check if it's a duplicate contact error (409 Conflict)
      if (response.status === 409 && duplicateHandling !== 'fail') {
        // Extract existing contact ID from error message
        const match = errorData.message?.match(/Existing ID: (\d+)/)
        existingContactId = match ? match[1] : null

        if (!existingContactId) {
          // Try to find contact by email if ID not in error message
          const searchResponse = await fetch(
            `https://api.hubapi.com/crm/v3/objects/contacts/search`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                filterGroups: [{
                  filters: [{
                    propertyName: "email",
                    operator: "EQ",
                    value: properties.email
                  }]
                }],
                properties: Object.keys(properties),
                limit: 1
              })
            }
          )

          if (searchResponse.ok) {
            const searchResult = await searchResponse.json()
            if (searchResult.results && searchResult.results.length > 0) {
              existingContactId = searchResult.results[0].id
              result = searchResult.results[0]
            }
          }
        }

        // Handle based on strategy
        if (duplicateHandling === 'update' && existingContactId) {
          // Update the existing contact
          logger.info(`Updating existing contact ${existingContactId} (duplicate handling: update)`)

          const updateResponse = await fetch(
            `https://api.hubapi.com/crm/v3/objects/contacts/${existingContactId}`,
            {
              method: "PATCH",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify(payload)
            }
          )

          if (!updateResponse.ok) {
            const updateErrorData = await updateResponse.json().catch(() => ({}))
            throw new Error(
              `Failed to update existing contact: ${updateResponse.status} - ${updateErrorData.message || updateResponse.statusText}`
            )
          }

          result = await updateResponse.json()
          wasUpdate = true
        } else if (duplicateHandling === 'skip' && existingContactId) {
          // Skip creation and return existing contact
          logger.info(`Skipping creation, returning existing contact ${existingContactId} (duplicate handling: skip)`)

          if (!result) {
            // Fetch the existing contact details
            const getResponse = await fetch(
              `https://api.hubapi.com/crm/v3/objects/contacts/${existingContactId}`,
              {
                method: "GET",
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  "Content-Type": "application/json"
                }
              }
            )

            if (getResponse.ok) {
              result = await getResponse.json()
            } else {
              // If we can't fetch details, return minimal info
              result = {
                id: existingContactId,
                properties: { email: properties.email }
              }
            }
          }
        } else {
          // Either 'fail' strategy or couldn't find existing contact
          throw new Error(
            `HubSpot API error: ${response.status} - ${errorData.message || 'Contact already exists. Existing ID: ' + existingContactId || response.statusText}`
          )
        }
      } else {
        // Non-duplicate error or 'fail' strategy
        throw new Error(
          `HubSpot API error: ${response.status} - ${errorData.message || response.statusText}`
        )
      }
    } else {
      // Success - contact was created
      result = await response.json()
    }
    
    logger.debug('HubSpot contact created, id:', result?.id)

    // Check if we should associate with existing company or create new one
    let companyId = null
    let companyName = null

    // If associatedCompanyId is a string that's not an ID (i.e., a new company name to create)
    if (associatedCompanyId && typeof associatedCompanyId === 'string' && !associatedCompanyId.match(/^\d+$/)) {
      companyName = associatedCompanyId
      try {
        logger.info('Creating company record for:', companyName)
        
        // Prepare company properties
        const companyProperties: Record<string, any> = {
          name: companyName
        }
        
        // Add company-specific fields if provided
        if (company_fields && Array.isArray(company_fields)) {
          logger.info('Processing company-specific fields:', company_fields)
          logger.info('Company field values:', company_field_values)
          
          company_fields.forEach(fieldName => {
            if (company_field_values[fieldName] !== undefined && company_field_values[fieldName] !== null && company_field_values[fieldName] !== '') {
              companyProperties[fieldName] = company_field_values[fieldName]
              logger.info(`Added company field ${fieldName} with value:`, company_field_values[fieldName])
            }
          })
        }
        
        // Add additional company properties from contact data if not already set by company fields
        if (properties.website && !companyProperties.domain) companyProperties.domain = properties.website
        if (properties.phone && !companyProperties.phone) companyProperties.phone = properties.phone
        if (properties.address && !companyProperties.address) companyProperties.address = properties.address
        if (properties.city && !companyProperties.city) companyProperties.city = properties.city
        if (properties.state && !companyProperties.state) companyProperties.state = properties.state
        if (properties.zip && !companyProperties.zip) companyProperties.zip = properties.zip
        if (properties.country && !companyProperties.country) companyProperties.country = properties.country
        if (properties.industry && !companyProperties.industry) companyProperties.industry = properties.industry
        
        // Create company
        const companyResponse = await fetch("https://api.hubapi.com/crm/v3/objects/companies", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            properties: companyProperties
          })
        })
        
        if (companyResponse.ok) {
          const companyResult = await companyResponse.json()
          companyId = companyResult.id
          logger.info('Created company with ID:', companyId)
          
          // Associate contact with company
          const associationResponse = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${result.id}/associations/companies/${companyId}/contact_to_company`, {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json"
            }
          })
          
          if (associationResponse.ok) {
            logger.info('Successfully associated contact with company')
          } else {
            logger.warn('Failed to associate contact with company:', associationResponse.status)
          }
        } else {
          logger.warn('Failed to create company:', companyResponse.status)
        }
      } catch (error) {
        logger.warn('Error creating company:', error)
      }
    } else if (associatedCompanyId && associatedCompanyId.match(/^\d+$/)) {
      // If associatedCompanyId is an actual ID, associate the contact with the existing company
      companyId = associatedCompanyId
      try {
        const associationResponse = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${result.id}/associations/companies/${companyId}/contact_to_company`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          }
        })

        if (associationResponse.ok) {
          logger.info('Successfully associated contact with existing company')
        } else {
          logger.warn('Failed to associate contact with existing company:', associationResponse.status)
        }
      } catch (error) {
        logger.warn('Error associating with existing company:', error)
      }
    }

    // Build success message based on what action was taken
    let successMessage: string
    if (wasUpdate) {
      successMessage = companyId
        ? `HubSpot contact updated successfully (${result.properties.email}) and associated with company ${companyName}`
        : `HubSpot contact updated successfully (${result.properties.email})`
    } else if (existingContactId && duplicateHandling === 'skip') {
      successMessage = `Contact already exists (${result.properties.email}), returning existing contact`
    } else {
      successMessage = companyId
        ? `HubSpot contact created successfully with email ${result.properties.email} and associated with company ${companyName}`
        : `HubSpot contact created successfully with email ${result.properties.email}`
    }

    return {
      success: true,
      output: {
        contactId: result.id,
        email: result.properties.email,
        name: `${result.properties.firstname || ''} ${result.properties.lastname || ''}`.trim(),
        phone: result.properties.phone,
        hs_lead_status: result.properties.hs_lead_status,
        favorite_content_topics: result.properties.favorite_content_topics,
        preferred_channels: result.properties.preferred_channels,
        // Include all properties from the response
        properties: result.properties,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
        hubspotResponse: result,
        // Include company information if created
        companyId: companyId,
        companyCreated: !!companyId,
        // Include metadata about the operation
        wasUpdate: wasUpdate,
        wasExisting: !!existingContactId,
        duplicateHandling: duplicateHandling
      },
      message: successMessage
    }

  } catch (error: any) {
    // Properly log error with all details
    logger.error("HubSpot create contact error:", {
      message: error.message,
      stack: error.stack,
      name: error.name,
      cause: error.cause
    })
    return {
      success: false,
      output: {},
      message: error.message || "Failed to create HubSpot contact"
    }
  }
}

/**
 * Create a new HubSpot company
 */
export async function createHubSpotCompany(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const resolvedConfig = resolveValue(config, input)
    
    const {
      name,
      domain,
      phone,
      address,
      city,
      state,
      zip,
      country,
      industry,
      description,
      annual_revenue,
      number_of_employees
    } = resolvedConfig

    if (!name) {
      throw new Error("Company name is required")
    }

    // Get HubSpot integration
    const { createSupabaseServerClient } = await import("@/utils/supabase/server")
    const supabase = await createSupabaseServerClient()
    
    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "hubspot")
      .eq("status", "connected")
      .single()

    if (!integration) {
      throw new Error("HubSpot integration not connected")
    }

    const accessToken = await getDecryptedAccessToken(userId, "hubspot")

    // Prepare company properties
    const properties: Record<string, any> = {
      name: name
    }

    if (domain) properties.domain = domain
    if (phone) properties.phone = phone
    if (address) properties.address = address
    if (city) properties.city = city
    if (state) properties.state = state
    if (zip) properties.zip = zip
    if (country) properties.country = country
    if (industry) properties.industry = industry
    if (description) properties.description = description
    if (annual_revenue) properties.annualrevenue = annual_revenue
    if (number_of_employees) properties.numberofemployees = number_of_employees

    // Create company payload
    const payload = {
      properties: properties
    }

    // Create company
    const response = await fetch("https://api.hubapi.com/crm/v3/objects/companies", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`HubSpot API error: ${response.status} - ${errorData.message || response.statusText}`)
    }

    const result = await response.json()

    return {
      success: true,
      output: {
        companyId: result.id,
        name: result.properties.name,
        domain: result.properties.domain,
        phone: result.properties.phone,
        address: result.properties.address,
        city: result.properties.city,
        state: result.properties.state,
        zip: result.properties.zip,
        country: result.properties.country,
        industry: result.properties.industry,
        description: result.properties.description,
        annual_revenue: result.properties.annualrevenue,
        number_of_employees: result.properties.numberofemployees,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
        hubspotResponse: result
      },
      message: `HubSpot company "${result.properties.name}" created successfully`
    }

  } catch (error: any) {
    logger.error("HubSpot create company error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to create HubSpot company"
    }
  }
}

/**
 * Add contact to HubSpot list
 */
export async function addContactToHubSpotList(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const resolvedConfig = resolveValue(config, input)
    
    const {
      contactEmail,
      listId
    } = resolvedConfig

    if (!contactEmail) {
      throw new Error("Contact email is required")
    }

    if (!listId) {
      throw new Error("List ID is required")
    }

    // Get HubSpot integration
    const { createSupabaseServerClient } = await import("@/utils/supabase/server")
    const supabase = await createSupabaseServerClient()
    
    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "hubspot")
      .eq("status", "connected")
      .single()

    if (!integration) {
      throw new Error("HubSpot integration not connected")
    }

    const accessToken = await getDecryptedAccessToken(userId, "hubspot")

    // First, get contact ID from email
    const searchResponse = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        filterGroups: [{
          filters: [{
            propertyName: "email",
            operator: "EQ",
            value: contactEmail
          }]
        }]
      })
    })

    if (!searchResponse.ok) {
      const errorData = await searchResponse.json().catch(() => ({}))
      throw new Error(`Failed to find contact: ${errorData.message || searchResponse.statusText}`)
    }

    const searchResult = await searchResponse.json()
    
    if (!searchResult.results || searchResult.results.length === 0) {
      throw new Error(`No contact found with email: ${contactEmail}`)
    }

    const contactId = searchResult.results[0].id

    // Add contact to list
    const response = await fetch(`https://api.hubapi.com/crm/v3/lists/${listId}/memberships/add`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify([contactId])
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      
      // Check if it's because the list is not manual
      if (errorData.message && errorData.message.includes("DYNAMIC")) {
        throw new Error("Cannot add contacts to dynamic lists. Please select a manual list.")
      }
      
      throw new Error(`HubSpot API error: ${response.status} - ${errorData.message || response.statusText}`)
    }

    const result = await response.json()

    return {
      success: true,
      output: {
        contactId: contactId,
        contactEmail: contactEmail,
        listId: listId,
        membersAdded: result.recordsIdsAdded || [contactId],
        message: `Contact ${contactEmail} added to list successfully`
      },
      message: `Successfully added contact ${contactEmail} to list`
    }

  } catch (error: any) {
    logger.error("HubSpot add contact to list error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to add contact to list"
    }
  }
}

/**
 * Update an existing HubSpot deal
 */
export async function updateHubSpotDeal(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const resolvedConfig = resolveValue(config, input)
    
    const {
      dealId,
      dealname,
      amount,
      dealstage,
      closedate,
      dealtype,
      description
    } = resolvedConfig

    if (!dealId) {
      throw new Error("Deal ID is required")
    }

    // Get HubSpot integration
    const { createSupabaseServerClient } = await import("@/utils/supabase/server")
    const supabase = await createSupabaseServerClient()
    
    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "hubspot")
      .eq("status", "connected")
      .single()

    if (!integration) {
      throw new Error("HubSpot integration not connected")
    }

    const accessToken = await getDecryptedAccessToken(userId, "hubspot")

    // Prepare update properties - only include fields that have values
    const properties: Record<string, any> = {}
    
    if (dealname) properties.dealname = dealname
    if (amount !== undefined && amount !== null) properties.amount = amount.toString()
    if (dealstage) properties.dealstage = dealstage
    if (closedate) properties.closedate = closedate
    if (dealtype) properties.dealtype = dealtype
    if (description) properties.description = description

    if (Object.keys(properties).length === 0) {
      throw new Error("No fields to update")
    }

    // Update deal
    const response = await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${dealId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        properties: properties
      })
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`HubSpot API error: ${response.status} - ${errorData.message || response.statusText}`)
    }

    const result = await response.json()

    return {
      success: true,
      output: {
        dealId: result.id,
        dealname: result.properties.dealname,
        amount: result.properties.amount,
        dealstage: result.properties.dealstage,
        closedate: result.properties.closedate,
        dealtype: result.properties.dealtype,
        description: result.properties.description,
        updatedAt: result.updatedAt,
        hubspotResponse: result
      },
      message: `HubSpot deal "${result.properties.dealname}" updated successfully`
    }

  } catch (error: any) {
    logger.error("HubSpot update deal error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to update HubSpot deal"
    }
  }
}

/**
 * Create a new HubSpot deal
 */
export async function createHubSpotDeal(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    const resolvedConfig = resolveValue(config, input)
    
    const {
      dealname,
      amount,
      pipeline,
      dealstage,
      closedate,
      dealtype,
      description,
      associatedCompanyId,
      associatedContactId
    } = resolvedConfig

    if (!dealname) {
      throw new Error("Deal name is required")
    }

    if (!dealstage) {
      throw new Error("Deal stage is required")
    }

    // Get HubSpot integration
    const { createSupabaseServerClient } = await import("@/utils/supabase/server")
    const supabase = await createSupabaseServerClient()
    
    const { data: integration } = await supabase
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "hubspot")
      .eq("status", "connected")
      .single()

    if (!integration) {
      throw new Error("HubSpot integration not connected")
    }

    const accessToken = await getDecryptedAccessToken(userId, "hubspot")

    // Prepare deal properties
    const properties: Record<string, any> = {
      dealname: dealname,
      dealstage: dealstage
    }

    if (amount) properties.amount = amount
    if (pipeline) properties.pipeline = pipeline || "default"
    if (closedate) properties.closedate = closedate
    if (dealtype) properties.dealtype = dealtype
    if (description) properties.description = description

    // Create deal payload
    const payload = {
      properties: properties
    }

    // Create deal
    const response = await fetch("https://api.hubapi.com/crm/v3/objects/deals", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(`HubSpot API error: ${response.status} - ${errorData.message || response.statusText}`)
    }

    const result = await response.json()

    // Associate with company if provided
    if (associatedCompanyId) {
      await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${result.id}/associations/companies/${associatedCompanyId}/deal_to_company`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      })
    }

    // Associate with contact if provided
    if (associatedContactId) {
      await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${result.id}/associations/contacts/${associatedContactId}/deal_to_contact`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      })
    }

    return {
      success: true,
      output: {
        dealId: result.id,
        dealname: result.properties.dealname,
        amount: result.properties.amount,
        pipeline: result.properties.pipeline,
        dealstage: result.properties.dealstage,
        closedate: result.properties.closedate,
        dealtype: result.properties.dealtype,
        description: result.properties.description,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
        hubspotResponse: result,
        associatedCompanyId: associatedCompanyId,
        associatedContactId: associatedContactId
      },
      message: `HubSpot deal "${result.properties.dealname}" created successfully`
    }

  } catch (error: any) {
    logger.error("HubSpot create deal error:", error)
    return {
      success: false,
      output: {},
      message: error.message || "Failed to create HubSpot deal"
    }
  }
}

// Re-export all handlers from the hubspot/ directory
export * from './hubspot/index'
