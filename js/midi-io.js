import { STATE } from './state.js';

export function exportToMIDI(embedLinkData = false) {
    const hasNotes = STATE.tracks.some(track => track.notes.length > 0 || track.linkedTo !== null);
    if (!hasNotes) {
        alert("ノートが配置されていません。");
        return;
    }

    function toVLQ(value) {
        let buffer =[value & 0x7F];
        while ((value >>= 7) > 0) {
            buffer.unshift((value & 0x7F) | 0x80);
        }
        return buffer;
    }

    function stringToBytes(str) {
        return Array.from(str).map(c => c.charCodeAt(0));
    }

    function to16Bit(value) {
        return[(value >> 8) & 0xFF, value & 0xFF];
    }

    function to32Bit(value) {
        return[(value >> 24) & 0xFF, (value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF];
    }

    const trackChunks =[];
    
    let conductorData =[];
    conductorData.push(0x00);
    const microsecondsPerBeat = Math.round(60000000 / STATE.bpm);
    conductorData.push(0xFF, 0x51, 0x03, (microsecondsPerBeat >> 16) & 0xFF, (microsecondsPerBeat >> 8) & 0xFF, microsecondsPerBeat & 0xFF);
    
    conductorData.push(0x00);
    conductorData.push(0xFF, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08);
    
    conductorData.push(0x00, 0xFF, 0x2F, 0x00);
    trackChunks.push(conductorData);

    STATE.tracks.forEach((track, trackIndex) => {
        let trackNotes = track.notes;
        if (track.linkedTo !== null) {
            const src = STATE.tracks.find(t => t.id === track.linkedTo);
            if (src) trackNotes = src.notes;
        }

        const activeNotes = trackNotes.filter(n => !n.muted);
        if (activeNotes.length === 0) return;

        let trackData =[];
        const channel = trackIndex % 16; 

        trackData.push(0x00, 0xFF, 0x03);
        
        let exportName = track.name;
        if (embedLinkData && track.linkedTo !== null) {
            exportName = `[L:${track.linkedTo},T:${track.transpose || 0}] ${track.name}`;
        }
        
        const nameBytes = stringToBytes(exportName);
        trackData.push(...toVLQ(nameBytes.length), ...nameBytes);

        let events =[];
        const trackTranspose = track.transpose || 0;
        activeNotes.forEach(note => {
            const exportPitch = Math.max(0, Math.min(127, note.pitch + STATE.globalTranspose + trackTranspose));
            events.push({ type: 'on', tick: note.tick, pitch: exportPitch, velocity: 100 });
            events.push({ type: 'off', tick: note.tick + note.duration, pitch: exportPitch, velocity: 0 });
        });

        events.sort((a, b) => {
            if (a.tick !== b.tick) return a.tick - b.tick;
            if (a.type !== b.type) return a.type === 'off' ? -1 : 1;
            return 0;
        });

        let currentTick = 0;
        events.forEach(ev => {
            const deltaTick = ev.tick - currentTick;
            currentTick = ev.tick;

            trackData.push(...toVLQ(deltaTick)); 

            if (ev.type === 'on') {
                trackData.push(0x90 + channel, ev.pitch, ev.velocity);
            } else {
                trackData.push(0x80 + channel, ev.pitch, ev.velocity);
            }
        });

        trackData.push(0x00, 0xFF, 0x2F, 0x00);
        trackChunks.push(trackData);
    });

    let midiBytes =[];

    midiBytes.push(
        0x4D, 0x54, 0x68, 0x64, 
        0x00, 0x00, 0x00, 0x06, 
        0x00, 0x01,             
        ...to16Bit(trackChunks.length), 
        ...to16Bit(STATE.ppq)   
    );

    trackChunks.forEach(data => {
        midiBytes.push(
            0x4D, 0x54, 0x72, 0x6B, 
            ...to32Bit(data.length), 
            ...data                  
        );
    });

    const buffer = new Uint8Array(midiBytes);
    const blob = new Blob([buffer], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.href = url;
    link.download = `export_${STATE.bpm}bpm.mid`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    URL.revokeObjectURL(url);
}

export function parseMIDI(arrayBuffer) {
    const data = new DataView(arrayBuffer);
    let offset = 0;

    const readString = (len) => {
        let str = '';
        for (let i = 0; i < len; i++) {
            str += String.fromCharCode(data.getUint8(offset++));
        }
        return str;
    };
    
    const read32 = () => { const v = data.getUint32(offset); offset += 4; return v; };
    const read16 = () => { const v = data.getUint16(offset); offset += 2; return v; };
    const read8 = () => { const v = data.getUint8(offset); offset += 1; return v; };
    const readVLQ = () => {
        let v = 0, b;
        do { b = read8(); v = (v << 7) + (b & 0x7f); } while (b & 0x80);
        return v;
    };

    const header = readString(4);
    if (header !== 'MThd') throw new Error("Invalid MIDI file (MThd not found)");

    const headerLen = read32();
    const format = read16(); // eslint-disable-line no-unused-vars
    const trackCount = read16();
    const originalPPQ = read16();
    offset = 14; 

    let resultBpm = 120;
    let rawTracks = [];

    for (let i = 0; i < trackCount; i++) {
        if (offset >= data.byteLength) break;

        const trackMagic = readString(4);
        if (trackMagic !== 'MTrk') {
            offset += read32(); 
            continue;
        }
        
        const trackLen = read32();
        const endOffset = offset + trackLen;

        let currentTick = 0;
        let runningStatus = 0;
        let rawTrackName = '';
        const activeNotes = {}; 
        const trackNotes =[];

        while (offset < endOffset) {
            const delta = readVLQ();
            currentTick += delta;

            let status = read8();
            if (status < 0x80) {
                status = runningStatus;
                offset--; 
            } else {
                runningStatus = status;
            }

            const type = status >> 4;

            if (type === 0x8 || (type === 0x9 && data.getUint8(offset + 1) === 0)) { 
                const pitch = read8();
                read8(); 
                if (activeNotes[pitch] !== undefined) {
                    const startTick = activeNotes[pitch];
                    trackNotes.push({ pitch, tick: startTick, duration: currentTick - startTick });
                    delete activeNotes[pitch];
                }
            } else if (type === 0x9) { 
                const pitch = read8();
                read8(); 
                activeNotes[pitch] = currentTick;
            } else if (type === 0xA || type === 0xB || type === 0xE) { 
                offset += 2; 
            } else if (type === 0xC || type === 0xD) { 
                offset += 1; 
            } else if (type === 0xF) { 
                if (status === 0xFF) { 
                    const metaType = read8();
                    const metaLen = readVLQ();
                    if (metaType === 0x51 && metaLen === 3) { 
                        const t1 = read8(), t2 = read8(), t3 = read8();
                        const microsec = (t1 << 16) | (t2 << 8) | t3;
                        resultBpm = Math.round(60000000 / microsec);
                    } else if (metaType === 0x03) { 
                        rawTrackName = readString(metaLen);
                    } else {
                        offset += metaLen;
                    }
                } else if (status === 0xF0 || status === 0xF7) { 
                    const sysexLen = readVLQ();
                    offset += sysexLen;
                }
            }
        }

        const scale = 96 / originalPPQ;
        const scaledNotes = trackNotes.map(n => ({
            pitch: n.pitch,
            tick: Math.round(n.tick * scale),
            duration: Math.max(1, Math.round(n.duration * scale)),
            muted: false,
            selected: false
        }));

        if (scaledNotes.length > 0 || rawTrackName !== '') {
            rawTracks.push({ rawName: rawTrackName, notes: scaledNotes, idIndex: rawTracks.length + 1 });
        }
        offset = endOffset; 
    }

    const processedTracks = [];
    const linkRegex = /^\[L:(\d+),T:([+-]?\d+)\]\s*(.*)$/;

    rawTracks.forEach((rt) => {
        let finalName = rt.rawName;
        let linkedToId = null;
        let transposeVal = 0;
        let notesToKeep = rt.notes;
        let linkStatus = 'standard';

        const match = rt.rawName.match(linkRegex);
        
        if (match) {
            const targetSrcId = parseInt(match[1], 10);
            const tVal = parseInt(match[2], 10);
            const cleanName = match[3];

            const sourceTrack = processedTracks.find(pt => pt.originalId === targetSrcId);
            
            if (sourceTrack) {
                const srcNotes = sourceTrack.notes;
                const loadedNotes = rt.notes;
                let isMatch = srcNotes.length === loadedNotes.length;
                
                if (isMatch) {
                    for (let i = 0; i < srcNotes.length; i++) {
                        const sN = srcNotes[i];
                        const lN = loadedNotes.find(n => Math.abs(n.tick - sN.tick) < 2);
                        if (!lN || lN.pitch - tVal !== sN.pitch || Math.abs(lN.duration - sN.duration) > 2) {
                            isMatch = false; break;
                        }
                    }
                }

                linkedToId = targetSrcId;
                transposeVal = tVal;
                finalName = cleanName;

                if (!isMatch) {
                    linkStatus = 'mismatch';
                    // mismatch時は読み込んだ独自ノートを一旦保持しておく
                    notesToKeep = rt.notes;
                } else {
                    linkStatus = 'linked';
                    notesToKeep = []; 
                }
            } else {
                finalName = cleanName;
            }
        }

        processedTracks.push({
            name: finalName,
            notes: notesToKeep,
            linkedToId: linkedToId,
            transpose: transposeVal,
            originalId: rt.idIndex,
            linkStatus: linkStatus
        });
    });

    const finalResultTracks = processedTracks.map(pt => ({
        name: pt.name,
        notes: pt.notes,
        _linkedToOriginalId: pt.linkedToId, 
        _transpose: pt.transpose,
        _linkStatus: pt.linkStatus
    }));

    return { bpm: resultBpm, tracks: finalResultTracks };
}
