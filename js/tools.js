import { STATE, clearSelection, deleteNote } from './state.js';
import { getNoteAt, xToTick, getPitchAtY, snapTick, tickToX, pitchToY } from './utils.js';
import { playPreview } from './audio-engine.js';

// モバイル（タッチ対応端末）かどうかの判定
const isMobile = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;

export const editState = {
    action: null,
    targetNote: null,
    startMouseTick: 0,
    startMousePitch: 0,
    originalNotesData:[],
    processedNoteIds: new Set(),
    lastPreviewPitch: -1 
};

function updateSelectionBox() {
    const box = STATE.selectionBox;
    const minX = Math.min(box.startX, box.currentX);
    const maxX = Math.max(box.startX, box.currentX);
    const minY = Math.min(box.startY, box.currentY);
    const maxY = Math.max(box.startY, box.currentY);

    STATE.notes.forEach(note => {
        const nx = tickToX(note.tick);
        const ny = pitchToY(note.pitch);
        const nw = note.duration * STATE.zoomX;
        const nh = STATE.zoomY;
        
        const isIntersecting = nx < maxX && (nx + nw) > minX && ny < maxY && (ny + nh) > minY;
        note.selected = isIntersecting;
    });
}

// --- Draw Tool (P) ---
export const DrawTool = {
    onMouseDown: (e, mouseX, mouseY) => {
        const rawTick = xToTick(mouseX);
        const pitch = getPitchAtY(mouseY);
        if (pitch === -1) return;

        let clickedNote = getNoteAt(mouseX, mouseY);

        if (e.ctrlKey && e.button === 0) {
            editState.action = 'select';
            STATE.selectionBox.active = true;
            STATE.selectionBox.startX = mouseX;
            STATE.selectionBox.startY = mouseY;
            STATE.selectionBox.currentX = mouseX;
            STATE.selectionBox.currentY = mouseY;
            if (!e.shiftKey) clearSelection();
            return;
        }

        if (e.button === 0) {
            if (clickedNote) {
                // クリックする前の選択状態を保存しておく
                const wasSelectedBeforeClick = clickedNote.selected;

                if (!clickedNote.muted) {
                    playPreview(clickedNote.pitch, STATE.activeTrackId);
                    editState.lastPreviewPitch = clickedNote.pitch;
                }

                if (e.shiftKey) {
                    let notesToCopy = STATE.notes.filter(n => n.selected);
                    if (!clickedNote.selected) {
                        notesToCopy = [clickedNote];
                    }
                    const clones = notesToCopy.map(n => ({
                        ...n,
                        id: STATE.nextNoteId++,
                        selected: true
                    }));
                    STATE.notes.forEach(n => n.selected = false);
                    STATE.notes.push(...clones);
                    clickedNote = clones.find(c => c.pitch === clickedNote.pitch && c.tick === clickedNote.tick);
                }

                if (!clickedNote.selected && !e.shiftKey) {
                    clearSelection();
                    clickedNote.selected = true;
                }

                const edgeHitTicks = 16 / STATE.zoomX; 
                const noteEndTick = clickedNote.tick + clickedNote.duration;
                
                // モバイルの場合は「元から選択されていたノート」でないとリサイズ不可
                let canResize = true;
                if (isMobile && !wasSelectedBeforeClick) {
                    canResize = false;
                }

                if (canResize && rawTick >= noteEndTick - edgeHitTicks && rawTick <= noteEndTick + (6 / STATE.zoomX)) {
                    editState.action = 'resize';
                } else {
                    editState.action = 'move';
                }

                editState.targetNote = clickedNote;
                editState.startMouseTick = rawTick;
                editState.startMousePitch = pitch;
                
                editState.originalNotesData = STATE.notes.filter(n => n.selected).map(n => ({
                    note: n, originalTick: n.tick, originalPitch: n.pitch, originalDuration: n.duration
                }));
            } else {
                playPreview(pitch, STATE.activeTrackId);
                editState.lastPreviewPitch = pitch;

                clearSelection();
                editState.action = 'create';
                const snappedTick = snapTick(rawTick, e.altKey);
                const newNote = { 
                    id: STATE.nextNoteId++, pitch: pitch, tick: snappedTick, 
                    duration: STATE.lastDuration, selected: true, muted: false 
                };
                STATE.notes.push(newNote);
                editState.targetNote = newNote;
            }
        } 
        else if (e.button === 2) {
            editState.action = 'delete';
            if (clickedNote) deleteNote(clickedNote);
        }
    },

    onMouseMove: (e, mouseX, mouseY, rawTick, pitch) => {
        if (editState.action === 'select') {
            STATE.selectionBox.currentX = mouseX;
            STATE.selectionBox.currentY = mouseY;
            updateSelectionBox();
            return;
        }

        if (editState.action === 'resize') {
            const newRightEdge = snapTick(rawTick, e.altKey);
            const targetOriginalData = editState.originalNotesData.find(i => i.note === editState.targetNote);
            if (!targetOriginalData) return;
            const originalRightEdge = targetOriginalData.originalTick + targetOriginalData.originalDuration;
            const deltaTick = newRightEdge - originalRightEdge;
            editState.originalNotesData.forEach(item => {
                let newDuration = item.originalDuration + deltaTick;
                if (newDuration < 1) newDuration = 1; 
                item.note.duration = newDuration;
            });
            
        } else if (editState.action === 'move') {
            const tickDiff = rawTick - editState.startMouseTick;
            const pitchDiff = pitch - editState.startMousePitch;

            const targetOriginalData = editState.originalNotesData.find(i => i.note === editState.targetNote);
            if (!targetOriginalData) return;

            const snappedTargetTick = snapTick(targetOriginalData.originalTick + tickDiff, e.altKey);
            const actualTickDiff = snappedTargetTick - targetOriginalData.originalTick;

            let targetNewPitch = -1; 

            editState.originalNotesData.forEach(item => {
                let newTick = item.originalTick + actualTickDiff;
                let newPitch = item.originalPitch + pitchDiff;
                item.note.tick = Math.max(0, newTick);
                item.note.pitch = Math.min(127, Math.max(0, newPitch));
                
                if (item.note === editState.targetNote) {
                    targetNewPitch = item.note.pitch;
                }
            });

            if (targetNewPitch !== -1 && targetNewPitch !== editState.lastPreviewPitch && !editState.targetNote.muted) {
                playPreview(targetNewPitch, STATE.activeTrackId);
                editState.lastPreviewPitch = targetNewPitch;
            }

        } else if (editState.action === 'create' && editState.targetNote) {
             const snappedTick = snapTick(rawTick, e.altKey);
             const boundedPitch = Math.min(127, Math.max(0, pitch));
             
             editState.targetNote.tick = Math.max(0, snappedTick);
             editState.targetNote.pitch = boundedPitch;

             if (boundedPitch !== editState.lastPreviewPitch) {
                 playPreview(boundedPitch, STATE.activeTrackId);
                 editState.lastPreviewPitch = boundedPitch;
             }

        } else if (editState.action === 'delete') {
            const hoveredNote = getNoteAt(mouseX, mouseY);
            if (hoveredNote) deleteNote(hoveredNote);
        }
    },

    onMouseUp: () => {
        if (editState.action === 'select') {
            STATE.selectionBox.active = false;
        } else if ((editState.action === 'resize' || editState.action === 'create') && editState.targetNote) {
            STATE.lastDuration = editState.targetNote.duration;
        }
        resetEditState();
    }
};

export const SelectTool = {
    onMouseDown: (e, mouseX, mouseY) => {
        if (e.button === 0) {
            editState.action = 'select';
            STATE.selectionBox.active = true;
            STATE.selectionBox.startX = mouseX; STATE.selectionBox.startY = mouseY;
            STATE.selectionBox.currentX = mouseX; STATE.selectionBox.currentY = mouseY;
            if (!e.shiftKey) clearSelection();
        }
    },
    onMouseMove: (e, mouseX, mouseY) => {
        if (editState.action === 'select') {
            STATE.selectionBox.currentX = mouseX;
            STATE.selectionBox.currentY = mouseY;
            updateSelectionBox();
        }
    },
    onMouseUp: () => {
        STATE.selectionBox.active = false;
        resetEditState();
    }
};

export const MuteTool = {
    onMouseDown: (e, mouseX, mouseY) => {
        if (e.button === 0) {
            editState.action = 'mute';
            editState.processedNoteIds.clear();
            toggleMuteAt(mouseX, mouseY);
        }
    },
    onMouseMove: (e, mouseX, mouseY) => {
        if (editState.action === 'mute') toggleMuteAt(mouseX, mouseY);
    },
    onMouseUp: () => resetEditState()
};

function toggleMuteAt(x, y) {
    const note = getNoteAt(x, y);
    if (note && !editState.processedNoteIds.has(note.id)) {
        note.muted = !note.muted;
        editState.processedNoteIds.add(note.id);
    }
}

export const DeleteTool = {
    onMouseDown: (e, mouseX, mouseY) => {
        if (e.button === 0) {
            editState.action = 'delete';
            deleteAt(mouseX, mouseY);
        }
    },
    onMouseMove: (e, mouseX, mouseY) => {
        if (editState.action === 'delete') deleteAt(mouseX, mouseY);
    },
    onMouseUp: () => resetEditState()
};

function deleteAt(x, y) {
    const note = getNoteAt(x, y);
    if (note) deleteNote(note); 
}

export function resetEditState() {
    editState.action = null;
    editState.targetNote = null;
    editState.originalNotesData = [];
    editState.processedNoteIds.clear();
    editState.lastPreviewPitch = -1; // リセット
}