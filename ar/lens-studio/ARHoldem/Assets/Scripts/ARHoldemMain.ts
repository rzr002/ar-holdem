import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {ARHoldemTableUI} from "./ARHoldemTableUI"
import {ARHoldemTableGeometry} from "./ARHoldemTableGeometry"
import {ARHoldemAudio} from "./ARHoldemAudio"
import {PresentedTableState, TableCommand, TableState, isTableState} from "./ARHoldemTypes"
import {ARHoldemPresentation} from "./ARHoldemPresentation"

/** Serializes user actions and reconciles the native view with the local rules engine. */
@component
export class ARHoldemMain extends BaseScriptComponent {
  @ui.label("AR Hold'em — local game connection")
  @ui.separator
  @ui.group_start("References")
  @input
  @hint("Passive spatial table UI")
  ui!: ARHoldemTableUI
  @input
  @allowUndefined
  @hint("Optional table and chip geometry")
  geometry!: ARHoldemTableGeometry
  @input
  @allowUndefined
  @hint("Optional action, turn and result sounds")
  sounds!: ARHoldemAudio
  @ui.group_end
  @ui.group_start("Connection")
  @input
  @hint("Local bridge URL; HTTP requires Experimental API in this project")
  serverUrl: string = "http://127.0.0.1:8765"
  @input
  @hint("Seconds between state reads")
  @widget(new SliderWidget(0.25, 3, 0.25))
  pollSeconds: number = 0.75
  @input
  @hint("HTTP timeout, independent of the asynchronous model turn")
  @widget(new SliderWidget(2, 15, 1))
  requestTimeoutSeconds: number = 5
  @input
  @hint("Minimum readable pause between visible actions")
  @widget(new SliderWidget(1, 1.8, 0.1))
  actionPresentationSeconds: number = 1.0
  @input
  @hint("Time used to reveal each community card")
  @widget(new SliderWidget(0.5, 0.8, 0.05))
  boardCardSeconds: number = 0.55
  @input
  @hint("Pause after flop and turn are complete")
  @widget(new SliderWidget(0.7, 1.2, 0.1))
  streetPauseSeconds: number = 0.8
  @ui.group_end

  readonly onState = new Event<TableState>()
  private internet: InternetModule = require("LensStudio:InternetModule")
  private current: TableState | null = null
  private readonly presentation = new ARHoldemPresentation()
  private journalRevision = -1
  private journalSession = ""
  private lastTick = 0
  private lastSoundStateKey = ""
  private lastGeometryKey = ""
  private forceResync = false
  private alive = false
  private pollBusy = false
  private mutating = false
  private generation = 0
  private pollId = 0
  private mutationId = 0
  private pollDeadline = 0
  private mutationDeadline = 0
  private nextPoll = 0
  private connectionError = "Connecting to local table…"
  private unsubscribe: (() => void) | null = null

  public get state(): TableState | null { return this.current }
  public get displayState(): TableState | null { return this.presentation.displayState }
  public get presenting(): boolean { return this.presentation.presenting || this.currentAheadOfJournal() }
  public get presentationIdle(): boolean { return !this.presenting && !this.mutating }
  public get presentationPhase(): string { return this.presentation.phase }
  public get presentationVisual() { return this.presentation.visual }

  onAwake(): void {
    this.createEvent("OnStartEvent").bind(() => this.start())
    this.createEvent("UpdateEvent").bind(() => this.tick())
    this.createEvent("OnDestroyEvent").bind(() => {
      this.alive = false
      this.generation++
      this.pollId++
      this.mutationId++
      this.unsubscribe?.()
    })
  }

  private start(): void {
    if (!this.ui) {
      console.warn("[ARHoldem] Assign the UI component before running")
      return
    }
    this.ui.initialize()
    // Keep the queue configuration Inspector-facing while preserving a stable public scheduler API.
    this.presentation.configure(this.actionPresentationSeconds, this.boardCardSeconds, this.streetPauseSeconds)
    this.alive = true
    this.unsubscribe = this.ui.onCommand.add(command => this.command(command))
    this.draw()
    this.nextPoll = 0
    this.lastTick = getTime()
    console.log("[ARHoldem] bridge client ready; waiting for Deal")
  }

  private tick(): void {
    if (!this.alive) return
    const now = getTime()
    const presented = this.presentation.update(Math.max(0, now - this.lastTick))
    this.lastTick = now
    if (presented || this.presentation.presenting) this.draw()
    if (this.pollBusy && now >= this.pollDeadline) {
      this.pollBusy = false
      this.pollId++ // A late response cannot replace a newer snapshot.
      this.connectionError = "Local table did not answer"
      this.nextPoll = now + Math.max(1, this.pollSeconds)
      this.draw()
    }
    if (this.mutating && now >= this.mutationDeadline) {
      this.mutating = false
      this.mutationId++
      this.generation++
      // The server may have accepted the action. Read state before enabling another action.
      this.connectionError = "Confirming table after a connection timeout"
      this.nextPoll = now
      this.draw()
    }
    if (!this.pollBusy && !this.mutating && now >= this.nextPoll) void this.readState()
  }

  private async readState(): Promise<void> {
    if (!this.alive || this.mutating) return
    this.pollBusy = true
    const id = ++this.pollId
    const generation = this.generation
    this.pollDeadline = getTime() + Math.max(2, this.requestTimeoutSeconds)
    try {
      const query = this.journalSession && !this.forceResync
        ? `?after_revision=${this.journalRevision}&session=${encodeURIComponent(this.journalSession)}` : ""
      const response = await this.internet.fetch(this.baseUrl() + "/state" + query, {method: "GET"})
      const body = await response.json()
      if (!this.alive || id !== this.pollId || generation !== this.generation) return
      if (response.status !== 200 || !isTableState(body)) throw new Error("Invalid bridge state")
      if (Object.prototype.hasOwnProperty.call(body, "presentation")) {
        const envelope = body as PresentedTableState
        const presentation = envelope.presentation
        if (!presentation || typeof presentation.reset !== "boolean" || !Array.isArray(presentation.frames))
          throw new Error("Malformed presentation journal")
        if (presentation.reset) {
          if (presentation.frames.length !== 0) throw new Error("Reset response included stale frames")
          this.presentation.reset(body)
          this.ui.cancelCardAnimations()
        } else {
          if (this.forceResync || this.journalSession !== body.session || this.journalRevision < 0 ||
              body.revision < this.journalRevision) throw new Error("Presentation cursor does not match")
          const expectedCount = body.revision - this.journalRevision
          if (presentation.frames.length !== expectedCount) throw new Error("Presentation journal has a revision gap")
          for (let index = 0; index < presentation.frames.length; index++) {
            const frame = presentation.frames[index]
            if (!isTableState(frame) || frame.session !== body.session ||
                frame.revision !== this.journalRevision + index + 1) throw new Error("Invalid presentation frame sequence")
          }
          const queueGeneration = this.presentation.token
          this.presentation.enqueue(presentation.frames)
          if (this.presentation.token !== queueGeneration) this.ui.cancelCardAnimations()
        }
        this.journalSession = body.session
        this.journalRevision = body.revision
        this.forceResync = false
      } else {
        // Compatibility with an older bridge: its single snapshot is a safe synchronization boundary.
        this.presentation.reset(body)
        this.ui.cancelCardAnimations()
        this.journalSession = body.session
        this.journalRevision = body.revision
        this.forceResync = false
      }
      this.accept(body)
      this.draw()
      this.connectionError = ""
    } catch (error) {
      if (!this.alive || id !== this.pollId || generation !== this.generation) return
      if (!this.connectionError) console.warn("[ARHoldem] bridge disconnected; hand retained")
      this.connectionError = "Start the local bridge, then reconnect"
    } finally {
      if (this.alive && id === this.pollId) {
        this.pollBusy = false
        this.nextPoll = getTime() + Math.max(0.25, this.pollSeconds)
        this.draw()
      }
    }
  }

  private command(command: TableCommand): void {
    if (!this.alive || this.mutating) return
    if (command.kind === "reconnect") {
      this.pollId++
      this.pollBusy = false
      this.forceResync = true
      this.nextPoll = 0
      return
    }
    const state = this.current
    if (!state || this.connectionError || this.presenting) return
    if (command.kind === "new" && !state.can_start) return
    if (command.kind === "retry" && (!state.error || state.thinking)) return
    if (command.kind === "action") {
      if (state.done || state.thinking || state.actor !== 0 || !state.legal.actions.includes(command.action)) return
      if (command.action === "raise" && (!Number.isInteger(command.amount) ||
          (command.amount ?? -1) < (state.legal.min_raise_to ?? 0) ||
          (command.amount ?? Infinity) > (state.legal.max_raise_to ?? 0))) return
    }
    const payload: Record<string, string | number> = {session: state.session, revision: state.revision}
    if (command.kind === "action") {
      payload.action = command.action
      payload.amount = command.amount ?? 0
    }
    this.sounds?.onAction()
    void this.writeState(command.kind === "action" ? "/action" : command.kind === "new" ? "/new" : "/retry", payload)
  }

  private async writeState(path: string, payload: Record<string, string | number>): Promise<void> {
    this.mutating = true
    this.generation++ // Invalidates an earlier GET before the POST can change state.
    this.pollId++
    this.pollBusy = false
    const id = ++this.mutationId
    this.mutationDeadline = getTime() + Math.max(2, this.requestTimeoutSeconds)
    this.draw()
    try {
      const response = await this.internet.fetch(this.baseUrl() + path, {
        method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload),
      })
      const body = await response.json()
      if (!this.alive || id !== this.mutationId) return
      if (response.status === 200 && isTableState(body)) {
        this.accept(body)
        this.connectionError = ""
      } else if (response.status === 409 && isTableState(body?.state)) {
        this.accept(body.state)
        this.connectionError = ""
        console.log("[ARHoldem] stale action ignored; refreshed authoritative state")
      } else {
        // Do not retry a mutation automatically: reconcile using a GET first.
        throw new Error("Action rejected")
      }
    } catch (error) {
      if (!this.alive || id !== this.mutationId) return
      this.connectionError = "Action not confirmed; reconnect to read table"
      console.warn("[ARHoldem] action unconfirmed; requesting authoritative state")
    } finally {
      if (this.alive && id === this.mutationId) {
        this.mutating = false
        this.nextPoll = 0
        this.draw()
      }
    }
  }

  private accept(state: TableState): void {
    const previous = this.current
    if (previous?.session === state.session && state.revision < previous.revision) return
    const changed = !previous || previous.session !== state.session || previous.revision !== state.revision
    this.current = state
    if (!changed) return
    this.onState.invoke(state)
    console.log(`[ARHoldem] hand=${state.hand} revision=${state.revision} street=${state.street} actor=${state.actor} thinking=${state.thinking} done=${state.done} mode=${state.mode}`)
  }

  private draw(): void {
    const displayed = this.presentation.displayState
    if (displayed) {
      const key = `${displayed.pot}/${displayed.players.map(player => player.stack).join(",")}`
      if (key !== this.lastGeometryKey) {
        this.lastGeometryKey = key
        this.geometry?.setStacks(displayed.players.map(p => p.stack), displayed.pot)
      }
    }
    this.geometry?.setPresentation(this.presentation.visual)
    if (displayed) {
      const presenting = this.presenting
      const humanTurn = !presenting && displayed.actor === 0 && !displayed.done && !displayed.thinking
      const key = `${displayed.session}/${displayed.revision}/${presenting}/${humanTurn}/${displayed.done}`
      if (key !== this.lastSoundStateKey) {
        this.lastSoundStateKey = key
        this.sounds?.onState(displayed.hand, displayed.revision, humanTurn, displayed.done)
      }
    }
    if (this.ui) this.ui.setState(this.current, this.mutating || this.presenting,
      this.connectionError, displayed, this.presentation.phase, this.presentation.dealCounts, this.presentation.visual)
  }

  private currentAheadOfJournal(): boolean {
    return !!this.current && (this.forceResync || this.journalSession !== this.current.session ||
      this.journalRevision < this.current.revision)
  }

  private baseUrl(): string { return this.serverUrl.replace(/\/+$/, "") }
}
