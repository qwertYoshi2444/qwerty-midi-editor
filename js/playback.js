import { STATE } from './state.js';
import { renderAll, startLerpAnimation } from './renderer.js';
import { audioCtx, initAudio, startScheduler, stopAllSounds, scheduleNotes, playReferenceAudio, stopReferenceAudio } from './audio-engine.js';

let animationId = null;

let playbackStartTime = 0;
let playbackStartTick = 0;

const ICON_PLAY = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
const ICON_STOP = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h12v12H6z"/></svg>`;

export function togglePlayback() {
    STATE.isPlaying = !STATE.isPlaying;
    
    const btnPlay = document.getElementById('btn-play');
    
    if (STATE.isPlaying) {
        initAudio();
        
        btnPlay.classList.add('playing');
        btnPlay.innerHTML = `${ICON_STOP} <span id="label-play">Stop</span>`;
        
        startScheduler(); 
        playReferenceAudio(STATE.playheadTick);
        
        playbackStartTime = audioCtx.currentTime;
        playbackStartTick = STATE.playheadTick;
        
        animationId = requestAnimationFrame(playbackLoop);
        
    } else {
        btnPlay.classList.remove('playing');
        btnPlay.innerHTML = `${ICON_PLAY} <span id="label-play">Play</span>`;
        
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
        
        stopAllSounds(); 
        stopReferenceAudio();
    }
    
    const canvasGrid = document.getElementById('grid-canvas');
    if (canvasGrid) canvasGrid.focus();
}

export function syncPlaybackTime() {
    if (audioCtx && STATE.isPlaying) {
        playbackStartTime = audioCtx.currentTime;
        playbackStartTick = STATE.playheadTick;
    }
}

export function rewindToStart() {
    STATE.playheadTick = 0;
    
    if (STATE.isPlaying) {
        playbackStartTick = 0;
        if (audioCtx) playbackStartTime = audioCtx.currentTime;
        
        stopAllSounds();
        stopReferenceAudio();
        startScheduler();
        playReferenceAudio(STATE.playheadTick);
    }
    
    STATE.targetScrollTick = 0;
    startLerpAnimation();
    renderAll();
}

function playbackLoop(currentTime) {
    if (!STATE.isPlaying) return;
    if (!audioCtx) return;

    const ticksPerSecond = (STATE.bpm * STATE.ppq) / 60;
    const secondsPerTick = 60 / (STATE.bpm * STATE.ppq);
    
    const elapsedTime = audioCtx.currentTime - playbackStartTime;
    let nextTick = playbackStartTick + (elapsedTime * ticksPerSecond);

    // ループ再生ロジック
    if (STATE.loopActive && nextTick >= STATE.loopEnd) {
        const overrun = nextTick - STATE.loopEnd;
        STATE.playheadTick = STATE.loopStart + overrun;
        
        playbackStartTick = STATE.playheadTick;
        playbackStartTime = audioCtx.currentTime;

        // 一旦すべての発音とスケジュールをクリアし、ループ先頭からシームレスに再予約
        stopAllSounds();
        stopReferenceAudio();
        startScheduler();
        playReferenceAudio(STATE.playheadTick);
    } else {
        STATE.playheadTick = nextTick;
    }

    const lookaheadTime = 0.1; 
    scheduleNotes(STATE.playheadTick, lookaheadTime, secondsPerTick);

    if (STATE.autoScroll) {
        const canvasGrid = document.getElementById('grid-canvas');
        if (canvasGrid) {
            const visibleTicks = canvasGrid.width / STATE.targetZoomX;
            const scrollThresholdOffset = visibleTicks * 0.8; 
            const scrollThresholdTick = STATE.targetScrollTick + scrollThresholdOffset;

            if (STATE.playheadTick > scrollThresholdTick) {
                STATE.targetScrollTick = STATE.playheadTick - scrollThresholdOffset;
                startLerpAnimation();
            }
            
            if (STATE.playheadTick < STATE.targetScrollTick) {
                STATE.targetScrollTick = STATE.playheadTick;
                startLerpAnimation();
            }
        }
    }

    renderAll();
    animationId = requestAnimationFrame(playbackLoop);
}

export function stopPlayback() {
    if (STATE.isPlaying) {
        togglePlayback();
    }
}