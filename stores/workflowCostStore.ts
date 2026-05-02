"use client"

import { create } from "zustand"

export interface LoopCostDetailClient {
  loopNodeId: string
  innerCost: number
  maxIterations: number
  expandedCost: number
}

interface WorkflowCostState {
  workflowId: string | null
  estimatedTasks: number
  worstCaseTasks: number
  hasLoops: boolean
  loopDetails: LoopCostDetailClient[]
  byNode: Record<string, number>
  byProvider: Record<string, { tasks: number; count: number }>
}

interface WorkflowCostActions {
  setWorkflowCostDetailed: (
    id: string,
    data: {
      estimatedTasks: number
      worstCaseTasks: number
      hasLoops: boolean
      loopDetails: LoopCostDetailClient[]
      byNode: Record<string, number>
      byProvider: Record<string, { tasks: number; count: number }>
    }
  ) => void

  clearWorkflowCost: () => void
}

const initialState: WorkflowCostState = {
  workflowId: null,
  estimatedTasks: 0,
  worstCaseTasks: 0,
  hasLoops: false,
  loopDetails: [],
  byNode: {},
  byProvider: {},
}

export const useWorkflowCostStore = create<WorkflowCostState & WorkflowCostActions>((set) => ({
  ...initialState,

  setWorkflowCostDetailed: (id, data) => {
    set({
      workflowId: id,
      estimatedTasks: data.estimatedTasks,
      worstCaseTasks: data.worstCaseTasks,
      hasLoops: data.hasLoops,
      loopDetails: data.loopDetails,
      byNode: data.byNode,
      byProvider: data.byProvider,
    })
  },

  clearWorkflowCost: () => {
    set(initialState)
  },
}))
