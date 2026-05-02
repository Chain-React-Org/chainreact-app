import { evaluateCondition } from './evaluateCondition'
import { resolveValue } from './resolveValue'
import { ActionResult } from './executeWait'

import { logger } from '@/lib/utils/logger'

/**
 * Executes an if-then condition node in a workflow
 * Supports simple, multiple, and advanced conditions
 */
export async function executeIfThenCondition(
  config: any,
  userId: string,
  input: Record<string, any>
): Promise<ActionResult> {
  try {
    // Handle both simple and complex condition configurations
    const {
      conditionType: configConditionType = "simple",
      field,
      operator,
      value,
      advancedExpression,
      continueOnFalse = false,
      logicOperator = "and",
      additionalConditions = []
    } = config

    let finalResult = false
    let evaluatedExpression = ""

    // Handle advanced expression mode
    if (configConditionType === "advanced" && advancedExpression) {
      try {
        // Create a safe evaluation context with input data
        const safeEval = new Function('data', 'trigger', 'previous', 'nodeOutputs', `
          try {
            with (Object.assign({}, data, trigger, previous, nodeOutputs)) {
              return (${advancedExpression});
            }
          } catch (e) {
            logger.error('Expression evaluation error:', e);
            return false;
          }
        `)

        finalResult = safeEval(
          input.data || {},
          input.trigger || {},
          input.previous || {},
          input.nodeOutputs || {}
        )
        evaluatedExpression = advancedExpression
      } catch (error) {
        logger.error("Advanced expression evaluation error:", error)
        finalResult = false
        evaluatedExpression = advancedExpression
      }
    }
    // Handle multiple conditions mode
    else if (configConditionType === "multiple" && field) {
      const conditions = [
        { field, operator, value },
        ...additionalConditions
      ].filter(c => c && c.field && c.operator)

      if (conditions.length > 0) {
        if (logicOperator === "or") {
          // OR logic - any condition must be true
          finalResult = conditions.some(condition => {
            const resolvedField = resolveValue(condition.field, input)
            const resolvedValue = condition.value ? resolveValue(condition.value, input) : undefined
            return evaluateCondition(resolvedField, condition.operator, resolvedValue)
          })
        } else {
          // AND logic - all conditions must be true
          finalResult = conditions.every(condition => {
            const resolvedField = resolveValue(condition.field, input)
            const resolvedValue = condition.value ? resolveValue(condition.value, input) : undefined
            return evaluateCondition(resolvedField, condition.operator, resolvedValue)
          })
        }

        evaluatedExpression = conditions
          .map(c => `${c.field} ${c.operator} ${c.value || ''}`)
          .join(` ${logicOperator.toUpperCase()} `)
      } else {
        finalResult = true
        evaluatedExpression = "No conditions (default: true)"
      }
    }
    // Handle simple condition mode (default)
    else if (field && operator) {
      const resolvedField = resolveValue(field, input)
      const resolvedValue = value ? resolveValue(value, input) : undefined

      finalResult = evaluateCondition(resolvedField, operator, resolvedValue)
      evaluatedExpression = `${field} ${operator} ${value || ''}`

      logger.info(`Simple condition evaluated: ${evaluatedExpression} => ${finalResult}`, {
        resolvedField,
        resolvedValue
      })
    }
    // No conditions defined - default to true
    else {
      logger.info("No conditions defined, defaulting to true")
      finalResult = true
      evaluatedExpression = "No conditions (default: true)"
    }

    logger.info(`Final condition result: ${finalResult} (expression: ${evaluatedExpression})`)

    // For if/then nodes, we always return success: true
    // The conditionMet field indicates whether the condition was true or false
    // The workflow engine should handle branching based on conditionMet
    return {
      success: true,
      output: {
        conditionMet: finalResult,
        conditionType: configConditionType,
        evaluatedExpression,
        success: true
      },
      message: finalResult
        ? `Condition evaluated to true`
        : `Condition evaluated to false`
    }
  } catch (error: any) {
    logger.error("If-then condition execution error:", error)
    return {
      success: false,
      output: {
        conditionMet: false,
        conditionType: config.conditionType || "simple",
        evaluatedExpression: "",
        success: false
      },
      message: `Condition evaluation failed: ${error.message}`,
      error: error.message
    }
  }
}