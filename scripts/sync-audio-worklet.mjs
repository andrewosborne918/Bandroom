import {copyFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
const require=createRequire(import.meta.url);
const source=require.resolve('@soundtouchjs/audio-worklet/processor');
mkdirSync('public/audio',{recursive:true});
copyFileSync(source,'public/audio/soundtouch-processor.js');
copyFileSync(join(dirname(source),'../LICENSE'),'public/audio/SoundTouch-LICENSE.txt');
