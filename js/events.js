import { STATE, getSelectedNotes, deleteSelectedNotes, performUndo, performRedo, saveHistory } from './state.js';
import { xToTick, getPitchAtY, getNoteAt, snapTick } from './utils.js';
import { renderAll, startLerpAnimation } from './renderer.js'; 
import { DrawTool, SelectTool, MuteTool, DeleteTool, editState, resetEditState } from './tools.js';
import { copyNotes, cutNotes, pasteNotes } from './clipboard.js';
import { setTool, showToast, updateMobilePanel } from './main.js';
import { initAudio, stopPreview, playPreview, stopAllSounds, startScheduler, stopReferenceAudio, playReferenceAudio } from './audio-engine.js';
import { togglePlayback } from './playback.js';

let canvasGrid = null;
let canvasTimeline = null;
let isMiddleDragging = false;
let isTimelineDragging = false; 
let lastMouseX = 0;
let lastMouseY = 0;

// ジェスチャー管理用変数
let isPinching = false;
let lastPinchDistanceX = 0;
let lastPinchDistanceY = 0;
let lastPinchCenter = { centerX: 0, centerY: 0 };

// 1本指タッチ（マウスエミュレート）用変数
let activeTouchId = null;
let lastTouchX = 0;
let lastTouchY = 0;
let touchHoldTimer = null;
let isTouchEditing = false; // 編集操作として確定したかどうかのフラグ

function isEditingLocked() {
    const track = STATE.tracks.find(t => t.id === STATE.activeTrackId);
    return track && track.linkedTo !== null;
}

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
        
        canvasGrid.addEventListener('touchstart', onTouchStart, { passive: false });
        canvasGrid.addEventListener('touchmove', onTouchMove, { passive: false });
        canvasGrid.addEventListener('touchend', onTouchEnd, { passive: false });
        canvasGrid.addEventListener('touchcancel', onTouchEnd, { passive: false });
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
            updatePlayheadFromMouse(e.clientX);
        });
        canvasTimeline.addEventListener('touchstart', (e) => {
            isTimelineDragging = true;
            updatePlayheadFromMouse(e.touches[0].clientX);
            e.preventDefault();
        }, { passive: false });
    }

    const btnPlay = document.getElementById('btn-play');
    if (btnPlay) btnPlay.addEventListener('click', togglePlayback);
}

function updatePlayheadFromMouse(clientX) {
    if (!canvasTimeline) return;
    const rect = canvasTimeline.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const rawTick = xToTick(mouseX);
    
    STATE.playheadTick = Math.max(0, snapTick(rawTick, false));
    
    if (STATE.isPlaying) {
        stopAllSounds();
        stopReferenceAudio(); 
        startScheduler();
        playReferenceAudio(STATE.playheadTick); 
    }
    
    renderAll();
}

function getPinchInfo(touches) {
    const dx = Math.abs(touches[0].clientX - touches[1].clientX);
    const dy = Math.abs(touches[0].clientY - touches[1].clientY);
    const distX = Math.max(10, dx);
    const distY = Math.max(10, dy);
    const centerX = (touches[0].clientX + touches[1].clientX) / 2;
    const centerY = (touches[0].clientY + touches[1].clientY) / 2;
    return { distX, distY, centerX, centerY };
}

function startTouchEdit() {
    isTouchEditing = true;
    const synthEvent = { clientX: lastTouchX, clientY: lastTouchY, button: 0, ctrlKey: false, shiftKey: false, altKey: false };
    onMouseDown(synthEvent);
}

function onTouchStart(e) {
    if (touchHoldTimer) {
        clearTimeout(touchHoldTimer);
        touchHoldTimer = null;
    }

    if (e.touches.length === 2) {
        e.preventDefault(); 
        isPinching = true;
        
        // 1本指操作が始まっていたらキャンセル
        if (isTouchEditing) {
            const synthEvent = { clientX: lastTouchX, clientY: lastTouchY, button: 0, ctrlKey: false, shiftKey: false, altKey: false };
            onMouseUp(synthEvent);
        }
        
        activeTouchId = null;
        isTouchEditing = false;
        
        resetEditState();
        STATE.selectionBox.active = false;
        
        const info = getPinchInfo(e.touches);
        lastPinchDistanceX = info.distX;
        lastPinchDistanceY = info.distY;
        lastPinchCenter = info;
    } else if (e.touches.length === 1) {
        isPinching = false;
        activeTouchId = e.changedTouches[0].identifier;
        lastTouchX = e.changedTouches[0].clientX;
        lastTouchY = e.changedTouches[0].clientY;
        isTouchEditing = false;
        
        // 80msの間、2本目の指が来ないか様子を見る
        touchHoldTimer = setTimeout(() => {
            if (activeTouchId !== null && !isPinching) {
                startTouchEdit();
            }
        }, 80);
    }
}

function onTouchMove(e) {
    if (isPinching && e.touches.length === 2) {
        e.preventDefault();
        const info = getPinchInfo(e.touches);

        const deltaX = info.centerX - lastPinchCenter.centerX;
        const deltaY = info.centerY - lastPinchCenter.centerY;
        STATE.targetScrollTick = Math.max(0, STATE.targetScrollTick - deltaX / STATE.targetZoomX);
        STATE.targetScrollPitch = Math.min(127, Math.max(10, STATE.targetScrollPitch + deltaY / STATE.targetZoomY));

        const rect = canvasGrid.getBoundingClientRect();
        const canvasX = info.centerX - rect.left;
        const canvasY = info.centerY - rect.top;

        if (lastPinchDistanceX > 15 && info.distX > 15) {
            const scaleX = info.distX / lastPinchDistanceX;
            const oldZoomX = STATE.targetZoomX;
            STATE.targetZoomX = Math.max(0.05, Math.min(10, STATE.targetZoomX * scaleX));
            STATE.targetScrollTick += (canvasX / oldZoomX) - (canvasX / STATE.targetZoomX);
        }

        if (lastPinchDistanceY > 15 && info.distY > 15) {
            const scaleY = info.distY / lastPinchDistanceY;
            const oldZoomY = STATE.targetZoomY;
            STATE.targetZoomY = Math.max(5, Math.min(50, STATE.targetZoomY * scaleY));
            STATE.targetScrollPitch -= (canvasY / oldZoomY) - (canvasY / STATE.targetZoomY);
        }

        lastPinchDistanceX = info.distX;
        lastPinchDistanceY = info.distY;
        lastPinchCenter = info;

        startLerpAnimation();
    } else if (e.touches.length === 1 && activeTouchId !== null) {
        const touch = Array.from(e.changedTouches).find(t => t.identifier === activeTouchId);
        if (touch) {
            const dx = Math.abs(touch.clientX - lastTouchX);
            const dy = Math.abs(touch.clientY - lastTouchY);

            // 待機中に指が10px以上動いた場合、即座に編集操作として確定させる
            if (!isTouchEditing && (dx > 10 || dy > 10)) {
                if (touchHoldTimer) clearTimeout(touchHoldTimer);
                startTouchEdit();
            }

            if (isTouchEditing) {
                e.preventDefault(); 
                lastTouchX = touch.clientX;
                lastTouchY = touch.clientY;
                const synthEvent = { clientX: lastTouchX, clientY: lastTouchY, button: 0, ctrlKey: false, shiftKey: false, altKey: false };
                onMouseMove(synthEvent);
            }
        }
    }
}

function onTouchEnd(e) {
    if (touchHoldTimer) {
        clearTimeout(touchHoldTimer);
        touchHoldTimer = null;
    }

    if (isPinching && e.touches.length < 2) {
        isPinching = false;
    }
    
    const touch = Array.from(e.changedTouches).find(t => t.identifier === activeTouchId);
    if (touch) {
        // もし指が離れるまで待機状態だったなら、クリックとみなして処理する
        if (!isTouchEditing) {
            startTouchEdit();
        }
        
        activeTouchId = null;
        isTouchEditing = false;
        const synthEvent = { clientX: lastTouchX, clientY: lastTouchY, button: 0, ctrlKey: false, shiftKey: false, altKey: false };
        onMouseUp(synthEvent);
    }
}

function onMouseDown(e) {
    if (!canvasGrid || isPinching) return;
    const rect = canvasGrid.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
        return; 
    }

    lastMouseX = e.clientX; 
    lastMouseY = e.clientY;

    if (e.button === 1) {
        isMiddleDragging = true;
        document.body.style.cursor = 'grabbing';
        if (e.preventDefault) e.preventDefault(); 
        return;
    }

    if (isEditingLocked()) return; 

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
        updatePlayheadFromMouse(e.clientX);
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

    if (!canvasGrid || isPinching) return;
    const rect = canvasGrid.getBoundingClientRect();
    const mouseX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const mouseY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    const rawTick = xToTick(mouseX);
    const pitch = getPitchAtY(mouseY);

    if (isEditingLocked()) {
        updateCursor(mouseX, mouseY, rawTick);
        return;
    }

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

    if (e && e.button === 1) {
        isMiddleDragging = false;
        document.body.style.cursor = 'default';
        return;
    }

    if (!isEditingLocked() && !isPinching) {
        if (STATE.currentTool === 'draw') DrawTool.onMouseUp();
        else if (STATE.currentTool === 'select') SelectTool.onMouseUp();
        else if (STATE.currentTool === 'mute') MuteTool.onMouseUp();
        else if (STATE.currentTool === 'delete') DeleteTool.onMouseUp();
    }

    if (canvasGrid && !isPinching && e) {
        const rect = canvasGrid.getBoundingClientRect();
        const mouseX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const mouseY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
        updateCursor(mouseX, mouseY, xToTick(mouseX));
    }
    
    renderAll();
    updateMobilePanel(); 
}

function updateCursor(mouseX, mouseY, rawTick) {
    if (isMiddleDragging || editState.action || isTimelineDragging) return;
    if (!canvasGrid) return;
    
    if (isEditingLocked()) {
        canvasGrid.style.cursor = 'not-allowed';
        return;
    }

    if (STATE.currentTool !== 'draw') return;

    const hoveredNote = getNoteAt(mouseX, mouseY);
    if (hoveredNote) {
        const isMobile = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
        const edgeHitPixels = isMobile ? 32 : 16;
        const edgeHitTicks = edgeHitPixels / STATE.zoomX;
        const noteEndTick = hoveredNote.tick + hoveredNote.duration;
        
        if (rawTick >= noteEndTick - edgeHitTicks && rawTick <= noteEndTick + edgeHitTicks) {
            canvasGrid.style.cursor = 'ew-resize';
        } else {
            canvasGrid.style.cursor = 'move';
        }
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

    if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
            const msg = performRedo();
            if (msg) showToast(msg);
        } else {
            const msg = performUndo();
            if (msg) showToast(msg);
        }
        renderAll();
        updateMobilePanel();
        return; 
    }

    if (e.key.toLowerCase() === 'p') setTool('draw');
    if (e.key.toLowerCase() === 'e') setTool('select');
    if (e.key.toLowerCase() === 't') setTool('mute');
    if (e.key.toLowerCase() === 'd') setTool('delete');

    if (isEditingLocked()) return; 

    if (e.ctrlKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        STATE.notes.forEach(n => n.selected = true);
        renderAll();
        updateMobilePanel();
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
        const selected = getSelectedNotes();
        if (selected.length > 0) {
            deleteSelectedNotes();
            saveHistory("Delete Selected");
            renderAll();
            updateMobilePanel();
        }
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'c') { copyNotes(); showToast("Copied"); }
    if (e.ctrlKey && e.key.toLowerCase() === 'x') { cutNotes(); renderAll(); updateMobilePanel(); showToast("Cut"); }
    if (e.ctrlKey && e.key.toLowerCase() === 'v') { pasteNotes(); renderAll(); updateMobilePanel(); showToast("Pasted"); }
    
    if (e.ctrlKey && e.key === 'ArrowUp') { shiftPitch(12); e.preventDefault(); }
    if (e.ctrlKey && e.key === 'ArrowDown') { shiftPitch(-12); e.preventDefault(); }
    if (e.shiftKey && e.key === 'ArrowUp') { shiftPitch(1); e.preventDefault(); }
    if (e.shiftKey && e.key === 'ArrowDown') { shiftPitch(-1); e.preventDefault(); }
}

export function shiftPitch(amount) {
    const selected = getSelectedNotes();
    if (selected.length === 0) return;
    const activeTrack = STATE.activeTrackId;
    
    selected.forEach(n => {
        n.pitch = Math.min(127, Math.max(0, n.pitch + amount));
    });
    
    playPreview(selected[0].pitch, activeTrack);
    setTimeout(() => stopPreview(), 200);
    
    saveHistory(`Transpose (${amount > 0 ? '+' : ''}${amount})`);
    renderAll();
}