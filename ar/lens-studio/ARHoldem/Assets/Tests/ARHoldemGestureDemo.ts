import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {ScenarioConfig} from "Leaf.lspkg/Scenarios/scenario/ScenarioConfig"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {findInteractableByName} from "Leaf.lspkg/Interactors/InteractableUtils"
import {IKBodyInteractor} from "Leaf.lspkg/Interactors/interactor/ik/IKBodyInteractor"
import {DiagnosticRecorder} from "Leaf.lspkg/Diagnostic/DiagnosticRecorder"
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {ARHoldemMain} from "../Scripts/ARHoldemMain"
import {TableState} from "../Scripts/ARHoldemTypes"

const ALLOWED_MODES = ["lucas", "local", "strategic"]

/**
 * Optional interaction check. It uses the bundled SIK hand visuals and
 * refuses to act unless the bridge is explicitly in an offline/local mode.
 */
@component
export class ARHoldemGestureDemo extends Scenario {
  private main!: ARHoldemMain
  private dealDriver!: DefaultLeafInteractor

  async run(config?: ScenarioConfig): Promise<void> {
    const flow = config?.get("flow") ?? "gesture"
    if (flow !== "gesture" && flow !== "full") {
      throw new Error("Unknown gesture demo flow: " + flow)
    }

    await this.until("native table initialization", () => !!findSceneObjectByName("Button_Deal"))
    const mainObject = this.node("Main")
    this.main = mainObject.getComponent(ARHoldemMain.getTypeName()) as ARHoldemMain
    if (!this.main) throw new Error("Main has no ARHoldemMain component")

    await this.until("local bridge connection", () => this.main.state !== null)
    this.assertOffline()
    this.dealDriver = new DefaultLeafInteractor()
    const before = await this.humanTurn()
    const actionButton = this.button("Button_Check___Call")
    await this.until("Check / Call to become active", () => !actionButton.inactive)
    const target = findInteractableByName("Button_Check___Call", undefined, true)
    if (!target) throw new Error("Check / Call is not targetable")

    const ik = new IKBodyInteractor({
      sikHandVisuals: {color: new vec4(0.25, 0.82, 1.0, 1.0)},
    })
    let ikDestroyed = false

    try {
      await ik.ready

      // Give the user time to see the hand enter; never move their camera.
      await sleep(2000)
      this.assertOffline()
      await ik.trigger(target)
      await this.until("IK action revision", () => this.state().revision > before.revision)

      const after = this.state()
      expect(after.hand).toBe(before.hand)
      expect(this.humanMoves(after)).toBe(this.humanMoves(before) + 1)
      const diagnostics = DiagnosticRecorder.getInstance()
      if (diagnostics.hasErrors()) {
        throw new Error("Gesture demo recorded IK diagnostics: " + diagnostics.toReport())
      }

      // Let the normal presentation finish before continuing.
      await sleep(2000)

      // Leave a final steady frame before the scenario manager tears down IK.
      await sleep(2000)
      this.assertOffline()

      if (flow === "full") {
        ik.destroy()
        ikDestroyed = true
        await this.finishFullHand(after)
      }
    } finally {
      if (!ikDestroyed) ik.destroy()
    }
  }

  private node(name: string): SceneObject {
    const node = findSceneObjectByName(name)
    if (!node) throw new Error("Missing scene object: " + name)
    return node
  }

  private button(name: string): Button {
    const button = this.node(name).getComponent(Button.getTypeName()) as Button
    if (!button) throw new Error("Missing UIKit Button: " + name)
    return button
  }

  private state(): TableState {
    const state = this.main.state
    if (!state) throw new Error("Bridge state unavailable")
    return state
  }

  private assertOffline(): void {
    const state = this.state()
    if (!ALLOWED_MODES.includes(state.mode)) {
      throw new Error("Gesture demo requires lucas, local, or strategic mode; no action was sent")
    }
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

  private async humanTurn(): Promise<TableState> {
    for (let attempt = 0; attempt < 4; attempt++) {
      this.assertOffline()
      let state = this.state()
      if (!state.hand || state.done) {
        if (!state.can_start) {
          throw new Error("Demo needs a fresh funded offline table; restart its bridge")
        }
        const previousHand = state.hand
        const deal = findInteractableByName("Button_Deal", undefined, true)
        if (!deal) throw new Error("Deal is not targetable")
        await this.dealDriver.trigger(deal)
        await this.until("a new hand", () => this.state().hand > previousHand)
      }

      await this.until("human turn or settlement", () => {
        const current = this.state()
        return current.done || (current.actor === 0 && !current.thinking)
      }, 45000)
      state = this.state()
      if (!state.done) {
        await this.until("human action dock", () => !this.button("Button_Check___Call").inactive)
        return this.state()
      }
    }
    throw new Error("No human turn reached in four hands; restart the offline bridge")
  }

  private humanMoves(state: TableState): number {
    return state.action_history.filter(action => action.seat === 0).length
  }

  private async finishFullHand(afterIkAction: TableState): Promise<void> {
    const deadline = getTime() + 120
    let actions = 1 // Count the real IK Check / Call already performed in this hand.
    let lastStreet = afterIkAction.street

    while (!this.state().done && actions < 32 && getTime() < deadline) {
      this.assertOffline()
      const current = this.state()
      const button = this.button("Button_Check___Call")
      if (current.actor === 0 && !current.thinking && !button.inactive) {
        // Keep each decision readable; this also gives a new street a clear beat.
        await sleep(2000)
        this.assertOffline()
        const target = findInteractableByName("Button_Check___Call", undefined, true)
        if (!target) throw new Error("Check / Call is not targetable during full demo")
        const moves = this.humanMoves(current)
        await this.dealDriver.trigger(target)
        await this.until("full-demo action revision", () => this.state().revision > current.revision)
        const after = this.state()
        expect(this.humanMoves(after)).toBe(moves + 1)
        if (after.street !== lastStreet) lastStreet = after.street
        actions++
      } else {
        await sleep(100)
      }
    }

    if (!this.state().done) {
      throw new Error(actions >= 32
        ? "Full demo reached the 32-action limit before settlement"
        : "Full demo timed out before settlement")
    }
    const settled = this.state()
    this.assertOffline()
    expect(!!settled.settlement).toBe(true)
    if (!settled.settlement) throw new Error("Full demo ended without a settlement payload")
    await sleep(8000)

    // Busting is a valid table outcome. Keep the real result instead of forcing a redeal.
    if (!settled.can_start) return
    const previousHand = settled.hand
    await this.until("Deal to become active", () => !this.button("Button_Deal").inactive)
    const deal = findInteractableByName("Button_Deal", undefined, true)
    if (!deal) throw new Error("Deal is not targetable after settlement")
    await this.dealDriver.trigger(deal)
    await this.until("next hand", () => this.state().hand > previousHand)
    await this.until("human turn in next hand", () => {
      const next = this.state()
      return next.done || (next.actor === 0 && !next.thinking)
    }, 45000)
    if (this.state().done) {
      throw new Error("Next hand settled before reaching a human turn")
    }
    await this.until("next-hand action dock", () => !this.button("Button_Check___Call").inactive)
    this.assertOffline()
    await sleep(3000)
  }

}
