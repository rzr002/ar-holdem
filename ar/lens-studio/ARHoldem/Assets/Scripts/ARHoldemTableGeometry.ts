import {splitChipAmount, ChipInventory} from "./ARHoldemChipAmounts"

type MeshBatch = {mesh: MeshBuilder; object: SceneObject; visual: RenderMeshVisual}
type ChipRack = {root: SceneObject; bodies: MeshBatch[]; ivory: MeshBatch; ink: MeshBatch; amount: number}
type PresentationVisual = {id:number; phase:string; progress:number; actor:number|null; transfers:Array<{from:number;to:number;amount:number}>; startStacks:number[]; endStacks:number[]; startPot:number; endPot:number}

// Smooth centimeter-scale table and exact-denomination, layered chip racks.
@component
export class ARHoldemTableGeometry extends BaseScriptComponent {
  @input @hint('Unlit material used as a clone template') material: Material;
  @input @hint('Table width in centimeters') widthCm: number = 86;
  @input @hint('Table depth in centimeters') depthCm: number = 60;
  @input @hint('Human chip pile anchor') humanChips: SceneObject;
  @input @hint('Atlas chip pile anchor') atlasChips: SceneObject;
  @input @hint('Nova chip pile anchor') novaChips: SceneObject;
  @input @hint('Orion chip pile anchor') orionChips: SceneObject;
  @input @hint('Lyra chip pile anchor') lyraChips: SceneObject;
  @input @hint('Vega chip pile anchor') vegaChips: SceneObject;
  @input @hint('Pot chip pile anchor') potChips: SceneObject;
  @input @hint('Felt tint') @widget(new ColorWidget())
  feltColor: vec4 = new vec4(.055,.32,.25,1);
  @input @hint('Padded table rail tint') @widget(new ColorWidget())
  rimColor: vec4 = new vec4(.32,.23,.14,1);

  private piles: ChipRack[] = [];
  private transferRacks: ChipRack[] = [];
  private anchors: SceneObject[] = [];
  private presentationId = -1;
  private presentationKey = "";
  private presentationVisual: PresentationVisual | null = null;
  private transferRenderClock = 0;
  private ready = false;
  private amounts = [500,500,500,500,500,500,0];
  private readonly ivory = new vec4(.91,.87,.73,1);
  private readonly ink = new vec4(.055,.09,.13,1);
  // Denomination, not player identity, determines chip color.
  private readonly chipColors = [new vec4(.49,.27,.65,1), new vec4(.12,.28,.50,1),
    new vec4(.07,.43,.27,1), new vec4(.78,.16,.14,1), new vec4(.79,.76,.66,1)];

  onAwake(): void {
    this.createEvent('OnStartEvent').bind(() => this.build());
  }

  private builder(): MeshBuilder {
    const b = new MeshBuilder([{name:'position',components:3},{name:'normal',components:3}]);
    b.topology = MeshTopology.Triangles;
    b.indexType = MeshIndexType.UInt16;
    return b;
  }

  private vertex(b:MeshBuilder,x:number,y:number,z:number,nx=0,ny=1,nz=0):void {
    b.appendVerticesInterleaved([x,y,z,nx,ny,nz]);
  }

  private cylinder(b:MeshBuilder,rx:number,rz:number,bottom:number,top:number,
      x=0,z=0,segments=40):void {
    for(let i=0;i<segments;i++) {
      const a=i*2*Math.PI/segments,c=(i+1)*2*Math.PI/segments;
      const ax=x+rx*Math.cos(a),az=z+rz*Math.sin(a);
      const cx=x+rx*Math.cos(c),cz=z+rz*Math.sin(c);
      let k=b.getVerticesCount();
      this.vertex(b,x,top,z); this.vertex(b,cx,top,cz); this.vertex(b,ax,top,az);
      this.vertex(b,x,bottom,z,0,-1,0); this.vertex(b,ax,bottom,az,0,-1,0); this.vertex(b,cx,bottom,cz,0,-1,0);
      b.appendIndices([k,k+1,k+2,k+3,k+4,k+5]);
      k=b.getVerticesCount();
      const nx=Math.cos((a+c)/2)/rx,nz=Math.sin((a+c)/2)/rz,n=Math.sqrt(nx*nx+nz*nz);
      this.vertex(b,ax,top,az,nx/n,0,nz/n); this.vertex(b,cx,bottom,cz,nx/n,0,nz/n);
      this.vertex(b,ax,bottom,az,nx/n,0,nz/n); this.vertex(b,cx,top,cz,nx/n,0,nz/n);
      b.appendIndices([k,k+1,k+2,k,k+3,k+1]);
    }
  }

  /** Horizontal elliptical ring; increasing angle runs clockwise from +Y. */
  private ring(b:MeshBuilder,rx:number,rz:number,width:number,y:number,x=0,z=0,segments=80):void {
    this.arc(b,rx,rz,rx-width,rz-width,y,x,z,0,Math.PI*2,segments);
  }

  private arc(b:MeshBuilder,rx:number,rz:number,innerX:number,innerZ:number,y:number,
      x:number,z:number,start:number,end:number,segments:number):void {
    for(let i=0;i<segments;i++) {
      const a=start+(end-start)*i/segments,c=start+(end-start)*(i+1)/segments;
      const k=b.getVerticesCount();
      this.vertex(b,x+rx*Math.cos(a),y,z+rz*Math.sin(a));
      this.vertex(b,x+rx*Math.cos(c),y,z+rz*Math.sin(c));
      this.vertex(b,x+innerX*Math.cos(a),y,z+innerZ*Math.sin(a));
      this.vertex(b,x+innerX*Math.cos(c),y,z+innerZ*Math.sin(c));
      b.appendIndices([k,k+2,k+1,k+1,k+2,k+3]);
    }
  }

  private batch(parent:SceneObject,name:string,color:vec4):MeshBatch {
    const object=global.scene.createSceneObject(name); object.setParent(parent);
    const visual=object.createComponent('Component.RenderMeshVisual') as RenderMeshVisual;
    const mat=this.material.clone(); mat.mainPass.baseColor=color;
    visual.mainMaterial=mat; object.enabled=false;
    return {mesh:this.builder(),object,visual};
  }

  private finish(batch:MeshBatch):void {
    const active=batch.mesh.getIndicesCount()>0;
    if(active) {batch.visual.mesh=batch.mesh.getMesh();batch.mesh.updateMesh();}
    batch.object.enabled=active;
  }

  private clear(batch:MeshBatch):void {
    const indices=batch.mesh.getIndicesCount(),vertices=batch.mesh.getVerticesCount();
    if(indices>0)batch.mesh.eraseIndices(0,indices);
    if(vertices>0)batch.mesh.eraseVertices(0,vertices);
  }

  private build():void {
    if(this.ready || !this.material || !this.humanChips || !this.atlasChips || !this.novaChips ||
        !this.orionChips || !this.lyraChips || !this.vegaChips || !this.potChips) return;
    const rx=this.widthCm/2,rz=this.depthCm/2;
    const base=this.batch(this.sceneObject,'Table lower apron',new vec4(.075,.09,.105,1));
    this.cylinder(base.mesh,rx-.35,rz-.35,-2.8,-1.0,0,0,96);this.finish(base);

    const rail=this.batch(this.sceneObject,'Brass table rim',this.rimColor);
    // A beveled padded rail, not a single flat gold cylinder.
    const profile=[[0,-1.25],[0,-.22],[.35,.22],[.85,.54],[2,.58],[2.8,.30],[3.35,.02]];
    for(let p=0;p<profile.length-1;p++) {
      const [insetA,ya]=profile[p],[insetB,yb]=profile[p+1];
      for(let i=0;i<96;i++) {
        const a=i*2*Math.PI/96,c=(i+1)*2*Math.PI/96,k=rail.mesh.getVerticesCount();
        this.vertex(rail.mesh,(rx-insetA)*Math.cos(a),ya,(rz-insetA)*Math.sin(a));
        this.vertex(rail.mesh,(rx-insetA)*Math.cos(c),ya,(rz-insetA)*Math.sin(c));
        this.vertex(rail.mesh,(rx-insetB)*Math.cos(a),yb,(rz-insetB)*Math.sin(a));
        this.vertex(rail.mesh,(rx-insetB)*Math.cos(c),yb,(rz-insetB)*Math.sin(c));
        rail.mesh.appendIndices([k,k+2,k+1,k+1,k+2,k+3]);
      }
    }
    this.finish(rail);
    const felt=this.batch(this.sceneObject,'Teal felt',this.feltColor);
    this.cylinder(felt.mesh,rx-3.15,rz-3.15,-.5,.25,0,0,96);this.finish(felt);
    const inset=this.batch(this.sceneObject,'Felt inner field',new vec4(this.feltColor.x*.92,this.feltColor.y*.92,this.feltColor.z*.92,1));
    // Keep the inset clearly above the felt cap to avoid near-coplanar depth flicker.
    this.cylinder(inset.mesh,rx-7,rz-7,.30,.34,0,0,96);this.finish(inset);
    const piping=this.batch(this.sceneObject,'Rail piping and betting line',new vec4(.68,.58,.34,1));
    this.ring(piping.mesh,rx-1.45,rz-1.45,.075,.60,0,0,96);
    this.ring(piping.mesh,rx-3.24,rz-3.24,.10,.285,0,0,96);
    this.ring(piping.mesh,rx-7,rz-7,.055,.37,0,0,96);this.finish(piping);

    const anchors=[this.humanChips,this.atlasChips,this.novaChips,
      this.orionChips,this.lyraChips,this.vegaChips,this.potChips];
    this.anchors=anchors;
    anchors.forEach((anchor,i)=> {
      const root=global.scene.createSceneObject('Chip pile '+i);root.setParent(anchor);
      const bodies=this.chipColors.map((color,index)=>this.batch(root,'Denomination '+[500,100,25,5,1][index],color));
      this.piles.push({root,bodies,ivory:this.batch(root,'Chip edge blocks and inlays',this.ivory),
        ink:this.batch(root,'Chip seams and denominations',this.ink),amount:-1});
    });
    // A small persistent pool carries chips between the authored anchors. Meshes
    // are rebuilt only when a new presentation begins, never during frame updates.
    for(let i=0;i<6;i++) {
      const root=global.scene.createSceneObject('Chip transfer '+i);root.setParent(this.sceneObject);root.enabled=false;
      const bodies=this.chipColors.map((color,index)=>this.batch(root,'Transfer denomination '+index,color));
      this.transferRacks.push({root,bodies,ivory:this.batch(root,'Transfer edges',this.ivory),ink:this.batch(root,'Transfer ink',this.ink),amount:-1});
    }
    this.ready=true;
    this.setStacks(this.amounts.slice(0,6),this.amounts[6]);
  }

  /** Small top-face numerals built from strokes, independent of font support. */
  private numeral(b:MeshBuilder,value:number,x:number,z:number,y:number):void {
    const digits=String(value),w=.36,h=.70,stroke=.075,gap=.12;
    const patterns:{[key:string]:string}={'0':'abcdef','1':'bc','2':'abdeg','5':'acdfg'};
    const start=x-((w+gap)*digits.length-gap)/2;
    for(let i=0;i<digits.length;i++) {
      const cx=start+i*(w+gap)+w/2;
      const parts:{[key:string]:number[]}={a:[cx,z-h/2,w,stroke],b:[cx+w/2,z-h/4,stroke,h/2],
        c:[cx+w/2,z+h/4,stroke,h/2],d:[cx,z+h/2,w,stroke],e:[cx-w/2,z+h/4,stroke,h/2],
        f:[cx-w/2,z-h/4,stroke,h/2],g:[cx,z,w,stroke]};
      for(const key of patterns[digits[i]]) {
        const [px,pz,sx,sz]=parts[key],k=b.getVerticesCount();
        this.vertex(b,px-sx/2,y,pz-sz/2);this.vertex(b,px+sx/2,y,pz-sz/2);
        this.vertex(b,px-sx/2,y,pz+sz/2);this.vertex(b,px+sx/2,y,pz+sz/2);
        b.appendIndices([k,k+2,k+1,k+1,k+2,k+3]);
      }
    }
  }

  private chip(rack:ChipRack,index:number,x:number,z:number,bottom:number,showTop:boolean,value:number):void {
    const top=bottom+.265,body=rack.bodies[index].mesh;
    this.cylinder(body,1.35,1.35,bottom+.025,top,x,z,40);
    // Dark hairline and an actual air gap make adjacent disks distinguishable.
    this.cylinder(rack.ink.mesh,1.31,1.31,bottom,bottom+.027,x,z,32);
    const marks=index===4?rack.ink.mesh:rack.ivory.mesh;
    for(let n=0;n<8;n++) {
      const start=n*Math.PI/4+.07,end=start+.21;
      this.arc(marks,1.354,1.354,1.04,1.04,top+.006,x,z,start,end,3);
      for(let j=0;j<3;j++) {
        const a=start+(end-start)*j/3,c=start+(end-start)*(j+1)/3,k=marks.getVerticesCount();
        const nx=Math.cos((a+c)/2),nz=Math.sin((a+c)/2);
        this.vertex(marks,x+1.356*Math.cos(a),bottom+.045,z+1.356*Math.sin(a),nx,0,nz);
        this.vertex(marks,x+1.356*Math.cos(c),bottom+.045,z+1.356*Math.sin(c),nx,0,nz);
        this.vertex(marks,x+1.356*Math.cos(a),top-.02,z+1.356*Math.sin(a),nx,0,nz);
        this.vertex(marks,x+1.356*Math.cos(c),top-.02,z+1.356*Math.sin(c),nx,0,nz);
        marks.appendIndices([k,k+2,k+1,k+1,k+2,k+3]);
      }
    }
    if(showTop) {
      this.ring(marks,1.06,1.06,.065,top+.009,x,z,40);
      this.cylinder(rack.ivory.mesh,.83,.83,top+.01,top+.014,x,z,32);
      this.numeral(rack.ink.mesh,value,x,z,top+.021);
    }
  }

  private updateRack(rack:ChipRack,amount:number,inventory:ChipInventory):void {
    if(rack.amount===amount)return;
    rack.amount=amount;rack.root.enabled=amount>0;
    if(!amount)return;
    const batches=[...rack.bodies,rack.ivory,rack.ink];batches.forEach(b=>this.clear(b));
    // 100 / 25 / 5 form the far row, 1 / 500 the near row. Fixed positions
    // keep a denomination in one place while the balance changes.
    const slots=[[1.5,1.65],[-3,-1.65],[0,-1.65],[3,-1.65],[-1.5,1.65]];
    inventory.forEach(({value,count},index)=> {
      const [x,z]=slots[index];
      for(let n=0;n<count;n++)this.chip(rack,index,x,z,n*.36,n===count-1,value);
    });
    batches.forEach(b=>this.finish(b));
  }

  setStacks(stacks:number[],pot:number):void {
    if(stacks.length!==6)return;
    const amounts=[...stacks,pot];
    // Validate the entire update before modifying any rack.
    const inventories=amounts.map(splitChipAmount);
    this.amounts=amounts;
    if(!this.ready)return;
    if(this.presentationVisual?.phase!=='action' && this.presentationVisual?.phase!=='payout')
      this.piles.forEach((rack,i)=>this.updateRack(rack,amounts[i],inventories[i]));
  }

  /** Animate temporary chip racks along fixed anchor-to-anchor paths. Null clears them. */
  setPresentation(visual:PresentationVisual | null):void {
    this.presentationVisual=visual;
    if(!this.ready)return;
    if(!visual || !(visual.phase==='payout' || (visual.transfers.length>0 && (visual.phase==='action' || visual.phase==='collecting')))) {
      this.transferRacks.forEach(r=>r.root.enabled=false);this.presentationId=-1;this.presentationKey="";
      this.piles.forEach((rack,i)=>this.updateRack(rack,this.amounts[i],splitChipAmount(this.amounts[i])));return;
    }
    const routes:{from:number;to:number;amount:number}[]=[];
    visual.transfers.forEach(t=>{const route=routes.find(r=>r.from===t.from&&r.to===t.to);if(route)route.amount+=t.amount;else routes.push({...t});});
    const key=visual.id+":"+visual.phase+":"+routes.map(t=>`${t.from}-${t.to}-${t.amount}`).join(",");
    const presentationChanged=key!==this.presentationKey;
    if(presentationChanged) {
      this.presentationId=visual.id;
      this.presentationKey=key;
      this.transferRacks.forEach((rack,index)=> {
        const transfer=routes[index];
        this.updateRack(rack,transfer?.amount ?? 0,transfer ? splitChipAmount(transfer.amount) : []);
        rack.root.enabled=!!transfer && transfer.amount>0;
      });
    }
    const t=Math.max(0,Math.min(1,visual.progress));
    // Keep the visible chip ledger conserved: chips on a travel rack are removed
    // from the source pile, then restored to the destination when the rack arrives.
    const staticAmounts=this.amounts.slice();
    if(visual.phase==='action' || visual.phase==='collecting') {
      for(const transfer of visual.transfers) if(transfer.to===6)
        staticAmounts[6]=Math.max(0,staticAmounts[6]-transfer.amount);
    } else {
      const ledger=[...visual.startStacks,visual.startPot];
      for(const transfer of visual.transfers) {
        ledger[transfer.from]=Math.max(0,(ledger[transfer.from] ?? 0)-transfer.amount);
        if(t>=1) ledger[transfer.to]=(ledger[transfer.to] ?? 0)+transfer.amount;
      }
      for(let i=0;i<7;i++) staticAmounts[i]=Math.max(0,ledger[i] ?? 0);
    }
    this.transferRenderClock+=getDeltaTime();
    if(presentationChanged || this.transferRenderClock>=.1 || t>=1) {
      this.transferRenderClock=0;
      this.piles.forEach((rack,i)=>this.updateRack(rack,staticAmounts[i],splitChipAmount(staticAmounts[i])));
    }
    this.transferRacks.forEach((rack,index)=> {
      const transfer=routes[index];
      if(!transfer || transfer.amount<=0 || t>=1){rack.root.enabled=false;return;}
      const from=this.anchors[transfer.from]?.getTransform().getWorldPosition();
      const to=this.anchors[transfer.to]?.getTransform().getWorldPosition();
      if(!from || !to)return;
      rack.root.enabled=true;
      rack.root.getTransform().setWorldPosition(new vec3(from.x+(to.x-from.x)*t,from.y+(to.y-from.y)*t+Math.sin(t*Math.PI)*1.3,from.z+(to.z-from.z)*t));
    });
  }
}
