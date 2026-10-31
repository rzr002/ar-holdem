import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {BackPlate} from "SpectaclesUIKit.lspkg/Scripts/BackPlate"
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {FlexLayout} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import {FlexItem} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import {FlexAlign, FlexDirection, FlexJustify} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import {ActionRecord, SEAT_NAMES, TableCommand, TableState, presetRaiseTo} from "./ARHoldemTypes"
import {ARHoldemCardFactory, ARHoldemCardVisual} from "./ARHoldemCardVisual"

type TextRole = "Title" | "Card" | "Headline" | "Body" | "Caption"
const TYPE_SCALE: Record<TextRole, {size: number; weight: number}> = {
  Title: {size: 93, weight: 700}, Card: {size: 105, weight: 700},
  Headline: {size: 54, weight: 700}, Body: {size: 39, weight: 500},
  Caption: {size: 38, weight: 500},
}
type CardView = {root: SceneObject; wrapper: SceneObject; rank: Text; mirroredRank: Text; suit: Text;
  visual: ARHoldemCardVisual; visualKey: string; animationRemaining: number}
type ActionView = {root: SceneObject; button: Button; label: Text}
type SeatView = {name: Text; badges: Text; chips: Text; move: Text; cards: CardView[]}
type PresentationVisual = {id:number; phase:string; progress:number; actor:number|null; transfers:Array<{from:number;to:number;amount:number}>; startStacks:number[]; endStacks:number[]; startPot:number; endPot:number}

/** Passive spatial view. Game rules and model decisions stay in the bridge. */
@component
export class ARHoldemTableUI extends BaseScriptComponent {
  @ui.label("AR Hold'em — spatial cards and controls")
  @ui.separator
  @ui.group_start("Authored anchors")
  @input
  @hint("Community-card row on the table")
  boardAnchor!: SceneObject
  @input
  @hint("Human private-card row near the player")
  handAnchor!: SceneObject
  @input
  @hint("Seat 1: left-near opponent")
  atlasAnchor!: SceneObject
  @input
  @hint("Seat 2: left-far opponent")
  novaAnchor!: SceneObject
  @input
  @hint("Seat 3: center-far opponent")
  orionAnchor!: SceneObject
  @input
  @hint("Seat 4: right-far opponent")
  lyraAnchor!: SceneObject
  @input
  @hint("Seat 5: right-near opponent")
  vegaAnchor!: SceneObject
  @input
  @hint("Status and pot above the table")
  statusAnchor!: SceneObject
  @input
  @hint("Human action buttons near the table edge")
  controlsAnchor!: SceneObject
  @ui.group_end
  @ui.group_start("Appearance")
  @input
  @hint("Opaque Unlit clone template for physical card faces and vector suits")
  cardMaterial!: Material
  @input
  @hint("Light text on the additive display")
  @widget(new ColorWidget())
  textColor: vec4 = new vec4(0.95, 0.97, 1, 1)
  @input
  @hint("Current-turn and pot accent")
  @widget(new ColorWidget())
  accentColor: vec4 = new vec4(0.53, 1, 0.82, 1)
  @input
  @hint("Hearts, diamonds and errors")
  @widget(new ColorWidget())
  warmColor: vec4 = new vec4(1, 0.48, 0.42, 1)
  @input
  @hint("Typography multiplier; keep labels within their cells")
  @widget(new SliderWidget(0.8, 1.5, 0.05))
  textScale: number = 1.1
  @input
  @hint("Community card width, centimeters")
  @widget(new SliderWidget(5, 8, 0.25))
  cardWidth: number = 6.2
  @input
  @hint("Action dock width, centimeters")
  @widget(new SliderWidget(40, 58, 1))
  controlsWidth: number = 46
  @ui.group_end

  readonly onCommand = new Event<TableCommand>()
  private ready = false
  private initializationStarted = false
  private latest: TableState | null = null
  private displayed: TableState | null = null
  private presentationPhase = "idle"
  private presentation: PresentationVisual | null = null
  private dealCounts = [0, 0, 0, 0, 0, 0]
  private busy = false
  private connectionError = "Connecting to local table…"
  private cardFactory!: ARHoldemCardFactory
  private board: CardView[] = []
  private handCards: CardView[] = []
  private seats: SeatView[] = []
  private title!: Text
  private status!: Text
  private pot!: Text
  private provider!: Text
  private human!: Text
  private humanStatus!: Text
  private hint!: Text
  private buttons: Record<string, ActionView> = {}
  private readonly winnerColor = new vec4(1, 0.82, 0.28, 1)

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.initialize())
    this.createEvent("UpdateEvent").bind(() => this.animateCards())
  }

  /** Idempotent so the main component need not depend on hierarchy startup order. */
  public initialize(): void {
    // A failed build is diagnosed on the next preview reset. Never append another
    // partial tree when Main and this component both receive their startup event.
    if (this.ready || this.initializationStarted) return
    const anchors = [this.boardAnchor, this.handAnchor, this.atlasAnchor,
      this.novaAnchor, this.orionAnchor, this.lyraAnchor, this.vegaAnchor,
      this.statusAnchor, this.controlsAnchor]
    if (anchors.some(a => !a) || !this.cardMaterial) return
    this.initializationStarted = true
    this.cardFactory = new ARHoldemCardFactory(this.cardMaterial)
    anchors.forEach(a => a.createComponent("Component.Canvas"))

    const boardRow = this.flex(this.boardAnchor, "CommunityCards", FlexDirection.Row,
      5 * this.cardWidth + 4 * 0.8, 9, 0.8)
    for (let i = 0; i < 5; i++) this.board.push(this.card(boardRow, `BoardCard${i + 1}`, this.cardWidth, 9))

    const handColumn = this.flex(this.handAnchor, "HumanHand", FlexDirection.Column, 18, 14, 0.4)
    this.human = this.label(handColumn, "YourSeat", "YOU · 500", "Headline", 18, 2.1)
    this.humanStatus = this.label(handColumn, "YourSeatStatus", "READY", "Caption", 18, 2.2)
    this.fitText(this.humanStatus)
    const handRow = this.flexChild(handColumn, {w: 18, h: 9.5}, () => {})
    this.attachFlex(handRow, FlexDirection.Row, 18, 9.5, 1)
    for (let i = 0; i < 2; i++) this.handCards.push(this.card(handRow, `YourCard${i + 1}`, 7.5, 9.5))

    this.seats = [this.atlasAnchor, this.novaAnchor, this.orionAnchor, this.lyraAnchor, this.vegaAnchor]
      .map((anchor, index) => this.seat(anchor, SEAT_NAMES[index + 1]))

    const statusRoot = this.panel(this.statusAnchor, "TableStatus", 34, 12)
    const statusCol = this.flex(statusRoot, "StatusContent", FlexDirection.Column, 32, 10.8, 0.5)
    this.title = this.label(statusCol, "TableTitle", "AR HOLD'EM", "Headline", 32, 2)
    this.pot = this.label(statusCol, "Pot", "VIRTUAL CHIPS ONLY", "Headline", 32, 3)
    this.status = this.label(statusCol, "TurnStatus", "Connecting…", "Body", 32, 2.5)
    this.fitText(this.pot, true)
    this.fitText(this.status, true)
    this.provider = this.label(statusCol, "OpponentSource", "LUCAS v16 · LOCAL", "Caption", 32, 1.8)

    const dock = this.panel(this.controlsAnchor, "ActionDock", this.controlsWidth, 17)
    const dockCol = this.flex(dock, "ActionDockContent", FlexDirection.Column, this.controlsWidth - 2, 15.4, 0.6)
    this.hint = this.label(dockCol, "ActionHint", "Pinch a button to play", "Caption", this.controlsWidth - 3, 1.6)
    const width = (this.controlsWidth - 4) / 3
    const first = this.flexChild(dockCol, {w: this.controlsWidth - 2, h: 6}, () => {})
    this.attachFlex(first, FlexDirection.Row, this.controlsWidth - 2, 6, 0.8)
    this.buttons.fold = this.button(first, "Fold", width, () => this.action("fold"))
    this.buttons.call = this.button(first, "Check / Call", width, () => {
      if (this.latest) this.action(this.latest.legal.actions.includes("check") ? "check" : "call")
    })
    this.buttons.allin = this.button(first, "All-in", width, () => this.action("allin"))
    const second = this.flexChild(dockCol, {w: this.controlsWidth - 2, h: 6}, () => {})
    this.attachFlex(second, FlexDirection.Row, this.controlsWidth - 2, 6, 0.8)
    this.buttons.raise = this.button(second, "Raise to —", width, () => {
      if (this.latest) this.action("raise", presetRaiseTo(this.latest, false))
    })
    this.buttons.pot = this.button(second, "Pot to —", width, () => {
      if (this.latest) this.action("raise", presetRaiseTo(this.latest, true))
    })
    this.buttons.deal = this.button(second, "Deal", width, () => {
      if (this.connectionError) this.onCommand.invoke({kind: "reconnect"})
      else if (this.latest?.error) this.onCommand.invoke({kind: "retry"})
      else this.onCommand.invoke({kind: "new"})
    })
    this.ready = true
    this.render()
    console.log("[ARHoldem] spatial UI ready")
  }

  public setState(state: TableState | null, busy: boolean, connectionError: string,
    displayed: TableState | null = state, phase = "idle", dealCounts?: number[], visual: PresentationVisual | null = null): void {
    this.latest = state
    this.displayed = displayed
    this.presentationPhase = phase
    this.presentation = visual
    this.dealCounts = dealCounts?.slice() ?? [0, 0, 0, 0, 0, 0]
    this.busy = busy
    this.connectionError = connectionError
    if (this.ready) this.render()
  }

  public cancelCardAnimations(): void {
    for (const card of this.allCards()) {
      card.animationRemaining = 0
      card.wrapper.getTransform().setLocalPosition(new vec3(0, 0, 0))
      card.wrapper.getTransform().setLocalRotation(quat.angleAxis(0, new vec3(0, 1, 0)))
    }
  }

  private action(action: "fold" | "check" | "call" | "raise" | "allin", amount = 0): void {
    if (!this.latest || this.busy || this.connectionError || this.latest.actor !== 0 ||
        this.latest.thinking || !this.latest.legal.actions.includes(action)) return
    this.onCommand.invoke({kind: "action", action, amount})
  }

  private render(): void {
    const s = this.displayed
    this.board.forEach((c, i) => this.updateCard(c, s?.board[i] ?? "", false))
    this.handCards.forEach((c, i) => this.updateCard(c, i < (this.dealCounts[0] ?? 2) ? s?.hole[i] ?? "" : "", false))
    const visualActor = this.presentation?.actor
    const currentActor = visualActor === null || visualActor === undefined ? s?.actor : visualActor
    const turnsVisible = this.presentationPhase === "idle" || this.presentationPhase === "thinking"
    const humanActive = turnsVisible && !!s && currentActor === 0 && !s.done
    const humanWinner = this.winnerBadge(s, 0)
    const humanReveal = this.reveal(s, 0)
    const humanBet = s?.players[0]?.bet ?? 0
    this.setText(this.human, `YOU · ${s?.players[0]?.stack ?? 500}${humanBet ? ` · BET ${humanBet}` : ""}`)
    this.setColor(this.human.textFill, humanWinner ? this.winnerColor : humanActive ? this.accentColor : this.textColor)
    const humanDelta = s?.net?.[0]
    const resultVisible = !!s?.done && this.presentationPhase !== "showdown" && this.presentationPhase !== "payout"
    const humanEnd = this.presentation?.endStacks[0] ?? s?.players[0]?.stack ?? 0
    const humanStart = humanDelta !== undefined ? humanEnd - humanDelta : humanEnd
    const humanBalance = resultVisible ? `BAL ${humanStart} → ${humanEnd}` : ""
    const humanNet = resultVisible && humanDelta !== undefined
      ? `NET ${humanDelta >= 0 ? "+" : ""}${humanDelta}` : ""
    this.setText(this.humanStatus, resultVisible ? `${humanNet}\n${humanBalance}` : [humanWinner || this.seatBadges(s, 0),
      humanReveal?.hand_name ?? (humanWinner ? "" : humanActive ? "YOUR TURN" : this.seatMove(s, 0))]
      .filter(text => !!text).join(" · "))
    this.setColor(this.humanStatus.textFill, humanWinner ? this.winnerColor : humanActive ? this.accentColor : this.textColor)
    this.seats.forEach((view, index) => {
      const seat = index + 1
      const player = s?.players[seat]
      const active = turnsVisible && !!s && currentActor === seat && !s.done
      const winner = this.winnerBadge(s, seat)
      const reveal = this.reveal(s, seat)
      this.setText(view.name, `${active ? "> " : ""}${player?.name ?? SEAT_NAMES[seat]}`)
      this.setColor(view.name.textFill, winner ? this.winnerColor : active ? this.accentColor : this.textColor)
      const net = s?.net?.[seat]
      const endBalance = this.presentation?.endStacks[seat] ?? player?.stack ?? 0
      const netLabel = resultVisible && net !== undefined ? `NET ${net >= 0 ? "+" : ""}${net}` : ""
      const turnStatus = active ? (s?.error ? "RETRY" : this.presentationPhase === "thinking" || s?.thinking ? "THINKING" : "TURN") : ""
      this.setText(view.badges, winner || [this.seatBadges(s, seat), turnStatus].filter(text => !!text).join(" · "))
      this.setColor(view.badges.textFill, winner ? this.winnerColor : this.accentColor)
      this.setText(view.chips, resultVisible && net !== undefined ? `${player?.stack ?? 0} · ${endBalance-net}→${endBalance}` : `${player?.stack ?? 500} chips${player?.bet ? ` · bet ${player.bet}` : ""}`)
      this.setText(view.move, netLabel || reveal?.hand_name || this.seatMove(s, seat))
      this.setColor(view.move.textFill, winner ? this.winnerColor : active ? this.accentColor : this.textColor)
      view.cards.forEach((card, index) => {
        const count = this.dealCounts[seat] ?? (player?.dealt_in ? 2 : 0)
        const present = index < count && !!player?.dealt_in && !player.folded
        this.updateCard(card, reveal?.hole[index] ?? "", !reveal && present)
      })
    })
    const phaseTitle = this.presentationPhase === "showdown" ? "SHOWDOWN" : this.presentationPhase === "payout" ? "PAYING OUT" : this.presentationPhase === "settled" ? "HAND COMPLETE" : ""
    this.setText(this.title, phaseTitle || (s?.hand ? `6-MAX · HAND ${s.hand} · ${s.street.toUpperCase()}` : "AR HOLD'EM · 6-MAX"))
    const pendingSettlement = !!s?.done && this.presentationPhase === "showdown"
    const grossAward = s?.settlement?.pots.reduce((sum,pot)=>sum+pot.amount,0) ?? 0
    const winnerNames = s?.settlement ? this.compactNames(s, s.settlement.winners) : ""
    this.setText(this.pot, pendingSettlement ? `POT ${s?.pot ?? 0} · UNPAID` : this.presentationPhase === "payout" ? `POT ${grossAward} → ${winnerNames}` : resultVisible ? this.resultText(s!) : s?.done ? this.resultText(s) : `POT ${s?.pot ?? 0}`)
    const potRole = s?.done || this.presentationPhase === "payout" ? "Body" : "Headline"
    if ((this.pot as any).__role !== potRole) { this.applyTextRole(this.pot, potRole as TextRole); (this.pot as any).__role = potRole }
    this.setColor(this.pot.textFill, s?.done && s.settlement ? this.winnerColor : this.accentColor)
    this.setText(this.provider, !s ? "LOCAL TABLE · CONNECTING" : s.mode === "lucas" ? "LUCAS v16 · LOCAL" :
      s.mode === "codex" ? "LIVE LLM · CODEX" : s.mode === "api" ? "LIVE LLM · CUSTOM API" :
      "OFFLINE TEST · PROGRAM OPPONENTS")
    this.setColor(this.provider.textFill, s?.mode === "lucas" ? this.accentColor :
      s && (s.mode === "strategic" || s.mode === "local") ? this.warmColor : this.textColor)
    const lastAction = s?.action_history[s.action_history.length - 1]
    const actionMessage = lastAction && s
      ? `${s.players[lastAction.seat].name} · ${this.actionLabel(lastAction)}` : "Blinds posted · getting ready…"
    const presentationMessage = this.presentationPhase === "thinking" ? `${s?.players[currentActor ?? 1]?.name ?? "Opponent"} THINKING${"·".repeat(1 + Math.floor((this.presentation?.progress ?? 0) * 3) % 3)}` : this.presentationPhase === "action" ? actionMessage :
      this.presentationPhase === "flop" ? "Revealing flop…" :
      this.presentationPhase === "turn" ? "Revealing turn…" :
      this.presentationPhase === "river" ? "Revealing river…" :
      this.presentationPhase === "showdown" && s ? `${this.resultText(s)}\nShowdown · payout pending` : this.presentationPhase === "payout" && s ? `${this.resultText(s)}\nPaying out…` : this.presentationPhase === "settled" && s ? this.settlementStatus(s) : ""
    this.setText(this.status, this.connectionError ? "Bridge disconnected · Reconnect below" :
      this.presentationPhase === "dealing" ? "Dealing · hold on…" : presentationMessage ? presentationMessage :
      s?.error ? "Opponent unavailable · Retry below" : this.busy ? "Sending action…" :
      this.presentationPhase === "thinking" ? presentationMessage : s?.done ? this.settlementStatus(s) : s?.thinking ? `${s.players[s.actor ?? 1]?.name ?? "Opponent"} is thinking…` :
      s?.actor === 0 ? "YOUR TURN" : "Ready · press Deal")
    this.setColor(this.status.textFill, this.connectionError || s?.error ? this.warmColor : this.textColor)
    const authority = this.latest
    const canAct = !!authority && authority.actor === 0 && !authority.done && !authority.thinking && !this.busy && !this.connectionError
    const legal = authority?.legal.actions ?? []
    this.setButton("fold", "Fold", canAct && legal.includes("fold"))
    this.setButton("call", legal.includes("check") ? "Check" : `Call ${authority?.legal.to_call ?? 0}`,
      canAct && (legal.includes("check") || legal.includes("call")))
    this.setButton("allin", "All-in", canAct && legal.includes("allin"))
    this.setButton("raise", `Raise to ${authority ? presetRaiseTo(authority, false) : "—"}`, canAct && legal.includes("raise"))
    this.setButton("pot", `Pot to ${authority ? presetRaiseTo(authority, true) : "—"}`, canAct && legal.includes("raise"))
    const next = this.connectionError ? "Reconnect" : authority?.error ? "Retry opponent" : authority?.done ? "Next hand" : "Deal"
    this.setButton("deal", next, !!this.connectionError || (!this.busy && (!!authority?.error || !!authority?.can_start)))
    this.setText(this.hint, s?.done && !s.can_start ? "Table finished · restart bridge for a fresh stack" :
      "Raise buttons show total street bet · virtual chips")
  }

  private resultText(s: TableState): string {
    if (s.done && s.settlement) {
      const main = s.settlement.pots[0]
      const names = this.compactNames(s, main.winners)
      const label = s.settlement.reason === "showdown"
        ? this.reveal(s, main.winners[0])?.hand_label ?? "Showdown"
        : "Everyone else folded"
      return `${main.winners.length > 1 ? "MAIN SPLIT" : "MAIN"} · ${names}\n${label}`
    }
    const winners = s.net?.map((net, i) => ({net, name: s.players[i].name})).filter(p => p.net > 0) ?? []
    return winners.length ? winners.map(p => `${p.name} +${p.net}`).join("  ·  ") : "HAND SETTLED"
  }

  private settlementStatus(s: TableState): string {
    const sides = s.settlement?.pots.slice(1) ?? []
    const winners = Array.from(new Set(sides.flatMap(pot => pot.winners)))
    return (s.can_start ? "Hand settled · ready for next hand" : "Table finished · restart for a fresh stack") +
      (winners.length ? `\nSIDE POTS · ${this.compactNames(s, winners)}` : "")
  }

  private compactNames(s: TableState, seats: number[]): string {
    const names = seats.slice(0, 2).map(seat => s.players[seat].name).join(" / ")
    return names + (seats.length > 2 ? ` +${seats.length - 2} more` : "")
  }

  private winnerBadge(state: TableState | null, seat: number): string {
    if (!state?.done || !state.settlement?.winners.includes(seat)) return ""
    return state.settlement.pots.some(pot => pot.winners.includes(seat) && pot.winners.length > 1)
      ? "SPLIT WINNER" : "WINNER"
  }

  private reveal(state: TableState | null, seat: number) {
    const player = state?.players[seat]
    return state?.done && state.settlement?.reason === "showdown" && player?.dealt_in && !player.folded
      ? state.settlement.reveals.find(reveal => reveal.seat === seat) : undefined
  }

  private seatBadges(state: TableState | null, seat: number): string {
    if (!state || !state.hand) return ""
    // Blind positions come from the engine, including short-handed hands.
    return [state.button === seat ? "D" : "",
      state.small_blind_seat === seat ? "SB" : "",
      state.big_blind_seat === seat ? "BB" : ""].filter(badge => !!badge).join(" / ")
  }

  private seatMove(state: TableState | null, seat: number): string {
    if (!state || !state.hand) return "READY"
    const player = state.players[seat]
    if (!player.dealt_in) return "OUT"
    if (player.folded) return "FOLDED"
    const last = state.action_history.slice().reverse().find(action => action.seat === seat)
    if (last) return this.actionLabel(last)
    return player.stack === 0 && !state.done ? "ALL-IN" : "READY"
  }

  private actionLabel(action: ActionRecord): string {
    const amount = action.action === "raise" ? action.raise_to ?? action.amount : action.paid ?? action.amount
    const label = action.action === "raise" ? `RAISE${amount !== undefined ? ` TO ${amount}` : ""}` :
      action.action === "call" ? `CALL${amount !== undefined ? ` ${amount}` : ""}` : action.action.toUpperCase()
    return action.all_in ? `${label} · ALL-IN` : label
  }

  private setButton(key: string, label: string, active: boolean): void {
    const view = this.buttons[key]
    if (view.label.text !== label) view.label.text = label
    if (view.button.inactive === active) view.button.inactive = !active
    this.setColor(view.label.textFill, active ? this.accentColor : new vec4(0.4, 0.46, 0.5, 1))
  }

  private updateCard(card: CardView, value: string, hidden: boolean): void {
    const rank = value ? (value[0] === "T" ? "10" : value[0]) : ""
    const suit = value ? value[1] : ""
    const color = suit === "h" || suit === "d" ? this.cardFactory.redColor : this.cardFactory.inkColor
    if (card.rank.text !== rank) card.rank.text = rank
    if (card.mirroredRank.text !== rank) card.mirroredRank.text = rank
    this.setColor(card.rank.textFill, color)
    this.setColor(card.mirroredRank.textFill, color)
    // Non-rendering metadata keeps privacy assertions independent of card artwork.
    this.setText(card.suit, hidden ? "HIDDEN" : suit)
    const key = `${value}/${hidden}`
    const changed = card.visualKey !== key
    if (changed && (!!value || hidden)) {
      card.visualKey = key
      card.animationRemaining = 0.18
      card.wrapper.getTransform().setLocalPosition(new vec3(0, -0.55, 0))
      card.wrapper.getTransform().setLocalRotation(quat.angleAxis(Math.PI * 0.48, new vec3(0, 1, 0)))
    } else if (changed) {
      card.visualKey = key
      card.animationRemaining = 0
      card.wrapper.getTransform().setLocalPosition(new vec3(0, 0, 0))
      card.wrapper.getTransform().setLocalRotation(quat.angleAxis(0, new vec3(0, 1, 0)))
    }
    card.visual.set(value, hidden)
  }

  private animateCards(): void {
    const dt = getDeltaTime()
    if (this.presentationPhase === "thinking" && this.ready) this.render()
    for (const card of this.allCards()) {
      if (card.animationRemaining <= 0) continue
      card.animationRemaining = Math.max(0, card.animationRemaining - dt)
      const progress = 1 - card.animationRemaining / 0.18
      const eased = 1 - (1 - progress) * (1 - progress)
      card.wrapper.getTransform().setLocalPosition(new vec3(0, -0.55 * (1 - eased), 0))
      card.wrapper.getTransform().setLocalRotation(quat.angleAxis(Math.PI * 0.48 * (1 - eased), new vec3(0, 1, 0)))
      if (card.animationRemaining === 0) {
        card.wrapper.getTransform().setLocalPosition(new vec3(0, 0, 0))
        card.wrapper.getTransform().setLocalRotation(quat.angleAxis(0, new vec3(0, 1, 0)))
      }
    }
  }

  private allCards(): CardView[] {
    return [...this.board, ...this.handCards, ...this.seats.flatMap(seat => seat.cards)]
  }

  private setColor(fill: TextFill, color: vec4): void {
    const old = fill.color
    if (old.x !== color.x || old.y !== color.y || old.z !== color.z || old.w !== color.w) fill.color = color
  }

  private setText(text: Text, value: string): void {
    if (text.text !== value) text.text = value
  }

  private seat(anchor: SceneObject, name: string): SeatView {
    const content = this.panel(anchor, `${name}Seat`, 15, 11)
    const col = this.flex(content, `${name}Content`, FlexDirection.Column, 14, 10, 0.15)
    const title = this.label(col, `${name}Name`, name, "Headline", 14, 1.6)
    const badges = this.label(col, `${name}Badges`, "", "Caption", 14, 1.15)
    const chips = this.label(col, `${name}Chips`, "500 chips", "Body", 14, 1.3)
    this.fitText(chips)
    const move = this.label(col, `${name}Move`, "READY", "Caption", 14, 1.3)
    this.fitText(badges)
    this.fitText(move)
    const row = this.flexChild(col, {w: 14, h: 4}, () => {})
    this.attachFlex(row, FlexDirection.Row, 14, 4, 0.6)
    const cards = [this.card(row, `${name}Card1`, 2.8, 4, true), this.card(row, `${name}Card2`, 2.8, 4, true)]
    return {name: title, badges, chips, move, cards}
  }

  private card(parent: SceneObject, name: string, width: number, height: number, compact = false): CardView {
    let view!: CardView
    this.flexChild(parent, {w: width, h: height}, root => {
      root.name = name
      const wrapper = this.obj(root, "CardVisualWrapper")
      const visual = this.cardFactory.create(wrapper, width, height)
      const content = this.obj(visual.front, "CardFace")
      const rankRoot = this.obj(content, "Rank", new vec3(-width * .32, height * .34, .22))
      const rank = this.text(rankRoot, "", compact ? "Caption" : "Headline", width * .34, height * .22)
      const mirrorRoot = this.obj(content, "RankMirror", new vec3(width * .32, -height * .34, .22))
      mirrorRoot.getTransform().setLocalRotation(quat.angleAxis(Math.PI, new vec3(0, 0, 1)))
      const mirroredRank = this.text(mirrorRoot, "", compact ? "Caption" : "Headline", width * .34, height * .22)
      const metadata = this.obj(wrapper, "Suit")
      const suit = this.text(metadata, "", "Caption", 1, 1)
      metadata.enabled = false
      visual.set("", false)
      view = {root, wrapper, rank, mirroredRank, suit, visual, visualKey: "", animationRemaining: 0}
    })
    return view
  }

  private panel(anchor: SceneObject, name: string, width: number, height: number): SceneObject {
    const root = this.obj(anchor, name)
    const plate = root.createComponent(BackPlate.getTypeName()) as BackPlate
    plate.size = new vec2(width, height)
    plate.style = "dark"
    return this.obj(root, "Content", new vec3(0, 0, 0.6))
  }

  private button(parent: SceneObject, name: string, width: number, callback: () => void): ActionView {
    let view!: ActionView
    this.flexChild(parent, {w: width, h: 6}, root => {
      root.name = `Button_${name.replace(/[^a-z0-9]/gi, "_")}`
      const button = root.createComponent(Button.getTypeName()) as Button
      button.setTheme("SnapOS3", "Primary")
      button.size = new vec3(width, 6, 1)
      button.onInitialized.add(() => { button.size = new vec3(width, 6, 1) })
      const labelSO = this.obj(root, "ButtonLabel", new vec3(0, 0, 0.6))
      const label = this.text(labelSO, name, "Body", width - 0.6, 3)
      button.onTriggerUp.add(() => { if (!button.inactive) callback() })
      view = {root, button, label}
    })
    return view
  }

  private label(parent: SceneObject, name: string, value: string, role: TextRole, width: number, height: number): Text {
    let text!: Text
    this.flexChild(parent, {w: width, h: height}, root => {
      root.name = name
      text = this.text(root, value, role, width, height)
    })
    return text
  }

  private text(root: SceneObject, value: string, role: TextRole, width: number, height: number): Text {
    const text = root.createComponent("Component.Text") as Text
    text.text = value
    text.depthTest = true
    this.applyTextRole(text, role)
    text.textFill.color = this.textColor
    text.horizontalAlignment = HorizontalAlignment.Center
    text.verticalAlignment = VerticalAlignment.Center
    text.horizontalOverflow = HorizontalOverflow.Overflow
    text.verticalOverflow = VerticalOverflow.Overflow
    text.layoutRect = Rect.create(-width / 2, width / 2, -height / 2, height / 2)
    return text
  }

  private applyTextRole(text: Text, role: TextRole): void {
    text.size = TYPE_SCALE[role].size * this.textScale
    text.weight = TYPE_SCALE[role].weight
  }

  private fitText(text: Text, wrap = false): void {
    text.horizontalOverflow = wrap ? HorizontalOverflow.Wrap : HorizontalOverflow.Shrink
    text.verticalOverflow = VerticalOverflow.Shrink
  }

  private obj(parent: SceneObject, name: string, position?: vec3): SceneObject {
    const sceneObject = global.scene.createSceneObject(name)
    sceneObject.setParent(parent)
    if (position) sceneObject.getTransform().setLocalPosition(position)
    return sceneObject
  }

  private flex(parent: SceneObject, name: string, direction: FlexDirection, width: number, height: number, gap: number): SceneObject {
    const root = this.obj(parent, name)
    this.attachFlex(root, direction, width, height, gap)
    return root
  }

  private attachFlex(root: SceneObject, direction: FlexDirection, width: number, height: number, gap: number): void {
    const layout = root.createComponent(FlexLayout.getTypeName()) as FlexLayout
    // Children are registered explicitly by flexChild, including before OnStart.
    // Current UIKit rejects addItems in that phase unless discovery is disabled.
    layout.autoDiscoverItemsOnStart = false
    layout.onInitialized.add(() => {
      layout.direction = direction
      layout.width = width
      layout.height = height
      layout.alignItems = FlexAlign.Center
      layout.justifyContent = FlexJustify.Center
      layout.rowGap = direction === FlexDirection.Column ? gap : 0
      layout.columnGap = direction === FlexDirection.Row ? gap : 0
    })
  }

  private flexChild(parent: SceneObject, size: {w?: number; h?: number}, builder: (root: SceneObject) => void): SceneObject {
    const child = this.obj(parent, "Item")
    const item = child.createComponent(FlexItem.getTypeName()) as FlexItem
    if (size.w !== undefined) item.overrideWidth = size.w
    if (size.h !== undefined) item.overrideHeight = size.h
    item.flexGrow = 0
    item.flexShrink = 0
    builder(child)
    const layout = parent.getComponent(FlexLayout.getTypeName()) as FlexLayout | null
    if (layout) layout.addItems([item])
    return child
  }
}
