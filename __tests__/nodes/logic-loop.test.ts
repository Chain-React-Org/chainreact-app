/**
 * Contract: executeLoop, getNextLoopIteration, getNextCountIteration
 * Source: lib/workflows/actions/logic/loop.ts
 * Style: real handler invocation against realistic inputs. The loop handler
 *        has no network or DB dependency, so the harness primarily provides
 *        the logger mock and ExecutionContext shape.
 *
 * Bug class: billing leak / iteration miscount — the loop drives the
 * cost-preview reservation. A regression that miscounts items, drops the
 * 500-iteration cap, or returns isLast=false on the final batch would
 * either over-charge users or run the workflow forever.
 */

import { resetHarness, makeContext } from "../helpers/actionTestHarness"

import {
  executeLoop,
  getNextLoopIteration,
  getNextCountIteration,
} from "@/lib/workflows/actions/logic/loop"

afterEach(() => {
  resetHarness()
})

// Bug class: items mode — wrong array handling silently drops items or
// reports the wrong iteration count to the engine.
describe("executeLoop — items mode", () => {
  test("returns first item, iteration 1, totalItems = array length on a real array input", async () => {
    const result = await executeLoop(
      { items: ["a", "b", "c"], batchSize: 1 },
      makeContext(),
    )

    expect(result.success).toBe(true)
    expect(result.output.currentItem).toBe("a")
    expect(result.output.index).toBe(0)
    expect(result.output.iteration).toBe(1)
    expect(result.output.totalItems).toBe(3)
    expect(result.output.isFirst).toBe(true)
    expect(result.output.isLast).toBe(false)
    expect(result.output.batch).toEqual(["a"])
    expect(result.output.progressPercentage).toBe(33)
    expect(result.output.remainingItems).toBe(2)
  })

  test("batches multiple items when batchSize > 1", async () => {
    const result = await executeLoop(
      { items: ["a", "b", "c", "d", "e"], batchSize: 2 },
      makeContext(),
    )

    expect(result.output.batch).toEqual(["a", "b"])
    expect(result.output.batchSize).toBe(2)
    expect(result.output.currentItem).toBe("a")
    expect(result.output.totalItems).toBe(5)
    expect(result.output.isLast).toBe(false)
    expect(result.output.progressPercentage).toBe(40)
  })

  test("isLast is true on a single-item array (regression: would otherwise hang the engine)", async () => {
    const result = await executeLoop({ items: ["only"], batchSize: 1 }, makeContext())
    expect(result.output.isLast).toBe(true)
    expect(result.output.totalItems).toBe(1)
  })

  test("succeeds with totalItems=0 on an empty array (no iterations)", async () => {
    const result = await executeLoop({ items: [], batchSize: 1 }, makeContext())
    expect(result.success).toBe(true)
    expect(result.output.totalItems).toBe(0)
    expect(result.output.iteration).toBe(0)
    expect(result.output.batch).toEqual([])
    expect(result.message).toContain("0 items")
  })

  test("parses a JSON-string items value", async () => {
    const result = await executeLoop(
      { items: JSON.stringify([1, 2, 3]), batchSize: 1 },
      makeContext(),
    )
    expect(result.output.totalItems).toBe(3)
    expect(result.output.currentItem).toBe(1)
  })

  test("wraps a non-JSON string into a single-item array", async () => {
    const result = await executeLoop(
      { items: "just-a-string", batchSize: 1 },
      makeContext(),
    )
    expect(result.output.totalItems).toBe(1)
    expect(result.output.currentItem).toBe("just-a-string")
  })

  test("extracts the array from an object that holds one (e.g., { records: [...] })", async () => {
    const result = await executeLoop(
      { items: { records: [{ id: 1 }, { id: 2 }] }, batchSize: 1 },
      makeContext(),
    )
    expect(result.output.totalItems).toBe(2)
    expect(result.output.currentItem).toEqual({ id: 1 })
  })

  test("clamps batchSize to the array length when caller asks for more", async () => {
    const result = await executeLoop(
      { items: ["a", "b"], batchSize: 99 },
      makeContext(),
    )
    expect(result.output.batchSize).toBe(2)
    expect(result.output.batch).toEqual(["a", "b"])
    expect(result.output.isLast).toBe(true)
  })

  test("clamps batchSize to a minimum of 1 when caller passes 0", async () => {
    const result = await executeLoop(
      { items: ["a", "b"], batchSize: 0 },
      makeContext(),
    )
    expect(result.output.batchSize).toBe(1)
  })

  test("returns failure with a clear message when items is missing entirely", async () => {
    const result = await executeLoop({ batchSize: 1 }, makeContext())
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/items/i)
  })
})

// Bug class: count-mode arithmetic — mis-cap or wrong counter math could
// either let a user run >500 iterations (billing leak) or silently skip
// iterations they paid for.
describe("executeLoop — count mode", () => {
  test("returns counter = initialValue on the first iteration", async () => {
    const result = await executeLoop(
      { loopMode: "count", count: "5", initialValue: "10", stepIncrement: "1" },
      makeContext(),
    )
    expect(result.success).toBe(true)
    expect(result.output.counter).toBe(10)
    expect(result.output.iteration).toBe(1)
    expect(result.output.totalItems).toBe(5)
    expect(result.output.isFirst).toBe(true)
    expect(result.output.isLast).toBe(false)
    expect(result.output._loopConfig).toEqual({
      count: 5,
      initialValue: 10,
      stepIncrement: 1,
    })
  })

  test("isLast is true when count = 1", async () => {
    const result = await executeLoop(
      { loopMode: "count", count: "1" },
      makeContext(),
    )
    expect(result.output.isLast).toBe(true)
  })

  test("rejects count of 0 (positive-number contract)", async () => {
    const result = await executeLoop(
      { loopMode: "count", count: "0" },
      makeContext(),
    )
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/positive/i)
  })

  test("rejects negative counts", async () => {
    const result = await executeLoop(
      { loopMode: "count", count: "-5" },
      makeContext(),
    )
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/positive/i)
  })

  test("rejects non-numeric counts", async () => {
    const result = await executeLoop(
      { loopMode: "count", count: "many" },
      makeContext(),
    )
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/positive/i)
  })

  test("CAPS COUNT AT 500 (billing-leak prevention)", async () => {
    // This is the cost-preview cap. A regression that drops or relaxes this
    // would let a user run an arbitrarily expensive loop with no protection.
    const result = await executeLoop(
      { loopMode: "count", count: "501" },
      makeContext(),
    )
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/500/)
  })

  test("accepts the maximum count of 500 (boundary)", async () => {
    const result = await executeLoop(
      { loopMode: "count", count: "500" },
      makeContext(),
    )
    expect(result.success).toBe(true)
    expect(result.output.totalItems).toBe(500)
  })

  test("defaults initialValue to 1 and stepIncrement to 1 when omitted", async () => {
    const result = await executeLoop(
      { loopMode: "count", count: "3" },
      makeContext(),
    )
    expect(result.output.counter).toBe(1)
  })
})

// Bug class: stuck-loop / over-run — the engine relies on getNextLoopIteration
// returning null EXACTLY at the end. Off-by-one bugs here either run past the
// end of the array (charging extra) or terminate one iteration early.
describe("getNextLoopIteration", () => {
  test("returns null when the next index is at or past the end", async () => {
    expect(await getNextLoopIteration(["a", "b"], 0, 2)).toBeNull()
    expect(await getNextLoopIteration(["a", "b"], 1, 1)).toBeNull()
  })

  test("advances by batchSize and reports the correct iteration", async () => {
    const next = await getNextLoopIteration(["a", "b", "c", "d"], 0, 2)
    expect(next).not.toBeNull()
    expect(next!.index).toBe(2)
    expect(next!.iteration).toBe(2)
    expect(next!.batch).toEqual(["c", "d"])
    expect(next!.isLast).toBe(true)
    expect(next!.hasMore).toBe(false)
  })

  test("isLast is false on intermediate batches and true on the final batch", async () => {
    // 6 items, batchSize 2 → batches are [0..1], [2..3], [4..5].
    // Calling getNext from currentIndex=0 produces the [2..3] batch (not last).
    const items = ["a", "b", "c", "d", "e", "f"]
    const fromZero = await getNextLoopIteration(items, 0, 2)
    expect(fromZero!.index).toBe(2)
    expect(fromZero!.isLast).toBe(false)
    // Calling from currentIndex=2 produces the [4..5] batch — that IS last.
    const fromTwo = await getNextLoopIteration(items, 2, 2)
    expect(fromTwo!.index).toBe(4)
    expect(fromTwo!.isLast).toBe(true)
    // Calling from currentIndex=4 returns null — no more batches.
    const fromFour = await getNextLoopIteration(items, 4, 2)
    expect(fromFour).toBeNull()
  })

  test("isFirst is always false (the first iteration is produced by executeLoop, not this helper)", async () => {
    const next = await getNextLoopIteration(["a", "b"], 0, 1)
    expect(next!.isFirst).toBe(false)
  })
})

// Bug class: same as getNextLoopIteration but for count mode. Off-by-one here
// either over-charges (>count iterations) or short-runs (terminates early).
describe("getNextCountIteration", () => {
  test("returns null after the final iteration", async () => {
    const cfg = { count: 3, initialValue: 1, stepIncrement: 1 }
    expect(await getNextCountIteration(cfg, 3)).toBeNull()
    expect(await getNextCountIteration(cfg, 99)).toBeNull()
  })

  test("advances counter by stepIncrement on each call", async () => {
    const cfg = { count: 5, initialValue: 10, stepIncrement: 5 }
    const second = await getNextCountIteration(cfg, 1)
    expect(second!.counter).toBe(15)
    expect(second!.iteration).toBe(2)
    const third = await getNextCountIteration(cfg, 2)
    expect(third!.counter).toBe(20)
  })

  test("isLast is true on the final iteration only", async () => {
    const cfg = { count: 3, initialValue: 1, stepIncrement: 1 }
    expect((await getNextCountIteration(cfg, 1))!.isLast).toBe(false)
    expect((await getNextCountIteration(cfg, 2))!.isLast).toBe(true)
  })
})
