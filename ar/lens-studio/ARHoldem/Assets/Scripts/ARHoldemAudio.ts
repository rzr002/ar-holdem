@component
export class ARHoldemAudio extends BaseScriptComponent {
  @input @hint('Background music volume; set to 0 to mute')
  @widget(new SliderWidget(0,1,.01)) musicVolume:number=.07;
  @input @hint('Button and turn sound volume; set to 0 to mute')
  @widget(new SliderWidget(0,1,.01)) effectsVolume:number=.25;
  private music:AudioComponent;
  private click:AudioComponent;
  private turn:AudioComponent;
  private complete:AudioComponent;
  private lastHand=0;
  private wasHuman=false;
  private wasDone=false;

  onAwake():void {
    this.createEvent('OnStartEvent').bind(()=> {
      this.music=this.make(requireAsset('../GeneratedSFX/TableLounge.wav') as AudioTrackAsset,this.musicVolume,false);
      this.click=this.make(requireAsset('../GeneratedSFX/TableClick.wav') as AudioTrackAsset,this.effectsVolume,true);
      this.turn=this.make(requireAsset('../GeneratedSFX/YourTurn.wav') as AudioTrackAsset,this.effectsVolume,true);
      this.complete=this.make(requireAsset('../GeneratedSFX/HandComplete.wav') as AudioTrackAsset,this.effectsVolume,true);
      this.music.fadeInTime=2;
      this.music.play(-1);
    });
  }

  private make(track:AudioTrackAsset,volume:number,fast:boolean):AudioComponent {
    const a=this.sceneObject.createComponent('Component.AudioComponent') as AudioComponent;
    a.audioTrack=track; a.volume=volume; a.mixToSnap=true;
    a.playbackMode=fast?Audio.PlaybackMode.LowLatency:Audio.PlaybackMode.LowPower;
    return a;
  }

  onAction():void { if(this.click) this.click.play(1); }

  onState(hand:number,_revision:number,humanTurn:boolean,done:boolean):void {
    if(hand!==this.lastHand) {this.wasHuman=false;this.wasDone=false;this.lastHand=hand;}
    if(hand>0 && done && !this.wasDone && this.complete) this.complete.play(1);
    else if(hand>0 && humanTurn && !this.wasHuman && this.turn) this.turn.play(1);
    this.wasHuman=humanTurn; this.wasDone=done;
  }
}
