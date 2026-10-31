const assert = require("node:assert/strict")
const {ARHoldemPresentation} = require("../ar/lens-studio/ARHoldem/Assets/Scripts/ARHoldemPresentation.ts")

function state(overrides = {}) {
  const players = Array.from({length: 6}, (_, seat) => ({seat,
    name: ["YOU", "ATLAS", "NOVA", "ORION", "LYRA", "VEGA"][seat],
    stack: 500, bet: 0, committed: 0, folded: false, dealt_in: false}))
  return {session: "s1", revision: 0, mode: "test", provider: "local", source: "test",
    hand: 0, table_size: 6, button: 0, small_blind_seat: null, big_blind_seat: null,
    street: "preflop", hole: [], board: [], pot: 0, small_blind: 5, big_blind: 10,
    players, legal: {actions: []}, actor: null, thinking: false, done: false, error: "",
    can_start: true, results: [], net: [0, 0, 0, 0, 0, 0], action_history: [], settlement: null,
    ...overrides}
}

function drain(queue, firstDelta = 0) {
  const seen = []
  let lastState = null
  let next = queue.update(firstDelta)
  if (next && next !== lastState) { seen.push({state: next, phase: queue.phase, counts: queue.dealCounts}); lastState = next }
  for (let i = 0; i < 100 && queue.presenting; i++) {
    next = queue.update(2)
    if (next && next !== lastState) { seen.push({state: next, phase: queue.phase, counts: queue.dealCounts}); lastState = next }
  }
  assert.equal(queue.presenting, false, "presentation queue drains")
  return seen
}

{
  const start = state({hand: 1, button: 4, hole: ["As", "Kd"], players: state().players.map(p =>
    ({...p, dealt_in: p.seat !== 2 && p.seat !== 4}))})
  const q = new ARHoldemPresentation()
  q.reset(state())
  q.enqueue([start])
  const frames = drain(q)
  assert.equal(frames.length, 8, "only four dealt seats receive two cards each")
  assert.equal(frames[0].counts[5], 1, "first card goes left of the button")
  assert.equal(frames[0].counts[0], 0)
  assert.equal(frames[1].counts[0], 1)
  assert.equal(frames[2].counts[1], 1)
  assert.equal(frames.every(frame => frame.state.hole.length <= 2), true)
  assert.equal(frames.at(-1).counts[0], 2, "second round returns to the first active seat")
  const dealt = frames.map(frame => frame.counts.reduce((sum, count) => sum + count, 0))
  assert.deepEqual(dealt, [1, 2, 3, 4, 5, 6, 7, 8], "each deal cue adds exactly one visible card")
  assert.equal(frames[4].counts[5], 2, "second round keeps first-round cards visible")
  assert.equal(frames[4].counts[0], 1)
}

{
  const before = state({hand: 1, revision: 4, button: 0, street: "preflop", pot: 50,
    players: state().players.map((p, seat) => ({...p, dealt_in: seat < 2,
      stack: seat === 1 ? 550 : 500, committed: seat === 1 ? 50 : 0}))})
  before.players[0].stack = 400
  const final = state({hand: 1, revision: 5, button: 0, street: "river", done: true, net: [200, -200, 0, 0, 0, 0],
    board: ["2s", "3d", "4c", "5h", "6s"], pot: 0,
    players: state().players.map((p, seat) => ({...p, dealt_in: seat < 2,
      stack: seat === 0 ? 600 : seat === 1 ? 400 : 500})),
    action_history: [{seat: 1, action: "allin", paid: 200, all_in: true}],
    settlement: {reason: "showdown", winners: [0],
      reveals: [{seat: 0, hole: ["As", "Kd"], hand_name: "Straight", hand_label: "Straight"},
        {seat: 1, hole: ["Qs", "Qd"], hand_name: "One pair", hand_label: "One pair"}],
      pots: [{index: 0, amount: 200, winners: [0], awards: [{seat: 0, amount: 200}], hand_name: "Straight"}],
      refunds: [{seat: 1, amount: 50}]}})
  const q = new ARHoldemPresentation()
  q.reset(before)
  q.enqueue([final])
  const frames = drain(q)
  assert.deepEqual(frames.map(frame => frame.phase), ["thinking", "action", "flop", "flop", "flop", "turn", "river", "showdown", "payout", "settled"])
  assert.equal(frames.every(frame => frame.state.players.reduce((sum, p) => sum + p.stack, 0) + frame.state.pot === 3000),
    true, "every AI terminal presentation phase conserves total chips")
  assert.equal(frames[0].state.board.length, 0, "thinking beat uses pre-action board")
  assert.equal(frames[0].state.action_history.length, 0, "thinking beat hides the action being considered")
  assert.equal(frames[0].state.actor, 1)
  assert.equal(frames[0].state.players[0].folded, false)
  assert.deepEqual(frames.slice(2, 7).map(frame => frame.state.board.length), [1, 2, 3, 4, 5])
  assert.equal(frames[6].state.done, false, "river is visible before settlement")
  assert.equal(frames[6].state.settlement, null)
  assert.equal(frames[7].state.players[0].stack, 400, "winner payout stays hidden during board reveal")
  assert.equal(frames[7].state.players[1].stack, 350, "refund is reversed from stack until final settlement")
  assert.equal(frames[7].state.pot, 250, "pot preview includes returned refunds before settlement")
  assert.equal(frames[7].state.players.reduce((sum, player) => sum + player.stack, 0) + frames[7].state.pot,
    final.players.reduce((sum, player) => sum + player.stack, 0), "pre-settlement chips remain conserved")
  assert.equal(frames[7].state.pot, 250, "showdown holds all chips in the pot before payout")
  assert.equal(frames[7].state.players.reduce((sum, player) => sum + player.stack, 0) + frames[7].state.pot, 3000)
  assert.equal(frames[7].state.net.every(value => value === 0), true, "net result stays hidden during showdown")
  assert.equal(frames[8].state.net.every(value => value === 0), true, "net result stays hidden during payout")
  assert.equal(frames[8].state.pot, 0, "payout completes by clearing the pot")
  assert.equal(frames.at(-1).state.done, true)
  assert.equal(frames.at(-1).state.players[0].stack, 600)
  assert.equal(frames.at(-1).state.players[1].stack, 400)
  assert.equal(frames.at(-1).state.pot, 0)
  assert.deepEqual(frames.at(-1).state.net, final.net, "truthful net appears in the settled phase")
}

{
  const old = state({hand: 2, revision: 9, board: ["2s", "3s", "4s"]})
  const nextHand = state({hand: 3, revision: 10, button: 0, hole: ["As", "Kd"],
    players: state().players.map(p => ({...p, dealt_in: true}))})
  const q = new ARHoldemPresentation()
  q.reset(old)
  q.enqueue([nextHand])
  const frames = drain(q)
  assert.equal(frames.every(frame => frame.state.board.length === 0), true, "a new hand clears the old board")
}

{
  const oldDone = state({hand: 4, revision: 12, done: true, board: ["2s", "3s", "4s", "5s", "6s"]})
  const immediateDone = state({hand: 5, revision: 14, button: 4, done: true, street: "river",
    board: ["7s", "8s", "9s", "Ts", "Js"], hole: ["As", "Kd"],
    players: state().players.map((p, seat) => ({...p, dealt_in: seat < 2, stack: seat === 0 ? 700 : 300})),
    settlement: {reason: "showdown", winners: [0],
      reveals: [{seat: 0, hole: ["As", "Kd"], hand_name: "Straight", hand_label: "Straight"},
        {seat: 1, hole: ["Qs", "Qd"], hand_name: "One pair", hand_label: "One pair"}],
      pots: [{index: 0, amount: 200, winners: [0], awards: [{seat: 0, amount: 200}], hand_name: "Straight"}],
      refunds: []}})
  const q = new ARHoldemPresentation()
  q.reset(oldDone)
  q.enqueue([immediateDone])
  const frames = drain(q)
  const dealFrames = frames.filter(frame => frame.phase === "dealing")
  assert.equal(dealFrames.length, 4, "only the two dealt seats get cards on the short-handed deal")
  assert.equal(dealFrames.every(frame => frame.state.board.length === 0 && frame.state.settlement === null && !frame.state.done),
    true, "deal cues never reveal runout or settlement")
  assert.equal(frames.filter(frame => frame.phase === "showdown" && frame.state.done).length, 1,
    "a new hand that auto-runs to completion still has exactly one terminal reveal")
  assert.deepEqual(frames.filter(frame => ["flop", "turn", "river"].includes(frame.phase)).map(frame => frame.state.board.length), [1, 2, 3, 4, 5])
  assert.deepEqual(frames.slice(-3).map(frame => frame.phase), ["showdown", "payout", "settled"])
}

{
  const current = state({hand: 1, revision: 2})
  const q = new ARHoldemPresentation()
  q.reset(current)
  q.enqueue([current])
  assert.equal(q.presenting, false, "an unchanged state does not replay")
  const overloaded = new ARHoldemPresentation(0.68, 0.4, 0.5, 2)
  overloaded.reset(state())
  const latest = state({hand: 1, revision: 1, hole: ["As", "Kd"],
    players: state().players.map(p => ({...p, dealt_in: true}))})
  overloaded.enqueue([latest])
  assert.equal(overloaded.presenting, true, "queue capacity floors at 256 to fit a six-seat burst")
  assert.equal(overloaded.displayState.revision, 0)
}

{
  const before = state({hand: 8, revision: 1, players: state().players.map(p => ({...p, dealt_in: true}))})
  const after = state({hand: 8, revision: 2, players: state().players.map(p => ({...p, dealt_in: true, stack: p.seat === 2 ? 490 : 500,
      committed: p.seat === 2 ? 10 : 0})), pot: 10, actor: 2, thinking: false,
    action_history: [{seat: 2, action: "call", paid: 10}]})
  const q = new ARHoldemPresentation(0.68, 0.4, 0.5)
  q.reset(before); q.enqueue([after])
  q.update(0)
  assert.equal(q.phase, "thinking", "every AI action starts with a thinking cue")
  assert.equal(q.duration, 2.2, "old fast Inspector presets cannot shorten AI thinking")
  assert.equal(q.displayState.actor, 2)
  assert.equal(q.displayState.action_history.length, 0, "future action stays hidden during thinking")
  assert.equal(q.displayState.pot, 0, "future contribution stays hidden during thinking")
  assert.equal(q.displayState.players[2].stack, 500)
  assert.equal(q.displayState.players[2].bet, 0)
  assert.equal(q.displayState.players[2].committed, 0)
  assert.equal(q.displayState.players[2].folded, false, "future fold flags stay hidden during thinking")
  const chips = q.displayState.players.reduce((sum, p) => sum + p.stack, 0) + q.displayState.pot
  assert.equal(chips, 3000, "thinking snapshot does not leak changed stacks")
  assert.equal(q.visual.actor, 2)
  q.update(2.2)
  assert.equal(q.phase, "action")
  assert.equal(q.duration, 1, "AI action gets a readable movement beat")
  assert.deepEqual(q.visual.startStacks, [500, 500, 500, 500, 500, 500, 0], "action animation begins from pre-action chips")
  assert.deepEqual(q.visual.endStacks, [500, 500, 490, 500, 500, 500, 10], "action animation ends at the authoritative post-action chips")
  assert.deepEqual(q.visual.transfers, [{from: 2, to: 6, amount: 10}])
  assert.equal(q.displayState.actor, after.actor, "action cue restores the authoritative next actor")
}

{
  const start = state({hand: 9, revision: 1, board: ["2s", "3d", "4c", "5h", "6s"],
    players: state().players.map(p => ({...p, dealt_in: p.seat < 3}))})
  const final = state({hand: 9, revision: 2, done: true, street: "river", board: start.board,
    players: state().players.map(p => ({...p, dealt_in: p.seat < 3,
      stack: p.seat === 0 ? 515 : p.seat === 1 ? 505 : p.seat === 2 ? 480 : 500})),
    settlement: {reason: "showdown", winners: [0, 1], reveals: [],
      pots: [{index: 0, amount: 30, winners: [0, 1], awards: [{seat: 0, amount: 15}, {seat: 1, amount: 15}], hand_name: null}],
      refunds: []}})
  const q = new ARHoldemPresentation(); q.reset(start); q.enqueue([final]); q.update(0)
  assert.equal(q.phase, "showdown")
  q.update(1.2); q.update(0)
  assert.equal(q.phase, "payout")
  assert.equal(q.displayState.pot, 30, "payout starts with the pot intact on its first visible frame")
  assert.equal(q.displayState.players[0].stack, 500, "payout starts from unpaid stacks without a one-frame jump")
  for (const dt of [0.19, 0.27, 0.31, 0.63]) {
    q.update(dt)
    const s = q.displayState
    assert.equal(s.players.reduce((sum, p) => sum + p.stack, 0) + s.pot, 3000, "every payout tick conserves chips")
  }
  q.update(0.01)
  assert.equal(q.phase, "settled")
  assert.equal(q.displayState.players[0].stack, 515, "split payout lands on final authoritative stacks")
  assert.equal(q.displayState.players[1].stack, 505)
  assert.equal(q.duration, 2.5, "settled state gets a winner reading beat")
  q.update(2.5)
  assert.equal(q.presenting, false, "settlement does not replay")
  q.enqueue([final])
  assert.equal(q.presenting, false, "repeated authoritative terminal snapshots do not replay settlement")
}

{
  const previous = state({hand: 11, revision: 1, players: state().players.map(p => ({...p, dealt_in: p.seat < 2}))})
  const terminalFold = state({hand: 11, revision: 2, done: true, actor: null,
    players: state().players.map(p => ({...p, dealt_in: p.seat < 2,
      folded: p.seat === 1, stack: p.seat === 0 ? 520 : p.seat === 1 ? 480 : 500})),
    pot: 0, action_history: [{seat: 1, action: "fold", paid: 0}],
    settlement: {reason: "uncontested", winners: [0], reveals: [],
      pots: [{index: 0, amount: 20, winners: [0], awards: [{seat: 0, amount: 20}], hand_name: null}], refunds: []}})
  const q = new ARHoldemPresentation(); q.reset(previous); q.enqueue([terminalFold]); q.update(0)
  assert.equal(q.phase, "thinking")
  assert.equal(q.displayState.players[1].folded, false, "terminal fold is not visible during the pre-action thought beat")
  q.update(2.2)
  assert.equal(q.phase, "action")
  assert.equal(q.displayState.done, false, "human-visible action cue does not publish terminal settlement")
  assert.equal(q.displayState.settlement, null)
  assert.equal(q.displayState.net.every(value => value === 0), true)
  assert.equal(q.displayState.players.reduce((sum, p) => sum + p.stack, 0) + q.displayState.pot, 3000)
  q.update(1); assert.equal(q.phase, "showdown")
  assert.equal(q.displayState.players.reduce((sum, p) => sum + p.stack, 0) + q.displayState.pot, 3000)
}

{
  const first = state({hand: 12, revision: 1})
  const afterOne = state({hand: 12, revision: 2, pot: 10,
    players: state().players.map(p => ({...p, stack: p.seat === 2 ? 490 : 500})),
    action_history: [{seat: 2, action: "call", paid: 10}]})
  const afterTwo = state({hand: 12, revision: 3, pot: 15,
    players: state().players.map(p => ({...p, stack: p.seat === 2 ? 490 : p.seat === 3 ? 495 : 500})),
    action_history: [{seat: 2, action: "call", paid: 10}, {seat: 3, action: "call", paid: 5}]})
  const q = new ARHoldemPresentation(); q.reset(first); q.enqueue([afterOne]); q.update(0)
  q.enqueue([afterTwo]) // arrives while the first thinking cue is active
  const phases = []
  for (let i = 0; i < 10 && q.presenting; i++) { phases.push(q.phase); q.update(3) }
  assert.deepEqual(phases.slice(0, 4), ["thinking", "action", "thinking", "action"], "new frames compare against the accepted authoritative tail while busy")
  assert.equal(q.displayState.actor, afterTwo.actor, "last action cue restores the newest authoritative actor")
  assert.deepEqual(q.visual, null)
}

{
  const base = state({hand: 10, players: state().players.map(p => ({...p, dealt_in: p.seat < 2}))})
  const uncontested = state({hand: 10, done: true, street: "river", board: ["2s", "3d", "4c", "5h", "6s"],
    players: state().players.map(p => ({...p, dealt_in: p.seat < 2, stack: p.seat === 0 ? 550 : p.seat === 1 ? 450 : 500})),
    settlement: {reason: "uncontested", winners: [0], reveals: [],
      pots: [{index: 0, amount: 50, winners: [0], awards: [{seat: 0, amount: 50}], hand_name: null}],
      refunds: [{seat: 1, amount: 50}]}})
  const q = new ARHoldemPresentation(); q.reset(base); q.enqueue([uncontested]); q.update(0)
  for (let i = 0; i < 8 && q.phase !== "showdown"; i++) q.update(2)
  assert.equal(q.phase, "showdown", "uncontested hand still gets an explicit collection beat")
  assert.equal(q.displayState.players[0].stack, 500)
  assert.equal(q.displayState.players[1].stack, 400)
  assert.equal(q.displayState.pot, 100, "uncontested award and refund remain in pot until payout")
  q.update(1.2); q.update(0)
  assert.equal(q.phase, "payout")
  assert.deepEqual(q.visual.transfers, [{from: 6, to: 0, amount: 50}, {from: 6, to: 1, amount: 50}])
  q.update(1.4)
  assert.equal(q.displayState.players[0].stack, 550)
  assert.equal(q.displayState.players[1].stack, 450)
  assert.equal(q.displayState.pot, 0)
  assert.equal(q.displayState.players.reduce((sum, p) => sum + p.stack, 0) + q.displayState.pot, 3000)
}

{
  // The human calls 100 into a 100-chip pot, wins 200, and finishes +100 net.
  const before = state({hand: 13, revision: 1, actor: 0, street: "river", hole: ["As", "Kd"],
    board: ["2s", "3d", "4c", "5h", "6s"], pot: 100,
    players: state().players.map(p => ({...p, dealt_in: p.seat < 2,
      stack: p.seat === 0 ? 500 : p.seat === 1 ? 400 : 500,
      committed: p.seat === 1 ? 100 : 0}))})
  const final = state({hand: 13, revision: 2, actor: null, done: true, street: "river",
    hole: ["As", "Kd"], board: ["2s", "3d", "4c", "5h", "6s"], net: [100, -100, 0, 0, 0, 0],
    players: state().players.map(p => ({...p, dealt_in: p.seat < 2,
      stack: p.seat === 0 ? 600 : p.seat === 1 ? 400 : 500})),
    action_history: [{seat: 0, action: "call", paid: 100}],
    settlement: {reason: "showdown", winners: [0],
      reveals: [{seat: 0, hole: ["As", "Kd"], hand_name: "Straight", hand_label: "Straight"},
        {seat: 1, hole: ["Qs", "Qd"], hand_name: "One pair", hand_label: "One pair"}],
      pots: [{index: 0, amount: 200, winners: [0], awards: [{seat: 0, amount: 200}], hand_name: "Straight"}],
      refunds: []}})
  const q = new ARHoldemPresentation(); q.reset(before); q.enqueue([final]); q.update(0)
  assert.equal(q.phase, "action", "human action has no AI thinking delay")
  assert.equal(q.displayState.done, false)
  assert.equal(q.displayState.settlement, null)
  assert.equal(q.displayState.net.every(value => value === 0), true)
  assert.deepEqual(q.visual.startStacks, [500, 400, 500, 500, 500, 500, 100])
  assert.deepEqual(q.visual.endStacks, [400, 400, 500, 500, 500, 500, 200])
  assert.deepEqual(q.visual.transfers, [{from: 0, to: 6, amount: 100}], "human chip movement matches paid amount")
  assert.equal(q.visual.endStacks[0] - q.visual.startStacks[0], -q.visual.transfers[0].amount)
  assert.equal(q.visual.endStacks[6] - q.visual.startStacks[6], q.visual.transfers[0].amount)
  assert.equal(q.displayState.players.reduce((sum, p) => sum + p.stack, 0) + q.displayState.pot, 3000,
    "first human action balance is exact")
  q.update(1)
  assert.equal(q.phase, "showdown")
  assert.equal(q.displayState.players[0].stack, 400)
  assert.equal(q.displayState.players[1].stack, 400)
  assert.equal(q.displayState.pot, 200)
  assert.equal(q.displayState.net.every(value => value === 0), true)
  q.update(1.2); q.update(0)
  assert.equal(q.phase, "payout")
  assert.equal(q.displayState.players.reduce((sum, p) => sum + p.stack, 0) + q.displayState.pot, 3000)
  q.update(1.4)
  assert.equal(q.phase, "settled")
  assert.equal(q.displayState.players[0].stack, 600)
  assert.equal(q.displayState.players[1].stack, 400)
  assert.equal(q.displayState.pot, 0)
  assert.deepEqual(q.displayState.net, [100, -100, 0, 0, 0, 0], "human winner sees truthful final net")
  assert.equal(q.displayState.players.reduce((sum, p) => sum + p.stack, 0) + q.displayState.pot, 3000,
    "last human-win balance is exact")
}

console.log("presentation scheduler checks passed")
