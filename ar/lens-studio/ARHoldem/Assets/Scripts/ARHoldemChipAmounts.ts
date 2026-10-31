/** Exact visual chip inventory for this six-seat, 3,000-chip table.
 * Five denomination stacks fit in a compact two-row rack. Change is made for
 * larger balances so a 500 stack contains useful small chips rather than one
 * abstract column. No chip represents an unspecified number of other chips.
 */
export const CHIP_DENOMINATIONS = [500, 100, 25, 5, 1] as const
export type ChipInventory = {value: number; count: number}[]

export function splitChipAmount(amount: number): ChipInventory {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 3000) {
    throw new RangeError("Chip balance must be an integer within the 3,000-chip table bank")
  }
  let remainder = amount
  const inventory = CHIP_DENOMINATIONS.map(value => {
    // Keep 500-chip notes out of ordinary starting stacks.
    const count = value === 500 && amount < 1000 ? 0 : Math.floor(remainder / value)
    remainder -= count * value
    return {value, count}
  })
  if (amount >= 100) {
    for (let target = 1; target < inventory.length; target++) {
      if (inventory[target].count > 0) continue
      for (let source = target - 1; source >= 0; source--) {
        if (!inventory[source].count) continue
        inventory[source].count--
        inventory[target].count += inventory[source].value / inventory[target].value
        break
      }
    }
  }
  return inventory
}
