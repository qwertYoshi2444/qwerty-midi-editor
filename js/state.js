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
    const h = Math.floor((i * (360 / 32)) % 360);
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
        transpose: 0,
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
    
    masterVolume: 1.0, 
    
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
        transpose: 0,
        waveform: 'sawtooth',
        attack: 0.0001,
        decay: 0.1,
        sustain: 0.75,
        release: 0.005
    });
}

// 新規: トラックの複製
export function duplicateTrack(trackId) {
    const sourceTrack = STATE.tracks.find(t => t.id === trackId);
    if (!sourceTrack) return;
    
    const nextId = STATE.tracks.length > 0 ? Math.max(...STATE.tracks.map(t => t.id)) + 1 : 1;
    
    // ノートのディープコピー（IDは新しく振り直す）
    const copiedNotes = sourceTrack.notes.map(n => ({
        ...n,
        id: STATE.nextNoteId++,
        selected: false
    }));

    const newTrack = {
        id: nextId,
        name: `${sourceTrack.name} (Copy)`,
        color: sourceTrack.color,
        borderColor: sourceTrack.borderColor,
        notes: copiedNotes,
        volume: sourceTrack.volume,
        transpose: sourceTrack.transpose,
        waveform: sourceTrack.waveform,
        attack: sourceTrack.attack,
        decay: sourceTrack.decay,
        sustain: sourceTrack.sustain,
        release: sourceTrack.release,
        isMuted: sourceTrack.isMuted,
        isSoloed: false
    };

    // 複製元トラックのすぐ後ろに挿入
    const index = STATE.tracks.findIndex(t => t.id === trackId);
    STATE.tracks.splice(index + 1, 0, newTrack);
}

// 新規: トラックの削除
export function deleteTrack(trackId) {
    if (STATE.tracks.length <= 1) {
        alert("Cannot delete the last track.");
        return;
    }
    
    STATE.tracks = STATE.tracks.filter(t => t.id !== trackId);
    
    // アクティブトラックが削除された場合、先頭のトラックをアクティブにする
    if (STATE.activeTrackId === trackId) {
        STATE.activeTrackId = STATE.tracks[0].id;
    }
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
            name: parsedTrack.name || `MIDI Track ${appendMode ? nextId : (index + 1)}`, 
            color: newColorObj.fill,
            borderColor: newColorObj.border,
            notes: newNotes,
            volume: 1.0,
            transpose: 0,
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