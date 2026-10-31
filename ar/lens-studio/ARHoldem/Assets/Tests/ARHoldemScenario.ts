import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {ScenarioConfig} from "Leaf.lspkg/Scenarios/scenario/ScenarioConfig"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {findInteractableByName} from "Leaf.lspkg/Interactors/InteractableUtils"
import {createIKInteractor} from "Leaf.lspkg/Interactors/interactor/ik/visualizer/BitmojiAvatar"
import {DiagnosticRecorder} from "Leaf.lspkg/Diagnostic/DiagnosticRecorder"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {ARHoldemMain} from "../Scripts/ARHoldemMain"
import {TableState} from "../Scripts/ARHoldemTypes"

/** UI names come from ARHoldemTableUI; authored names come from the scene bootstrap.
 * Action scenarios refuse live Codex/API mode before making any game mutation.
 */
@component
export class ARHoldemScenario extends Scenario {
  private main!: ARHoldemMain
  private driver!: DefaultLeafInteractor

  async run(config?: ScenarioConfig): Promise<void> {
    await this.until("native table initialization", () => !!findSceneObjectByName("Button_Deal"))
    this.main = this.node("Main").getComponent(ARHoldemMain.getTypeName()) as ARHoldemMain
    if (!this.main) throw new Error("Main has no ARHoldemMain component")
    const flow = config?.get("flow") ?? "spatial"
    if (flow === "spatial") return this.spatial()
    await this.until("local bridge connection", () => this.main.state !== null)
    this.offline()
    this.driver = new DefaultLeafInteractor()
    if (flow === "action") return this.action()
    if (flow === "hand") return this.completeHand()
    if (flow === "guards") return this.guards()
    if (flow === "ik") return this.ikReach()
    throw new Error("Unknown test flow: " + flow)
  }

  private node(name: string, root?: SceneObject): SceneObject {
    const node = findSceneObjectByName(name, root)
    if (!node) throw new Error("Missing scene object: " + name)
    return node
  }

  private button(name: string): Button {
    const button = this.node(name).getComponent(Button.getTypeName()) as Button
    if (!button) throw new Error("Missing UIKit Button: " + name)
    return button
  }

  private text(name: string, root?: SceneObject): string {
    const text = this.node(name, root).getComponent("Component.Text") as Text
    if (!text) throw new Error("Missing Text: " + name)
    return text.text
  }

  private state(): TableState {
    const state = this.main.state
    if (!state) throw new Error("Bridge state unavailable")
    return state
  }

  private offline(): void {
    const state = this.state()
    if (state.mode !== "lucas" && state.mode !== "strategic" && state.mode !== "local") {
      throw new Error("Action tests require an explicitly selected offline bridge; live LLM mode preserved")
    }
    expect(this.text("OpponentSource").includes(state.mode === "lucas" ? "LUCAS v16" : "OFFLINE TEST")).toBe(true)
    if (state.error) throw new Error("Bridge reports: " + state.error)
  }

  private async until(label: string, predicate: () => boolean, timeoutMs = 20000): Promise<void> {
    const deadline = getTime() + timeoutMs / 1000
    while (getTime() < deadline) {
      if (predicate()) return
      await sleep(100)
    }
    throw new Error("Timed out waiting for " + label)
  }

  private async press(name: string): Promise<void> {
    this.offline()
    await this.until(name + " to become active", () => !this.button(name).inactive)
    const target = findInteractableByName(name, undefined, true)
    if (!target) throw new Error("No enabled SIK interactable: " + name)
    await this.driver.trigger(target)
  }

  private async humanTurn(): Promise<TableState> {
    // Each scenario may see the same external bridge session after a Lens reset.
    for (let attempt = 0; attempt < 4; attempt++) {
      this.offline()
      let state = this.state()
      if (!state.hand || state.done) {
        if (!state.can_start) throw new Error("Test needs a fresh funded offline table; restart its bridge")
        const hand = state.hand
        await this.press("Button_Deal")
        await this.until("a new hand", () => this.state().hand > hand)
      }
      await this.until("human turn or settlement", () => {
        const s = this.state()
        return s.done || (s.actor === 0 && !s.thinking)
      }, 45000)
      state = this.state()
      if (!state.done) {
        await this.until("human action dock", () => !this.button("Button_Check___Call").inactive)
        return this.state()
      }
    }
    throw new Error("No human turn reached in four hands; restart the offline bridge")
  }

  private total(state: TableState): number {
    return state.players.reduce((sum, player) => sum + player.stack, state.pot)
  }

  private humanMoves(state: TableState): number {
    return state.action_history.filter(action => action.seat === 0).length
  }

  private async spatial(): Promise<void> {
    const root = this.node("ARHoldem")
    for (const name of ["TableGeometry", "TableUI", "BoardAnchor", "HandAnchor", "AtlasAnchor", "NovaAnchor", "OrionAnchor", "LyraAnchor", "VegaAnchor", "StatusAnchor", "ControlsAnchor"]) {
      expect(this.node(name, root).isEnabledInHierarchy).toBe(true)
    }
    for (const name of ["YourCard1", "YourCard2", "BoardCard1", "BoardCard5", "ATLASCard1", "NOVACard1", "ORIONCard1", "LYRACard1", "VEGACard1"]) {
      expect(this.node(name, root).isEnabledInHierarchy).toBe(true)
    }
    expect(root.getParent()).toBeNull()
    const initial = root.getTransform().getWorldPosition()
    const camera = WorldCameraFinderProvider.getInstance().getTransform()
    const cameraPosition = camera.getWorldPosition()
    try {
      // A camera-parented table would move immediately with this transform.
      camera.setWorldPosition(cameraPosition.add(new vec3(12, 0, 0)))
      const actual = root.getTransform().getWorldPosition()
      expect(actual.x).toBeCloseTo(initial.x, 3)
      expect(actual.y).toBeCloseTo(initial.y, 3)
      expect(actual.z).toBeCloseTo(initial.z, 3)
    } finally {
      camera.setWorldPosition(cameraPosition)
    }
  }

  private async action(): Promise<void> {
    const before = await this.humanTurn()
    expect(before.table_size).toBe(6)
    expect(before.players.length).toBe(6)
    expect(before.hole.length).toBe(2)
    expect(before.players.every(player => !("hole" in player))).toBe(true)
    for (const card of [1, 2]) {
      const root = this.node(`YourCard${card}`)
      expect(this.node("CardFront", root).isEnabledInHierarchy).toBe(true)
      expect(this.node("CardBack", root).isEnabledInHierarchy).toBe(false)
      const suit = this.node("SuitGlyph", root).getComponent("Component.RenderMeshVisual") as RenderMeshVisual
      expect(!!suit && !!suit.mesh).toBe(true)
    }
    for (let i = 0; i < before.players.length; i++) {
      const badges = this.text(i === 0 ? "YourSeatStatus" : `${before.players[i].name}Badges`)
      expect(badges.includes("SB")).toBe(before.small_blind_seat === i)
      expect(badges.includes("BB")).toBe(before.big_blind_seat === i)
      if (before.button === i) expect(badges.split(/\s*[\/·]\s*/).includes("D")).toBe(true)
    }
    for (let i = 1; i < before.players.length; i++) {
      const seat = before.players[i]
      for (const card of [1, 2]) {
        if (seat.dealt_in && !seat.folded) {
          expect(this.text("Suit", this.node(`${seat.name}Card${card}`))).toBe("HIDDEN")
          const root = this.node(`${seat.name}Card${card}`)
          expect(this.node("CardBack", root).isEnabledInHierarchy).toBe(true)
          expect(this.node("CardFront", root).isEnabledInHierarchy).toBe(false)
          expect(this.node("WovenCardBack", root).isEnabledInHierarchy).toBe(true)
        }
      }
    }
    const moves = this.humanMoves(before)
    await this.press("Button_Check___Call")
    await this.until("one committed human action", () => this.state().revision > before.revision)
    expect(this.state().hand).toBe(before.hand)
    expect(this.humanMoves(this.state())).toBe(moves + 1)
    expect(this.total(this.state())).toBe(this.total(before))
  }

  private async completeHand(): Promise<void> {
    const first = await this.humanTurn()
    this.assertSettlementView(first)
    const chips = this.total(first)
    const deadline = getTime() + 90
    let actions = 0
    while (!this.state().done && getTime() < deadline && actions < 60) {
      this.offline()
      const state = this.state()
      expect(state.hand).toBe(first.hand)
      expect(this.total(state)).toBe(chips)
      if (this.main.presentationIdle) this.assertSettlementView(state)
      if (state.actor === 0 && !state.thinking && !this.button("Button_Check___Call").inactive) {
        const revision = state.revision
        await this.press("Button_Check___Call")
        await this.until("betting state update", () => this.state().revision > revision)
        actions++
      } else await sleep(100)
    }
    await this.until("settlement presentation", () => this.main.presentationIdle, 30000)
    const end = this.state()
    expect(end.done).toBe(true)
    expect(end.pot).toBe(0)
    expect(this.total(end)).toBe(chips)
    expect(end.results.length > 0).toBe(true)
    expect(this.text("TurnStatus").includes(end.can_start ? "Hand settled" : "Table finished")).toBe(true)
    expect(!!end.settlement).toBe(true)
    this.assertSettlementView(end)
    if (end.settlement) {
      const main = end.settlement.pots[0]
      for (const seat of main.winners.slice(0, 2)) expect(this.text("Pot").includes(end.players[seat].name)).toBe(true)
      const winner = end.settlement.reveals.find(reveal => reveal.seat === main.winners[0])
      if (winner) expect(this.text("Pot").includes(winner.hand_label)).toBe(true)
      if (end.settlement.pots.length > 1) expect(this.text("TurnStatus").includes("SIDE POTS")).toBe(true)
    }
    if (!end.can_start) throw new Error("Settlement passed, but table exhausted: use a fresh funded offline bridge for Next Hand coverage")
    await this.press("Button_Deal")
    await this.until("next hand", () => this.state().hand > end.hand)
    await this.until("next-hand presentation", () => this.main.presentationIdle, 30000)
    expect(this.state().hand).toBe(end.hand + 1)
    expect(this.total(this.state())).toBe(chips)
    expect(this.state().done).toBe(false)
    this.assertSettlementView(this.state())
  }

  private assertSettlementView(state: TableState): void {
    expect(state.players.every(player => !("hole" in player))).toBe(true)
    if (!state.done) expect(state.settlement == null).toBe(true)
    const settlement = state.done ? state.settlement : null
    for (const player of state.players) {
      const reveal = settlement?.reason === "showdown"
        ? settlement.reveals.find(value => value.seat === player.seat) : undefined
      const badge = this.text(player.seat === 0 ? "YourSeatStatus" : `${player.name}Badges`)
      const winner = !!settlement?.winners.includes(player.seat)
      expect(badge.includes("WINNER")).toBe(winner)
      if (winner) {
        const split = settlement!.pots.some(pot => pot.winners.length > 1 && pot.winners.includes(player.seat))
        expect(badge.includes("SPLIT WINNER")).toBe(split)
      }
      if (reveal) {
        expect(player.folded).toBe(false)
        expect(this.text(player.seat === 0 ? "YourSeatStatus" : `${player.name}Move`).includes(reveal.hand_name)).toBe(true)
      }
      if (player.seat === 0) continue
      for (let index = 0; index < 2; index++) {
        const root = this.node(`${player.name}Card${index + 1}`)
        expect(this.node("CardFront", root).isEnabledInHierarchy).toBe(!!reveal)
        const hidden = !reveal && player.dealt_in && !player.folded
        expect(this.node("CardBack", root).isEnabledInHierarchy).toBe(hidden)
        expect(this.text("Suit", root)).toBe(reveal ? reveal.hole[index][1] : hidden ? "HIDDEN" : "")
        if (reveal) {
          const rank = reveal.hole[index][0] === "T" ? "10" : reveal.hole[index][0]
          expect(this.text("Rank", root)).toBe(rank)
        }
      }
    }
  }

  private async guards(): Promise<void> {
    const state = await this.humanTurn()
    expect(this.button("Button_Deal").inactive).toBe(true)
    for (const [name, legal] of [
      ["Button_Fold", "fold"], ["Button_All_in", "allin"],
      ["Button_Raise_to__", "raise"], ["Button_Pot_to__", "raise"],
    ]) expect(this.button(name).inactive).toBe(!state.legal.actions.includes(legal as "fold" | "allin" | "raise"))
    // Inject at the public UI-to-controller boundary to exercise its guards.
    // A disabled UIKit button itself has no enabled collider and cannot be pinched.
    this.main.ui.onCommand.invoke({kind: "new"})
    this.main.ui.onCommand.invoke({kind: "action", action: "raise", amount: -1})
    await sleep(Math.max(1500, this.main.pollSeconds * 2000))
    expect(this.state().revision).toBe(state.revision)
    expect(this.total(this.state())).toBe(this.total(state))
  }

  private async ikReach(): Promise<void> {
    const before = await this.humanTurn()
    const target = findInteractableByName("Button_Check___Call", undefined, true)
    if (!target) throw new Error("Check / Call is not targetable")
    const camera = WorldCameraFinderProvider.getInstance().getTransform()
    const cameraPosition = camera.getWorldPosition()
    const cameraRotation = camera.getWorldRotation()
    // LeafIndex sets fail-fast diagnostics so a fallback cannot hide failed reach.
    const ik = createIKInteractor({avatar: {debugOverlay: false}})
    try {
      await ik.trigger(target)
      const diagnostics = DiagnosticRecorder.getInstance()
      if (diagnostics.hasErrors()) throw new Error("IK interaction failed: " + diagnostics.toReport())
      await this.until("IK-triggered action", () => this.state().revision > before.revision)
      expect(this.humanMoves(this.state())).toBe(this.humanMoves(before) + 1)
    } finally {
      // Stop head control before restoring the preview pose for the next scenario.
      ik.destroy()
      camera.setWorldPosition(cameraPosition)
      camera.setWorldRotation(cameraRotation)
    }
  }
}
