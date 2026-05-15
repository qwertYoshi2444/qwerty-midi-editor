import { STATE } from './state.js';
import { tickToX, xToTick, pitchToY, isBlackKey, getNoteName } from './utils.js';
import { getActiveNotes } from './audio-engine.js'; // 追加: ハイライト用情報の取得

let ctxGrid, ctxKeyboard, ctxTimeline;
let canvasGrid, canvasKeyboard, canvasTimeline;
let animationFrameId = null;
let animationFrameIdLerp = null;

export function initRenderer(gridCvs, keyCvs, timeCvs) {
    canvasGrid = gridCvs;
    canvasKeyboard = keyCvs; 
    canvasTimeline = timeCvs;
    ctxGrid = canvasGrid.getContext('2d');
    if (canvasKeyboard) ctxKeyboard = canvasKeyboard.getContext('2d');
    ctxTimeline = canvasTimeline.getContext('2d');
}

export function renderAll() {
    if (!ctxGrid || !ctxTimeline) return;

    renderGrid();
    renderGhostNotes();
    renderNotes();
    renderDyingNotes();
    
    if (STATE.selectionBox.active) {
        renderSelectionRect();
    }
    
    renderPlayheadGrid(); 
    
    if (canvasKeyboard) renderKeyboard(); 
    renderTimeline();
}

export function startFadeOutAnimation() {
    if (!animationFrameId) animateFadeOut();
}

function animateFadeOut() {
    let stillAnimating = false;
    STATE.dyingNotes.forEach(note => {
        note.opacity -= 0.05;
        if (note.opacity > 0) stillAnimating = true;
    });
    STATE.dyingNotes = STATE.dyingNotes.filter(note => note.opacity > 0);
    renderAll();
    if (stillAnimating) {
        animationFrameId = requestAnimationFrame(animateFadeOut);
    } else {
        animationFrameId = null;
    }
}

export function startLerpAnimation() {
    if (!animationFrameIdLerp) animateLerp();
}

function animateLerp() {
    let needsUpdate = false;
    const lerpFactor = 0.2; 

    if (Math.abs(STATE.targetZoomX - STATE.zoomX) > 0.001) {
        STATE.zoomX += (STATE.targetZoomX - STATE.zoomX) * lerpFactor;
        needsUpdate = true;
    } else {
        STATE.zoomX = STATE.targetZoomX;
    }

    if (Math.abs(STATE.targetZoomY - STATE.zoomY) > 0.01) {
        STATE.zoomY += (STATE.targetZoomY - STATE.zoomY) * lerpFactor;
        needsUpdate = true;
    } else {
        STATE.zoomY = STATE.targetZoomY;
    }

    if (Math.abs(STATE.targetScrollTick - STATE.scrollTick) > 0.1) {
        STATE.scrollTick += (STATE.targetScrollTick - STATE.scrollTick) * lerpFactor;
        needsUpdate = true;
    } else {
        STATE.scrollTick = STATE.targetScrollTick;
    }

    if (Math.abs(STATE.targetScrollPitch - STATE.scrollPitch) > 0.01) {
        STATE.scrollPitch += (STATE.targetScrollPitch - STATE.scrollPitch) * lerpFactor;
        needsUpdate = true;
    } else {
        STATE.scrollPitch = STATE.targetScrollPitch;
    }

    if (needsUpdate) {
        renderAll();
        animationFrameIdLerp = requestAnimationFrame(animateLerp);
    } else {
        animationFrameIdLerp = null;
    }
}

function renderGrid() {
    const w = canvasGrid.width, h = canvasGrid.height;
    ctxGrid.clearRect(0, 0, w, h);
    const topPitch = STATE.scrollPitch + 1;
    const bottomPitch = STATE.scrollPitch - (h / STATE.zoomY) - 1;

    for (let pitch = Math.floor(topPitch); pitch >= Math.floor(bottomPitch); pitch--) {
        if (pitch < 0 || pitch > 127) continue;
        const y = pitchToY(pitch);
        ctxGrid.fillStyle = isBlackKey(pitch) ? '#1a1c1d' : '#222527';
        ctxGrid.fillRect(0, y, w, STATE.zoomY);
        
        ctxGrid.strokeStyle = '#111'; 
        ctxGrid.lineWidth = 1;
        ctxGrid.beginPath(); 
        ctxGrid.moveTo(0, y + STATE.zoomY); 
        ctxGrid.lineTo(w, y + STATE.zoomY); 
        ctxGrid.stroke();
    }

    const snapTickVal = STATE.ppq / 4; 
    let currentTick = Math.floor(STATE.scrollTick / snapTickVal) * snapTickVal;
    
    while (currentTick <= xToTick(w)) {
        const x = tickToX(currentTick);
        if (x >= 0 && x <= w) { 
            ctxGrid.beginPath();
            if (currentTick % (STATE.ppq * 4) === 0) {
                ctxGrid.strokeStyle = '#666';
                ctxGrid.lineWidth = 2;
            } else if (currentTick % STATE.ppq === 0) {
                ctxGrid.strokeStyle = '#3a3a3a';
                ctxGrid.lineWidth = 1;
            } else {
                ctxGrid.strokeStyle = '#2a2a2a';
                ctxGrid.lineWidth = 1;
            }
            ctxGrid.moveTo(x, 0); 
            ctxGrid.lineTo(x, h); 
            ctxGrid.stroke();
        }
        currentTick += snapTickVal;
    }
}

function renderGhostNotes() {
    const heightPadding = 2;
    STATE.tracks.filter(t => t.id !== STATE.activeTrackId).forEach(track => {
        if (track.linkedTo !== null) return;
        
        track.notes.forEach(note => {
            const x = tickToX(note.tick);
            const y = pitchToY(note.pitch);
            const w = note.duration * STATE.zoomX;
            const h = STATE.zoomY;
            if (x + w < 0 || x > canvasGrid.width || y + h < 0 || y > canvasGrid.height) return;

            ctxGrid.fillStyle = note.muted ? 'rgba(85, 85, 85, 0.3)' : 'rgba(150, 150, 150, 0.4)';
            ctxGrid.strokeStyle = 'rgba(50, 50, 50, 0.5)';
            ctxGrid.lineWidth = 1;
            
            ctxGrid.beginPath();
            if (ctxGrid.roundRect) ctxGrid.roundRect(x, y + heightPadding, w, h - heightPadding * 2, 2);
            else ctxGrid.rect(x, y + heightPadding, w, h - heightPadding * 2);
            ctxGrid.fill(); 
            ctxGrid.stroke();
        });
    });
}

function renderNotes() {
    const heightPadding = 2;
    const activeTrack = STATE.tracks.find(t => t.id === STATE.activeTrackId);
    if (!activeTrack) return;
    
    const isLinked = activeTrack.linkedTo !== null;
    
    STATE.notes.forEach(note => {
        const x = tickToX(note.tick);
        const y = pitchToY(note.pitch);
        const w = note.duration * STATE.zoomX;
        const h = STATE.zoomY;
        if (x + w < 0 || x > canvasGrid.width || y + h < 0 || y > canvasGrid.height) return;

        let fillColor = activeTrack.color;
        let strokeColor = activeTrack.borderColor;
        
        if (isLinked) {
            fillColor = note.muted ? '#666666' : '#999999';
            strokeColor = '#555555';
        } else {
            if (note.muted) {
                fillColor = '#555555'; strokeColor = '#333333';
            } else if (note.selected) {
                fillColor = '#ff3333'; strokeColor = '#cc0000';
            }
        }

        ctxGrid.fillStyle = fillColor; 
        ctxGrid.strokeStyle = strokeColor; 
        ctxGrid.lineWidth = 1;
        
        ctxGrid.beginPath();
        if (ctxGrid.roundRect) ctxGrid.roundRect(x, y + heightPadding, w, h - heightPadding * 2, 3);
        else ctxGrid.rect(x, y + heightPadding, w, h - heightPadding * 2);
        ctxGrid.fill(); 
        ctxGrid.stroke();
        
        ctxGrid.fillStyle = note.muted ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.3)'; 
        ctxGrid.fillRect(x + 2, y + heightPadding + 1, w - 4, 2);
        ctxGrid.fillStyle = note.muted ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.3)'; 
        ctxGrid.fillRect(x + 2, y + heightPadding + (h/2) - 1, w - 4, 2);

        if (isLinked && w > 10) {
            ctxGrid.strokeStyle = 'rgba(0, 0, 0, 0.3)';
            ctxGrid.beginPath();
            ctxGrid.moveTo(x + 3, y + h - heightPadding - 2);
            ctxGrid.lineTo(x + w - 3, y + heightPadding + 2);
            ctxGrid.stroke();
        }

        if (w > 25 && h > 10 && !note.muted) {
            ctxGrid.fillStyle = isLinked ? 'rgba(0, 0, 0, 0.6)' : 'rgba(255, 255, 255, 0.8)';
            const fontSize = Math.min(11, h - 4); 
            ctxGrid.font = `${fontSize}px sans-serif`;
            ctxGrid.fillText(getNoteName(note.pitch), x + 4, y + (h / 2) + (fontSize / 3));
        }
    });
}

function renderDyingNotes() {
    const heightPadding = 2;
    STATE.dyingNotes.forEach(note => {
        const x = tickToX(note.tick);
        const y = pitchToY(note.pitch);
        const w = note.duration * STATE.zoomX;
        const h = STATE.zoomY;
        if (x + w < 0 || x > canvasGrid.width || y + h < 0 || y > canvasGrid.height) return;

        ctxGrid.globalAlpha = note.opacity;
        ctxGrid.strokeStyle = note.color;
        ctxGrid.lineWidth = 2; 
        
        ctxGrid.beginPath();
        if (ctxGrid.roundRect) ctxGrid.roundRect(x, y + heightPadding, w, h - heightPadding * 2, 3);
        else ctxGrid.rect(x, y + heightPadding, w, h - heightPadding * 2);
        ctxGrid.stroke();
        ctxGrid.globalAlpha = 1.0; 
    });
}

function renderSelectionRect() {
    if (!STATE.selectionBox.active) return;
    const box = STATE.selectionBox;
    const minX = Math.min(box.startX, box.currentX);
    const minY = Math.min(box.startY, box.currentY);
    const w = Math.abs(box.currentX - box.startX);
    const h = Math.abs(box.currentY - box.startY);

    ctxGrid.fillStyle = 'rgba(255, 255, 255, 0.1)'; 
    ctxGrid.fillRect(minX, minY, w, h);
    ctxGrid.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctxGrid.lineWidth = 1;
    ctxGrid.strokeRect(minX, minY, w, h);
}

function renderPlayheadGrid() {
    const x = tickToX(STATE.playheadTick);
    if (x >= -5 && x <= canvasGrid.width + 5) {
        ctxGrid.beginPath();
        ctxGrid.strokeStyle = '#33ff33';
        ctxGrid.lineWidth = 2.0;
        ctxGrid.moveTo(x, 0);
        ctxGrid.lineTo(x, canvasGrid.height);
        ctxGrid.stroke();
        
        ctxGrid.beginPath();
        ctxGrid.strokeStyle = 'rgba(51, 255, 51, 0.15)';
        ctxGrid.lineWidth = 6.0;
        ctxGrid.moveTo(x, 0);
        ctxGrid.lineTo(x, canvasGrid.height);
        ctxGrid.stroke();
    }
}

function renderKeyboard() {
    const w = canvasKeyboard.width, h = canvasKeyboard.height;
    ctxKeyboard.clearRect(0, 0, w, h);
    const topPitch = STATE.scrollPitch + 1;
    const bottomPitch = STATE.scrollPitch - (h / STATE.zoomY) - 1;

    // 現在発音中のノートを取得（重複するピッチには最後に見つかった色を適用）
    const activeNotes = getActiveNotes();
    const playingPitches = {};
    activeNotes.forEach(note => {
        playingPitches[note.pitch] = note.color;
    });

    for (let pitch = Math.floor(topPitch); pitch >= Math.floor(bottomPitch); pitch--) {
        if (pitch < 0 || pitch > 127) continue;
        const y = pitchToY(pitch);
        
        ctxKeyboard.fillStyle = isBlackKey(pitch) ? '#1e1e1e' : '#e0e0e0';
        ctxKeyboard.fillRect(0, y, w, STATE.zoomY);

        // 発音中のハイライト描画
        if (playingPitches[pitch]) {
            ctxKeyboard.fillStyle = playingPitches[pitch];
            ctxKeyboard.globalAlpha = 0.5; // 半透明で重ねる
            ctxKeyboard.fillRect(0, y, w, STATE.zoomY);
            ctxKeyboard.globalAlpha = 1.0;
        }
        
        ctxKeyboard.strokeStyle = '#000'; 
        ctxKeyboard.strokeRect(0, y, w, STATE.zoomY);
        
        if (pitch % 12 === 0) {
            ctxKeyboard.fillStyle = '#333'; 
            ctxKeyboard.font = '10px sans-serif';
            ctxKeyboard.fillText(getNoteName(pitch), w - 25, y + STATE.zoomY - 5);
        }
    }
}

function renderTimeline() {
    const w = canvasTimeline.width, h = canvasTimeline.height;
    ctxTimeline.clearRect(0, 0, w, h);
    ctxTimeline.fillStyle = '#3b4043';
    ctxTimeline.fillRect(0, 0, w, h);

    let currentTick = Math.floor(STATE.scrollTick / (STATE.ppq * 4)) * (STATE.ppq * 4);
    ctxTimeline.fillStyle = '#d0d0d0'; 
    ctxTimeline.font = '11px sans-serif';
    
    while (currentTick <= xToTick(w)) {
        const x = tickToX(currentTick);
        if (x >= 0 && x <= w) {
            ctxTimeline.fillText((currentTick / (STATE.ppq * 4)) + 1, x + 5, 20);
            ctxTimeline.beginPath(); 
            ctxTimeline.strokeStyle = '#666'; 
            ctxTimeline.moveTo(x, h - 5); 
            ctxTimeline.lineTo(x, h); 
            ctxTimeline.stroke();
        }
        currentTick += (STATE.ppq * 4);
    }

    const phX = tickToX(STATE.playheadTick);
    if (phX >= -10 && phX <= w + 10) {
        ctxTimeline.fillStyle = '#33ff33'; 
        ctxTimeline.beginPath();
        ctxTimeline.moveTo(phX - 6, 0);
        ctxTimeline.lineTo(phX + 6, 0);
        ctxTimeline.lineTo(phX, 12);
        ctxTimeline.fill();
        
        ctxTimeline.beginPath();
        ctxTimeline.strokeStyle = '#33ff33';
        ctxTimeline.lineWidth = 2.0;
        ctxTimeline.moveTo(phX, 12);
        ctxTimeline.lineTo(phX, h);
        ctxTimeline.stroke();
    }
}