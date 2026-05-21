import { STATE, clearSelection, addTrack, duplicateTrack, createLinkedTrack, deleteTrack, TRACK_COLORS_PALETTE, loadParsedMIDI, getMaxTick, initHistory, performUndo, performRedo, saveHistory, getSelectedNotes, deleteSelectedNotes } from './state.js';
import { initRenderer, renderAll, startLerpAnimation } from './renderer.js';
import { initEvents, shiftPitch } from './events.js';
import { updateReferenceVolume, loadReferenceAudio, updateMasterVolume } from './audio-engine.js';
import { exportToMIDI, parseMIDI } from './midi-io.js';
import { copyNotes, cutNotes, pasteNotes } from './clipboard.js';

let editingTrackId = null; 
let editingColorTrackId = null;
let pendingMidiData = null; 

let initialSynthSettings = null; 
const isMobile = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;

const ICON_FOLDER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;margin-right:4px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
const ICON_SETTINGS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;
const ICON_MENU = `<svg viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px;"><circle cx="12" cy="5" r="2"></circle><circle cx="12" cy="12" r="2"></circle><circle cx="12" cy="19" r="2"></circle></svg>`;
const ICON_DRAG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><line x1="4" y1="9" x2="20" y2="9"></line><line x1="4" y1="15" x2="20" y2="15"></line></svg>`;

document.addEventListener('DOMContentLoaded', () => {
    initHistory();

    const gridCvs = document.getElementById('grid-canvas');
    const keyCvs = document.getElementById('keyboard-canvas');
    const timeCvs = document.getElementById('timeline-canvas');

    initRenderer(gridCvs, keyCvs, timeCvs);
    initEvents(gridCvs);

    window.addEventListener('resize', resizeCanvas);
    document.getElementById('track-panel-container').addEventListener('transitionend', resizeCanvas);
    
    document.addEventListener('click', (e) => {
        const menu = document.getElementById('track-context-menu');
        if (menu.classList.contains('show') && !e.target.closest('.tc-btn.menu-btn')) {
            menu.classList.remove('show');
        }
    });

    const resizer = document.getElementById('panel-resizer');
    const panelContainer = document.getElementById('track-panel-container');
    let isResizing = false;

    const startResize = (e) => {
        isResizing = true;
        panelContainer.classList.add('no-transition'); 
        document.body.style.cursor = 'col-resize';
        e.preventDefault();
    };
    const doResize = (clientX) => {
        if (!isResizing) return;
        let newWidth = clientX;
        if (newWidth < 150) newWidth = 150;
        if (newWidth > 500) newWidth = 500;
        panelContainer.style.width = `${newWidth}px`;
        resizeCanvas();
    };
    const stopResize = () => {
        if (isResizing) {
            isResizing = false;
            panelContainer.classList.remove('no-transition'); 
            document.body.style.cursor = 'default';
        }
    };

    resizer.addEventListener('mousedown', startResize);
    resizer.addEventListener('touchstart', (e) => startResize(e.touches[0]), {passive: false});
    
    window.addEventListener('mousemove', (e) => doResize(e.clientX));
    window.addEventListener('touchmove', (e) => { if(isResizing) doResize(e.touches[0].clientX); }, {passive: true});
    
    window.addEventListener('mouseup', stopResize);
    window.addEventListener('touchend', stopResize);

    resizeCanvas();
    setupToolbar();
    setupScrollbars(); 
    setupRefTrackPanel(); 
    setupTrackPanel();
    setupSynthModal();
    setupColorPickerModal();
    setupMidiLoadModal(); 
    setupMobilePanel(); 
    setTool('draw');
});

export function updateMobilePanel() {
    const panel = document.getElementById('mobile-edit-panel');
    if (!panel) return;
    
    if (isMobile && getSelectedNotes().length > 0) {
        panel.classList.add('show');
    } else {
        panel.classList.remove('show');
    }
}

function setupMobilePanel() {
    const panel = document.getElementById('mobile-edit-panel');
    
    // イベント伝播防止（キャンバスの誤操作防止）
    if (panel) {
        ['touchstart', 'touchmove', 'touchend', 'mousedown', 'mousemove', 'mouseup', 'click'].forEach(evt => {
            panel.addEventListener(evt, e => e.stopPropagation(), { passive: false });
        });
    }

    const btnCopy = document.getElementById('mbtn-copy');
    const btnCut = document.getElementById('mbtn-cut');
    const btnPaste = document.getElementById('mbtn-paste');
    const btnDelete = document.getElementById('mbtn-delete');
    
    const btnUp12 = document.getElementById('mbtn-up12');
    const btnDown12 = document.getElementById('mbtn-down12');
    const btnUp1 = document.getElementById('mbtn-up1');
    const btnDown1 = document.getElementById('mbtn-down1');

    if (btnCopy) btnCopy.addEventListener('click', () => { copyNotes(); showToast("Copied"); });
    if (btnCut) btnCut.addEventListener('click', () => { cutNotes(); renderAll(); updateMobilePanel(); showToast("Cut"); });
    if (btnPaste) btnPaste.addEventListener('click', () => { pasteNotes(); renderAll(); updateMobilePanel(); showToast("Pasted"); });
    if (btnDelete) btnDelete.addEventListener('click', () => {
        deleteSelectedNotes();
        saveHistory("Delete Selected");
        renderAll();
        updateMobilePanel();
    });

    if (btnUp12) btnUp12.addEventListener('click', () => shiftPitch(12));
    if (btnDown12) btnDown12.addEventListener('click', () => shiftPitch(-12));
    if (btnUp1) btnUp1.addEventListener('click', () => shiftPitch(1));
    if (btnDown1) btnDown1.addEventListener('click', () => shiftPitch(-1));
}

export function showToast(message) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    toast.style.color = '#fff';
    toast.style.padding = '8px 16px';
    toast.style.borderRadius = '4px';
    toast.style.fontSize = '12px';
    toast.style.boxShadow = '0 2px 10px rgba(0,0,0,0.5)';
    toast.style.opacity = '1';
    toast.style.transition = 'opacity 0.5s ease-in-out';
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 500);
    }, 2000);
}

function resizeCanvas() {
    const rollArea = document.getElementById('roll-area');
    const rect = rollArea.getBoundingClientRect();
    
    const gridCvs = document.getElementById('grid-canvas');
    const keyCvs = document.getElementById('keyboard-canvas');
    const timeCvs = document.getElementById('timeline-canvas');

    const w = rect.width - 80 - 14; 
    const h = rect.height - 30 - 12; 

    gridCvs.width = Math.max(0, w); 
    gridCvs.height = Math.max(0, h);
    keyCvs.width = 80; 
    keyCvs.height = Math.max(0, h);
    timeCvs.width = Math.max(0, w); 
    timeCvs.height = 30;

    // 縦スクロールバーの高さをコンテナに合わせる（CSSで90度回転しているためwidthに設定）
    const scrollV = document.getElementById('scroll-v');
    const vContainer = document.getElementById('v-scroll-container');
    if (scrollV && vContainer) {
        scrollV.style.width = `${vContainer.clientHeight - 8}px`;
    }

    renderAll();
}

function setupScrollbars() {
    const scrollH = document.getElementById('scroll-h');
    const scrollV = document.getElementById('scroll-v');
    let isDraggingH = false;
    let isDraggingV = false;

    const startH = () => isDraggingH = true;
    scrollH.addEventListener('mousedown', startH);
    scrollH.addEventListener('touchstart', startH, {passive: true});
    scrollH.addEventListener('input', (e) => {
        STATE.targetScrollTick = parseFloat(e.target.value);
        startLerpAnimation();
    });

    const startV = () => isDraggingV = true;
    scrollV.addEventListener('mousedown', startV);
    scrollV.addEventListener('touchstart', startV, {passive: true});
    scrollV.addEventListener('input', (e) => {
        STATE.targetScrollPitch = parseFloat(e.target.value);
        startLerpAnimation();
    });

    window.addEventListener('mouseup', () => { isDraggingH = false; isDraggingV = false; });
    window.addEventListener('touchend', () => { isDraggingH = false; isDraggingV = false; });

    function syncScrollbars() {
        if (!isDraggingH) {
            const canvasGrid = document.getElementById('grid-canvas');
            const visibleTicks = canvasGrid ? canvasGrid.width / Math.max(0.1, STATE.zoomX) : 0;
            const contentMax = Math.max(1000, getMaxTick() + visibleTicks);
            
            if (parseFloat(scrollH.max) < contentMax) {
                scrollH.max = contentMax + 500;
            } else if (parseFloat(scrollH.max) > contentMax + 3000) {
                scrollH.max = contentMax + 1000;
            }
            scrollH.value = STATE.scrollTick;
        }

        if (!isDraggingV) {
            scrollV.value = STATE.scrollPitch;
        }
        
        requestAnimationFrame(syncScrollbars);
    }
    requestAnimationFrame(syncScrollbars);
}

function setupToolbar() {
    const btnTogglePanel = document.getElementById('btn-toggle-panel');
    const panelContainer = document.getElementById('track-panel-container');
    btnTogglePanel.addEventListener('click', () => {
        panelContainer.classList.toggle('closed');
    });

    document.getElementById('snap-select').addEventListener('change', e => {
        STATE.snap = parseInt(e.target.value, 10);
    });

    const bpmInput = document.getElementById('bpm-input');
    bpmInput.addEventListener('change', e => {
        let val = parseInt(e.target.value, 10);
        if (isNaN(val) || val < 20) val = 20;
        if (val > 300) val = 300;
        e.target.value = val;
        STATE.bpm = val;
    });
    
    const transposeInput = document.getElementById('transpose-input');
    if (transposeInput) {
        transposeInput.addEventListener('change', e => {
            let val = parseInt(e.target.value, 10);
            if (isNaN(val)) val = 0;
            if (val < -24) val = -24;
            if (val > 24) val = 24;
            e.target.value = val;
            STATE.globalTranspose = val;
        });
    }

    const masterVolSlider = document.getElementById('master-vol-slider');
    if (masterVolSlider) {
        masterVolSlider.addEventListener('input', e => {
            let val = parseInt(e.target.value, 10);
            if (val >= 95 && val <= 105) { val = 100; e.target.value = val; }
            STATE.masterVolume = val / 100;
            updateMasterVolume();
            masterVolSlider.title = `Master Volume: ${val}%`;
        });
        masterVolSlider.title = `Master Volume: 100%`;
    }

    const tools =['draw', 'select', 'mute', 'delete'];
    tools.forEach(tool => {
        const btn = document.getElementById(`btn-${tool}`);
        btn.addEventListener('click', () => setTool(tool));
    });

    const btnUndo = document.getElementById('btn-undo');
    const btnRedo = document.getElementById('btn-redo');
    
    if (btnUndo) {
        btnUndo.addEventListener('click', () => {
            const msg = performUndo();
            if (msg) showToast(msg);
            setupTrackPanel(); 
            renderAll();
            updateMobilePanel();
        });
    }
    
    if (btnRedo) {
        btnRedo.addEventListener('click', () => {
            const msg = performRedo();
            if (msg) showToast(msg);
            setupTrackPanel();
            renderAll();
            updateMobilePanel();
        });
    }

    const menuLoad = document.getElementById('menu-load-midi');
    const menuExportLinks = document.getElementById('menu-export-midi-links');
    const menuExportStd = document.getElementById('menu-export-midi-standard');
    const hiddenInput = document.getElementById('hidden-midi-input');
    
    if (menuLoad && hiddenInput) {
        menuLoad.addEventListener('click', (e) => {
            e.preventDefault();
            hiddenInput.click();
        });
    }

    if (menuExportLinks) {
        menuExportLinks.addEventListener('click', (e) => {
            e.preventDefault();
            exportToMIDI(true); 
        });
    }
    
    if (menuExportStd) {
        menuExportStd.addEventListener('click', (e) => {
            e.preventDefault();
            exportToMIDI(false); 
        });
    }

    if (hiddenInput) {
        hiddenInput.addEventListener('change', async (e) => {
            if (e.target.files.length === 0) return;
            const file = e.target.files[0];
            try {
                const arrayBuffer = await file.arrayBuffer();
                pendingMidiData = parseMIDI(arrayBuffer);
                
                const validTracks = pendingMidiData.tracks.length;
                let linkedCount = 0;
                let mismatchCount = 0;
                
                pendingMidiData.tracks.forEach(t => {
                    if (t._linkStatus === 'linked') linkedCount++;
                    if (t._linkStatus === 'mismatch') mismatchCount++;
                });

                const titleEl = document.getElementById('midi-info-title');
                if (titleEl) titleEl.textContent = file.name;

                const textEl = document.getElementById('midi-info-text');
                if (textEl) {
                    if (titleEl) {
                        textEl.innerHTML = `Tracks: ${validTracks} (Standard: ${validTracks - linkedCount - mismatchCount}, Linked: ${linkedCount})`;
                    } else {
                        textEl.textContent = `Loaded: ${file.name} (${validTracks} tracks)`;
                    }
                }

                const warningPanel = document.getElementById('midi-mismatch-warning');
                if (warningPanel) {
                    if (mismatchCount > 0) {
                        warningPanel.style.display = 'block';
                        const msgEl = warningPanel.querySelector('.mismatch-count-msg');
                        if (msgEl) msgEl.textContent = `${mismatchCount} track(s) have link data, but their notes do not match the source.`;
                    } else {
                        warningPanel.style.display = 'none';
                    }
                }

                const modal = document.getElementById('midi-load-modal');
                if (modal) modal.classList.add('show');
            } catch (err) {
                alert('Error parsing MIDI file: ' + err.message);
            }
            e.target.value = ''; 
        });
    }
}

function setupRefTrackPanel() {
    const container = document.getElementById('ref-track-container');
    container.innerHTML = '';

    const refDiv = document.createElement('div');
    refDiv.className = 'ref-track-item';

    const topRow = document.createElement('div');
    topRow.className = 'track-item-top';

    const fileLabel = document.createElement('label');
    fileLabel.className = 'ref-file-label';
    fileLabel.innerHTML = `${ICON_FOLDER} Audio`; 
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'audio/*';
    fileInput.style.display = 'none';

    const fileNameDiv = document.createElement('div');
    fileNameDiv.className = 'ref-file-name';
    fileNameDiv.textContent = STATE.referenceTrack.fileName;

    fileInput.addEventListener('change', async (e) => {
        if (e.target.files.length > 0) {
            const file = e.target.files[0];
            fileNameDiv.textContent = 'Loading...';
            try {
                await loadReferenceAudio(file);
                fileNameDiv.textContent = file.name;
            } catch (err) {
                fileNameDiv.textContent = 'Error';
            }
        }
    });
    fileLabel.appendChild(fileInput);

    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'track-controls';

    const muteBtn = document.createElement('button');
    muteBtn.className = `tc-btn ${STATE.referenceTrack.isMuted ? 'muted' : ''}`;
    muteBtn.textContent = 'M';
    muteBtn.title = 'Mute';
    muteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        STATE.referenceTrack.isMuted = !STATE.referenceTrack.isMuted;
        muteBtn.classList.toggle('muted', STATE.referenceTrack.isMuted);
        updateReferenceVolume(); 
    });

    const soloBtn = document.createElement('button');
    soloBtn.className = `tc-btn ${STATE.referenceTrack.isSoloed ? 'soloed' : ''}`;
    soloBtn.textContent = 'S';
    soloBtn.title = 'Solo';
    soloBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        STATE.referenceTrack.isSoloed = !STATE.referenceTrack.isSoloed;
        soloBtn.classList.toggle('soloed', STATE.referenceTrack.isSoloed);
        if (STATE.referenceTrack.isSoloed && STATE.referenceTrack.isMuted) {
            STATE.referenceTrack.isMuted = false;
            muteBtn.classList.remove('muted');
        }
        updateReferenceVolume(); 
    });

    controlsDiv.appendChild(muteBtn);
    controlsDiv.appendChild(soloBtn);

    topRow.appendChild(fileLabel);
    topRow.appendChild(fileNameDiv);
    topRow.appendChild(controlsDiv);

    const volContainer = document.createElement('div');
    volContainer.className = 'track-vol-container';
    const volLabel = document.createElement('label');
    volLabel.textContent = 'Vol';
    const volSlider = document.createElement('input');
    volSlider.type = 'range';
    volSlider.className = 'track-vol';
    volSlider.min = '0';
    volSlider.max = '150';
    volSlider.value = Math.round(STATE.referenceTrack.volume * 100);

    volSlider.addEventListener('input', (e) => {
        let val = parseInt(e.target.value, 10);
        if (val >= 95 && val <= 105) { val = 100; e.target.value = val; }
        STATE.referenceTrack.volume = val / 100;
        volSlider.title = `Volume: ${val}%`;
        updateReferenceVolume(); 
    });
    volSlider.addEventListener('mousedown', e => e.stopPropagation());
    volSlider.addEventListener('touchstart', e => e.stopPropagation(), {passive: true});

    volContainer.appendChild(volLabel);
    volContainer.appendChild(volSlider);

    refDiv.appendChild(topRow);
    refDiv.appendChild(volContainer);
    container.appendChild(refDiv);
}

let draggedTrackItem = null;
let dragGhost = null;
let dragStartY = 0;
let dragScrollInterval = null;
let longPressTimeout = null;

export function setupTrackPanel() {
    const trackList = document.getElementById('track-list');
    trackList.innerHTML = ''; 

    STATE.tracks.forEach(track => {
        const itemDiv = document.createElement('div');
        itemDiv.className = `track-item ${track.id === STATE.activeTrackId ? 'active' : ''}`;
        itemDiv.dataset.trackId = track.id;

        const colorDiv = document.createElement('div');
        colorDiv.className = 'track-color-indicator';
        colorDiv.style.backgroundColor = track.color;
        colorDiv.title = "Click to change color";
        colorDiv.addEventListener('click', (e) => {
            e.stopPropagation();
            editingColorTrackId = track.id;
            document.getElementById('color-picker-modal').classList.add('show');
        });

        const nameDiv = document.createElement('div');
        nameDiv.className = 'track-name';
        
        let transposeBadge = '';
        if (track.transpose) {
            const sign = track.transpose > 0 ? '+' : '';
            transposeBadge = `<span class="transpose-badge">[${sign}${track.transpose}]</span>`;
        }
        
        if (track.linkedTo !== null) {
            itemDiv.classList.add('is-linked');
            const sourceTrack = STATE.tracks.find(t => t.id === track.linkedTo);
            const sourceName = sourceTrack ? sourceTrack.name : 'Unknown';
            nameDiv.innerHTML = `${track.name} ${transposeBadge}<br><span style="font-size: 10px; color: #88ccff; font-weight: normal;">🔗 ${sourceName}</span>`;
            nameDiv.title = "Double-click to rename (Linked Track)";
        } else {
            nameDiv.innerHTML = `${track.name} ${transposeBadge}`;
            nameDiv.title = "Double-click to rename";
        }
        
        nameDiv.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            const newName = prompt("Enter new track name:", track.name);
            if (newName && newName.trim() !== '') {
                track.name = newName.trim();
                saveHistory("Rename Track");
                setupTrackPanel();
            }
        });

        const controlsDiv = document.createElement('div');
        controlsDiv.className = 'track-controls';

        const muteBtn = document.createElement('button');
        muteBtn.className = `tc-btn ${track.isMuted ? 'muted' : ''}`;
        muteBtn.textContent = 'M';
        muteBtn.title = 'Mute';
        muteBtn.addEventListener('click', (e) => {
            e.stopPropagation(); 
            track.isMuted = !track.isMuted;
            muteBtn.classList.toggle('muted', track.isMuted);
            updateReferenceVolume(); 
            renderAll();
        });

        const soloBtn = document.createElement('button');
        soloBtn.className = `tc-btn ${track.isSoloed ? 'soloed' : ''}`;
        soloBtn.textContent = 'S';
        soloBtn.title = 'Solo';
        soloBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            track.isSoloed = !track.isSoloed;
            soloBtn.classList.toggle('soloed', track.isSoloed);
            if (track.isSoloed && track.isMuted) {
                track.isMuted = false;
                muteBtn.classList.remove('muted');
            }
            updateReferenceVolume(); 
            renderAll();
        });

        const synthBtn = document.createElement('button');
        synthBtn.className = 'tc-btn';
        synthBtn.innerHTML = ICON_SETTINGS;
        synthBtn.title = 'Synth Settings';
        synthBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openSynthModal(track.id);
        });

        const menuBtn = document.createElement('button');
        menuBtn.className = 'tc-btn menu-btn';
        menuBtn.innerHTML = ICON_MENU;
        menuBtn.title = 'Menu';
        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showTrackMenu(e, track.id);
        });

        controlsDiv.appendChild(muteBtn);
        controlsDiv.appendChild(soloBtn);
        controlsDiv.appendChild(synthBtn);
        controlsDiv.appendChild(menuBtn);

        const topRow = document.createElement('div');
        topRow.className = 'track-item-top';
        topRow.appendChild(colorDiv);
        topRow.appendChild(nameDiv);
        topRow.appendChild(controlsDiv);

        const volContainer = document.createElement('div');
        volContainer.className = 'track-vol-container';
        
        const dragHandle = document.createElement('div');
        dragHandle.className = 'track-drag-handle';
        dragHandle.innerHTML = ICON_DRAG;
        dragHandle.title = "Drag to reorder (Long press on mobile)";
        
        const startDrag = (e, clientY) => {
            e.preventDefault();
            e.stopPropagation();
            if (draggedTrackItem) return;

            draggedTrackItem = itemDiv;
            dragStartY = clientY;
            
            dragGhost = itemDiv.cloneNode(true);
            dragGhost.classList.add('dragging');
            dragGhost.style.position = 'absolute';
            dragGhost.style.width = `${itemDiv.offsetWidth}px`;
            
            const listRect = trackList.getBoundingClientRect();
            const itemRect = itemDiv.getBoundingClientRect();
            dragGhost.style.top = `${itemRect.top - listRect.top + trackList.scrollTop}px`;
            dragGhost.style.left = `0px`;
            
            trackList.appendChild(dragGhost);
            itemDiv.style.opacity = '0.3';
            document.body.style.cursor = 'grabbing';
            
            startDragScrollLoop();
        };

        dragHandle.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            startDrag(e, e.clientY);
        });

        dragHandle.addEventListener('touchstart', (e) => {
            const touchY = e.touches[0].clientY;
            longPressTimeout = setTimeout(() => {
                startDrag(e, touchY);
            }, 400); 
        }, { passive: false });

        dragHandle.addEventListener('touchend', () => {
            if (longPressTimeout) clearTimeout(longPressTimeout);
        });
        dragHandle.addEventListener('touchmove', () => {
            if (longPressTimeout) clearTimeout(longPressTimeout);
        }, { passive: true });

        const volLabel = document.createElement('label');
        volLabel.textContent = 'Vol';
        const volSlider = document.createElement('input');
        volSlider.type = 'range';
        volSlider.className = 'track-vol';
        volSlider.min = '0';
        volSlider.max = '150';
        volSlider.value = Math.round((track.volume !== undefined ? track.volume : 1.0) * 100);
        volSlider.title = `Volume: ${volSlider.value}%`;
        
        volSlider.addEventListener('input', (e) => {
            let val = parseInt(e.target.value, 10);
            if (val >= 95 && val <= 105) {
                val = 100;
                e.target.value = val;
            }
            track.volume = val / 100;
            volSlider.title = `Volume: ${val}%`;
        });
        volSlider.addEventListener('mousedown', e => e.stopPropagation());
        volSlider.addEventListener('touchstart', e => e.stopPropagation(), {passive: true});

        volContainer.appendChild(dragHandle); 
        volContainer.appendChild(volLabel);
        volContainer.appendChild(volSlider);

        itemDiv.appendChild(topRow);
        itemDiv.appendChild(volContainer);

        itemDiv.addEventListener('click', () => {
            if (STATE.activeTrackId !== track.id) {
                clearSelection();
                STATE.activeTrackId = track.id;
                document.querySelectorAll('.track-item').forEach(el => el.classList.remove('active'));
                itemDiv.classList.add('active');
                renderAll();
                updateMobilePanel();
            }
        });

        trackList.appendChild(itemDiv);
    });

    const addBtn = document.createElement('div');
    addBtn.id = 'btn-add-track';
    addBtn.textContent = '+ Add Track';
    addBtn.addEventListener('click', () => {
        addTrack();
        saveHistory("Add Track");
        setupTrackPanel();
    });
    trackList.appendChild(addBtn);
}

function handleDragMove(clientY) {
    if (!dragGhost || !draggedTrackItem) return;

    const trackList = document.getElementById('track-list');
    const listRect = trackList.getBoundingClientRect();
    
    let newTop = clientY - listRect.top + trackList.scrollTop - (dragGhost.offsetHeight / 2);
    dragGhost.style.top = `${newTop}px`;

    const items = Array.from(trackList.querySelectorAll('.track-item:not(.dragging)'));
    const mouseY = clientY - listRect.top + trackList.scrollTop;

    let targetItem = null;
    for (let item of items) {
        const itemTop = item.offsetTop;
        const itemBottom = itemTop + item.offsetHeight;
        if (mouseY > itemTop && mouseY < itemBottom) {
            targetItem = item;
            break;
        }
    }

    if (targetItem && targetItem !== draggedTrackItem) {
        const itemTop = targetItem.offsetTop;
        const itemHeight = targetItem.offsetHeight;
        
        if (mouseY < itemTop + itemHeight / 2) {
            trackList.insertBefore(draggedTrackItem, targetItem);
        } else {
            trackList.insertBefore(draggedTrackItem, targetItem.nextSibling);
        }
    }
}

function stopDrag() {
    if (!draggedTrackItem) return;

    const trackList = document.getElementById('track-list');
    
    if (dragScrollInterval) {
        cancelAnimationFrame(dragScrollInterval);
        dragScrollInterval = null;
    }

    const newTracksArray = [];
    const items = trackList.querySelectorAll('.track-item:not(.dragging)');
    items.forEach(item => {
        const id = parseInt(item.dataset.trackId, 10);
        const trackObj = STATE.tracks.find(t => t.id === id);
        if (trackObj) newTracksArray.push(trackObj);
    });
    
    let orderChanged = false;
    for (let i = 0; i < STATE.tracks.length; i++) {
        if (STATE.tracks[i].id !== newTracksArray[i].id) {
            orderChanged = true; break;
        }
    }

    STATE.tracks = newTracksArray;

    if (orderChanged) saveHistory("Reorder Tracks");

    if (dragGhost) {
        dragGhost.remove();
        dragGhost = null;
    }
    draggedTrackItem.style.opacity = '1';
    draggedTrackItem = null;
    document.body.style.cursor = 'default';

    setupTrackPanel();
}

window.addEventListener('mousemove', e => {
    if (draggedTrackItem) handleDragMove(e.clientY);
});
window.addEventListener('touchmove', e => {
    if (draggedTrackItem) {
        handleDragMove(e.touches[0].clientY);
        e.preventDefault(); 
    }
}, { passive: false });

window.addEventListener('mouseup', stopDrag);
window.addEventListener('touchend', stopDrag);

let dragCurrentMouseY = 0;
window.addEventListener('mousemove', e => dragCurrentMouseY = e.clientY);
window.addEventListener('touchmove', e => { if(draggedTrackItem) dragCurrentMouseY = e.touches[0].clientY; }, {passive:true});

function startDragScrollLoop() {
    const trackList = document.getElementById('track-list');
    
    function loop() {
        if (!draggedTrackItem) return;
        
        const rect = trackList.getBoundingClientRect();
        const threshold = 30; 
        const scrollSpeed = 5;

        if (dragCurrentMouseY < rect.top + threshold) {
            trackList.scrollTop -= scrollSpeed;
            handleDragMove(dragCurrentMouseY); 
        } else if (dragCurrentMouseY > rect.bottom - threshold) {
            trackList.scrollTop += scrollSpeed;
            handleDragMove(dragCurrentMouseY);
        }
        
        dragScrollInterval = requestAnimationFrame(loop);
    }
    dragScrollInterval = requestAnimationFrame(loop);
}

function showTrackMenu(e, trackId) {
    const menu = document.getElementById('track-context-menu');
    const rect = e.target.getBoundingClientRect();
    
    menu.style.top = `${rect.bottom}px`;
    menu.style.left = `${rect.left - 120}px`; 
    menu.classList.add('show');

    const track = STATE.tracks.find(t => t.id === trackId);
    const linkMenuBtn = document.getElementById('ctx-menu-link');
    if (track && track.linkedTo !== null) {
        linkMenuBtn.style.display = 'none';
    } else {
        linkMenuBtn.style.display = 'block';
    }

    document.getElementById('ctx-menu-duplicate').onclick = (ev) => {
        ev.preventDefault();
        duplicateTrack(trackId);
        saveHistory("Duplicate Track");
        setupTrackPanel();
        renderAll();
        menu.classList.remove('show');
    };

    document.getElementById('ctx-menu-link').onclick = (ev) => {
        ev.preventDefault();
        createLinkedTrack(trackId);
        saveHistory("Link Track");
        setupTrackPanel();
        renderAll();
        menu.classList.remove('show');
    };

    document.getElementById('ctx-menu-delete').onclick = (ev) => {
        ev.preventDefault();
        deleteTrack(trackId);
        saveHistory("Delete Track");
        setupTrackPanel();
        renderAll();
        menu.classList.remove('show');
    };
}

const KNOB_CONFIG = {
    attack:  { min: 0.1, max: 1000, log: true },
    decay:   { min: 1,   max: 2000, log: true },
    sustain: { min: 0,   max: 100,  log: false },
    release: { min: 1,   max: 3000, log: true }
};

function valToRatio(val, min, max, isLog) {
    if (isLog) return Math.log(val / min) / Math.log(max / min);
    return (val - min) / (max - min);
}

function ratioToVal(ratio, min, max, isLog) {
    if (isLog) return min * Math.pow(max / min, ratio);
    return min + ratio * (max - min);
}

function formatKnobValue(param, val) {
    if (param === 'sustain') return Math.round(val) + '%';
    if (val >= 100) return Math.round(val) + 'ms';
    if (val >= 10) return val.toFixed(1) + 'ms';
    return val.toFixed(2) + 'ms';
}

function updateKnobVisual(param, ratio, displayValue) {
    const wrapper = document.querySelector(`.knob-wrapper[data-param="${param}"]`);
    if (!wrapper) return;
    const circleVal = wrapper.querySelector('.knob-val');
    const disp = wrapper.querySelector('.knob-value-disp');
    
    const maxOffset = 70.686;
    const offset = maxOffset - (ratio * maxOffset);
    circleVal.style.strokeDashoffset = offset;
    
    disp.textContent = formatKnobValue(param, displayValue);
}

function setupSynthModal() {
    const modal = document.getElementById('synth-modal');
    const closeBtn = document.getElementById('modal-close');
    
    document.getElementById('synth-waveform').addEventListener('change', (e) => {
        if (editingTrackId) {
            const track = STATE.tracks.find(t => t.id === editingTrackId);
            track.waveform = e.target.value;
        }
    });

    document.getElementById('synth-transpose').addEventListener('change', (e) => {
        if (editingTrackId) {
            let val = parseInt(e.target.value, 10);
            if (isNaN(val)) val = 0;
            if (val < -48) val = -48;
            if (val > 48) val = 48;
            e.target.value = val;
            const track = STATE.tracks.find(t => t.id === editingTrackId);
            track.transpose = val;
            setupTrackPanel(); 
        }
    });

    let activeKnob = null;
    let startY = 0;
    let startRatio = 0;

    const beginDrag = (param, clientY) => {
        activeKnob = param;
        startY = clientY;
        
        const track = STATE.tracks.find(t => t.id === editingTrackId);
        let currentVal = 0;
        if (param === 'attack') currentVal = track.attack * 1000;
        else if (param === 'decay') currentVal = track.decay * 1000;
        else if (param === 'sustain') currentVal = track.sustain * 100;
        else if (param === 'release') currentVal = track.release * 1000;
        
        const config = KNOB_CONFIG[param];
        startRatio = valToRatio(currentVal, config.min, config.max, config.log);
        document.body.style.cursor = 'ns-resize';
    };

    document.querySelectorAll('.knob').forEach(knob => {
        const param = knob.closest('.knob-wrapper').dataset.param;
        knob.addEventListener('mousedown', e => {
            beginDrag(param, e.clientY);
            e.preventDefault();
        });
        knob.addEventListener('touchstart', e => {
            beginDrag(param, e.touches[0].clientY);
            e.preventDefault(); 
        }, {passive: false});
    });

    const handleKnobMove = (clientY) => {
        const dy = startY - clientY; 
        let ratio = startRatio + (dy / 150);
        ratio = Math.max(0, Math.min(1, ratio));
        
        const config = KNOB_CONFIG[activeKnob];
        const val = ratioToVal(ratio, config.min, config.max, config.log);
        
        updateKnobVisual(activeKnob, ratio, val);
        
        const track = STATE.tracks.find(t => t.id === editingTrackId);
        if (activeKnob === 'attack') track.attack = val / 1000;
        else if (activeKnob === 'decay') track.decay = val / 1000;
        else if (activeKnob === 'sustain') track.sustain = val / 100;
        else if (activeKnob === 'release') track.release = val / 1000;
    };

    window.addEventListener('mousemove', e => {
        if (activeKnob) handleKnobMove(e.clientY);
    });
    
    window.addEventListener('touchmove', e => {
        if (activeKnob) {
            handleKnobMove(e.touches[0].clientY);
            e.preventDefault();
        }
    }, {passive: false});

    const endDrag = () => {
        if (activeKnob) {
            activeKnob = null;
            document.body.style.cursor = 'default';
        }
    };
    
    window.addEventListener('mouseup', endDrag);
    window.addEventListener('touchend', endDrag);

    closeBtn.addEventListener('click', () => {
        modal.classList.remove('show');
        if (editingTrackId) {
            const track = STATE.tracks.find(t => t.id === editingTrackId);
            if (JSON.stringify(initialSynthSettings) !== JSON.stringify(track)) {
                saveHistory("Edit Synth Settings");
            }
        }
        editingTrackId = null;
        initialSynthSettings = null;
    });
}

function openSynthModal(trackId) {
    const track = STATE.tracks.find(t => t.id === trackId);
    if (!track) return;
    
    editingTrackId = trackId;
    initialSynthSettings = JSON.parse(JSON.stringify(track)); 
    
    document.getElementById('modal-track-name').textContent = `${track.name} Settings`;
    document.getElementById('synth-waveform').value = track.waveform;
    document.getElementById('synth-transpose').value = track.transpose || 0; 
    
    ['attack', 'decay', 'sustain', 'release'].forEach(param => {
        let val = 0;
        if (param === 'attack') val = track.attack * 1000;
        else if (param === 'decay') val = track.decay * 1000;
        else if (param === 'sustain') val = track.sustain * 100;
        else if (param === 'release') val = track.release * 1000;
        
        const config = KNOB_CONFIG[param];
        const ratio = valToRatio(val, config.min, config.max, config.log);
        updateKnobVisual(param, Math.max(0, Math.min(1, ratio)), val);
    });
    
    document.getElementById('synth-modal').classList.add('show');
}

function setupColorPickerModal() {
    const modal = document.getElementById('color-picker-modal');
    const closeBtn = document.getElementById('color-modal-close');
    const grid = document.getElementById('color-grid');
    
    TRACK_COLORS_PALETTE.forEach(colorObj => {
        const cell = document.createElement('div');
        cell.className = 'color-cell';
        cell.style.backgroundColor = colorObj.fill;
        cell.addEventListener('click', () => {
            if (editingColorTrackId) {
                const track = STATE.tracks.find(t => t.id === editingColorTrackId);
                if (track && track.color !== colorObj.fill) {
                    track.color = colorObj.fill;
                    track.borderColor = colorObj.border;
                    saveHistory("Change Track Color");
                    setupTrackPanel(); 
                    renderAll(); 
                }
            }
            modal.classList.remove('show');
            editingColorTrackId = null;
        });
        grid.appendChild(cell);
    });

    closeBtn.addEventListener('click', () => {
        modal.classList.remove('show');
        editingColorTrackId = null;
    });
}

function setupMidiLoadModal() {
    const modal = document.getElementById('midi-load-modal');
    const btnCancel = document.getElementById('btn-midi-cancel');
    const btnConfirm = document.getElementById('btn-midi-confirm');

    btnCancel.addEventListener('click', () => {
        modal.classList.remove('show');
        pendingMidiData = null;
    });

    btnConfirm.addEventListener('click', () => {
        if (!pendingMidiData) return;
        
        const trackMode = document.getElementById('midi-load-track-mode').value;
        const bpmMode = document.getElementById('midi-load-bpm-mode').value;
        
        let mismatchAction = 'keep';
        const radioChecked = document.querySelector('input[name="mismatch-action"]:checked');
        if (radioChecked) {
            mismatchAction = radioChecked.value;
        }
        
        loadParsedMIDI(pendingMidiData, trackMode === 'append', bpmMode === 'use_midi', mismatchAction);
        
        saveHistory("Load MIDI File");
        
        setupTrackPanel();
        renderAll();
        
        modal.classList.remove('show');
        pendingMidiData = null;
    });
}

export function setTool(toolName) {
    STATE.currentTool = toolName;
    document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`btn-${toolName}`).classList.add('active');
    
    const gridCvs = document.getElementById('grid-canvas');
    if (toolName === 'draw') gridCvs.style.cursor = 'crosshair';
    else if (toolName === 'select') gridCvs.style.cursor = 'cell';
    else if (toolName === 'mute') gridCvs.style.cursor = 'not-allowed';
    else if (toolName === 'delete') gridCvs.style.cursor = 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'16\' height=\'16\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'red\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'><path d=\'M20 20H7L3 16C2.5 15.5 2.5 14.5 3 14L13 4C13.5 3.5 14.5 3.5 15 4L20 9C20.5 9.5 20.5 10.5 20 11L11 20H20V20Z\'/><line x1=\'18\' y1=\'13\' x2=\'11\' y2=\'20\'/></svg>") 8 16, auto';
}