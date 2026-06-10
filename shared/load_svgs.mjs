import fs from 'fs';
import path from 'path';

function getSvgContent(name) {
  try {
    const p = path.join(process.cwd(), 'ui_svgs', name + '.svg');
    let content = fs.readFileSync(p, 'utf8');
    // Extract everything from <svg to </svg>
    const match = content.match(/<svg[\s\S]*?<\/svg>/i);
    if (match) {
      // Modify to ensure it sizes correctly
      let svg = match[0];
      // strip width and height attributes to let CSS define it
      svg = svg.replace(/\swidth="[^"]*"/ig, '').replace(/\sheight="[^"]*"/ig, '');
      return svg;
    }
  } catch (e) {
    console.warn(`Could not load ${name}.svg`);
  }
  return '';
}

export const svgs = {
  char1: getSvgContent('char1'),
  char2: getSvgContent('char2'),
  char3: getSvgContent('char3'),
  char4: getSvgContent('char4'),
  settings: getSvgContent('settings'),
  mic: getSvgContent('microphone'),
  chat: getSvgContent('messages'),
  fullscreen: getSvgContent('plus'),
  sprint: getSvgContent('sprint'),
  fire: getSvgContent('fire'),
  walkie: getSvgContent('radio'),
  medkit: getSvgContent('medkit'),
  rifle: getSvgContent('rifle'),
  pistol: getSvgContent('pistol'),
  ads: getSvgContent('aim'),
  reload: getSvgContent('reload'),
  jump: getSvgContent('up_arrow'),
  dash: getSvgContent('right_arrow'),
  crouch: getSvgContent('crouch'),
  bandaid1: getSvgContent('bandaid1'),
  bandaid2: getSvgContent('bandaid2'),
  player_arrow: getSvgContent('player_arrow')
};

console.log('SVGs loaded successfully.');
