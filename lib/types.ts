import type {AudioAnalysis} from './analysis';
import type {SongInfo} from './song-info';
export type Stem = { audioVersion?:string; id: string; name: string; filename: string; enabled: boolean; volume: number; duration: number; bytes: number; offset?: number; bandOnly?: boolean; category?: string; sampleRate?: number; source?: 'import'|'ai'; status?: 'completed'; pan?: number; solo?: boolean };
export type Section = { lineCues?:{line:number;at:number}[]; manual?:boolean; start?:number; tabCues?:{id:string;at:number;instrument:string;text:string}[]; id: string; name: string; bars: number; lyrics: string; chords: string; tabs: Record<string,string> };
export type Song = { id: string; title: string; artist: string; bpm: number; beats: number; denominator: number; key: string; countIn: number; beatOffset: number; duration: number; stems: Stem[]; sections: Section[]; chart?:import('./song-charts').SongChart; demo?: boolean; analysis?:AudioAnalysis; info?:SongInfo };
export type Member = { id: string; name: string; instrument: string; ready: boolean; songId?: string; seen: number; role?: 'musician'|'audience'; userId?: string };
export type Transport = { status: 'stopped'|'playing'; run: string; startAt: number; offset: number; countIn: number };
export type Session = { code: string; name: string; songs: Song[]; songId: string; members: Member[]; transport: Transport; revision: number; expires: number; sessionId?: string; canControl?: boolean; leaderId?: string; controllers?: string[] };
