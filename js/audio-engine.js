import { STATE } from './state.js';

let audioCtx = null;

let previewOsc = null;
let previewGain = null;
let currentPreviewPitch = -1;

const scheduledNoteIds = new Set(); 
let activeNodes =[]; 

// 追加: リファレンス音声用のノード
let refSource = null;
let refGain = null;

export function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

function pitchToFreq(pitch) {
    return 440 * Math.pow(2, (pitch - 69) / 12);
}

// 変更: Solo時のミュートロジックにリファレンストラックを考慮
export function isTrackAudible(track) {
    if (!track) return false;
    if (track.isMuted) return false;
    
    const isAnyInstSoloed = STATE.tracks.some(t => t.isSoloed);
    const isRefSoloed = STATE.referenceTrack.isSoloed;
    
    // いずれかのトラックがソロ化されている場合、自身のソロ状態のみで判定
    if (isAnyInstSoloed || isRefSoloed) {
        return track.isSoloed;
    }
    return true;
}

// --- 追加: リファレンス音声トラック機能 ---

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
    
    // 接続
    refSource.connect(refGain);
    refGain.connect(audioCtx.destination);
    
    updateReferenceVolume(); // Solo/Mute・Volumeの適用

    // Tickをオフセット秒数に変換して再生
    const secondsPerTick = 60 / (STATE.bpm * STATE.ppq);
    const offsetSeconds = startTick * secondsPerTick;

    // バッファの長さを超えていなければ再生
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

// Mute/Soloおよび音量スライダの変更時にリアルタイムでゲインを適用
export function updateReferenceVolume() {
    if (!refGain || !audioCtx) return;
    
    const isMuted = STATE.referenceTrack.isMuted;
    const isAnyInstSoloed = STATE.tracks.some(t => t.isSoloed);
    const isRefSoloed = STATE.referenceTrack.isSoloed;

    let audible = true;
    if (isMuted) audible = false;
    // インストゥルメントがソロ化されており、自身がソロ化されていない場合はミュート
    if (isAnyInstSoloed && !isRefSoloed) audible = false;

    const targetVol = audible ? STATE.referenceTrack.volume : 0;
    
    // ノイズを避けるための微小フェード
    refGain.gain.setTargetAtTime(targetVol, audioCtx.currentTime, 0.01);
}

// --- プレビュー発音 ---
export function playPreview(pitch, trackId) {
    if (!audioCtx) return;
    const track = STATE.tracks.find(t => t.id === trackId);
    if (!isTrackAudible(track)) return;

    if (previewOsc && currentPreviewPitch === pitch) return;
    stopPreview(true);

    currentPreviewPitch = pitch;
    
    const actualPitch = Math.max(0, Math.min(127, pitch + STATE.globalTranspose));
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

    previewOsc.connect(previewGain);
    previewGain.connect(audioCtx.destination);
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

// --- 再生シーケンサー（スケジューリング） ---

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
    const actualPitch = Math.max(0, Math.min(127, note.pitch + STATE.globalTranspose));
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
    gain.connect(audioCtx.destination);
    
    osc.start(startTime);
    osc.stop(releaseStartTime + track.release);
    
    const nodeObj = { osc, gain };
    activeNodes.push(nodeObj);
    
    osc.onended = () => {
        activeNodes = activeNodes.filter(n => n !== nodeObj);
    };
}