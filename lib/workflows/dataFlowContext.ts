/**
 * Data Flow Context System
 * Manages data flow between workflow nodes and provides variable resolution
 */

import { parseVariableReference, normalizeVariableReference } from './variableReferences'
import {
  resolveValue as canonicalResolveValue,
  resolveValueStrict as canonicalResolveValueStrict,
  MissingVariableError,
} from './actions/core/resolveValue'

import { logger } from '@/lib/utils/logger'

export interface DataFlowContext {
  // Execution context
  executionId: string
  workflowId: string
  userId: string
  
  // Data storage
  nodeOutputs: Record<string, any> // nodeId -> output data
  variables: Record<string, any> // custom variables set by users
  globalData: Record<string, any> // workflow-level data
  
  // Node metadata for variable resolution
  nodeMetadata: Record<string, {
    title: string
    type: string
    outputSchema?: Array<{
      name: string
      label: string
      type: string
    }>
  }>
  
  // Metadata
  executionStartTime: Date
  currentNodeId?: string
  parentNodeId?: string
}

export interface NodeOutput {
  success: boolean
  data: any
  metadata?: {
    timestamp: Date
    nodeType: string
    executionTime: number
    dataSize?: number
  }
}

export class DataFlowManager {
  private context: DataFlowContext

  constructor(executionId: string, workflowId: string, userId: string) {
    this.context = {
      executionId,
      workflowId,
      userId,
      nodeOutputs: {},
      variables: {},
      globalData: {},
      nodeMetadata: {},
      executionStartTime: new Date()
    }
  }

  /**
   * Store node metadata for variable resolution
   */
  setNodeMetadata(nodeId: string, metadata: { title: string, type: string, outputSchema?: any[] }): void {
    this.context.nodeMetadata[nodeId] = metadata
  }

  /**
   * Store output data from a node execution
   */
  setNodeOutput(nodeId: string, output: NodeOutput): void {
    this.context.nodeOutputs[nodeId] = output
  }

  /**
   * Get output data from a specific node
   */
  getNodeOutput(nodeId: string): NodeOutput | null {
    return this.context.nodeOutputs[nodeId] || null
  }

  /**
   * Set a custom variable
   */
  setVariable(name: string, value: any): void {
    this.context.variables[name] = value
  }

  /**
   * Get a custom variable
   */
  getVariable(name: string): any {
    return this.context.variables[name]
  }

  /**
   * Set global workflow data
   */
  setGlobalData(key: string, value: any): void {
    this.context.globalData[key] = value
  }

  /**
   * Get global workflow data
   */
  getGlobalData(key: string): any {
    return this.context.globalData[key]
  }

  /**
   * Set the current node being executed
   */
  setCurrentNode(nodeId: string): void {
    this.context.currentNodeId = nodeId
  }

  /**
   * Resolve a variable reference (e.g., "{{node1.subject}}" or "{{var.customField}}").
   *
   * As of PR-C1a, template parsing is delegated to the canonical resolver in
   * `lib/workflows/actions/core/resolveValue.ts` for the shared feature set
   * (`{{trigger.x}}`, `{{nodeId.x}}`, `{{NOW}}`, `{{*}}`, prefix matching,
   * embedded templates, the `Action: Provider: Name.Field` format). The
   * stateful and schema-aware features unique to DataFlowManager
   * (`{{Node Title.Field Label}}` schema-driven, `{{var.x}}`, `{{global.x}}`)
   * are handled in-class as pre-processing before delegation, with a
   * single-part variable fallback as post-processing.
   *
   * Miss behavior is preserved from pre-PR-C1a:
   *   - Plain string (no `{{}}`): returned unchanged.
   *   - Embedded miss `"prefix {{x}} suffix"` where `{{x}}` doesn't resolve:
   *     canonical now returns the literal-preserved string — this is an
   *     intentional improvement over pre-PR-C1a behavior (which returned
   *     `undefined` due to an unanchored `directVarMatch`). Documented in
   *     resolver-consolidation-design.md §2.
   *   - Full-template miss `{{x}}`: returns `undefined`, matching pre-PR-C1a.
   *
   * Strict-mode hard-fail lands in PR-C1b.
   */
  resolveVariable(reference: string): any {
    logger.info(`🔧 DataFlowManager resolving variable: "${reference}"`)

    if (!reference || typeof reference !== 'string') {
      return reference
    }

    // Plain strings without templates pass through unchanged.
    if (!reference.includes('{{')) {
      return reference
    }

    // PRE-PROCESS 1: human-readable {{Node Title.Field Label}} (schema-aware)
    // Anchored to full-template references only — embedded usage like
    // "Hello {{Node Title.Field}}!" delegates to canonical so prefix/suffix
    // substitution works correctly. Pre-PR-C1a fired on embedded too and
    // dropped prefix/suffix; that bug is intentionally fixed here.
    // Skip if the first capture looks like a node ID (node-/trigger-/add-action-<digits>)
    const humanReadableMatch = reference.match(/^\{\{([^.→]+)(?:\.|\s*→\s*)([^}]+)\}\}$/)
    const isNodeId = humanReadableMatch && /^(node|trigger|add-action)-\d+(-[a-z0-9]+)?/.test(humanReadableMatch[1].trim())
    if (humanReadableMatch && !isNodeId) {
      const humanReadableResult = this.tryResolveHumanReadable(
        humanReadableMatch[1].trim(),
        humanReadableMatch[2].trim()
      )
      if (humanReadableResult !== undefined) {
        return humanReadableResult
      }
      // Fall through to subsequent matchers
    }

    // PRE-PROCESS 2: stateful-only `{{var.x}}` (anchored to single-template only;
    // embedded `{{var.x}}` in a longer string falls through to canonical, which
    // leaves the literal in place — pre-PR-C1a behavior was undefined via an
    // unanchored fall-through; the literal-preserved string is an improvement)
    const varMatch = reference.match(/^\{\{var\.([^}]+)\}\}$/)
    if (varMatch) {
      return this.getVariable(varMatch[1])
    }

    // PRE-PROCESS 3: stateful-only `{{global.x}}` (anchored, same rationale)
    const globalMatch = reference.match(/^\{\{global\.([^}]+)\}\}$/)
    if (globalMatch) {
      return this.getGlobalData(globalMatch[1])
    }

    // Detect single-template vs embedded for miss-handling below.
    const isFullTemplate = /^\{\{([^}]+)\}\}$/.test(reference)

    // DELEGATE: canonical engine handles {{trigger.x}}, {{nodeId.x}}, {{NOW}},
    // {{*}}, prefix matching, embedded templates, recursion, etc.
    const canonicalInput = this.buildInputFromState()
    const canonicalResult = canonicalResolveValue(reference, canonicalInput)

    // For embedded templates, canonical's result is always the right answer.
    // Substituted refs are replaced; missing refs are left as literals.
    if (!isFullTemplate) {
      return canonicalResult
    }

    // Full-template path: canonical returns the resolved value or undefined.
    if (canonicalResult !== undefined && canonicalResult !== reference) {
      return canonicalResult
    }

    // POST-PROCESS: legacy parseVariableReference fallback for node references
    // the canonical engine doesn't recognize. Kept as a safety net.
    const normalizedReference = normalizeVariableReference(reference)
    const parsedReference = parseVariableReference(normalizedReference)
    if (parsedReference && parsedReference.kind === 'node' && parsedReference.nodeId) {
      const output = this.getNodeOutput(parsedReference.nodeId)
      if (output && output.success) {
        if (parsedReference.fieldPath.length > 0) {
          const fieldValue = this.getNestedValue(output.data, parsedReference.fieldPath.join('.'))
          if (fieldValue !== null && fieldValue !== undefined) {
            return fieldValue
          }
        } else {
          return output.data
        }
      }
    }

    // POST-PROCESS: single-part `{{varName}}` falls back to a custom variable
    const directVarMatch = reference.match(/^\{\{([^}.]+)\}\}$/)
    if (directVarMatch) {
      const varValue = this.getVariable(directVarMatch[1])
      if (varValue !== undefined) {
        return varValue
      }
    }

    // Full-template miss: return undefined (matches pre-PR-C1a behavior).
    return undefined
  }

  /**
   * Try to resolve `{{Node Title.Field Label}}` using node metadata + output schema.
   * Returns the resolved value, or `undefined` if no match (caller falls through).
   * Logic preserved verbatim from the pre-PR-C1a implementation, extracted into
   * a helper so the main resolution path reads cleanly.
   */
  private tryResolveHumanReadable(nodeTitle: string, fieldLabel: string): any {
    logger.info(`🔍 Human-readable format detected: nodeTitle="${nodeTitle}", fieldLabel="${fieldLabel}"`)

    // Find the node by exact title match first
    const nodeId = Object.keys(this.context.nodeMetadata).find(id => {
      const metadata = this.context.nodeMetadata[id]
      return metadata.title === nodeTitle
    })

    let fallbackNodeId = nodeId
    if (!nodeId) {
      // Strategy 1: by TYPE (e.g., hitl_conversation, ai_agent)
      fallbackNodeId = Object.keys(this.context.nodeMetadata).find(id =>
        this.context.nodeMetadata[id].type === nodeTitle
      )

      // Strategy 2: AI agent by type if title hints at AI
      if (!fallbackNodeId && (nodeTitle === 'AI Agent' || nodeTitle.includes('AI') || nodeTitle.includes('Agent'))) {
        fallbackNodeId = Object.keys(this.context.nodeMetadata).find(id =>
          this.context.nodeMetadata[id].type === 'ai_agent'
        )
      }

      // Strategy 3: case-insensitive partial title match
      if (!fallbackNodeId) {
        fallbackNodeId = Object.keys(this.context.nodeMetadata).find(id => {
          const metadata = this.context.nodeMetadata[id]
          return metadata.title.toLowerCase().includes(nodeTitle.toLowerCase()) ||
                 nodeTitle.toLowerCase().includes(metadata.title.toLowerCase())
        })
      }

      // Strategy 4: any ai_agent if the field looks AI-flavored
      if (!fallbackNodeId && (fieldLabel === 'AI Agent Output' || fieldLabel === 'output')) {
        fallbackNodeId = Object.keys(this.context.nodeMetadata).find(id =>
          this.context.nodeMetadata[id].type === 'ai_agent'
        )
      }

      // Strategy 5: nodeTitle present directly as a key in nodeOutputs
      // (HITL resumed workflows store outputs by type)
      if (!fallbackNodeId && this.context.nodeOutputs[nodeTitle]) {
        const output = this.context.nodeOutputs[nodeTitle]
        if (output && output.data) {
          const result = this.getNestedValue(output.data, fieldLabel)
          if (result !== null && result !== undefined) {
            return result
          }
        }
      }
    }

    if (!fallbackNodeId) {
      return undefined
    }

    const output = this.getNodeOutput(fallbackNodeId)
    const metadata = this.context.nodeMetadata[fallbackNodeId]

    if (output && output.success && metadata.outputSchema) {
      // Find the field by label or name in the output schema
      const field = metadata.outputSchema.find(f =>
        f.label === fieldLabel || f.name === fieldLabel
      )

      if (field) {
        return this.getNestedValue(output.data, field.name)
      }

      // Schema-miss fallback: simple structure access
      if (output.data && typeof output.data === 'object') {
        if (output.data.output !== undefined && (fieldLabel === 'AI Agent Output' || fieldLabel === 'output')) {
          return output.data.output
        }
        return output.data[fieldLabel] || output.data
      }
      return output.data
    }

    return undefined
  }

  /**
   * Build the `input` dict the canonical resolver expects from internal state.
   *
   * The canonical resolver's `{{nodeId.field}}` lookup paths are:
   *   - `nodeData[field]` (direct)
   *   - `nodeData.output[field]`
   *   - `nodeData.output.output[field]` (double-nested)
   *
   * DataFlowManager stores node output data at `nodeOutputs[nodeId].data`.
   * To make the canonical resolver's `output[field]` path catch our data, we
   * mirror `data` → `output` when shaping each node entry. This is read-only
   * — the original `nodeOutputs` state is unchanged.
   */
  private buildInputFromState(): Record<string, any> {
    const reshaped: Record<string, any> = {}
    for (const [nodeId, output] of Object.entries(this.context.nodeOutputs)) {
      if (output && typeof output === 'object') {
        reshaped[nodeId] = {
          ...output,
          // Canonical engine reads `nodeData.output[field]`. Mirror data → output.
          output: output.data,
        }
      } else {
        reshaped[nodeId] = output
      }
    }

    const result: Record<string, any> = {
      ...reshaped,
      nodeOutputs: this.context.nodeOutputs,
    }

    // Surface trigger data at the canonical path `input.trigger.<field>` only
    // if the trigger output is actually present. Setting `trigger: null` when
    // missing causes canonical's reduce-into-input to return `null` instead of
    // `undefined`, breaking the miss-behavior contract.
    if (this.context.nodeOutputs.trigger?.data !== undefined) {
      result.trigger = this.context.nodeOutputs.trigger.data
    }

    return result
  }

  /**
   * Strict counterpart to `resolveVariable`. Same resolution logic, but
   * throws `MissingVariableError` (from `core/resolveValue.ts`) on the first
   * unresolved `{{...}}` reference — covering full-template AND embedded
   * positions, plus the stateful-only paths (`{{var.x}}`, `{{global.x}}`,
   * `{{Node Title.Field Label}}`).
   *
   * Used by `nodeExecutionService.executeNodeByType` to strictly pre-resolve
   * a node's config before dispatching to action / integration handlers.
   * The handler-invocation site catches `MissingVariableError` and converts
   * it to the standardized `{success:false, category:'config', error:{code,
   * path}}` shape (Q2). Soft `resolveVariable` remains the default for
   * design-time callers (preview, planner, builder, AI agent suggestions).
   */
  resolveVariableStrict(reference: string): any {
    if (!reference || typeof reference !== 'string') {
      return reference
    }

    if (!reference.includes('{{')) {
      return reference
    }

    // PRE-PROCESS 1: human-readable {{Node Title.Field Label}} (schema-aware,
    // anchored to full-template only — embedded usage delegates to canonical).
    const humanReadableMatch = reference.match(/^\{\{([^.→]+)(?:\.|\s*→\s*)([^}]+)\}\}$/)
    const isNodeId = humanReadableMatch && /^(node|trigger|add-action)-\d+(-[a-z0-9]+)?/.test(humanReadableMatch[1].trim())
    if (humanReadableMatch && !isNodeId) {
      const result = this.tryResolveHumanReadable(
        humanReadableMatch[1].trim(),
        humanReadableMatch[2].trim()
      )
      if (result !== undefined) {
        return result
      }
      // Don't throw yet — fall through to canonical (a NodeId-style match may
      // still succeed, e.g. the title coincidentally looks like a nodeId).
    }

    // PRE-PROCESS 2: stateful-only `{{var.x}}` — strict throws when unset.
    const varMatch = reference.match(/^\{\{var\.([^}]+)\}\}$/)
    if (varMatch) {
      const value = this.getVariable(varMatch[1])
      if (value !== undefined) return value
      throw new MissingVariableError(`var.${varMatch[1]}`)
    }

    // PRE-PROCESS 3: stateful-only `{{global.x}}` — strict throws when unset.
    const globalMatch = reference.match(/^\{\{global\.([^}]+)\}\}$/)
    if (globalMatch) {
      const value = this.getGlobalData(globalMatch[1])
      if (value !== undefined) return value
      throw new MissingVariableError(`global.${globalMatch[1]}`)
    }

    const isFullTemplate = /^\{\{([^}]+)\}\}$/.test(reference)
    const canonicalInput = this.buildInputFromState()

    // For embedded templates, canonical-strict throws on the first miss
    // directly — no post-processing path applies (post-process targets are
    // full-template references like `{{varName}}`).
    if (!isFullTemplate) {
      return canonicalResolveValueStrict(reference, canonicalInput)
    }

    // Full-template path: try canonical first; if it throws, attempt the
    // post-process fallbacks below. If they also fail, re-throw the canonical
    // error so the path reported is consistent with the user's reference.
    let canonicalError: MissingVariableError | undefined
    try {
      const result = canonicalResolveValueStrict(reference, canonicalInput)
      if (result !== undefined) return result
      // canonical-strict shouldn't return undefined (it throws on miss), but
      // guard for safety in case a caller pre-injects an undefined value.
    } catch (err) {
      if (err instanceof MissingVariableError) {
        canonicalError = err
      } else {
        throw err
      }
    }

    // POST-PROCESS: legacy parseVariableReference fallback for node references
    // the canonical engine doesn't recognize. Mirrors the soft path's safety
    // net so strict mode doesn't reject references the soft path would accept.
    const normalizedReference = normalizeVariableReference(reference)
    const parsedReference = parseVariableReference(normalizedReference)
    if (parsedReference && parsedReference.kind === 'node' && parsedReference.nodeId) {
      const output = this.getNodeOutput(parsedReference.nodeId)
      if (output && output.success) {
        if (parsedReference.fieldPath.length > 0) {
          const fieldValue = this.getNestedValue(output.data, parsedReference.fieldPath.join('.'))
          if (fieldValue !== null && fieldValue !== undefined) {
            return fieldValue
          }
        } else {
          return output.data
        }
      }
    }

    // POST-PROCESS: single-part `{{varName}}` fallback to a custom variable.
    const directVarMatch = reference.match(/^\{\{([^}.]+)\}\}$/)
    if (directVarMatch) {
      const varValue = this.getVariable(directVarMatch[1])
      if (varValue !== undefined) {
        return varValue
      }
    }

    // All paths exhausted — strict failure. Prefer the canonical-derived
    // error (its `path` is normalized) over reconstructing one here.
    throw canonicalError ?? new MissingVariableError(
      reference.replace(/^\{\{/, '').replace(/\}\}$/, '').trim()
    )
  }

  /**
   * Strict counterpart to `resolveObject`. Recurses through arrays and
   * objects exactly like the soft path, but every string is resolved via
   * `resolveVariableStrict`. The first unresolved reference anywhere in the
   * tree throws `MissingVariableError` and aborts the traversal — the engine
   * layer catches and converts to the standardized config-failure shape.
   */
  resolveObjectStrict(obj: any): any {
    if (typeof obj === 'string') {
      return this.resolveVariableStrict(obj)
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.resolveObjectStrict(item))
    }

    if (obj && typeof obj === 'object') {
      const resolved: any = {}
      for (const [key, value] of Object.entries(obj)) {
        resolved[key] = this.resolveObjectStrict(value)
      }
      return resolved
    }

    return obj
  }

  /**
   * Resolve all variable references in an object recursively
   */
  resolveObject(obj: any): any {
    if (typeof obj === 'string') {
      return this.resolveVariable(obj)
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.resolveObject(item))
    }
    
    if (obj && typeof obj === 'object') {
      const resolved: any = {}
      for (const [key, value] of Object.entries(obj)) {
        resolved[key] = this.resolveObject(value)
      }
      return resolved
    }
    
    return obj
  }

  /**
   * Get nested value from an object using dot notation
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : null
    }, obj)
  }

  /**
   * Get all available variable references for the UI
   */
  getAvailableReferences(): {
    nodeOutputs: Array<{ nodeId: string; fields: string[] }>
    variables: string[]
    globalData: string[]
  } {
    const nodeOutputs = Object.entries(this.context.nodeOutputs).map(([nodeId, output]) => {
      const fields = this.extractFields(output.data)
      return { nodeId, fields }
    })

    const variables = Object.keys(this.context.variables)
    const globalData = Object.keys(this.context.globalData)

    return { nodeOutputs, variables, globalData }
  }

  /**
   * Extract available fields from an object for UI suggestions
   */
  private extractFields(obj: any, prefix = ''): string[] {
    if (!obj || typeof obj !== 'object') {
      return []
    }

    const fields: string[] = []
    
    for (const [key, value] of Object.entries(obj)) {
      const fieldPath = prefix ? `${prefix}.${key}` : key
      fields.push(fieldPath)
      
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        fields.push(...this.extractFields(value, fieldPath))
      }
    }
    
    return fields
  }

  /**
   * Get the current context
   */
  getContext(): DataFlowContext {
    return { ...this.context }
  }

  /**
   * Set the current node being executed
   */
  setCurrentNode(nodeId: string, parentNodeId?: string): void {
    this.context.currentNodeId = nodeId
    this.context.parentNodeId = parentNodeId
  }
}

/**
 * Create a new data flow manager instance
 */
export function createDataFlowManager(executionId: string, workflowId: string, userId: string): DataFlowManager {
  return new DataFlowManager(executionId, workflowId, userId)
} 
