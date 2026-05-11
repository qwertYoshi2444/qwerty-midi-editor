import { STATE } from './state.js';

let audioCtx = null;
let masterGain = null; // 新規: マスターボリューム用ノード

let previewOsc = null;
let previewGain = null;
let currentPreviewPitch = -1;

const scheduledNoteIds = new Set(); 
let activeNodes =[]; 

let refSource = null;
let refGain = null;

export function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        // マスターゲインの初期化と接続
        masterGain = audioCtx.createGain();
        masterGain.connect(audioCtx.destination);
        updateMasterVolume();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

export function updateMasterVolume() {
    if (masterGain && audioCtx) {
        // ノイズを避けるための微小フェード
        masterGain.gain.setTargetAtTime(STATE.masterVolume, audioCtx.currentTime, 0.01);
    }
}

function pitchToFreq(pitch) {
    return 440 * Math.pow(2, (pitch - 69) / 12);
}

export function isTrackAudible(track) {
    if (!track) return false;
    if (track.isMuted) return false;
    
    const isAnyInstSoloed = STATE.tracks.some(t => t.isSoloed);
    const isRefSoloed = STATE.referenceTrack.isSoloed;
    
    if (isAnyInstSoloed || isRefSoloed) {
        return track.isSoloed;
    }
    return true;
}

export async function loadReferenceAudio(file) {
    initAudio();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    STATE.referenceTrack.buffer = audioBuffer;
    STATE.referenceTrack.fileName = file.name;
    STATE.referenceTrack.isLoaded = true;
}

export function playReferenceAudio(startTick) {
    if (!audioCtx || !STATE.referenceTrack.isLoaded || !STATE.referenceTrack.buffer) return;
    stopReferenceAudio();

    refSource = audioCtx.createBufferSource();
    refSource.buffer = STATE.referenceTrack.buffer;

    refGain = audioCtx.createGain();
    
    // マスターゲインに接続するよう変更
    refSource.connect(refGain);
    refGain.connect(masterGain);
    
    updateReferenceVolume(); 

    const secondsPerTick = 60 / (STATE.bpm * STATE.ppq);
    const offsetSeconds = startTick * secondsPerTick;

    if (offsetSeconds < refSource.buffer.duration) {
        refSource.start(0, offsetSeconds);
    }
}

export function stopReferenceAudio() {
    if (refSource) {
        try { refSource.stop(); } catch(e) {}
        refSource.disconnect();
        refSource = null;
    }
    if (refGain) {
        refGain.disconnect();
        refGain = null;
    }
}

export function updateReferenceVolume() {
    if (!refGain || !audioCtx) return;
    
    const isMuted = STATE.referenceTrack.isMuted;
    const isAnyInstSoloed = STATE.tracks.some(t => t.isSoloed);
    const isRefSoloed = STATE.referenceTrack.isSoloed;

    let audible = true;
    if (isMuted) audible = false;
    if (isAnyInstSoloed && !isRefSoloed) audible = false;

    const targetVol = audible ? STATE.referenceTrack.volume : 0;
    refGain.gain.setTargetAtTime(targetVol, audioCtx.currentTime, 0.01);
}

export function playPreview(pitch, trackId) {
    if (!audioCtx) return;
    const track = STATE.tracks.find(t => t.id === trackId);
    if (!isTrackAudible(track)) return;

    if (previewOsc && currentPreviewPitch === pitch) return;
    stopPreview(true);

    currentPreviewPitch = pitch;
    
    // トラック個別のトランスポーズを加味
    const trackTranspose = track.transpose || 0;
    const actualPitch = Math.max(0, Math.min(127, pitch + STATE.globalTranspose + trackTranspose));
    const freq = pitchToFreq(actualPitch);

    previewOsc = audioCtx.createOscillator();
    previewGain = audioCtx.createGain();

    previewOsc.type = track.waveform;
    previewOsc.frequency.value = freq;

    const t = audioCtx.currentTime;
    const trackVol = track.volume !== undefined ? track.volume : 1.0;
    const maxVolume = 0.3 * trackVol;

    previewGain.gain.setValueAtTime(0, t);
    previewGain.gain.linearRampToValueAtTime(maxVolume, t + track.attack);
    const sustainLevel = maxVolume * track.sustain;
    previewGain.gain.setTargetAtTime(sustainLevel, t + track.attack, track.decay);

    // マスターゲインへ接続
    previewOsc.connect(previewGain);
    previewGain.connect(masterGain);
    previewOsc.start();
}

export function stopPreview(immediate = false) {
    if (!previewOsc || !previewGain || !audioCtx) return;

    const t = audioCtx.currentTime;
    previewGain.gain.cancelScheduledValues(t);
    previewGain.gain.setValueAtTime(previewGain.gain.value, t);

    if (immediate) {
        previewGain.gain.linearRampToValueAtTime(0, t + 0.01);
        previewOsc.stop(t + 0.01);
    } else {
        const track = STATE.tracks.find(t => t.id === STATE.activeTrackId);
        const releaseTime = track ? track.release : 0.1;
        previewGain.gain.exponentialRampToValueAtTime(0.0001, t + releaseTime);
        previewOsc.stop(t + releaseTime);
    }

    previewOsc = null;
    previewGain = null;
    currentPreviewPitch = -1;
}

export function startScheduler() {
    scheduledNoteIds.clear();
    stopAllSounds();
}

export function stopAllSounds() {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    
    activeNodes.forEach(node => {
        try {
            node.gain.gain.cancelScheduledValues(t);
            node.gain.gain.setValueAtTime(node.gain.gain.value, t);
            node.gain.gain.linearRampToValueAtTime(0, t + 0.02); 
            node.osc.stop(t + 0.02);
        } catch (e) {}
    });
    
    activeNodes =[];
    scheduledNoteIds.clear();
}

export function scheduleNotes(currentTick, lookaheadTime, secondsPerTick) {
    if (!audioCtx) return;
    
    const lookaheadTicks = lookaheadTime / secondsPerTick;
    const endTick = currentTick + lookaheadTicks;
    
    STATE.tracks.forEach(track => {
        if (!isTrackAudible(track)) return;
        
        track.notes.forEach(note => {
            if (note.tick >= currentTick && note.tick < endTick && !note.muted && !scheduledNoteIds.has(note.id)) {
                const timeOffset = (note.tick - currentTick) * secondsPerTick;
                const startTime = audioCtx.currentTime + timeOffset;
                const durationTime = note.duration * secondsPerTick;
                
                scheduleSingleNote(note, track, startTime, durationTime);
                scheduledNoteIds.add(note.id);
            }
        });
    });
}

function scheduleSingleNote(note, track, startTime, durationTime) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.type = track.waveform;
    
    // トラック個別のトランスポーズを加味
    const trackTranspose = track.transpose || 0;
    const actualPitch = Math.max(0, Math.min(127, note.pitch + STATE.globalTranspose + trackTranspose));
    osc.frequency.value = pitchToFreq(actualPitch);
    
    const trackVol = track.volume !== undefined ? track.volume : 1.0;
    const maxVolume = 0.3 * trackVol;
    
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(maxVolume, startTime + track.attack);
    const sustainLevel = maxVolume * Math.max(0.01, track.sustain);
    gain.gain.setTargetAtTime(sustainLevel, startTime + track.attack, track.decay);
    
    const releaseStartTime = startTime + durationTime;
    gain.gain.setValueAtTime(sustainLevel, releaseStartTime); 
    gain.gain.exponentialRampToValueAtTime(0.0001, releaseStartTime + track.release);
    
    osc.connect(gain);
    gain.connect(masterGain); // マスターゲインへ接続
    
    osc.start(startTime);
    osc.stop(releaseStartTime + track.release);
    
    const nodeObj = { osc, gain };
    activeNodes.push(nodeObj);
    
    osc.onended = () => {
        activeNodes = activeNodes.filter(n => n !== nodeObj);
    };
}