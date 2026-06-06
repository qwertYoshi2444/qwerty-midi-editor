import { STATE, clearSelection, deleteNote, saveHistory } from './state.js';
import { getNoteAt, xToTick, getPitchAtY, snapTick, tickToX, pitchToY, getSelectionBoundingBox } from './utils.js';
import { playPreview } from './audio-engine.js';

const isMobile = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;

export const editState = {
    action: null,
    targetNote: null,
    startMouseTick: 0,
    startMousePitch: 0,
    originalNotesData:[],
    processedNoteIds: new Set(),
    lastPreviewPitch: -1,
    hasChanged: false,
    previouslySelected: [] 
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
        
        if (editState.previouslySelected.includes(note)) {
            note.selected = true; 
        } else {
            note.selected = isIntersecting;
        }
    });
}

// --- Draw Tool (P) ---
export const DrawTool = {
    onMouseDown: (e, mouseX, mouseY) => {
        const rawTick = xToTick(mouseX);
        const pitch = getPitchAtY(mouseY);
        if (pitch === -1) return;

        let clickedNote = getNoteAt(mouseX, mouseY);
        editState.hasChanged = false;

        if (e.ctrlKey && e.button === 0) {
            editState.action = 'select';
            STATE.selectionBox.active = true;
            STATE.selectionBox.startX = mouseX;
            STATE.selectionBox.startY = mouseY;
            STATE.selectionBox.currentX = mouseX;
            STATE.selectionBox.currentY = mouseY;
            
            editState.previouslySelected = STATE.notes.filter(n => n.selected);
            if (!e.shiftKey && !e.ctrlKey) clearSelection(); 
            return;
        }

        if (e.button === 0) {
            let isResizeHit = false;
            let targetResizeNote = null;

            // 1. まずリサイズ領域の判定を最優先で行う
            if (clickedNote) {
                const wasSelectedBeforeClick = clickedNote.selected;
                let canResize = true;
                if (isMobile && !wasSelectedBeforeClick) {
                    canResize = false;
                }
                const edgeHitPixels = isMobile ? 32 : 16;
                const edgeHitTicks = edgeHitPixels / STATE.zoomX; 
                const noteEndTick = clickedNote.tick + clickedNote.duration;
                
                if (canResize && rawTick >= noteEndTick - edgeHitTicks && rawTick <= noteEndTick + edgeHitTicks) {
                    isResizeHit = true;
                    targetResizeNote = clickedNote;
                }
            }

            // 2. バウンディングボックス内かどうかの判定 (リサイズ領域でない場合のみ有効とする)
            const bbox = getSelectionBoundingBox();
            let isInsideBBox = false;
            if (bbox && !isResizeHit) {
                const isInsideTick = rawTick >= bbox.minTick && rawTick <= bbox.maxTick;
                const isInsidePitch = pitch >= bbox.minPitch && pitch <= bbox.maxPitch;
                if (isInsideTick && isInsidePitch) {
                    isInsideBBox = true;
                }
            }

            // 3. アクションの決定と実行
            if (isResizeHit) {
                if (!targetResizeNote.muted) {
                    playPreview(targetResizeNote.pitch, STATE.activeTrackId);
                    editState.lastPreviewPitch = targetResizeNote.pitch;
                }
                
                if (!targetResizeNote.selected && !e.shiftKey) {
                    clearSelection();
                    targetResizeNote.selected = true;
                }
                
                editState.action = 'resize';
                editState.targetNote = targetResizeNote;
                editState.startMouseTick = rawTick;
                editState.startMousePitch = pitch;
                editState.originalNotesData = STATE.notes.filter(n => n.selected).map(n => ({
                    note: n, originalTick: n.tick, originalPitch: n.pitch, originalDuration: n.duration
                }));
                return;
            }

            if (isInsideBBox) {
                editState.action = 'move';
                editState.targetNote = STATE.notes.find(n => n.selected); 
                editState.startMouseTick = rawTick;
                editState.startMousePitch = pitch;
                
                editState.originalNotesData = STATE.notes.filter(n => n.selected).map(n => ({
                    note: n, originalTick: n.tick, originalPitch: n.pitch, originalDuration: n.duration
                }));

                if (clickedNote && !clickedNote.muted) {
                    playPreview(clickedNote.pitch, STATE.activeTrackId);
                    editState.lastPreviewPitch = clickedNote.pitch;
                } else {
                    playPreview(pitch, STATE.activeTrackId);
                    editState.lastPreviewPitch = pitch;
                }
                return;
            }

            if (clickedNote) {
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
                    editState.hasChanged = true;
                }

                if (!clickedNote.selected && !e.shiftKey) {
                    clearSelection();
                    clickedNote.selected = true;
                }

                editState.action = 'move';
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
                editState.hasChanged = true;
            }
        } 
        else if (e.button === 2) {
            editState.action = 'delete';
            if (clickedNote) {
                deleteNote(clickedNote);
                editState.hasChanged = true;
            }
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
                if (item.note.duration !== newDuration) editState.hasChanged = true;
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
                
                const boundedTick = Math.max(0, newTick);
                const boundedPitch = Math.min(127, Math.max(0, newPitch));
                
                if (item.note.tick !== boundedTick || item.note.pitch !== boundedPitch) {
                    editState.hasChanged = true;
                }

                item.note.tick = boundedTick;
                item.note.pitch = boundedPitch;
                
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
             
             if (editState.targetNote.tick !== Math.max(0, snappedTick) || editState.targetNote.pitch !== boundedPitch) {
                 editState.hasChanged = true;
             }

             editState.targetNote.tick = Math.max(0, snappedTick);
             editState.targetNote.pitch = boundedPitch;

             if (boundedPitch !== editState.lastPreviewPitch) {
                 playPreview(boundedPitch, STATE.activeTrackId);
                 editState.lastPreviewPitch = boundedPitch;
             }

        } else if (editState.action === 'delete') {
            const hoveredNote = getNoteAt(mouseX, mouseY);
            if (hoveredNote) {
                deleteNote(hoveredNote);
                editState.hasChanged = true;
            }
        }
    },

    onMouseUp: () => {
        if (editState.action === 'select') {
            STATE.selectionBox.active = false;
        } else {
            if ((editState.action === 'resize' || editState.action === 'create') && editState.targetNote) {
                STATE.lastDuration = editState.targetNote.duration;
            }
            if (editState.hasChanged) {
                let msg = "Edit Notes";
                if (editState.action === 'create') msg = "Add Note";
                if (editState.action === 'delete') msg = "Delete Note";
                if (editState.action === 'resize') msg = "Resize Note";
                if (editState.action === 'move') msg = "Move Note";
                saveHistory(msg);
            }
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
            
            if (e.ctrlKey || e.shiftKey) {
                editState.previouslySelected = STATE.notes.filter(n => n.selected);
            } else {
                editState.previouslySelected = [];
                clearSelection();
            }
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
            editState.hasChanged = false;
            toggleMuteAt(mouseX, mouseY);
        }
    },
    onMouseMove: (e, mouseX, mouseY) => {
        if (editState.action === 'mute') toggleMuteAt(mouseX, mouseY);
    },
    onMouseUp: () => {
        if (editState.hasChanged) saveHistory("Mute Notes");
        resetEditState();
    }
};

function toggleMuteAt(x, y) {
    const note = getNoteAt(x, y);
    if (note && !editState.processedNoteIds.has(note.id)) {
        note.muted = !note.muted;
        editState.processedNoteIds.add(note.id);
        editState.hasChanged = true;
    }
}

export const DeleteTool = {
    onMouseDown: (e, mouseX, mouseY) => {
        if (e.button === 0) {
            editState.action = 'delete';
            editState.hasChanged = false;
            deleteAt(mouseX, mouseY);
        }
    },
    onMouseMove: (e, mouseX, mouseY) => {
        if (editState.action === 'delete') deleteAt(mouseX, mouseY);
    },
    onMouseUp: () => {
        if (editState.hasChanged) saveHistory("Delete Notes");
        resetEditState();
    }
};

function deleteAt(x, y) {
    const note = getNoteAt(x, y);
    if (note) {
        deleteNote(note); 
        editState.hasChanged = true;
    }
}

export function resetEditState() {
    editState.action = null;
    editState.targetNote = null;
    editState.originalNotesData = [];
    editState.processedNoteIds.clear();
    editState.lastPreviewPitch = -1; 
    editState.hasChanged = false;
    editState.previouslySelected = [];
}