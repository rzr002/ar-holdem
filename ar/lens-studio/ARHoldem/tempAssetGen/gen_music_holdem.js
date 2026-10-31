const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PROJECT_ASSETS_SFX = path.join(ROOT, 'Assets', 'GeneratedSFX');
let SKILLS = process.env.LS_CLAD_SKILLS_ROOT;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--skills-root' && args[i + 1]) {
    SKILLS = args[++i];
  } else {
    console.error('Usage: node gen_music_holdem.js [--skills-root <ls-clad-skills-root>]');
    process.exit(2);
  }
}
if (!SKILLS) {
  console.error('Set LS_CLAD_SKILLS_ROOT or pass --skills-root pointing to ls-clad/local/skills.');
  process.exit(2);
}
const SFX_TOOLS = path.join(SKILLS, 'build-sfx/tools');
const MUSIC_TOOLS = path.join(SKILLS, 'build-music/tools');
if (!fs.existsSync(SFX_TOOLS) || !fs.existsSync(MUSIC_TOOLS)) {
  console.error('The selected skills root must contain build-sfx/tools and build-music/tools.');
  process.exit(2);
}
const a = require(SFX_TOOLS);
const m = require(MUSIC_TOOLS);
fs.mkdirSync(PROJECT_ASSETS_SFX, {recursive: true});
for (const [name, make] of [
  ['TableClick', () => a.sfx_presets.uiClick({character:'soft',pitch:-4})],
  ['YourTurn', () => a.sfx_presets.uiNotify()],
  ['HandComplete', () => a.sfx_presets.uiSuccess()],
]) {
  const buf = make();
  a.mix_bus.masterChain(buf, {normalize:'peak'});
  a.WavBuilder.write(buf, path.join(PROJECT_ASSETS_SFX, name+'.wav'));
}
const genre='lofi-jazz';
const bpm=m.suggestTempo(genre);
const {chords,meta}=m.composeChords({genre,voice:'vibraphone'});
const tracks=[
  m.track('soft comp','vibraphone',m.chordEvents(chords,{voice:'vibraphone',bars:4,velocity:62}),
    {fx:{hpf:220,lpf:2800,reverb:'smallRoom',gain:.35}}),
  m.track('warm bass','subBass',m.composeBass({chords,genre,bars:4,style:'root',variation:.15}),
    {fx:{lpf:200,gain:.25}}),
];
const music=m.render(tracks,{bpm});
m.WavBuilder.write(music,path.join(PROJECT_ASSETS_SFX,'TableLounge.wav'));
console.log(JSON.stringify({bpm,meta,output:PROJECT_ASSETS_SFX}));
