--- START OF FILE text/javascript ---

import { STATE } from './state.js';

// --- 座標・値の変換 ---
export function tickToX(tick) { 
    return (tick - STATE.scrollTick) * STATE.zoomX; 
}

export function xToTick(x) { 
    return (x / STATE.zoomX) + STATE.scrollTick; 
}

export function pitchToY(pitch) { 
    return (STATE.scrollPitch - pitch) * STATE.zoomY; 
}

export function getPitchAtY(y) {
    for (let p = 127; p >= 0; p--) {
        const top = pitchToY(p);
        const bottom = top + STATE.zoomY;
        if (y >= top && y < bottom) return p;
    }
    return -1;
}

export function snapTick(tick, bypassSnap = false) {
    if (bypassSnap || STATE.snap === 0) return tick;
    return Math.round(tick / STATE.snap) * STATE.snap;
}

// --- 音楽情報 ---
const noteNames =["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export function getNoteName(pitch) { 
    return noteNames[pitch % 12] + (Math.floor(pitch / 12) + 0); 
}

export function isBlackKey(pitch) { 
    return [1, 3, 6, 8, 10].includes(pitch % 12); 
}

// --- ヒットテスト（当たり判定） ---
export function getNoteAt(x, y) {
    const tick = xToTick(x);
    const pitch = getPitchAtY(y);
    // 上に描画される（後に追加された）ノートを優先
    for (let i = STATE.notes.length - 1; i >= 0; i--) {
        const note = STATE.notes[i];
        if (note.pitch === pitch && tick >= note.tick && tick <= note.tick + note.duration) {
            return note;
        }
    }
    return null;
}

// --- 選択範囲のバウンディングボックス取得 ---
export function getSelectionBoundingBox() {
    const selected = STATE.notes.filter(n => n.selected);
    if (selected.length === 0) return null;
    
    let minTick = Infinity;
    let maxTick = -Infinity;
    let minPitch = Infinity;
    let maxPitch = -Infinity;
    
    selected.forEach(n => {
        if (n.tick < minTick) minTick = n.tick;
        if (n.tick + n.duration > maxTick) maxTick = n.tick + n.duration;
        if (n.pitch < minPitch) minPitch = n.pitch;
        if (n.pitch > maxPitch) maxPitch = n.pitch;
    });
    
    return { minTick, maxTick, minPitch, maxPitch };
}