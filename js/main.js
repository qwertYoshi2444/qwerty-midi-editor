import { STATE, clearSelection, addTrack, TRACK_COLORS_PALETTE, loadParsedMIDI } from './state.js';
import { initRenderer, renderAll } from './renderer.js';
import { initEvents } from './events.js';
import { updateReferenceVolume, loadReferenceAudio, updateMasterVolume } from './audio-engine.js';
import { exportToMIDI, parseMIDI } from './midi-io.js';

let editingTrackId = null; 
let editingColorTrackId = null;
let pendingMidiData = null; 

// アイコンSVG定義 (フェーズ1)
const ICON_FOLDER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;margin-right:4px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
const ICON_SETTINGS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;

document.addEventListener('DOMContentLoaded', () => {
    const gridCvs = document.getElementById('grid-canvas');
    const keyCvs = document.getElementById('keyboard-canvas');
    const timeCvs = document.getElementById('timeline-canvas');

    initRenderer(gridCvs, keyCvs, timeCvs);
    initEvents(gridCvs);

    window.addEventListener('resize', resizeCanvas);
    document.getElementById('track-panel-container').addEventListener('transitionend', resizeCanvas);
    
    resizeCanvas();
    setupToolbar();
    setupRefTrackPanel(); 
    setupTrackPanel();
    setupSynthModal();
    setupColorPickerModal();
    setupMidiLoadModal(); 
    setTool('draw');
});

function resizeCanvas() {
    const rollArea = document.getElementById('roll-area');
    const rect = rollArea.getBoundingClientRect();
    
    const gridCvs = document.getElementById('grid-canvas');
    const keyCvs = document.getElementById('keyboard-canvas');
    const timeCvs = document.getElementById('timeline-canvas');

    const w = rect.width - 80;
    const h = rect.height - 30; 

    gridCvs.width = w; 
    gridCvs.height = h;
    keyCvs.width = 80; 
    keyCvs.height = h;
    timeCvs.width = w; 
    timeCvs.height = 30;

    renderAll();
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

    const menuLoad = document.getElementById('menu-load-midi');
    const menuExport = document.getElementById('menu-export-midi');
    const hiddenInput = document.getElementById('hidden-midi-input');
    
    if (menuLoad && hiddenInput) {
        menuLoad.addEventListener('click', (e) => {
            e.preventDefault();
            hiddenInput.click();
        });
    }

    if (menuExport) {
        menuExport.addEventListener('click', (e) => {
            e.preventDefault();
            exportToMIDI();
        });
    }

    if (hiddenInput) {
        hiddenInput.addEventListener('change', async (e) => {
            if (e.target.files.length === 0) return;
            const file = e.target.files[0];
            try {
                const arrayBuffer = await file.arrayBuffer();
                pendingMidiData = parseMIDI(arrayBuffer);
                document.getElementById('midi-info-text').textContent = `Loaded: ${file.name} (${pendingMidiData.tracks.length} tracks)`;
                document.getElementById('midi-load-modal').classList.add('show');
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
    fileLabel.innerHTML = `${ICON_FOLDER} Audio`; // アイコン化
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

function setupTrackPanel() {
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
        nameDiv.textContent = track.name;
        nameDiv.title = "Double-click to rename";
        nameDiv.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            const newName = prompt("Enter new track name:", track.name);
            if (newName && newName.trim() !== '') {
                track.name = newName.trim();
                nameDiv.textContent = track.name;
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
        synthBtn.innerHTML = ICON_SETTINGS; // アイコン化
        synthBtn.title = 'Synth Settings';
        synthBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openSynthModal(track.id);
        });

        controlsDiv.appendChild(muteBtn);
        controlsDiv.appendChild(soloBtn);
        controlsDiv.appendChild(synthBtn);

        const topRow = document.createElement('div');
        topRow.className = 'track-item-top';
        topRow.appendChild(colorDiv);
        topRow.appendChild(nameDiv);
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
            }
        });

        trackList.appendChild(itemDiv);
    });

    const addBtn = document.createElement('div');
    addBtn.id = 'btn-add-track';
    addBtn.textContent = '+ Add Track';
    addBtn.addEventListener('click', () => {
        addTrack();
        setupTrackPanel();
    });
    trackList.appendChild(addBtn);
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
        editingTrackId = null;
    });
}

function openSynthModal(trackId) {
    const track = STATE.tracks.find(t => t.id === trackId);
    if (!track) return;
    
    editingTrackId = trackId;
    
    document.getElementById('modal-track-name').textContent = `${track.name} Settings`;
    document.getElementById('synth-waveform').value = track.waveform;
    document.getElementById('synth-transpose').value = track.transpose || 0; // 追加
    
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
                if (track) {
                    track.color = colorObj.fill;
                    track.borderColor = colorObj.border;
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
        
        loadParsedMIDI(pendingMidiData, trackMode === 'append', bpmMode === 'use_midi');
        
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
    else if (toolName === 'delete') gridCvs.style.cursor = 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'16\' height=\'16\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'red\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'><line x1=\'18\' y1=\'6\' x2=\'6\' y2=\'18\'></line><line x1=\'6\' y1=\'6\' x2=\'18\' y2=\'18\'></line></svg>") 8 8, auto';
}