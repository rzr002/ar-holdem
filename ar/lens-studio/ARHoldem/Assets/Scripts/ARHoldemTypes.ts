/** Live opponents' cards stay private; settlement reveals eligible showdown hands. */
export type PokerAction = "fold" | "check" | "call" | "raise" | "allin"
export const SEAT_NAMES = ["YOU", "ATLAS", "NOVA", "ORION", "LYRA", "VEGA"]

export interface TablePlayer {
  seat: number
  name: string
  stack: number
  bet: number
  committed: number
  folded: boolean
  dealt_in: boolean
}

export interface ActionRecord {
  seat: number
  action: string
  amount?: number
  street?: string
  paid?: number
  raise_to?: number
  all_in?: boolean
}

export interface SettlementReveal {
  seat: number
  hole: string[]
  hand_name: string
  hand_label: string
}

export interface TableSettlement {
  reason: "showdown" | "uncontested"
  winners: number[]
  reveals: SettlementReveal[]
  pots: Array<{index: number; amount: number; winners: number[];
    awards: Array<{seat: number; amount: number}>; hand_name: string | null}>
  refunds: Array<{seat: number; amount: number}>
}

export interface TableState {
  session: string
  revision: number
  mode: string
  provider: string
  source: string
  hand: number
  table_size: number
  button: number
  small_blind_seat: number | null
  big_blind_seat: number | null
  street: string
  hole: string[]
  board: string[]
  pot: number
  small_blind: number
  big_blind: number
  current_bet?: number
  players: TablePlayer[]
  legal: {actions: PokerAction[]; to_call?: number; min_raise_to?: number; max_raise_to?: number}
  actor: number | null
  thinking: boolean
  done: boolean
  error: string
  can_start: boolean
  results: string[]
  net: number[]
  action_history: ActionRecord[]
  /** Missing only on older bridges. Opponent cards are public only after showdown. */
  settlement?: TableSettlement | null
}

/** Optional transition journal supplied by newer local bridges. */
export interface StatePresentation {
  frames: TableState[]
  reset: boolean
}

export type PresentedTableState = TableState & {presentation?: StatePresentation}

export type TableCommand =
  | {kind: "new" | "retry" | "reconnect"}
  | {kind: "action"; action: PokerAction; amount?: number}

export function isTableState(value: any): value is TableState {
  const isSeat = (seat: any): boolean => Number.isInteger(seat) && seat >= 0 && seat < SEAT_NAMES.length
  return value !== null && typeof value === "object" &&
    typeof value.session === "string" && Number.isInteger(value.revision) &&
    value.table_size === SEAT_NAMES.length &&
    Array.isArray(value.players) && value.players.length === SEAT_NAMES.length &&
    value.players.every((p: any, i: number) => p && p.seat === i && p.name === SEAT_NAMES[i] &&
      Number.isFinite(p.stack) && Number.isFinite(p.bet) && Number.isFinite(p.committed) &&
      typeof p.folded === "boolean" && typeof p.dealt_in === "boolean" && !("hole" in p)) &&
    isSeat(value.button) && (value.actor === null || isSeat(value.actor)) &&
    (value.small_blind_seat === null || isSeat(value.small_blind_seat)) &&
    (value.big_blind_seat === null || isSeat(value.big_blind_seat)) &&
    Number.isInteger(value.hand) && typeof value.street === "string" &&
    Number.isFinite(value.small_blind) && Number.isFinite(value.big_blind) &&
    Array.isArray(value.hole) && value.hole.length <= 2 &&
    Array.isArray(value.board) && value.board.length <= 5 &&
    [...value.hole, ...value.board].every((c: any) => typeof c === "string" && /^[2-9TJQKA][shdc]$/.test(c)) &&
    new Set([...value.hole, ...value.board]).size === value.hole.length + value.board.length &&
    value.legal && Array.isArray(value.legal.actions) &&
    Array.isArray(value.action_history) && Array.isArray(value.net) &&
    typeof value.thinking === "boolean" && typeof value.done === "boolean" &&
    typeof value.error === "string" && Number.isFinite(value.pot) && isSettlement(value)
}

function isSettlement(state: TableState): boolean {
  const value = state.settlement as any
  if (value === undefined) return true // Older bridges do not expose showdown cards.
  if (!state.done) return value === null
  if (!value || (value.reason !== "showdown" && value.reason !== "uncontested")) return false
  const isSeat = (seat: any): boolean => Number.isInteger(seat) && seat >= 0 && seat < state.players.length
  const isAmount = (amount: any): boolean => Number.isSafeInteger(amount) && amount >= 0
  const uniqueSeats = (seats: any): boolean => Array.isArray(seats) && seats.length > 0 &&
    seats.every(isSeat) && new Set(seats).size === seats.length
  const handNames = ["High card", "One pair", "Two pair", "Three of a kind", "Straight",
    "Flush", "Full house", "Four of a kind", "Straight flush"]
  if (!uniqueSeats(value.winners) || !Array.isArray(value.reveals) ||
      !Array.isArray(value.pots) || !value.pots.length || !Array.isArray(value.refunds)) return false
  const eligible = state.players.filter(player => player.dealt_in && !player.folded).map(player => player.seat)
  if (!value.winners.every((seat: number) => eligible.includes(seat))) return false
  if (value.reason === "uncontested" && (value.reveals.length !== 0 || eligible.length !== 1)) return false
  if (value.reason === "showdown" && (state.board.length !== 5 || eligible.length < 2 ||
      value.reveals.length !== eligible.length)) return false
  const revealedSeats = new Set<number>()
  const cards = new Set([...state.board, ...state.hole])
  for (const reveal of value.reveals) {
    if (!reveal || !isSeat(reveal.seat) || !eligible.includes(reveal.seat) || revealedSeats.has(reveal.seat) ||
        !Array.isArray(reveal.hole) || reveal.hole.length !== 2 ||
        !reveal.hole.every((card: any) => typeof card === "string" && /^[2-9TJQKA][shdc]$/.test(card)) ||
        reveal.hole[0] === reveal.hole[1] || !handNames.includes(reveal.hand_name) ||
        typeof reveal.hand_label !== "string" || !reveal.hand_label.trim() || reveal.hand_label.length > 96 ||
        /[\x00-\x1f]/.test(reveal.hand_label)) return false
    revealedSeats.add(reveal.seat)
    if (reveal.seat === 0) {
      if (state.hole.length !== 2 || !reveal.hole.every((card: string) => state.hole.includes(card))) return false
    } else {
      for (const card of reveal.hole) {
        if (cards.has(card)) return false
        cards.add(card)
      }
    }
  }
  const potWinners = new Set<number>()
  for (let index = 0; index < value.pots.length; index++) {
    const pot = value.pots[index]
    if (!pot || pot.index !== index || !isAmount(pot.amount) || pot.amount === 0 || !uniqueSeats(pot.winners) ||
        !pot.winners.every((seat: number) => eligible.includes(seat)) ||
        !Array.isArray(pot.awards) || pot.awards.length !== pot.winners.length ||
        (pot.hand_name !== null && !handNames.includes(pot.hand_name))) return false
    const awarded = new Set<number>()
    let total = 0
    for (const award of pot.awards) {
      if (!award || !isSeat(award.seat) || !pot.winners.includes(award.seat) || awarded.has(award.seat) ||
          !isAmount(award.amount)) return false
      awarded.add(award.seat)
      potWinners.add(award.seat)
      total += award.amount
    }
    if (total !== pot.amount) return false
  }
  if (potWinners.size !== value.winners.length || !value.winners.every((seat: number) => potWinners.has(seat))) return false
  const refunded = new Set<number>()
  return value.refunds.every((refund: any) => {
    if (!refund || !isSeat(refund.seat) || !state.players[refund.seat].dealt_in || refunded.has(refund.seat) ||
        !isAmount(refund.amount) || refund.amount === 0) return false
    refunded.add(refund.seat)
    return true
  })
}

/** No rule decisions here: clamp the presentation preset to the engine's legal bounds. */
export function presetRaiseTo(state: TableState, potSized: boolean): number {
  const min = state.legal.min_raise_to ?? 0
  const max = state.legal.max_raise_to ?? 0
  const potTarget = (state.current_bet ?? 0) + state.pot + (state.legal.to_call ?? 0)
  return Math.min(max, Math.max(min, potSized ? potTarget : min))
}
