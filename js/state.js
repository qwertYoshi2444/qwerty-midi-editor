import { startFadeOutAnimation } from './renderer.js';

function hslToHex(h, s, l) {
    l /= 100;
    const a = s * Math.min(l, 1 - l) / 100;
    const f = n => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

export const TRACK_COLORS_PALETTE =[];
for (let i = 0; i < 32; i++) {
    // 変更: +215度シフトすることで、インデックス0が青色系（#4585f5に近い色）になるよう調整
    const h = Math.floor((i * (360 / 32) + 215) % 360);
    const s = i % 2 === 0 ? 60 : 45;
    const l = i % 2 === 0 ? 55 : 45;
    TRACK_COLORS_PALETTE.push({
        fill: hslToHex(h, s, l),
        border: hslToHex(h, s, Math.max(0, l - 15))
    });
}

const initialTracks =[];
for (let i = 0; i < 8; i++) {
    initialTracks.push({
        id: i + 1,
        name: `Track ${i + 1}`,
        color: TRACK_COLORS_PALETTE[i].fill,
        borderColor: TRACK_COLORS_PALETTE[i].border,
        notes:[],
        volume: 1.0,
        waveform: 'sawtooth',
        attack: 0.0001,
        decay: 0.1,
        sustain: 0.75,
        release: 0.005
    });
}

export const STATE = {
    bpm: 120,
    ppq: 96,
    
    zoomX: 0.5,
    zoomY: 20,
    scrollTick: 0,
    scrollPitch: 84,
    
    targetZoomX: 0.5,
    targetZoomY: 20,
    targetScrollTick: 0,
    targetScrollPitch: 84,
    
    playheadTick: 0,
    isPlaying: false,
    
    nextNoteId: 1,
    snap: 24,
    lastDuration: 24,
    currentTool: 'draw',
    
    tracks: initialTracks,
    activeTrackId: 1,
    dyingNotes:[],
    
    globalTranspose: 0,

    referenceTrack: {
        isLoaded: false,
        buffer: null,
        fileName: "No File",
        isMuted: false,
        isSoloed: false,
        volume: 1.0
    },

    selectionBox: {
        active: false,
        startX: 0,
        startY: 0,
        currentX: 0,
        currentY: 0
    },

    get notes() {
        const track = this.tracks.find(t => t.id === this.activeTrackId);
        return track ? track.notes :[];
    },
    set notes(newNotes) {
        const track = this.tracks.find(t => t.id === this.activeTrackId);
        if (track) track.notes = newNotes;
    }
};

export function clearSelection() {
    STATE.notes.forEach(n => n.selected = false);
}

export function getSelectedNotes() {
    return STATE.notes.filter(n => n.selected);
}

export function deleteNote(note) {
    if (!note) return;
    const track = STATE.tracks.find(t => t.id === STATE.activeTrackId);
    if (track) {
        STATE.dyingNotes.push({ ...note, opacity: 1.0, color: track.color });
    }
    STATE.notes = STATE.notes.filter(n => n.id !== note.id);
    startFadeOutAnimation();
}

export function deleteSelectedNotes() {
    const selected = getSelectedNotes();
    if (selected.length === 0) return;
    const track = STATE.tracks.find(t => t.id === STATE.activeTrackId);
    selected.forEach(note => {
        if (track) STATE.dyingNotes.push({ ...note, opacity: 1.0, color: track.color });
    });
    STATE.notes = STATE.notes.filter(n => !n.selected);
    startFadeOutAnimation();
}

export function addTrack() {
    const nextId = STATE.tracks.length > 0 ? Math.max(...STATE.tracks.map(t => t.id)) + 1 : 1;
    
    const usedColors = STATE.tracks.map(t => t.color);
    let newColorObj = TRACK_COLORS_PALETTE.find(c => !usedColors.includes(c.fill));
    
    if (!newColorObj) {
        newColorObj = TRACK_COLORS_PALETTE[Math.floor(Math.random() * TRACK_COLORS_PALETTE.length)];
    }

    STATE.tracks.push({
        id: nextId,
        name: `Track ${nextId}`,
        color: newColorObj.fill,
        borderColor: newColorObj.border,
        notes:[],
        volume: 1.0,
        waveform: 'sawtooth',
        attack: 0.0001,
        decay: 0.1,
        sustain: 0.75,
        release: 0.005
    });
}

export function loadParsedMIDI(parsedData, appendMode, overrideBpm) {
    if (overrideBpm && parsedData.bpm) {
        STATE.bpm = parsedData.bpm;
        const bpmInput = document.getElementById('bpm-input');
        if (bpmInput) bpmInput.value = STATE.bpm;
    }

    if (!appendMode) {
        STATE.tracks =[]; 
    }

    parsedData.tracks.forEach((parsedTrack, index) => {
        const nextId = STATE.tracks.length > 0 ? Math.max(...STATE.tracks.map(t => t.id)) + 1 : 1;
        
        const usedColors = STATE.tracks.map(t => t.color);
        let newColorObj = TRACK_COLORS_PALETTE.find(c => !usedColors.includes(c.fill));
        
        if (!newColorObj) {
            newColorObj = TRACK_COLORS_PALETTE[Math.floor(Math.random() * TRACK_COLORS_PALETTE.length)];
        }

        const newNotes = parsedTrack.notes.map(n => ({
            ...n,
            id: STATE.nextNoteId++
        }));

        STATE.tracks.push({
            id: nextId,
            name: `MIDI Track ${appendMode ? nextId : (index + 1)}`,
            color: newColorObj.fill,
            borderColor: newColorObj.border,
            notes: newNotes,
            volume: 1.0,
            waveform: 'sawtooth',
            attack: 0.0001,
            decay: 0.1,
            sustain: 0.75,
            release: 0.005
        });
    });

    if (STATE.tracks.length > 0 && (!STATE.activeTrackId || !STATE.tracks.find(t => t.id === STATE.activeTrackId))) {
        STATE.activeTrackId = STATE.tracks[0].id;
    }
}