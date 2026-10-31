import type {TableState} from "./ARHoldemTypes"

type Transfer = {from: number; to: number; amount: number}
/** Read-only animation contract. Seats are 0..5 and index 6 is the pot. */
export interface PresentationVisual {
  id: number
  phase: string
  progress: number
  actor: number | null
  transfers: Transfer[]
  startStacks: number[]
  endStacks: number[]
  startPot: number
  endPot: number
}
type Cue = {state: TableState; seconds: number; phase: string; dealCounts: number[];
  actor: number | null; transfers: Transfer[]; start: number[]; end: number[]; startPot: number; endPot: number}

/** Small presentation-only queue. It never makes poker decisions or invents cards. */
export class ARHoldemPresentation {
  private actionSeconds: number
  private boardCardSeconds: number
  private streetPauseSeconds: number
  private maxQueued: number
  private cues: Cue[] = []
  private elapsed = 0
  private activeDuration = 0
  private active = false
  private shown: TableState | null = null
  private shownCue: Cue | null = null
  private generation = 0
  private visualId = 0
  /** Last authoritative frame accepted, independent of the currently animated cue. */
  private accepted: TableState | null = null

  constructor(actionSeconds = 1.0, boardCardSeconds = 0.55,
    streetPauseSeconds = 0.8, maxQueued = 256) {
    this.actionSeconds = Math.max(1.0, actionSeconds)
    this.boardCardSeconds = Math.max(0.55, boardCardSeconds)
    this.streetPauseSeconds = Math.max(0.8, streetPauseSeconds)
    this.maxQueued = Math.max(256, maxQueued)
  }

  get displayState(): TableState | null { return this.shown }
  get phase(): string { return this.presenting ? this.shownCue?.phase ?? "action" : "idle" }
  get dealCounts(): number[] { return this.shownCue?.dealCounts.slice() ?? [0, 0, 0, 0, 0, 0] }
  get presenting(): boolean { return this.active || this.cues.length > 0 }
  get token(): number { return this.generation }
  get duration(): number { return this.activeDuration }
  get visual(): PresentationVisual | null {
    const cue = this.shownCue
    if (!cue || !this.presenting) return null
    return {id: this.visualId, phase: cue.phase, progress: cue.seconds <= 0 ? 1 : Math.min(1, this.elapsed / cue.seconds),
      actor: cue.actor, transfers: cue.transfers.map(t => ({...t})), startStacks: cue.start.slice(), endStacks: cue.end.slice(),
      startPot: cue.startPot, endPot: cue.endPot}
  }

  configure(actionSeconds: number, boardCardSeconds: number, streetPauseSeconds: number): void {
    this.actionSeconds = Math.max(1.0, Math.min(2.5, actionSeconds))
    this.boardCardSeconds = Math.max(0.55, Math.min(1.5, boardCardSeconds))
    this.streetPauseSeconds = Math.max(0.8, Math.min(2.0, streetPauseSeconds))
  }

  reset(state: TableState | null): void {
    this.generation++
    this.cues = []
    this.active = false
    this.elapsed = this.activeDuration = 0
    this.shown = state
    this.accepted = state ? this.copy(state) : null
    this.shownCue = state ? this.makeCue(state, 0, "idle") : null
    this.visualId++
  }

  enqueue(frames: TableState[]): void {
    if (!frames.length) return
    let previous = this.accepted
    const additions: Cue[] = []
    for (const target of frames) {
      if (previous && previous.session !== target.session) { this.reset(target); previous = target; continue }
      const sameHand = !!previous && previous.hand === target.hand && previous.session === target.session
      const oldBoard = sameHand ? previous!.board : []
      const newBoard = target.board
      const newHand = target.hand > (previous?.hand ?? 0)
      if (newHand && target.players.some(player => player.dealt_in)) this.addDealCues(target, additions)

      const oldActions = sameHand ? previous!.action_history : []
      const actionChanged = target.action_history.length > oldActions.length
      // Each AI gets a private pre-action beat; only the already-known board and action prefix are shown.
      const actionDelta = target.action_history.length - oldActions.length
      if (actionChanged && actionDelta === 1) {
        const record = target.action_history[target.action_history.length - 1]
        if (record.seat !== 0 && previous) {
          const before = this.copy(previous)
          before.actor = record.seat
          before.thinking = true
          additions.push(this.makeCue(before, 2.2, "thinking", record.seat))
        }
        const action = this.copy(target)
        action.board = oldBoard.slice()
        action.street = previous?.street ?? "preflop"
        action.thinking = false
        action.actor = target.actor
        this.clearSettlement(action, previous)
        const starts = previous ? this.vector(previous) : this.vector(action)
        const ends = this.vector(action)
        const transfers: Transfer[] = (record.paid ?? 0) > 0 ?
          [{from: record.seat, to: 6, amount: record.paid!}] : []
        additions.push(this.makeCue(action, this.actionSeconds, "action", record.seat, transfers, starts, ends))
      } else if (actionChanged) {
        // A missing journal revision means intermediate actor/stack state cannot be reconstructed safely.
        const recovery = this.copy(target)
        recovery.board = oldBoard.slice()
        recovery.street = previous?.street ?? "preflop"
        this.clearSettlement(recovery, previous)
        additions.push(this.makeCue(recovery, this.actionSeconds, "action"))
      }
      const boardGrows = newBoard.length > oldBoard.length
      if (boardGrows) {
        for (let count = oldBoard.length + 1; count <= newBoard.length; count++) {
          const staged = this.copy(target)
          staged.board = newBoard.slice(0, count)
          staged.street = count <= 3 ? "flop" : count === 4 ? "turn" : "river"
          this.clearSettlement(staged, previous)
          const pause = count === 3 || count === 4 ? this.streetPauseSeconds : 0
          additions.push(this.makeCue(staged, this.boardCardSeconds + pause,
            count <= 3 ? "flop" : count === 4 ? "turn" : "river"))
        }
      }

      const terminal = target.done && (!sameHand || !previous?.done)
      if (terminal) {
        const unpaid = this.copy(target)
        const starts = this.unpaidVector(target)
        unpaid.players = unpaid.players.map((p, seat) => ({...p, stack: starts[seat]}))
        unpaid.pot = starts[6]
        unpaid.done = true
        unpaid.net = unpaid.net.map(() => 0)
        unpaid.results = []
        // Reveals are now public, while winnings remain in the displayed pot.
        additions.push(this.makeCue(unpaid, 1.2, "showdown"))
        const end = this.vector(target)
        const transfers: Transfer[] = []
        if (target.settlement) {
          for (const pot of target.settlement.pots) for (const award of pot.awards)
            if (award.amount) transfers.push({from: 6, to: award.seat, amount: award.amount})
          for (const refund of target.settlement.refunds)
            if (refund.amount) transfers.push({from: 6, to: refund.seat, amount: refund.amount})
        }
        const payout = this.copy(target)
        payout.net = payout.net.map(() => 0)
        payout.results = []
        additions.push(this.makeCue(payout, 1.4, "payout", null, transfers, starts, end))
        additions.push(this.makeCue(this.copy(target), 2.5, "settled"))
      } else if (!actionChanged && !boardGrows && !newHand &&
          (!previous || target.revision !== previous.revision || target.session !== previous.session)) {
        additions.push(this.makeCue(this.copy(target), this.actionSeconds, "action"))
      }
      previous = target
      this.accepted = this.copy(target)
    }
    if (!additions.length) return
    if (this.cues.length + additions.length > this.maxQueued) { this.reset(frames[frames.length - 1]); return }
    this.cues.push(...additions)
  }

  update(dt: number): TableState | null {
    let changed = false
    if (!this.active && this.cues.length) { this.activate(this.cues.shift()!); changed = true }
    if (this.active) {
      this.elapsed += Math.max(0, dt)
      if (this.shownCue?.phase === "payout" && this.shown) this.interpolatePayout()
      if (this.elapsed >= this.activeDuration) {
        this.active = false; changed = true
        if (this.cues.length) this.activate(this.cues.shift()!)
      }
    }
    return changed ? this.shown : null
  }

  private makeCue(state: TableState, seconds: number, phase: string, actor: number | null = null,
    transfers: Transfer[] = [], start?: number[], end?: number[]): Cue {
    const vector = this.vector(state)
    return {state, seconds, phase, dealCounts: this.countsFor(state), actor, transfers,
      start: start ?? vector, end: end ?? vector, startPot: start ? start[6] : state.pot,
      endPot: end ? end[6] : state.pot}
  }
  private vector(state: TableState): number[] { return [...state.players.map(p => p.stack), state.pot] }
  private unpaidVector(state: TableState): number[] {
    const result = this.vector(state), settlement = state.settlement
    if (!settlement) return result
    let awarded = 0
    for (const pot of settlement.pots) for (const award of pot.awards) { result[award.seat] -= award.amount; awarded += award.amount }
    for (const refund of settlement.refunds) { result[refund.seat] -= refund.amount; awarded += refund.amount }
    result[6] += awarded
    return result
  }
  private interpolatePayout(): void {
    const cue = this.shownCue!, progress = cue.seconds <= 0 ? 1 : Math.min(1, this.elapsed / cue.seconds)
    const vector = cue.start.slice()
    for (const transfer of cue.transfers) {
      const moved = Math.round(transfer.amount * progress)
      vector[transfer.from] -= moved
      vector[transfer.to] += moved
    }
    this.shown!.players = this.shown!.players.map((p, i) => ({...p, stack: vector[i]}))
    this.shown!.pot = vector[6]
  }
  private activate(cue: Cue): void {
    this.shown = cue.state; this.shownCue = cue
    if (cue.phase === "payout") {
      this.shown.players = this.shown.players.map((player, seat) => ({...player, stack: cue.start[seat]}))
      this.shown.pot = cue.start[6]
    }
    this.activeDuration = Math.max(0, cue.seconds); this.elapsed = 0; this.active = true; this.visualId++
  }
  private addDealCues(target: TableState, additions: Cue[]): void {
    const order: number[] = []
    for (let offset = 1; offset <= target.players.length; offset++) {
      const seat = (target.button + offset) % target.players.length
      if (target.players[seat].dealt_in && !target.players[seat].folded) order.push(seat)
    }
    const step = 1.8 / Math.max(1, order.length * 2), counts = [0, 0, 0, 0, 0, 0]
    for (let round = 1; round <= 2; round++) for (const seat of order) {
      counts[seat] = round
      const staged = this.copy(target); staged.board = []; staged.street = "preflop"
      this.clearSettlement(staged, null); staged.hole = target.hole.slice(0, counts[0])
      additions.push(this.makeCue(staged, step, "dealing"))
      additions[additions.length - 1].dealCounts = counts.slice()
    }
  }
  private countsFor(state: TableState): number[] { return state.players.map(player => player.dealt_in && !player.folded ? 2 : 0) }
  private clearSettlement(state: TableState, previous: TableState | null): void {
    if (!state.done && !state.settlement) return
    if (state.settlement) {
      const unpaid = this.unpaidVector(state)
      state.players = state.players.map((player, seat) => ({...player, stack: unpaid[seat]})); state.pot = unpaid[6]
    } else if (previous) {
      state.players = state.players.map((player, seat) => ({...player, stack: previous.players[seat].stack})); state.pot = previous.pot
    }
    state.done = false; state.settlement = null; state.net = state.net.map(() => 0); state.results = []
  }
  private copy(state: TableState): TableState {
    return {...state, board: state.board.slice(), hole: state.hole.slice(), players: state.players.map(player => ({...player})),
      action_history: state.action_history.map(action => ({...action})), results: state.results.slice(), net: state.net.slice(),
      settlement: state.settlement ? {...state.settlement, winners: state.settlement.winners.slice(),
        reveals: state.settlement.reveals.map(reveal => ({...reveal, hole: reveal.hole.slice()})),
        pots: state.settlement.pots.map(pot => ({...pot, winners: pot.winners.slice(), awards: pot.awards.map(award => ({...award}))})),
        refunds: state.settlement.refunds.map(refund => ({...refund}))} : state.settlement}
  }
}
