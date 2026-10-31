/** Small shared meshes for playing-card faces. Suits do not depend on font glyphs. */
type Point = {x: number; y: number}
type CardMesh = {object: SceneObject; visual: RenderMeshVisual}

class CardMeshBuilder {
  private vertices: number[] = []
  private indices: number[] = []

  private vertex(x: number, y: number, z: number, nx = 0, ny = 0, nz = 1): number {
    const index = this.vertices.length / 10
    this.vertices.push(x, y, z, nx, ny, nz, 1, 1, 1, 1)
    return index
  }

  polygon(points: Point[], z: number): void {
    let outline = points.slice()
    const area = outline.reduce((sum, p, i) => {
      const q = outline[(i + 1) % outline.length]
      return sum + p.x * q.y - q.x * p.y
    }, 0)
    if (area < 0) outline.reverse()
    const ids = outline.map(p => this.vertex(p.x, p.y, z))
    const remaining = outline.map((_, i) => i)
    const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    const inside = (p: Point, a: Point, b: Point, c: Point) =>
      cross(a, b, p) >= -1e-8 && cross(b, c, p) >= -1e-8 && cross(c, a, p) >= -1e-8
    // Ear clipping handles the heart's notch without filling across its outline.
    let guard = outline.length * outline.length
    while (remaining.length > 3 && guard-- > 0) {
      let clipped = false
      for (let j = 0; j < remaining.length; j++) {
        const a = remaining[(j + remaining.length - 1) % remaining.length]
        const b = remaining[j]
        const c = remaining[(j + 1) % remaining.length]
        if (cross(outline[a], outline[b], outline[c]) <= 1e-8) continue
        if (remaining.some(k => k !== a && k !== b && k !== c && inside(outline[k], outline[a], outline[b], outline[c]))) continue
        this.indices.push(ids[a], ids[b], ids[c])
        remaining.splice(j, 1)
        clipped = true
        break
      }
      if (!clipped) throw new Error("Invalid playing-card outline")
    }
    if (remaining.length === 3) this.indices.push(...remaining.map(i => ids[i]))
  }

  rounded(width: number, height: number, radius: number, z: number): void {
    this.polygon(this.roundedPoints(width, height, radius), z)
  }

  body(width: number, height: number, radius: number, bottom: number, top: number): void {
    const points = this.roundedPoints(width, height, radius)
    this.polygon(points, top)
    const center = this.vertex(0, 0, bottom, 0, 0, -1)
    const lower = points.map(p => this.vertex(p.x, p.y, bottom, 0, 0, -1))
    for (let i = 0; i < lower.length; i++) this.indices.push(center, lower[(i + 1) % lower.length], lower[i])
    // Independent side vertices keep a crisp, visible paper edge.
    for (let i = 0; i < points.length; i++) {
      const p = points[i], q = points[(i + 1) % points.length]
      const dx = q.x - p.x, dy = q.y - p.y, length = Math.sqrt(dx * dx + dy * dy)
      const nx = dy / length, ny = -dx / length
      const a = this.vertex(p.x, p.y, bottom, nx, ny, 0)
      const b = this.vertex(q.x, q.y, bottom, nx, ny, 0)
      const c = this.vertex(q.x, q.y, top, nx, ny, 0)
      const d = this.vertex(p.x, p.y, top, nx, ny, 0)
      this.indices.push(a, b, c, a, c, d)
    }
  }

  ring(width: number, height: number, radius: number, thickness: number, z: number): void {
    const outside = this.roundedPoints(width, height, radius)
    const inside = this.roundedPoints(width - 2 * thickness, height - 2 * thickness,
      Math.max(0.03, radius - thickness))
    for (let i = 0; i < outside.length; i++) {
      const j = (i + 1) % outside.length
      const ids = [outside[i], outside[j], inside[j], inside[i]].map(p => this.vertex(p.x, p.y, z))
      this.indices.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3])
    }
  }

  line(a: Point, b: Point, width: number, z: number): void {
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.sqrt(dx * dx + dy * dy)
    if (length === 0) return
    const x = -dy / length * width / 2, y = dx / length * width / 2
    this.polygon([{x: a.x + x, y: a.y + y}, {x: a.x - x, y: a.y - y},
      {x: b.x - x, y: b.y - y}, {x: b.x + x, y: b.y + y}], z)
  }

  circle(cx: number, cy: number, radius: number, z: number): void {
    const points: Point[] = []
    for (let i = 0; i < 28; i++) {
      const angle = i * Math.PI * 2 / 28
      points.push({x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle)})
    }
    this.polygon(points, z)
  }

  suit(suit: string, x: number, y: number, scale: number, z: number, rotated = false): void {
    const direction = rotated ? -1 : 1
    const points = (outline: Point[]) => outline.map(p => ({x: x + p.x * scale * direction, y: y + p.y * scale * direction}))
    if (suit === "d") {
      this.polygon(points([{x: 0, y: .92}, {x: -.60, y: 0}, {x: 0, y: -.92}, {x: .60, y: 0}]), z)
      return
    }
    if (suit === "c") {
      for (const p of [{x: 0, y: .36}, {x: -.34, y: -.13}, {x: .34, y: -.13}]) {
        const center = points([p])[0]
        this.circle(center.x, center.y, scale * .34, z)
      }
      this.polygon(points([{x: -.10, y: -.18}, {x: .10, y: -.18}, {x: .27, y: -.81}, {x: -.27, y: -.81}]), z)
      return
    }
    const heart: Point[] = []
    for (let i = 0; i < 48; i++) {
      const t = i * Math.PI * 2 / 48
      const px = 16 * Math.pow(Math.sin(t), 3) / 19
      const py = (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 19
      heart.push(suit === "s" ? {x: -px, y: -py * .83 + .06} : {x: px, y: py})
    }
    this.polygon(points(heart), z)
    if (suit === "s")
      this.polygon(points([{x: -.11, y: -.30}, {x: .11, y: -.30}, {x: .28, y: -.83}, {x: -.28, y: -.83}]), z)
  }

  private roundedPoints(width: number, height: number, radius: number): Point[] {
    const r = Math.min(radius, width / 2, height / 2)
    const result: Point[] = []
    const corners = [
      {x: width / 2 - r, y: height / 2 - r}, {x: -width / 2 + r, y: height / 2 - r},
      {x: -width / 2 + r, y: -height / 2 + r}, {x: width / 2 - r, y: -height / 2 + r},
    ]
    corners.forEach((corner, index) => {
      for (let i = 0; i <= 7; i++) {
        const angle = index * Math.PI / 2 + i * Math.PI / 14
        result.push({x: corner.x + r * Math.cos(angle), y: corner.y + r * Math.sin(angle)})
      }
    })
    return result
  }

  mesh(): RenderMesh {
    const builder = new MeshBuilder([{name: "position", components: 3},
      {name: "normal", components: 3}, {name: "color", components: 4}])
    builder.topology = MeshTopology.Triangles
    builder.indexType = MeshIndexType.UInt16
    builder.appendVerticesInterleaved(this.vertices)
    builder.appendIndices(this.indices)
    builder.updateMesh()
    return builder.getMesh()
  }
}

export class ARHoldemCardFactory {
  readonly inkColor = new vec4(.035, .075, .15, 1)
  readonly redColor = new vec4(.77, .035, .105, 1)
  private materials: Record<string, Material> = {}
  private meshes: Record<string, RenderMesh> = {}

  constructor(private template: Material) {
    this.material("paper", new vec4(.98, .965, .89, 1))
    this.material("edge", new vec4(.76, .68, .44, 1))
    this.material("blue", new vec4(.055, .16, .38, 1))
    this.material("pattern", new vec4(.65, .79, .97, 1))
    this.material("slot", new vec4(.29, .53, .48, 1))
    this.material("ink", this.inkColor)
    this.material("red", this.redColor)
  }

  private material(key: string, color: vec4): Material {
    if (!this.materials[key]) {
      const material = this.template.clone()
      material.mainPass.baseColor = color
      material.mainPass.blendMode = BlendMode.Disabled
      material.mainPass.depthTest = true
      material.mainPass.depthWrite = true
      this.materials[key] = material
    }
    return this.materials[key]
  }

  private mesh(key: string, build: (builder: CardMeshBuilder) => void): RenderMesh {
    if (!this.meshes[key]) {
      const builder = new CardMeshBuilder()
      build(builder)
      this.meshes[key] = builder.mesh()
    }
    return this.meshes[key]
  }

  private object(parent: SceneObject, name: string): SceneObject {
    const object = global.scene.createSceneObject(name)
    object.setParent(parent)
    return object
  }

  private visual(parent: SceneObject, name: string, mesh: RenderMesh, material: string): CardMesh {
    const object = this.object(parent, name)
    const visual = object.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    visual.mesh = mesh
    visual.mainMaterial = this.materials[material]
    return {object, visual}
  }

  create(parent: SceneObject, width: number, height: number): ARHoldemCardVisual {
    const key = `${width}/${height}`
    const radius = Math.min(.36, width * .09)
    const front = this.object(parent, "CardFront")
    const back = this.object(parent, "CardBack")
    const slot = this.object(parent, "CardSlot")
    const body = this.mesh(`${key}/body`, b => b.body(width, height, radius, -.12, .12))
    const edge = this.mesh(`${key}/edge`, b => b.ring(width - .24, height - .24, radius * .8, .035, .145))
    this.visual(front, "IvoryCardBody", body, "paper")
    this.visual(front, "FineCardBorder", edge, "edge")
    const glyph = this.visual(front, "SuitGlyph", this.suitMesh("s", width, height), "ink")
    this.visual(back, "BlueCardBody", body, "blue")
    const pattern = this.mesh(`${key}/pattern`, b => {
      b.ring(width - .30, height - .30, radius * .8, .09, .15)
      b.ring(width - .62, height - .62, radius * .65, .035, .15)
      const dx = (width - 1) / 4, dy = (height - 1) / 5
      for (let row = 0; row < 5; row++) for (let col = 0; col < 4; col++) {
        const cx = (col - 1.5) * dx, cy = (row - 2) * dy
        const diamond = [{x: cx, y: cy + dy * .34}, {x: cx + dx * .34, y: cy},
          {x: cx, y: cy - dy * .34}, {x: cx - dx * .34, y: cy}]
        for (let i = 0; i < 4; i++) b.line(diamond[i], diamond[(i + 1) % 4], .035, .15)
      }
    })
    this.visual(back, "WovenCardBack", pattern, "pattern")
    this.visual(slot, "EmptyCardOutline", this.mesh(`${key}/slot`, b => b.ring(width, height, radius, .065, .01)), "slot")
    return new ARHoldemCardVisual(front, back, slot, glyph.visual, this, width, height)
  }

  suitMesh(suit: string, width: number, height: number): RenderMesh {
    return this.mesh(`${width}/${height}/${suit}`, b => {
      const large = Math.min(width * .25, height * .20)
      const corner = Math.min(width * .068, height * .065)
      b.suit(suit, 0, -.05, large, .18)
      b.suit(suit, -width * .32, height * .16, corner, .18)
      b.suit(suit, width * .32, -height * .16, corner, .18, true)
    })
  }

  suitMaterial(suit: string): Material { return this.materials[suit === "h" || suit === "d" ? "red" : "ink"] }
}

export class ARHoldemCardVisual {
  private previous = ""
  constructor(readonly front: SceneObject, readonly back: SceneObject, readonly slot: SceneObject,
    private glyph: RenderMeshVisual, private factory: ARHoldemCardFactory, private width: number, private height: number) {}

  set(value: string, hidden: boolean): void {
    const key = `${value}/${hidden}`
    if (key === this.previous) return
    this.previous = key
    const faceUp = !!value && !hidden
    this.front.enabled = faceUp
    this.back.enabled = hidden
    this.slot.enabled = !faceUp && !hidden
    if (faceUp) {
      this.glyph.mesh = this.factory.suitMesh(value[1], this.width, this.height)
      this.glyph.mainMaterial = this.factory.suitMaterial(value[1])
    }
  }
}
