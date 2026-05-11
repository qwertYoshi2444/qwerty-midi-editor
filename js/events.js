import { STATE, getSelectedNotes, deleteSelectedNotes } from './state.js';
import { xToTick, getPitchAtY, getNoteAt, snapTick } from './utils.js';
import { renderAll, startLerpAnimation } from './renderer.js'; 
import { DrawTool, SelectTool, MuteTool, DeleteTool, editState } from './tools.js';
import { copyNotes, cutNotes, pasteNotes } from './clipboard.js';
import { setTool } from './main.js';
import { initAudio, stopPreview, playPreview, stopAllSounds, startScheduler, stopReferenceAudio, playReferenceAudio } from './audio-engine.js';
import { togglePlayback, stopPlayback } from './playback.js';

let canvasGrid = null;
let canvasTimeline = null;
let isMiddleDragging = false;
let isTimelineDragging = false; 
let lastMouseX = 0;
let lastMouseY = 0;

export function initEvents(gridCvs) {
    canvasGrid = gridCvs;
    canvasTimeline = document.getElementById('timeline-canvas');
    const keyCvs = document.getElementById('keyboard-canvas');

    document.body.addEventListener('mousedown', initAudio, { once: true });
    document.body.addEventListener('touchstart', initAudio, { once: true, passive: true });
    document.body.addEventListener('keydown', initAudio, { once: true });

    if (canvasGrid) {
        canvasGrid.addEventListener('contextmenu', e => e.preventDefault());
        canvasGrid.addEventListener('mousedown', onMouseDown);
        canvasGrid.addEventListener('wheel', onWheel, { passive: false });
    }
    
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown);

    if (keyCvs) {
        keyCvs.addEventListener('mousedown', (e) => {
            const rect = keyCvs.getBoundingClientRect();
            const mouseY = e.clientY - rect.top;
            const pitch = getPitchAtY(mouseY);
            if (pitch !== -1) playPreview(pitch, STATE.activeTrackId);
        });
    }
    
    if (canvasTimeline) {
        canvasTimeline.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return; 
            isTimelineDragging = true;
            updatePlayheadFromMouse(e);
        });
    }

    const btnPlay = document.getElementById('btn-play');
    if (btnPlay) btnPlay.addEventListener('click', togglePlayback);
}

function updatePlayheadFromMouse(e) {
    if (!canvasTimeline) return;
    const rect = canvasTimeline.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const rawTick = xToTick(mouseX);
    
    STATE.playheadTick = Math.max(0, snapTick(rawTick, e.altKey));
    
    if (STATE.isPlaying) {
        stopAllSounds();
        stopReferenceAudio(); 
        startScheduler();
        playReferenceAudio(STATE.playheadTick); 
    }
    
    renderAll();
}

function onMouseDown(e) {
    if (!canvasGrid) return;
    const rect = canvasGrid.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
        return; 
    }

    lastMouseX = e.clientX; 
    lastMouseY = e.clientY;

    if (e.button === 1) {
        isMiddleDragging = true;
        document.body.style.cursor = 'grabbing';
        e.preventDefault(); 
        return;
    }

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (STATE.currentTool === 'draw') DrawTool.onMouseDown(e, mouseX, mouseY);
    else if (STATE.currentTool === 'select') SelectTool.onMouseDown(e, mouseX, mouseY);
    else if (STATE.currentTool === 'mute') MuteTool.onMouseDown(e, mouseX, mouseY);
    else if (STATE.currentTool === 'delete') DeleteTool.onMouseDown(e, mouseX, mouseY);

    renderAll();
}

function onMouseMove(e) {
    if (isTimelineDragging) {
        updatePlayheadFromMouse(e);
        return;
    }

    if (isMiddleDragging) {
        const dx = e.clientX - lastMouseX;
        const dy = e.clientY - lastMouseY;
        STATE.targetScrollTick = Math.max(0, STATE.targetScrollTick - dx / STATE.targetZoomX);
        STATE.targetScrollPitch = Math.min(127, Math.max(10, STATE.targetScrollPitch + dy / STATE.targetZoomY));
        lastMouseX = e.clientX; 
        lastMouseY = e.clientY;
        startLerpAnimation();
        return;
    }

    if (!canvasGrid) return;
    const rect = canvasGrid.getBoundingClientRect();
    const mouseX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const mouseY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    const rawTick = xToTick(mouseX);
    const pitch = getPitchAtY(mouseY);

    if (STATE.currentTool === 'draw') DrawTool.onMouseMove(e, mouseX, mouseY, rawTick, pitch);
    else if (STATE.currentTool === 'select') SelectTool.onMouseMove(e, mouseX, mouseY);
    else if (STATE.currentTool === 'mute') MuteTool.onMouseMove(e, mouseX, mouseY);
    else if (STATE.currentTool === 'delete') DeleteTool.onMouseMove(e, mouseX, mouseY);

    updateCursor(mouseX, mouseY, rawTick);
    renderAll();
}

function onMouseUp(e) {
    stopPreview();

    if (isTimelineDragging) {
        isTimelineDragging = false;
        return;
    }

    if (e.button === 1) {
        isMiddleDragging = false;
        document.body.style.cursor = 'default';
        return;
    }

    if (STATE.currentTool === 'draw') DrawTool.onMouseUp();
    else if (STATE.currentTool === 'select') SelectTool.onMouseUp();
    else if (STATE.currentTool === 'mute') MuteTool.onMouseUp();
    else if (STATE.currentTool === 'delete') DeleteTool.onMouseUp();

    if (canvasGrid) {
        const rect = canvasGrid.getBoundingClientRect();
        const mouseX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const mouseY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
        updateCursor(mouseX, mouseY, xToTick(mouseX));
    }
    
    renderAll();
}

function updateCursor(mouseX, mouseY, rawTick) {
    if (isMiddleDragging || editState.action || isTimelineDragging) return;
    if (STATE.currentTool !== 'draw' || !canvasGrid) return;

    const hoveredNote = getNoteAt(mouseX, mouseY);
    if (hoveredNote && Math.abs(rawTick - (hoveredNote.tick + hoveredNote.duration)) <= (8 / STATE.zoomX)) {
        canvasGrid.style.cursor = 'ew-resize';
    } else if (hoveredNote) {
        canvasGrid.style.cursor = 'move';
    } else {
        canvasGrid.style.cursor = 'crosshair';
    }
}

function onWheel(e) {
    e.preventDefault();
    const mouseX = e.offsetX, mouseY = e.offsetY;
    
    const targetTick = (mouseX / STATE.targetZoomX) + STATE.targetScrollTick;
    const targetPitch = STATE.targetScrollPitch - (mouseY / STATE.targetZoomY);

    if (e.ctrlKey) {
        STATE.targetZoomX *= e.deltaY > 0 ? 0.8 : 1.25;
        if (STATE.targetZoomX < 0.05) STATE.targetZoomX = 0.05; 
        if (STATE.targetZoomX > 10) STATE.targetZoomX = 10;
        STATE.targetScrollTick = Math.max(0, targetTick - (mouseX / STATE.targetZoomX));
    } else if (e.altKey) {
        STATE.targetZoomY *= e.deltaY > 0 ? 0.9 : 1.1;
        if (STATE.targetZoomY < 5) STATE.targetZoomY = 5; 
        if (STATE.targetZoomY > 50) STATE.targetZoomY = 50;
        STATE.targetScrollPitch = Math.min(127, targetPitch + (mouseY / STATE.targetZoomY));
    } else {
        STATE.targetScrollPitch = Math.min(127, Math.max(10, STATE.targetScrollPitch + (e.deltaY > 0 ? -2 : 2)));
    }
    
    startLerpAnimation();
}

function onKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    if (e.code === 'Space') {
        e.preventDefault(); 
        togglePlayback();
        return;
    }

    if (e.key.toLowerCase() === 'p') setTool('draw');
    if (e.key.toLowerCase() === 'e') setTool('select');
    if (e.key.toLowerCase() === 't') setTool('mute');
    if (e.key.toLowerCase() === 'd') setTool('delete');

    if (e.ctrlKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        STATE.notes.forEach(n => n.selected = true);
        renderAll();
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelectedNotes();
        renderAll();
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'c') copyNotes();
    if (e.ctrlKey && e.key.toLowerCase() === 'x') { cutNotes(); renderAll(); }
    if (e.ctrlKey && e.key.toLowerCase() === 'v') { pasteNotes(); renderAll(); }
    
    // トランスポーズショートカット
    if (e.ctrlKey && e.key === 'ArrowUp') { shiftPitch(12); e.preventDefault(); }
    if (e.ctrlKey && e.key === 'ArrowDown') { shiftPitch(-12); e.preventDefault(); }
    if (e.shiftKey && e.key === 'ArrowUp') { shiftPitch(1); e.preventDefault(); }
    if (e.shiftKey && e.key === 'ArrowDown') { shiftPitch(-1); e.preventDefault(); }
}

function shiftPitch(amount) {
    const selected = getSelectedNotes();
    if (selected.length === 0) return;
    const activeTrack = STATE.activeTrackId;
    
    selected.forEach(n => {
        n.pitch = Math.min(127, Math.max(0, n.pitch + amount));
    });
    
    playPreview(selected[0].pitch, activeTrack);
    setTimeout(() => stopPreview(), 200);
    renderAll();
}