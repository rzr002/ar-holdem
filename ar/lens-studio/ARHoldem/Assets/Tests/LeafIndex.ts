import {scenariosIndex} from "Leaf.lspkg/Scenarios/decorator/ScenarioIndexDecorator"
import {ScenarioMetadata} from "Leaf.lspkg/Scenarios/scenario/ScenarioMetadata"
import {ARHoldemScenario} from "./ARHoldemScenario"
import {ARHoldemGestureDemo} from "./ARHoldemGestureDemo"
import {ARHoldemFlowScenario} from "./ARHoldemFlowScenario"

@component
export class LeafIndex extends BaseScriptComponent {
  @scenariosIndex
  static scenariosIndex: ScenarioMetadata[] = [
    {id: "ar-holdem-presentation", typename: ARHoldemFlowScenario.getTypeName(), parameters: {
      flow: "deal", __leaf__timeout_secs: "150", __leaf__log_level: "ERROR",
    }},
    {id: "ar-holdem-presentation-hand", typename: ARHoldemFlowScenario.getTypeName(), parameters: {
      flow: "hand", __leaf__timeout_secs: "240", __leaf__log_level: "ERROR",
    }},
    {id: "ar-holdem-presentation-human-win", typename: ARHoldemFlowScenario.getTypeName(), parameters: {
      flow: "hand", expectHumanWin: "true", __leaf__timeout_secs: "240", __leaf__log_level: "ERROR",
    }},
    {id: "ar-holdem-presentation-allin", typename: ARHoldemFlowScenario.getTypeName(), parameters: {
      flow: "allin", __leaf__timeout_secs: "240", __leaf__log_level: "ERROR",
    }},
    {id: "ar-holdem-spatial", typename: ARHoldemScenario.getTypeName(), parameters: {flow: "spatial"}},
    {id: "ar-holdem-action", typename: ARHoldemScenario.getTypeName(), parameters: {flow: "action"}},
    {id: "ar-holdem-offline-hand", typename: ARHoldemScenario.getTypeName(), parameters: {flow: "hand", __leaf__timeout_secs: "150"}},
    {id: "ar-holdem-guards", typename: ARHoldemScenario.getTypeName(), parameters: {flow: "guards"}},
    {id: "ar-holdem-ik-reach", typename: ARHoldemScenario.getTypeName(), parameters: {
      flow: "ik", __leaf__diagnostic_policy: "fail-fast", __leaf__diagnostic_report_duration_ms: "0",
    }},
    {id: "ar-holdem-gesture-demo", typename: ARHoldemGestureDemo.getTypeName(), parameters: {
      flow: "gesture", __leaf__log_level: "ERROR", __leaf__diagnostic_policy: "fail-fast", __leaf__diagnostic_report_duration_ms: "0",
    }},
    {id: "ar-holdem-full-demo", typename: ARHoldemGestureDemo.getTypeName(), parameters: {
      flow: "full", __leaf__timeout_secs: "150", __leaf__log_level: "ERROR",
      __leaf__diagnostic_policy: "fail-fast", __leaf__diagnostic_report_duration_ms: "0",
    }},
  ]
}
