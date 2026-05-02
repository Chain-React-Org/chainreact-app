import { NodeComponent, NodeField, ConfigField } from "@/lib/workflows/nodes"
import { validateVariableResolution, containsVariables } from "./variable-validation"

/**
 * Validates if a field is required and has a value
 * @param field The field configuration
 * @param value The current value of the field
 * @param input Optional input context for variable resolution validation
 * @returns Error message if validation fails, or undefined if validation passes
 */
export const validateRequiredField = (
  field: NodeField | ConfigField,
  value: any,
  input?: Record<string, any>
): string | undefined => {
  // Skip validation for hidden fields or non-required fields
  if (field.hidden || !field.required) {
    return undefined;
  }

  // Check if field has AI-generated value ({{AI_FIELD:fieldName}})
  const hasAIValue = typeof value === 'string' && /^\{\{AI_FIELD:.+\}\}$/.test(value);

  // Check if the field has a value (AI-generated values count as having a value)
  if (
    !hasAIValue && (
      value === undefined ||
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0)
    )
  ) {
    return `${field.label || field.name} is required`;
  }

  return undefined;
};

/**
 * Validates that variables in a field resolve to actual values
 * @param field The field configuration
 * @param value The current value of the field
 * @param input The input context for variable resolution
 * @returns Error message if validation fails, or undefined if validation passes
 */
export const validateFieldVariables = (
  field: NodeField | ConfigField,
  value: any,
  input: Record<string, any>
): string | undefined => {
  // Skip validation for hidden fields
  if (field.hidden) {
    return undefined;
  }

  // Only validate if the field contains variables
  if (!containsVariables(value)) {
    return undefined;
  }

  // Validate variable resolution
  return validateVariableResolution(value, input, field.name);
};

/**
 * Validates all required fields in a form
 * @param nodeInfo Node component information
 * @param config Current form configuration values
 * @param input Optional input context for variable resolution validation
 * @returns Object with field errors
 */
export const validateAllRequiredFields = (
  nodeInfo: NodeComponent | null,
  config: Record<string, any>,
  input?: Record<string, any>
): Record<string, string> => {
  const errors: Record<string, string> = {};

  if (!nodeInfo || !nodeInfo.configSchema) {
    return errors;
  }

  // Filter visible fields
  const visibleFields = nodeInfo.configSchema.filter(
    (field) => !shouldHideField(field, config)
  );

  // Validate each visible required field
  visibleFields.forEach((field) => {
    const value = config[field.name];

    // Check required field validation
    const requiredError = validateRequiredField(field, value, input);
    if (requiredError) {
      errors[field.name] = requiredError;
      return; // Don't check variable validation if required validation fails
    }

    // Check variable resolution validation (if input is provided)
    if (input) {
      const variableError = validateFieldVariables(field, value, input);
      if (variableError) {
        errors[field.name] = variableError;
      }
    }
  });

  return errors;
};

/**
 * Determines if a field should be hidden based on dependencies
 * @param field The field configuration
 * @param config Current form values
 * @returns Boolean indicating if the field should be hidden
 */
export const shouldHideField = (
  field: NodeField | ConfigField,
  config: Record<string, any>
): boolean => {
  // Check visibilityCondition first (newer pattern used in unified Notion actions)
  const visibilityCondition = (field as any).visibilityCondition;
  if (visibilityCondition !== undefined && visibilityCondition !== null) {
    // Always show if condition is "always"
    if (visibilityCondition === 'always') {
      return false;
    }

    // Handle object-based visibility conditions
    if (typeof visibilityCondition === 'object') {
      // Handle 'and' operator for multiple conditions
      if (visibilityCondition.and && Array.isArray(visibilityCondition.and)) {
        const allConditionsMet = visibilityCondition.and.every((condition: any) => {
          const { field: condField, operator, value } = condition;
          const fieldValue = config[condField];

          switch (operator) {
            case 'isNotEmpty':
              return fieldValue !== undefined && fieldValue !== '' && fieldValue !== null;
            case 'isEmpty':
              return fieldValue === undefined || fieldValue === '' || fieldValue === null;
            case 'equals':
              if (!fieldValue && fieldValue !== 0 && fieldValue !== false) return false;
              return fieldValue === value;
            case 'notEquals':
              return fieldValue !== value;
            case 'in':
              if (!fieldValue && fieldValue !== 0 && fieldValue !== false) return false;
              return Array.isArray(value) && value.includes(fieldValue);
            default:
              return true;
          }
        });
        return !allConditionsMet; // Hide if not all conditions are met
      }

      // Handle single condition
      const { field: condField, operator, value } = visibilityCondition;
      const fieldValue = config[condField];

      let shouldShow = true;
      switch (operator) {
        case 'isNotEmpty':
          shouldShow = fieldValue !== undefined && fieldValue !== '' && fieldValue !== null;
          break;
        case 'isEmpty':
          shouldShow = fieldValue === undefined || fieldValue === '' || fieldValue === null;
          break;
        case 'equals':
          if (!fieldValue && fieldValue !== 0 && fieldValue !== false) {
            shouldShow = false;
          } else {
            shouldShow = fieldValue === value;
          }
          break;
        case 'notEquals':
          shouldShow = fieldValue !== value;
          break;
        case 'in':
          if (!fieldValue && fieldValue !== 0 && fieldValue !== false) {
            shouldShow = false;
          } else {
            shouldShow = Array.isArray(value) && value.includes(fieldValue);
          }
          break;
        default:
          shouldShow = true;
      }
      return !shouldShow; // Hide if should not show
    }
  }

  // Check if the field has explicit hidden property and showIf function
  if (field.hidden && (field as any).showIf) {
    // If there's a showIf function, evaluate it
    if (typeof (field as any).showIf === 'function') {
      const shouldShow = (field as any).showIf(config);
      return !shouldShow; // Hide if showIf returns false
    }
  }

  // Check if the field has explicit hidden property without showIf
  if (field.hidden && !(field as any).showIf) {
    return true;
  }

  // Check if there's just a showIf function without hidden property
  if ((field as any).showIf && typeof (field as any).showIf === 'function') {
    const shouldShow = (field as any).showIf(config);
    return !shouldShow; // Hide if showIf returns false
  }

  // Check conditional property (used in Google Drive and other nodes)
  if ((field as any).conditional) {
    const conditional = (field as any).conditional;
    const conditionFieldValue = config[conditional.field];
    
    // Hide if the condition doesn't match
    if (conditional.value !== undefined) {
      return conditionFieldValue !== conditional.value;
    }
  }

  // Pre-migration shape: dependsOn + showIf. Tracked alongside the
  // canonicalization in learning/docs/visibility-migration-progress.md
  // (~130 callers across 25+ schema files).
  if (field.dependsOn && field.showIf) {
    const dependentValue = config[field.dependsOn];
    
    // If the dependent field doesn't have a value, hide this field
    if (dependentValue === undefined || dependentValue === null || dependentValue === "") {
      return true;
    }

    // Check if current value matches any of the allowed values
    if (Array.isArray(field.showIf)) {
      return !field.showIf.includes(dependentValue);
    } 
      return dependentValue !== field.showIf;
    
  }

  // Check showWhen property (another variation used in some nodes)
  if ((field as any).showWhen) {
    const showWhen = (field as any).showWhen;
    for (const [conditionField, conditionValues] of Object.entries(showWhen)) {
      const currentValue = config[conditionField];

      // Handle special cases
      if (conditionValues === "!empty") {
        // Field should show only when the condition field has a non-empty value
        if (!currentValue || currentValue === '') {
          return true; // Hide if empty
        }
      } else if (Array.isArray(conditionValues)) {
        // Field should show only when the condition field matches one of the values
        if (!conditionValues.includes(currentValue)) {
          return true; // Hide if not matching
        }
      } else {
        // Single value comparison
        if (currentValue !== conditionValues) {
          return true; // Hide if not matching
        }
      }
    }
  }

  // Check visibleWhen property (used in Add Attachment and other nodes)
  if ((field as any).visibleWhen) {
    const visibleWhen = (field as any).visibleWhen;
    const conditionField = visibleWhen.field;
    const conditionValue = visibleWhen.value;
    const currentValue = config[conditionField];

    // Field should only show when the condition field equals the specified value
    if (currentValue !== conditionValue) {
      return true; // Hide if not matching
    }
  }

  // By default, show the field if not explicitly hidden
  return false;
};

/**
 * Gets all visible fields for a node
 * @param nodeInfo Node component information
 * @param config Current form values
 * @returns Array of visible fields
 */
export const getVisibleFields = (
  nodeInfo: NodeComponent | null,
  config: Record<string, any>
): (NodeField | ConfigField)[] => {
  if (!nodeInfo || !nodeInfo.configSchema) {
    return [];
  }

  return nodeInfo.configSchema.filter(
    (field) => !shouldHideField(field, config)
  );
};