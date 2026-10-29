import type {Session} from './types';
export function mergeSession(previous:Session|null,incoming:Session):Session{
 if(previous?.code===incoming.code&&previous.revision>incoming.revision)return previous;
 if(!incoming.partial)return incoming;
 const songs=new Map((previous?.code===incoming.code?previous.songs:[]).map(s=>[s.id,s]));
 for(const song of incoming.songs)songs.set(song.id,song);
 return {...incoming,songs:(incoming.songIds||[]).map(id=>songs.get(id)).filter((s):s is Session['songs'][number]=>!!s)};
}
