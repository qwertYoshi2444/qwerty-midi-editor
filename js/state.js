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
        release: 0.005,
        linkedTo: null
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
        if (!track) return [];
        if (track.linkedTo !== null && track.linkedTo !== undefined) {
            const sourceTrack = this.tracks.find(t => t.id === track.linkedTo);
            return sourceTrack ? sourceTrack.notes : [];
        }
        return track.notes;
    },
    set notes(newNotes) {
        const track = this.tracks.find(t => t.id === this.activeTrackId);
        if (track && track.linkedTo === null) {
            track.notes = newNotes;
        }
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
    if (track && track.linkedTo === null) {
        STATE.dyingNotes.push({ ...note, opacity: 1.0, color: track.color });
        STATE.notes = STATE.notes.filter(n => n.id !== note.id);
        startFadeOutAnimation();
    }
}

export function deleteSelectedNotes() {
    const track = STATE.tracks.find(t => t.id === STATE.activeTrackId);
    if (!track || track.linkedTo !== null) return; 
    
    const selected = getSelectedNotes();
    if (selected.length === 0) return;
    
    selected.forEach(note => {
        STATE.dyingNotes.push({ ...note, opacity: 1.0, color: track.color });
    });
    STATE.notes = STATE.notes.filter(n => !n.selected);
    startFadeOutAnimation();
}

export function addTrack() {
    const nextId = STATE.tracks.length > 0 ? Math.max(...STATE.tracks.map(t => t.id)) + 1 : 1;
    
    const usedColors = STATE.tracks.map(t => t.color);
    let newColorObj = TRACK_COLORS_PALETTE.find(c => !usedColors.includes(c.fill));
    if (!newColorObj) newColorObj = TRACK_COLORS_PALETTE[Math.floor(Math.random() * TRACK_COLORS_PALETTE.length)];

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
        release: 0.005,
        linkedTo: null
    });
}

export function duplicateTrack(trackId) {
    const sourceTrack = STATE.tracks.find(t => t.id === trackId);
    if (!sourceTrack) return;
    
    const nextId = STATE.tracks.length > 0 ? Math.max(...STATE.tracks.map(t => t.id)) + 1 : 1;
    
    let copiedNotes = [];
    if (sourceTrack.linkedTo === null) {
        copiedNotes = sourceTrack.notes.map(n => ({ ...n, id: STATE.nextNoteId++, selected: false }));
    }

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
        isSoloed: false,
        linkedTo: sourceTrack.linkedTo
    };

    const index = STATE.tracks.findIndex(t => t.id === trackId);
    STATE.tracks.splice(index + 1, 0, newTrack);
}

export function createLinkedTrack(trackId) {
    const sourceTrack = STATE.tracks.find(t => t.id === trackId);
    if (!sourceTrack) return;
    
    const actualSourceId = sourceTrack.linkedTo !== null ? sourceTrack.linkedTo : sourceTrack.id;
    const actualSourceTrack = STATE.tracks.find(t => t.id === actualSourceId);
    
    const nextId = STATE.tracks.length > 0 ? Math.max(...STATE.tracks.map(t => t.id)) + 1 : 1;

    const baseName = actualSourceTrack.name.replace(/\s\d+$/, '');
    let maxNum = 1;
    STATE.tracks.forEach(t => {
        if (t.name === baseName) {
            maxNum = Math.max(maxNum, 1);
        } else if (t.name.startsWith(baseName + " ")) {
            const num = parseInt(t.name.replace(baseName + " ", ""), 10);
            if (!isNaN(num)) maxNum = Math.max(maxNum, num);
        }
    });
    const newName = `${baseName} ${maxNum + 1}`;

    const newTrack = {
        id: nextId,
        name: newName,
        color: sourceTrack.color,
        borderColor: sourceTrack.borderColor,
        notes: [], 
        volume: sourceTrack.volume,
        transpose: sourceTrack.transpose,
        waveform: sourceTrack.waveform,
        attack: sourceTrack.attack,
        decay: sourceTrack.decay,
        sustain: sourceTrack.sustain,
        release: sourceTrack.release,
        isMuted: sourceTrack.isMuted,
        isSoloed: false,
        linkedTo: actualSourceId
    };

    const index = STATE.tracks.findIndex(t => t.id === trackId);
    STATE.tracks.splice(index + 1, 0, newTrack);
}

export function deleteTrack(trackId) {
    if (STATE.tracks.length <= 1) {
        alert("Cannot delete the last track.");
        return;
    }
    
    STATE.tracks.forEach(t => {
        if (t.linkedTo === trackId) {
            const src = STATE.tracks.find(orig => orig.id === trackId);
            if (src) {
                t.notes = src.notes.map(n => ({ ...n, id: STATE.nextNoteId++, selected: false }));
            }
            t.linkedTo = null;
        }
    });
    
    STATE.tracks = STATE.tracks.filter(t => t.id !== trackId);
    
    if (STATE.activeTrackId === trackId) {
        STATE.activeTrackId = STATE.tracks[0].id;
    }
}

export function loadParsedMIDI(parsedData, appendMode, overrideBpm, mismatchAction = 'keep') {
    if (overrideBpm && parsedData.bpm) {
        STATE.bpm = parsedData.bpm;
        const bpmInput = document.getElementById('bpm-input');
        if (bpmInput) bpmInput.value = STATE.bpm;
    }

    if (!appendMode) STATE.tracks = []; 

    const idMap = new Map();

    parsedData.tracks.forEach((parsedTrack, index) => {
        const nextId = STATE.tracks.length > 0 ? Math.max(...STATE.tracks.map(t => t.id)) + 1 : 1;
        idMap.set(index + 1, nextId);
        
        const usedColors = STATE.tracks.map(t => t.color);
        let newColorObj = TRACK_COLORS_PALETTE.find(c => !usedColors.includes(c.fill));
        if (!newColorObj) newColorObj = TRACK_COLORS_PALETTE[Math.floor(Math.random() * TRACK_COLORS_PALETTE.length)];

        let finalNotes = parsedTrack.notes;
        let finalLinkedTo = null;

        // リンク状態とユーザーのアクションに応じて処理を分岐
        if (parsedTrack._linkStatus === 'linked') {
            finalLinkedTo = parsedTrack._linkedToOriginalId;
            finalNotes = []; // 正常なリンクは自身のノートを破棄
        } else if (parsedTrack._linkStatus === 'mismatch') {
            if (mismatchAction === 'keep') {
                finalLinkedTo = parsedTrack._linkedToOriginalId;
                finalNotes = []; // 強制リンクなので自身のノートを破棄
            } else {
                finalLinkedTo = null; // 独立トラックにする
                // ノートはそのまま保持する
                parsedTrack.name += " (Independent)";
            }
        }

        const newNotes = finalNotes.map(n => ({ ...n, id: STATE.nextNoteId++ }));

        STATE.tracks.push({
            id: nextId,
            name: parsedTrack.name || `MIDI Track ${appendMode ? nextId : (index + 1)}`, 
            color: newColorObj.fill,
            borderColor: newColorObj.border,
            notes: newNotes,
            volume: 1.0,
            transpose: parsedTrack._transpose || 0, 
            waveform: 'sawtooth',
            attack: 0.0001,
            decay: 0.1,
            sustain: 0.75,
            release: 0.005,
            linkedTo: null, // 下のループで解決
            _tempOriginalLink: finalLinkedTo
        });
    });

    STATE.tracks.forEach(track => {
        if (track._tempOriginalLink !== undefined && track._tempOriginalLink !== null) {
            const mappedId = idMap.get(track._tempOriginalLink);
            if (mappedId) {
                track.linkedTo = mappedId;
            }
            delete track._tempOriginalLink;
        }
    });

    if (STATE.tracks.length > 0 && (!STATE.activeTrackId || !STATE.tracks.find(t => t.id === STATE.activeTrackId))) {
        STATE.activeTrackId = STATE.tracks[0].id;
    }
}