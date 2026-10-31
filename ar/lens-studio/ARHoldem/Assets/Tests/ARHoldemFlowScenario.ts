import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {ScenarioConfig} from "Leaf.lspkg/Scenarios/scenario/ScenarioConfig"
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {findInteractableByName} from "Leaf.lspkg/Interactors/InteractableUtils"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {ARHoldemMain} from "../Scripts/ARHoldemMain"
import {SEAT_NAMES} from "../Scripts/ARHoldemTypes"

/** Checks ordinary game presentation without a recording or a scripted camera move. */
@component
export class ARHoldemFlowScenario extends Scenario {
  private main!: ARHoldemMain
  private driver = new DefaultLeafInteractor()

  async run(config?: ScenarioConfig): Promise<void> {
    await this.until(() => !!findSceneObjectByName("Button_Deal"), "UI initialization")
    this.main = this.node("Main").getComponent(ARHoldemMain.getTypeName()) as ARHoldemMain
    await this.until(() => !!this.main.state && this.main.presentationIdle, "connected idle table")
    this.check(["local", "strategic", "lucas"].includes(this.main.state!.mode), "Offline mode required")
    this.check(this.main.state!.hand === 0, "Restart a funded offline bridge before this scenario")
    const flow = config?.get("flow") ?? "deal"
    const fullHand = flow === "hand" || flow === "allin"
    const expectHumanWin = config?.get("expectHumanWin") === "true"
    let inputs = 0
    const initialChips = this.main.state!.players.reduce((sum, p) => sum + p.stack, 0)
    const fixed = [this.node("ARHoldem").getTransform(), this.node("ActionDock").getTransform(),
      this.node("Button_Deal").getTransform(), WorldCameraFinderProvider.getInstance().getTransform()]
    const poses = fixed.map(transform => ({position: transform.getWorldPosition(), rotation: transform.getWorldRotation()}))
    const counts = new Set<number>()
    const phases = new Set<string>()
    const actionLengths = new Set<number>()
    const boardCounts = new Set<number>()
    const thinkingDurations: number[] = []
    let lastPhase = "idle"
    let phaseStartedAt = getTime()
    let actionTransferSeen = false
    let payoutTransferSeen = false
    let showdownBalancesChecked = false
    let lastCount = 0
    let dealSamples = 0
    let firstDealTime = -1
    let finalDealTime = -1
    let duplicateAttempted = false
    let pending = true
    let inputError = ""
    const trigger = (name: string) => {
      pending = true
      this.press(name).then(() => { pending = false }, error => { inputError = String(error); pending = false })
    }
    trigger("Button_Deal")
    const deadline = getTime() + 220
    while (getTime() < deadline) {
      this.check(!inputError, inputError)
      const shown = this.main.displayState
      if (shown?.hand) {
        const phase = this.main.presentationPhase
        const now = getTime()
        if (phase !== lastPhase) {
          if (lastPhase === "thinking") thinkingDurations.push(now - phaseStartedAt)
          lastPhase = phase
          phaseStartedAt = now
        }
        phases.add(phase)
        const visual = this.main.presentationVisual
        if (phase === "action" && visual?.transfers.some(transfer => transfer.amount > 0)) actionTransferSeen = true
        if (phase === "payout" && visual?.transfers.some(transfer => transfer.amount > 0)) payoutTransferSeen = true
        actionLengths.add(shown.action_history.length)
        boardCounts.add(shown.board.length)
        this.check(shown.players.every(p => !("hole" in p)), "Private opponent hole cards leaked")
        this.check(shown.players.reduce((sum, p) => sum + p.stack, shown.pot) === initialChips,
          "Presented chips must conserve the table total")
        const authoritative = this.main.state
        if (phase === "showdown" && !showdownBalancesChecked && authoritative?.done && authoritative.settlement) {
          const payoutBySeat = Array.from({length: authoritative.players.length}, () => 0)
          let payoutTotal = 0
          for (const pot of authoritative.settlement.pots) for (const award of pot.awards) {
            payoutBySeat[award.seat] += award.amount
            payoutTotal += award.amount
          }
          for (const refund of authoritative.settlement.refunds) {
            payoutBySeat[refund.seat] += refund.amount
            payoutTotal += refund.amount
          }
          authoritative.players.forEach((player, seat) =>
            this.check(shown.players[seat].stack === player.stack - payoutBySeat[seat],
              "Showdown must hold each payout in the pot"))
          this.check(shown.pot === payoutTotal, "Showdown pot must equal awards plus refunds")
          showdownBalancesChecked = true
        }
        if (phase === "dealing") {
          const count = this.cardCount()
          counts.add(count)
          this.check(count >= lastCount, "Deal reversed its card count")
          lastCount = count
          dealSamples++
          if (firstDealTime < 0) firstDealTime = getTime()
          finalDealTime = getTime()
          if (!duplicateAttempted) {
            duplicateAttempted = true
            this.main.ui.onCommand.invoke({kind: "new"})
            this.main.ui.onCommand.invoke({kind: "action", action: "allin"})
          }
        }
        if (this.main.presenting) {
          for (const name of ["Button_Deal", "Button_Fold", "Button_Check___Call", "Button_All_in"])
            this.check(this.button(name).inactive, "Input enabled during " + phase)
        }
        for (let i = 0; i < fixed.length; i++) {
          const pos = fixed[i].getWorldPosition(), expected = poses[i].position
          this.check(pos.sub(expected).length < 0.001, "Camera or fixed UI anchor moved: " + i)
          this.check(Math.abs(fixed[i].getWorldRotation().dot(poses[i].rotation)) > 0.999999,
            "Camera or fixed UI anchor rotated: " + i)
        }
        if (this.main.presentationIdle && this.main.state!.actor === 0 && !this.main.state!.thinking) {
          if (!fullHand) break
          if (!pending && !this.button("Button_Check___Call").inactive) {
            trigger(flow === "allin" && inputs++ === 0 ? "Button_All_in" : "Button_Check___Call")
          }
        }
        if (shown.done && this.main.presentationIdle) break
      }
      await sleep(60)
    }
    if (lastPhase === "thinking") thinkingDurations.push(getTime() - phaseStartedAt)
    this.check(this.main.presentationIdle, "Presentation failed to settle")
    this.check(this.main.state!.hand === 1, "Duplicate input created another hand")
    this.check(dealSamples > 10 && counts.size >= 6, "Dealing was not visibly staggered")
    this.check(finalDealTime - firstDealTime > 1.3, "Deal happened too quickly")
    if (!fullHand) this.check(this.main.state!.action_history.filter(a => a.seat === 0).length === 0,
      "A command during dealing escaped the input gate")
    const history = this.main.displayState!.action_history.length
    for (let count = 0; count <= history; count++)
      this.check(actionLengths.has(count), "Skipped visible action " + count)
    if (fullHand) {
      this.check(this.main.displayState!.done, "Full-hand presentation did not finish")
      this.check(!!this.main.displayState!.settlement, "Missing settlement")
      this.check(thinkingDurations.length > 0, "No opponent thinking cue was presented")
      this.check(thinkingDurations.every(seconds => seconds >= 2.0),
        "Opponent thinking cue ended before the 2.2-second minimum (allowing sampling tolerance)")
      this.check(actionTransferSeen, "No chips were visibly moved into the pot during actions")
      this.check(payoutTransferSeen, "No pot-to-player chip transfer was presented")
      this.check(showdownBalancesChecked, "No unpaid showdown balance frame was verified")
      const final = this.main.state!
      const shownFinal = this.main.displayState!
      this.check(shownFinal.players.every((player, seat) => player.stack === final.players[seat].stack),
        "Settled presentation stacks must match authoritative balances")
      this.check(shownFinal.pot === final.pot && final.pot === 0,
        "Settled presentation pot must match the authoritative zero pot")
      this.check(shownFinal.net.every((net, seat) => net === final.net[seat]),
        "Settled presentation net must persist from authoritative state")
      const humanNet = final.net[0]
      const humanNetText = `NET ${humanNet >= 0 ? "+" : ""}${humanNet}`
      const humanStatus = this.text("YourSeatStatus")
      this.check(humanStatus.includes(humanNetText), "Human net result is missing from the settled UI")
      const humanStart = final.players[0].stack - humanNet
      this.check(humanStatus.includes(`BAL ${humanStart} → ${final.players[0].stack}`),
        "Human before/after balance is missing from the settled UI")
      if (expectHumanWin)
        this.check(final.settlement!.winners.includes(0), "Expected the human seat to win a pot")
      if (this.main.displayState!.settlement!.reason === "showdown") {
        for (const phase of ["flop", "turn", "river", "showdown"])
          this.check(phases.has(phase), "Skipped phase " + phase)
        for (let count = 0; count <= 5; count++) this.check(boardCounts.has(count), "Skipped board card " + count)
      }
    }
    // Several unchanged polling responses must not restart a card or button animation.
    const idleRevision = this.main.displayState!.revision
    for (let i = 0; i < 25; i++) {
      await sleep(80)
      this.check(this.main.presentationIdle && this.main.displayState!.revision === idleRevision,
        "Unchanged state restarted presentation")
    }
    console.log("[ARHoldemFlow] " + JSON.stringify({flow,
      phases: Array.from(phases), cardCounts: Array.from(counts), boardCounts: Array.from(boardCounts),
      thinkingSeconds: thinkingDurations, actionTransferSeen, payoutTransferSeen,
      winnerSeats: this.main.state!.settlement?.winners ?? [],
      stacks: this.main.state!.players.map(player => player.stack), net: this.main.state!.net,
      visibleActions: actionLengths.size, dealSeconds: finalDealTime - firstDealTime,
      cameraAndDockStable: true, duplicateInputBlocked: true, idleStable: true}))
  }

  private node(name: string, root?: SceneObject): SceneObject {
    const node = findSceneObjectByName(name, root)
    if (!node) throw new Error("Missing " + name)
    return node
  }
  private button(name: string): Button { return this.node(name).getComponent(Button.getTypeName()) as Button }
  private async press(name: string): Promise<void> {
    this.check(!this.button(name).inactive, name + " is inactive")
    const target = findInteractableByName(name, undefined, true)
    if (!target) throw new Error("Missing interactable " + name)
    await this.driver.trigger(target)
  }
  private cardCount(): number {
    let count = 0
    for (let seat = 0; seat < 6; seat++) for (let index = 1; index <= 2; index++) {
      const root = this.node(seat === 0 ? `YourCard${index}` : `${SEAT_NAMES[seat]}Card${index}`)
      if (this.node("CardFront", root).isEnabledInHierarchy || this.node("CardBack", root).isEnabledInHierarchy) count++
    }
    return count
  }
  private async until(predicate: () => boolean, label: string): Promise<void> {
    const end = getTime() + 25
    while (getTime() < end) { if (predicate()) return; await sleep(100) }
    throw new Error("Timed out: " + label)
  }
  private check(condition: boolean, message: string): void { if (!condition) throw new Error(message) }

  private text(name: string): string {
    const text = this.node(name).getComponent("Component.Text") as Text
    if (!text) throw new Error("Missing Text: " + name)
    return text.text
  }
}
