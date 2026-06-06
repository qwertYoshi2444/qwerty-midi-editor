import { STATE } from './state.js';

let audioCtx = null;
let masterGain = null; 

let previewSource = null; // oscから抽象化
let previewGain = null;
let currentPreviewPitch = -1;

const scheduledNoteIds = new Set(); 
let activeNodes =[]; 

let scheduledNodes = [];
let previewState = { pitch: -1, color: null, isPlaying: false };

let refSource = null;
let refGain = null;

let pulse25Wave = null;
let pulse12Wave = null;
let noiseBuffer = null;

export function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        masterGain = audioCtx.createGain();
        masterGain.connect(audioCtx.destination);
        updateMasterVolume();

        pulse25Wave = createPulseWave(0.25);
        pulse12Wave = createPulseWave(0.125);
        noiseBuffer = createNoiseBuffer();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

function createPulseWave(duty) {
    const terms = 30; 
    const real = new Float32Array(terms + 1);
    const imag = new Float32Array(terms + 1);
    
    real[0] = duty;
    for (let i = 1; i <= terms; i++) {
        real[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * duty);
        imag[i] = 0; 
    }
    return audioCtx.createPeriodicWave(real, imag, { disableNormalization: false });
}

function createNoiseBuffer() {
    if (!audioCtx) return null;
    const bufferSize = audioCtx.sampleRate * 2; // 2 seconds
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1; // ホワイトノイズ
    }
    return buffer;
}

export function updateMasterVolume() {
    if (masterGain && audioCtx) {
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

    if (previewSource && currentPreviewPitch === pitch) return;
    stopPreview(true);

    currentPreviewPitch = pitch;
    previewState = { pitch: pitch, color: track.color, isPlaying: true };
    
    const trackTranspose = track.transpose || 0;
    const actualPitch = Math.max(0, Math.min(127, pitch + STATE.globalTranspose + trackTranspose));
    
    previewGain = audioCtx.createGain();

    if (track.waveform === 'noise' && noiseBuffer) {
        previewSource = audioCtx.createBufferSource();
        previewSource.buffer = noiseBuffer;
        previewSource.loop = true;
        // C4(60)を基準とし、ピッチに応じて再生速度を変える（レトロゲーム風）
        previewSource.playbackRate.value = Math.pow(2, (actualPitch - 60) / 12);
    } else {
        previewSource = audioCtx.createOscillator();
        if (track.waveform === 'pulse25' && pulse25Wave) {
            previewSource.setPeriodicWave(pulse25Wave);
        } else if (track.waveform === 'pulse12' && pulse12Wave) {
            previewSource.setPeriodicWave(pulse12Wave);
        } else {
            previewSource.type = track.waveform;
        }
        previewSource.frequency.value = pitchToFreq(actualPitch);
    }

    const t = audioCtx.currentTime;
    const trackVol = track.volume !== undefined ? track.volume : 1.0;
    const maxVolume = 0.3 * trackVol;

    previewGain.gain.setValueAtTime(0, t);
    previewGain.gain.linearRampToValueAtTime(maxVolume, t + track.attack);
    const sustainLevel = maxVolume * track.sustain;
    previewGain.gain.setTargetAtTime(sustainLevel, t + track.attack, track.decay);

    previewSource.connect(previewGain);
    previewGain.connect(masterGain);
    previewSource.start();
}

export function stopPreview(immediate = false) {
    previewState.isPlaying = false;
    
    if (!previewSource || !previewGain || !audioCtx) return;

    const t = audioCtx.currentTime;
    previewGain.gain.cancelScheduledValues(t);
    previewGain.gain.setValueAtTime(previewGain.gain.value, t);

    if (immediate) {
        previewGain.gain.linearRampToValueAtTime(0, t + 0.01);
        previewSource.stop(t + 0.01);
    } else {
        const track = STATE.tracks.find(t => t.id === STATE.activeTrackId);
        const releaseTime = track ? track.release : 0.1;
        previewGain.gain.exponentialRampToValueAtTime(0.0001, t + releaseTime);
        previewSource.stop(t + releaseTime);
    }

    previewSource = null;
    previewGain = null;
    currentPreviewPitch = -1;
}

export function startScheduler() {
    scheduledNoteIds.clear();
    scheduledNodes = [];
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
            node.source.stop(t + 0.02);
        } catch (e) {}
    });
    
    activeNodes =[];
    scheduledNoteIds.clear();
    scheduledNodes = [];
}

export function scheduleNotes(currentTick, lookaheadTime, secondsPerTick) {
    if (!audioCtx) return;
    
    const lookaheadTicks = lookaheadTime / secondsPerTick;
    const endTick = currentTick + lookaheadTicks;
    
    STATE.tracks.forEach(track => {
        if (!isTrackAudible(track)) return;
        
        let notesToPlay = track.notes;
        if (track.linkedTo !== null) {
            const srcTrack = STATE.tracks.find(t => t.id === track.linkedTo);
            if (srcTrack) notesToPlay = srcTrack.notes;
        }
        
        notesToPlay.forEach(note => {
            const compoundId = `${track.id}_${note.id}`;
            
            if (note.tick >= currentTick && note.tick < endTick && !note.muted && !scheduledNoteIds.has(compoundId)) {
                let timeOffset = (note.tick - currentTick) * secondsPerTick;
                let startTime = audioCtx.currentTime + timeOffset;
                
                // 音飛び対策: 計算上の時間が過去にずれていた場合、現在時刻にクランプする
                if (startTime < audioCtx.currentTime) {
                    startTime = audioCtx.currentTime;
                }
                
                const durationTime = note.duration * secondsPerTick;
                
                scheduleSingleNote(note, track, startTime, durationTime);
                scheduledNoteIds.add(compoundId);
            }
        });
    });
}

function scheduleSingleNote(note, track, startTime, durationTime) {
    let sourceNode;
    const gain = audioCtx.createGain();
    
    const trackTranspose = track.transpose || 0;
    const actualPitch = Math.max(0, Math.min(127, note.pitch + STATE.globalTranspose + trackTranspose));
    
    if (track.waveform === 'noise' && noiseBuffer) {
        sourceNode = audioCtx.createBufferSource();
        sourceNode.buffer = noiseBuffer;
        sourceNode.loop = true;
        sourceNode.playbackRate.value = Math.pow(2, (actualPitch - 60) / 12);
    } else {
        sourceNode = audioCtx.createOscillator();
        if (track.waveform === 'pulse25' && pulse25Wave) {
            sourceNode.setPeriodicWave(pulse25Wave);
        } else if (track.waveform === 'pulse12' && pulse12Wave) {
            sourceNode.setPeriodicWave(pulse12Wave);
        } else {
            sourceNode.type = track.waveform;
        }
        sourceNode.frequency.value = pitchToFreq(actualPitch);
    }
    
    const trackVol = track.volume !== undefined ? track.volume : 1.0;
    const maxVolume = 0.3 * trackVol;
    
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(maxVolume, startTime + track.attack);
    const sustainLevel = maxVolume * Math.max(0.01, track.sustain);
    gain.gain.setTargetAtTime(sustainLevel, startTime + track.attack, track.decay);
    
    const releaseStartTime = startTime + durationTime;
    gain.gain.setValueAtTime(sustainLevel, releaseStartTime); 
    gain.gain.exponentialRampToValueAtTime(0.0001, releaseStartTime + track.release);
    
    sourceNode.connect(gain);
    gain.connect(masterGain); 
    
    sourceNode.start(startTime);
    sourceNode.stop(releaseStartTime + track.release);
    
    const nodeObj = { source: sourceNode, gain };
    activeNodes.push(nodeObj);
    
    const nodeInfo = {
        pitch: note.pitch, 
        color: track.color,
        startTime: startTime,
        endTime: releaseStartTime + track.release
    };
    scheduledNodes.push(nodeInfo);
    
    sourceNode.onended = () => {
        activeNodes = activeNodes.filter(n => n !== nodeObj);
        scheduledNodes = scheduledNodes.filter(n => n !== nodeInfo);
    };
}

export function getActiveNotes() {
    if (!audioCtx) return [];
    const t = audioCtx.currentTime;
    const active = [];
    
    scheduledNodes.forEach(node => {
        if (t >= node.startTime && t <= node.endTime) {
            active.push({ pitch: node.pitch, color: node.color });
        }
    });

    if (previewState.isPlaying && previewState.pitch !== -1) {
        active.push({ pitch: previewState.pitch, color: previewState.color });
    }

    return active;
}
