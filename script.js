// VERSION 16
// --- DOOM.JS ENGINE CONFIG & VARIABLES ---

const CELL_SIZE = 12;
let MAP_GRID = [];

// Game state variables
let camera, scene, renderer;
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let prevTime = performance.now();
const velocity = new THREE.Vector3();

// Player state
let player = {
    x: CELL_SIZE * 2.5,
    z: CELL_SIZE * 2.5,
    health: 100,
    armor: 50,
    keys: { red: false, blue: false, yellow: false },
    activeWeaponIdx: 1, // Pistol
    weaponsUnlocked: [true, true, false, false, false], // Fist, Pistol, Shotgun, Plasma, Rocket
    ammo: {
        pistol: 50,
        shotgun: 0,
        plasma: 0,
        rockets: 0
    },
    inventory: {
        scrap: 0,
        cores: 0,
        fuel: 0
    },
    runesCollected: 0
};

let isCraftingOpen = false;

const WEAPONS_STATS = [
    { name: 'FIST',    ammoType: 'none',    sound: 'punch',   damage: 25,  delay: 350,  key: 'fist' },
    { name: 'PISTOL',  ammoType: 'pistol',  sound: 'pistol',  damage: 15,  delay: 250,  key: 'pistol' },
    { name: 'SHOTGUN', ammoType: 'shotgun', sound: 'shotgun', damage: 65,  delay: 800,  key: 'shotgun' },
    { name: 'PLASMA',  ammoType: 'plasma',  sound: 'plasma',  damage: 24,  delay: 100,  key: 'plasma' },
    { name: 'ROCKET',  ammoType: 'rockets', sound: 'rocket',  damage: 120, delay: 900,  key: 'rocket' }
];

// --- DIFFICULTY SYSTEM ---
let difficulty = 'normal'; // 'easy' | 'normal' | 'hard'
const DIFF_MULTIPLIERS = {
    easy:   { enemyHP: 0.6, enemyDmg: 0.6, pickupBonus: 1.5 },
    normal: { enemyHP: 1.0, enemyDmg: 1.0, pickupBonus: 1.0 },
    hard:   { enemyHP: 1.5, enemyDmg: 1.5, pickupBonus: 0.7 }
};

function setDifficulty(d) {
    difficulty = d;
    document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('diff-' + d).classList.add('active');
}

function getDiffMult() { return DIFF_MULTIPLIERS[difficulty]; }

// --- SCORE & STREAK SYSTEM ---
let score = 0;
let killStreak = 0;
let lastKillTime = 0;
const STREAK_WINDOW = 3000; // ms
const STREAK_MESSAGES = ['', '', 'DOUBLE KILL!', 'TRIPLE KILL!', 'QUAD KILL!', 'PENTA KILL!', 'RAMPAGE!!!'];
let streakMsgTimer = 0;
let gameStartTime = 0;
let totalKills = 0;

function addScore(pts) {
    score += pts;
    document.getElementById('score-val').innerText = score;
    // save best
    const best = parseInt(localStorage.getItem('doomjs_best') || '0');
    if (score > best) localStorage.setItem('doomjs_best', score);
}

function registerKill(enemyType) {
    totalKills++;
    const now = performance.now();
    if (now - lastKillTime < STREAK_WINDOW) {
        killStreak++;
    } else {
        killStreak = 1;
    }
    lastKillTime = now;

    // Score per kill
    const pts = { soldier: 100, imp: 200, pinky: 300, wraith: 500, boss: 2000 };
    addScore((pts[enemyType] || 100) * killStreak);

    // Streak message
    if (killStreak >= 2) {
        const msg = STREAK_MESSAGES[Math.min(killStreak, STREAK_MESSAGES.length - 1)];
        const el = document.getElementById('streak-msg');
        el.innerText = msg;
        streakMsgTimer = 2.0;
    }

    // Kill flash
    const kf = document.getElementById('kill-flash');
    kf.style.opacity = 1;
    setTimeout(() => kf.style.opacity = 0, 120);
}

// --- SCREEN SHAKE ---
let shakeTimer = 0;
function triggerShake() {
    const gc = document.getElementById('game-container');
    gc.classList.remove('shaking');
    void gc.offsetWidth; // reflow to restart animation
    gc.classList.add('shaking');
    setTimeout(() => gc.classList.remove('shaking'), 260);
}

// --- LEVEL INTRO ---
function showLevelIntro(title, sub) {
    const el = document.getElementById('level-intro');
    document.getElementById('level-intro-title').innerText = title;
    document.getElementById('level-intro-sub').innerText = sub;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2800);
}

let currentLevel = 1;
let levelKillCount = 0;
const levelObjectiveKills = 8;
let portalActive = false;
let bossEntity = null;

let weaponImages = {};
let isDead = false;
let isWin = false;
let currentFaceExpr = 'idle';
let faceTimer = 0;
let sceneTextures;
let pickupTextures;
let enemyTextures;

// Game objects
let walls = [];
let doors = [];
let pickups = [];
let enemies = [];
let particles = [];
let projectiles = [];
let lightObjects = [];
let torches = []; // animated torch lights

let yawObject, pitchObject;
let playerLight;
let floorMesh, ceilMesh;
let lastPortalMsgTime = 0;
let portalMesh = null;
let portalVanguardTriggered = false;
let portalLight = null;
let isLocked = false;
const PI_2 = Math.PI / 2;
let recoilPitch = 0;

// Level 4 rune stones objective
const LEVEL4_RUNES_NEEDED = 3;

// Level 5 wraith mini-boss tracking
let wraithsKilled = 0;
const LEVEL5_WRAITHS_NEEDED = 3;

// Minimap
const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas.getContext('2d');

// --- WEB AUDIO SYNTHESIZER ---
class SoundManager {
    constructor() {
        this.ctx = null;
        this.musicPlaying = false;
        this.tempo = 120;
        this.musicInterval = null;
        this.step = 0;
    }

    init() {
        if (this.ctx) return;
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.startMusic();
    }

    playSound(type) {
        if (!this.ctx) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();
        const now = this.ctx.currentTime;
        switch(type) {
            case 'pistol': {
                const bufferSize = this.ctx.sampleRate * 0.1;
                const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
                const noiseNode = this.ctx.createBufferSource();
                noiseNode.buffer = buffer;
                const filter = this.ctx.createBiquadFilter();
                filter.type = 'bandpass';
                filter.frequency.setValueAtTime(1000, now);
                const gain = this.ctx.createGain();
                gain.gain.setValueAtTime(0.5, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
                noiseNode.connect(filter); filter.connect(gain); gain.connect(this.ctx.destination);
                noiseNode.start(now);
                break;
            }
            case 'shotgun': {
                const bufferSize = this.ctx.sampleRate * 0.35;
                const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
                const noise = this.ctx.createBufferSource();
                noise.buffer = buffer;
                const filter = this.ctx.createBiquadFilter();
                filter.type = 'lowpass'; filter.frequency.setValueAtTime(700, now);
                const gain = this.ctx.createGain();
                gain.gain.setValueAtTime(0.7, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
                noise.connect(filter); filter.connect(gain); gain.connect(this.ctx.destination);
                noise.start(now);
                setTimeout(() => this.playSynthTone(550, 0.05, 'triangle', 0.1), 350);
                setTimeout(() => this.playSynthTone(350, 0.06, 'triangle', 0.1), 450);
                break;
            }
            case 'plasma': {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(900, now);
                osc.frequency.exponentialRampToValueAtTime(180, now + 0.12);
                gain.gain.setValueAtTime(0.3, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
                osc.connect(gain); gain.connect(this.ctx.destination);
                osc.start(now); osc.stop(now + 0.12);
                break;
            }
            case 'rocket': {
                // Deep boom launch
                const bufferSize = this.ctx.sampleRate * 0.5;
                const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
                const noise = this.ctx.createBufferSource(); noise.buffer = buffer;
                const filter = this.ctx.createBiquadFilter();
                filter.type = 'lowpass'; filter.frequency.setValueAtTime(300, now);
                const gain = this.ctx.createGain();
                gain.gain.setValueAtTime(0.9, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
                noise.connect(filter); filter.connect(gain); gain.connect(this.ctx.destination);
                noise.start(now);
                const osc = this.ctx.createOscillator();
                const g2 = this.ctx.createGain();
                osc.frequency.setValueAtTime(120, now);
                osc.frequency.exponentialRampToValueAtTime(40, now + 0.35);
                g2.gain.setValueAtTime(0.6, now); g2.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
                osc.connect(g2); g2.connect(this.ctx.destination);
                osc.start(now); osc.stop(now + 0.35);
                break;
            }
            case 'explosion': {
                const bufferSize = this.ctx.sampleRate * 0.6;
                const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
                const noise = this.ctx.createBufferSource(); noise.buffer = buffer;
                const filter = this.ctx.createBiquadFilter();
                filter.type = 'lowpass'; filter.frequency.setValueAtTime(200, now);
                const gain = this.ctx.createGain();
                gain.gain.setValueAtTime(1.0, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
                noise.connect(filter); filter.connect(gain); gain.connect(this.ctx.destination);
                noise.start(now);
                break;
            }
            case 'punch': { this.playSynthTone(80, 0.1, 'sine', 0.7); break; }
            case 'player_pain': {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(110, now);
                osc.frequency.linearRampToValueAtTime(70, now + 0.15);
                gain.gain.setValueAtTime(0.6, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
                osc.connect(gain); gain.connect(this.ctx.destination);
                osc.start(now); osc.stop(now + 0.15);
                break;
            }
            case 'enemy_pain': { this.playSynthTone(240, 0.1, 'sawtooth', 0.3); break; }
            case 'enemy_death': {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(180, now);
                osc.frequency.exponentialRampToValueAtTime(30, now + 0.5);
                gain.gain.setValueAtTime(0.6, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
                osc.connect(gain); gain.connect(this.ctx.destination);
                osc.start(now); osc.stop(now + 0.5);
                break;
            }
            case 'boss_screamer': {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(80, now);
                osc.frequency.exponentialRampToValueAtTime(600, now + 0.8);
                gain.gain.setValueAtTime(0.8, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.8);
                osc.connect(gain); gain.connect(this.ctx.destination);
                osc.start(now); osc.stop(now + 0.8);
                break;
            }
            case 'pickup': {
                const notes = [261.63, 329.63, 392.00, 523.25];
                notes.forEach((freq, idx) => {
                    setTimeout(() => this.playSynthTone(freq, 0.05, 'triangle', 0.2), idx * 50);
                });
                break;
            }
            case 'rune_pickup': {
                const notes = [392, 523.25, 659.25, 783.99];
                notes.forEach((freq, idx) => {
                    setTimeout(() => this.playSynthTone(freq, 0.12, 'square', 0.25), idx * 80);
                });
                break;
            }
            case 'door': { this.playSynthTone(150, 0.6, 'sawtooth', 0.15); break; }
            case 'door_buzz': { this.playSynthTone(90, 0.25, 'sawtooth', 0.4); break; }
            case 'win': {
                const fan = [523.25, 659.25, 783.99, 1046.50];
                fan.forEach((freq, idx) => {
                    setTimeout(() => this.playSynthTone(freq, 0.18, 'square', 0.25), idx * 100);
                });
                break;
            }
        }
    }

    playSynthTone(freq, dur, type = 'sine', volume = 0.5) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(volume, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + dur);
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.start(now); osc.stop(now + dur);
    }

    stopMusic() {
        if (this.musicInterval) {
            clearInterval(this.musicInterval);
            this.musicInterval = null;
            this.musicPlaying = false;
        }
    }

    startMusic() {
        if (this.musicPlaying) return;
        this.musicPlaying = true;
        const stepTime = 60 / this.tempo / 2;
        const isBossLvl = currentLevel === 3;
        const isNexus   = currentLevel === 5;

        const normalRiff = [41.20, 41.20, 48.99, 41.20, 55.00, 41.20, 58.27, 61.74,
                            41.20, 41.20, 48.99, 41.20, 55.00, 41.20, 58.27, 41.20];
        const bossRiff   = [55.00, 55.00, 65.41, 55.00, 73.42, 55.00, 77.78, 82.41,
                            55.00, 55.00, 65.41, 55.00, 73.42, 55.00, 77.78, 55.00];
        const nexusRiff  = [73.42, 73.42, 87.31, 73.42, 97.99, 73.42, 103.83, 110.00,
                            73.42, 73.42, 87.31, 73.42, 97.99, 73.42, 103.83, 73.42];

        let riff = normalRiff;
        let filterFreq = 180;
        let intervalMult = 1.0;
        if (isBossLvl) { riff = bossRiff; filterFreq = 280; intervalMult = 0.8; }
        if (isNexus)   { riff = nexusRiff; filterFreq = 320; intervalMult = 0.7; }

        this.musicInterval = setInterval(() => {
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            const note = riff[this.step % 16];

            if (this.step % 2 === 0 || Math.random() > 0.5) {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.value = note;
                const filter = this.ctx.createBiquadFilter();
                filter.type = 'lowpass'; filter.frequency.value = filterFreq;
                gain.gain.setValueAtTime(0.2, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + stepTime * 0.95);
                osc.connect(filter); filter.connect(gain); gain.connect(this.ctx.destination);
                osc.start(now); osc.stop(now + stepTime);
            }
            if (this.step % 4 === 0) {
                const kOsc = this.ctx.createOscillator();
                const kGain = this.ctx.createGain();
                kOsc.frequency.setValueAtTime(140, now);
                kOsc.frequency.exponentialRampToValueAtTime(45, now + 0.1);
                kGain.gain.setValueAtTime(0.35, now);
                kGain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
                kOsc.connect(kGain); kGain.connect(this.ctx.destination);
                kOsc.start(now); kOsc.stop(now + 0.1);
            }
            if (this.step % 8 === 4) {
                const bufferSize = this.ctx.sampleRate * 0.08;
                const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
                const noise = this.ctx.createBufferSource(); noise.buffer = buffer;
                const filter = this.ctx.createBiquadFilter();
                filter.type = 'bandpass'; filter.frequency.value = 900;
                const gain = this.ctx.createGain();
                gain.gain.setValueAtTime(0.18, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
                noise.connect(filter); filter.connect(gain); gain.connect(this.ctx.destination);
                noise.start(now);
            }
            this.step++;
        }, stepTime * intervalMult * 1000);
    }
}
const soundManager = new SoundManager();

// --- TEXTURE GENERATOR ---
function generateCanvasTexture(width, height, drawFunc) {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    drawFunc(ctx, width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    return texture;
}

function buildTextures() {
    // Brick wall
    const wall_brick = generateCanvasTexture(128, 128, (ctx) => {
        ctx.fillStyle = '#100a1c'; ctx.fillRect(0,0,128,128);
        ctx.fillStyle = '#00ffff';
        for(let y=0; y<=128; y+=16) ctx.fillRect(0, y, 128, 2);
        for(let y=0; y<128; y+=16) {
            const offset = (y/16)%2 === 0 ? 0 : 16;
            for(let x=offset; x<128+offset; x+=32) ctx.fillRect(x%128, y, 2, 16);
        }
        for(let k=0; k<30; k++) { ctx.fillStyle='rgba(0,255,255,0.4)'; ctx.fillRect(Math.random()*128, Math.random()*128, 3, 3); }
    });

    const wall_metal = generateCanvasTexture(128, 128, (ctx) => {
        ctx.fillStyle='#181924'; ctx.fillRect(0,0,128,128);
        ctx.fillStyle='#00aaff';
        ctx.fillRect(0,0,128,4); ctx.fillRect(0,0,4,128); ctx.fillRect(124,0,4,128); ctx.fillRect(0,124,128,4);
        ctx.strokeStyle='#0055aa'; ctx.lineWidth=2; ctx.beginPath();
        for(let i=16; i<128; i+=16) { ctx.moveTo(i,0); ctx.lineTo(i,128); ctx.moveTo(0,i); ctx.lineTo(128,i); }
        ctx.stroke();
        ctx.fillStyle='#ff00aa';
        ctx.fillRect(6,6,4,4); ctx.fillRect(118,6,4,4); ctx.fillRect(6,118,4,4); ctx.fillRect(118,118,4,4);
    });

    const wall_caution = generateCanvasTexture(128, 128, (ctx) => {
        ctx.fillStyle='#ff22aa'; ctx.fillRect(0,0,128,128);
        ctx.fillStyle='#0f0515'; ctx.lineWidth=14; ctx.beginPath();
        for(let i=-128; i<256; i+=32) { ctx.moveTo(i,0); ctx.lineTo(i+128,128); }
        ctx.stroke();
    });

    const wall_door = generateCanvasTexture(128, 128, (ctx) => {
        ctx.fillStyle='#252636'; ctx.fillRect(0,0,128,128);
        ctx.fillStyle='#00ffcc'; ctx.fillRect(0,0,128,6); ctx.fillRect(0,122,128,6);
        for(let y=16; y<120; y+=16) {
            ctx.fillStyle='#111'; ctx.fillRect(10,y,108,4);
            ctx.fillStyle='#00ffcc'; ctx.fillRect(10,y+4,108,2);
        }
    });

    // Crypt/stone wall for Level 4
    const wall_crypt = generateCanvasTexture(128, 128, (ctx) => {
        ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0,0,128,128);
        ctx.fillStyle = '#2d2d2d';
        for(let y=0; y<128; y+=20) {
            const off = (Math.floor(y/20)%2)*16;
            for(let x=off; x<128+off; x+=32) {
                ctx.fillRect(x%128+1, y+1, 30, 18);
            }
        }
        ctx.fillStyle = '#111';
        for(let y=0; y<=128; y+=20) ctx.fillRect(0,y,128,1);
        for(let y=0; y<128; y+=20) {
            const off = (Math.floor(y/20)%2)*16;
            for(let x=off; x<128+off; x+=32) ctx.fillRect(x%128, y, 1, 20);
        }
        // moss spots
        ctx.fillStyle='rgba(0,80,20,0.35)';
        for(let i=0; i<8; i++) ctx.fillRect(Math.random()*128, Math.random()*128, Math.random()*12+4, Math.random()*8+3);
        // glowing rune marks
        ctx.fillStyle='rgba(0,255,100,0.15)';
        for(let i=0; i<5; i++) { const x=Math.random()*100+14, y=Math.random()*100+14; ctx.fillRect(x,y,4,12); ctx.fillRect(x-4,y+4,12,4); }
    });

    // Neon tech wall for Level 5
    const wall_nexus = generateCanvasTexture(128, 128, (ctx) => {
        ctx.fillStyle = '#050a18'; ctx.fillRect(0,0,128,128);
        ctx.strokeStyle = '#0033ff'; ctx.lineWidth = 1; ctx.beginPath();
        for(let i=0; i<128; i+=8) { ctx.moveTo(i,0); ctx.lineTo(i,128); ctx.moveTo(0,i); ctx.lineTo(128,i); }
        ctx.stroke();
        ctx.fillStyle = '#0055ff';
        ctx.fillRect(0,0,128,3); ctx.fillRect(0,125,128,3); ctx.fillRect(0,0,3,128); ctx.fillRect(125,0,3,128);
        ctx.fillStyle='rgba(0,100,255,0.5)';
        for(let i=0; i<6; i++) ctx.fillRect(Math.random()*110+9, Math.random()*110+9, 10, 3);
        ctx.fillStyle='rgba(100,200,255,0.6)';
        for(let i=0; i<4; i++) ctx.fillRect(Math.random()*60+34, Math.random()*60+34, 3, 10);
    });

    const door_red    = generateColorDoorTexture('#ff1144');
    const door_blue   = generateColorDoorTexture('#0077ff');
    const door_yellow = generateColorDoorTexture('#ffcc00');

    const floor_tile = generateCanvasTexture(64, 64, (ctx) => {
        ctx.fillStyle='#0e0e15'; ctx.fillRect(0,0,64,64);
        ctx.strokeStyle='#22233b'; ctx.lineWidth=2; ctx.strokeRect(0,0,64,64);
        ctx.fillStyle='#00aaff'; ctx.fillRect(31,31,2,2);
    });

    const floor_slime = generateCanvasTexture(64, 64, (ctx) => {
        ctx.fillStyle='#cc2200'; ctx.fillRect(0,0,64,64);
        ctx.fillStyle='#ff7700';
        for(let i=0; i<10; i++) { ctx.beginPath(); ctx.arc(Math.random()*64,Math.random()*64,Math.random()*12+4,0,Math.PI*2); ctx.fill(); }
        ctx.fillStyle='#ffff00';
        for(let i=0; i<15; i++) ctx.fillRect(Math.random()*64, Math.random()*64, Math.random()*10+2, 2);
    });

    // Dark stone floor for Level 4
    const floor_crypt = generateCanvasTexture(64, 64, (ctx) => {
        ctx.fillStyle = '#141414'; ctx.fillRect(0,0,64,64);
        ctx.fillStyle = '#1c1c1c';
        ctx.fillRect(0,0,31,31); ctx.fillRect(33,33,31,31);
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0,32,64,2); ctx.fillRect(32,0,2,64);
        ctx.fillStyle = 'rgba(0,180,60,0.08)';
        for(let i=0; i<5; i++) ctx.fillRect(Math.random()*60,Math.random()*60,4,4);
    });

    // Bright neon floor for Level 5
    const floor_nexus = generateCanvasTexture(64, 64, (ctx) => {
        ctx.fillStyle = '#060612'; ctx.fillRect(0,0,64,64);
        ctx.strokeStyle = '#001855'; ctx.lineWidth = 1; ctx.beginPath();
        for(let i=0; i<64; i+=16) { ctx.moveTo(i,0); ctx.lineTo(i,64); ctx.moveTo(0,i); ctx.lineTo(64,i); }
        ctx.stroke();
        ctx.fillStyle = 'rgba(0,60,200,0.3)'; ctx.fillRect(0,0,64,2); ctx.fillRect(0,62,64,2);
    });

    const sky_hell = generateCanvasTexture(512, 512, (ctx) => {
        const grd = ctx.createLinearGradient(0,0,0,512);
        grd.addColorStop(0,'#060010'); grd.addColorStop(0.5,'#20003b'); grd.addColorStop(1,'#500055');
        ctx.fillStyle=grd; ctx.fillRect(0,0,512,512);
        ctx.fillStyle='rgba(255,0,170,0.1)';
        for(let i=0; i<12; i++) { ctx.beginPath(); ctx.arc(Math.random()*512,Math.random()*300,Math.random()*100+50,0,Math.PI*2); ctx.fill(); }
        ctx.fillStyle='#00ffff';
        for(let i=0; i<80; i++) ctx.fillRect(Math.random()*512,Math.random()*350,2,2);
        ctx.fillStyle='#ff00ff';
        for(let i=0; i<40; i++) ctx.fillRect(Math.random()*512,Math.random()*350,3,3);
    });

    // Rune stone pickup
    const rune_stone = generateCanvasTexture(32, 32, (ctx) => {
        ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.fillRect(0,0,32,32);
        ctx.fillStyle = '#1a3a1a'; ctx.beginPath(); ctx.moveTo(16,2); ctx.lineTo(30,28); ctx.lineTo(2,28); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#00ff88'; ctx.strokeStyle = '#00ff88'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(16,8); ctx.lineTo(16,22); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(10,15); ctx.lineTo(22,15); ctx.stroke();
        ctx.fillRect(14,6,4,4); ctx.fillRect(6,22,8,4); ctx.fillRect(18,22,8,4);
    });

    // Rocket ammo pickup
    const rocket_ammo = generateCanvasTexture(32, 32, (ctx) => {
        ctx.fillStyle='rgba(0,0,0,0)'; ctx.fillRect(0,0,32,32);
        ctx.fillStyle='#cc4400'; ctx.fillRect(12,6,8,20);
        ctx.fillStyle='#888'; ctx.fillRect(11,20,10,6);
        ctx.fillStyle='#ff6600'; ctx.beginPath(); ctx.moveTo(12,6); ctx.lineTo(20,6); ctx.lineTo(16,2); ctx.closePath(); ctx.fill();
    });

    // Scrap Metal
    const scrap_metal = generateCanvasTexture(32, 32, (ctx) => {
        ctx.fillStyle='rgba(0,0,0,0)'; ctx.fillRect(0,0,32,32);
        ctx.fillStyle='#55555d'; ctx.fillRect(6,6,20,20);
        ctx.fillStyle='#88888f'; ctx.fillRect(8,8,16,16);
        ctx.fillStyle='#333338'; ctx.fillRect(6,24,20,2); ctx.fillRect(24,6,2,20);
        // rivets/nails
        ctx.fillStyle='#aaa'; ctx.fillRect(9,9,2,2); ctx.fillRect(21,9,2,2); ctx.fillRect(9,21,2,2); ctx.fillRect(21,21,2,2);
    });

    // Energy Core
    const energy_core = generateCanvasTexture(32, 32, (ctx) => {
        ctx.fillStyle='rgba(0,0,0,0)'; ctx.fillRect(0,0,32,32);
        ctx.fillStyle='#222'; ctx.fillRect(8,4,16,24);
        ctx.fillStyle='#00ffff'; ctx.fillRect(10,8,12,16);
        ctx.fillStyle='#ffffff'; ctx.fillRect(13,11,6,10);
    });

    // Unstable Fuel
    const unstable_fuel = generateCanvasTexture(32, 32, (ctx) => {
        ctx.fillStyle='rgba(0,0,0,0)'; ctx.fillRect(0,0,32,32);
        ctx.fillStyle='#d96200'; ctx.fillRect(8,6,16,22);
        ctx.fillStyle='#ffea00'; ctx.fillRect(8,12,16,6); // yellow stripe
        ctx.fillStyle='#111'; ctx.fillRect(8,13,16,4); // black caution lines
    });

    return {
        wall_brick, wall_metal, wall_caution, wall_door,
        wall_crypt, wall_nexus,
        door_red, door_blue, door_yellow,
        floor_tile, floor_slime, floor_crypt, floor_nexus,
        sky_hell, rune_stone, rocket_ammo,
        scrap_metal, energy_core, unstable_fuel
    };
}

function generateColorDoorTexture(color) {
    return generateCanvasTexture(128, 128, (ctx) => {
        ctx.fillStyle='#222'; ctx.fillRect(0,0,128,128);
        ctx.fillStyle=color; ctx.fillRect(16,16,96,96);
        ctx.fillStyle='#000'; ctx.fillRect(20,20,88,88);
        ctx.fillStyle=color; ctx.fillRect(40,48,48,32);
        ctx.fillStyle='#fff'; ctx.fillRect(48,54,32,20);
    });
}

function buildPickupTextures() {
    const medkit = generateCanvasTexture(32, 32, (ctx) => {
        ctx.fillStyle='rgba(0,0,0,0)'; ctx.fillRect(0,0,32,32);
        ctx.fillStyle='#00ffcc'; ctx.fillRect(4,8,24,18);
        ctx.fillStyle='#ffffff'; ctx.fillRect(14,11,4,12); ctx.fillRect(10,15,12,4);
    });
    const armor = generateCanvasTexture(32, 32, (ctx) => {
        ctx.fillStyle='rgba(0,0,0,0)'; ctx.fillRect(0,0,32,32);
        ctx.fillStyle='#ff00aa';
        ctx.beginPath(); ctx.moveTo(16,4); ctx.lineTo(26,8); ctx.lineTo(24,22); ctx.lineTo(16,28); ctx.lineTo(8,22); ctx.lineTo(6,8); ctx.closePath(); ctx.fill();
        ctx.fillStyle='#ffccff';
        ctx.beginPath(); ctx.moveTo(16,8); ctx.lineTo(22,11); ctx.lineTo(20,20); ctx.lineTo(16,24); ctx.lineTo(12,20); ctx.lineTo(10,11); ctx.closePath(); ctx.fill();
    });
    const bullets = generateCanvasTexture(32, 32, (ctx) => {
        ctx.fillStyle='rgba(0,0,0,0)'; ctx.fillRect(0,0,32,32);
        ctx.fillStyle='#393b4a'; ctx.fillRect(6,12,20,12);
        ctx.fillStyle='#00ffff'; ctx.fillRect(9,8,3,4); ctx.fillRect(14,8,3,4); ctx.fillRect(19,8,3,4);
    });
    const shells = generateCanvasTexture(32, 32, (ctx) => {
        ctx.fillStyle='rgba(0,0,0,0)'; ctx.fillRect(0,0,32,32);
        ctx.fillStyle='#cc2200'; ctx.fillRect(6,10,20,14);
        ctx.fillStyle='#ffd700'; ctx.fillRect(8,10,16,3);
    });
    const cells = generateCanvasTexture(32, 32, (ctx) => {
        ctx.fillStyle='rgba(0,0,0,0)'; ctx.fillRect(0,0,32,32);
        ctx.fillStyle='#0f172a'; ctx.fillRect(8,6,16,20);
        ctx.fillStyle='#00ffff'; ctx.fillRect(10,8,12,16);
    });
    const shotgun = generateCanvasTexture(64, 32, (ctx) => {
        ctx.fillStyle='rgba(0,0,0,0)'; ctx.fillRect(0,0,64,32);
        ctx.fillStyle='#613000'; ctx.fillRect(10,16,12,6);
        ctx.fillStyle='#3c3d42'; ctx.fillRect(22,14,38,5);
    });
    const plasma = generateCanvasTexture(64, 32, (ctx) => {
        ctx.fillStyle='rgba(0,0,0,0)'; ctx.fillRect(0,0,64,32);
        ctx.fillStyle='#1e293b'; ctx.fillRect(12,12,36,10);
        ctx.fillStyle='#00ffff'; ctx.fillRect(20,10,24,2);
    });
    const rocket_gun = generateCanvasTexture(64, 32, (ctx) => {
        ctx.fillStyle='rgba(0,0,0,0)'; ctx.fillRect(0,0,64,32);
        ctx.fillStyle='#554433'; ctx.fillRect(8,16,14,8);
        ctx.fillStyle='#886644'; ctx.fillRect(22,12,36,8);
        ctx.fillStyle='#cc4400'; ctx.fillRect(20,14,4,4); ctx.fillRect(26,14,4,4);
    });
    const key_red    = generateKeycardTexture('#ff2222');
    const key_blue   = generateKeycardTexture('#2222ff');
    const key_yellow = generateKeycardTexture('#ffff22');

    return { medkit, armor, bullets, shells, cells, shotgun, plasma, rocket_gun,
             key_red, key_blue, key_yellow,
             rune_stone: sceneTextures.rune_stone,
             rocket_ammo: sceneTextures.rocket_ammo,
             scrap_metal: sceneTextures.scrap_metal,
             energy_core: sceneTextures.energy_core,
             unstable_fuel: sceneTextures.unstable_fuel };
}

function generateKeycardTexture(color) {
    return generateCanvasTexture(32, 32, (ctx) => {
        ctx.fillStyle='rgba(0,0,0,0)'; ctx.fillRect(0,0,32,32);
        ctx.fillStyle='#222'; ctx.fillRect(10,8,12,18);
        ctx.fillStyle=color; ctx.fillRect(12,10,8,14);
        ctx.fillStyle='#fff'; ctx.fillRect(14,14,4,2);
    });
}

function buildEnemyTextures() {
    const list = {};
    const enemyTypes = {
        soldier: { color: '#00cc55', eyeColor: '#ff2222', size: 64 },
        imp:     { color: '#cc6600', eyeColor: '#ff00ff', size: 64 },
        pinky:   { color: '#ff00aa', eyeColor: '#ffffff', size: 80 },
        wraith:  { color: '#00ddcc', eyeColor: '#ffffff', size: 80 },
        boss:    { color: '#e60000', eyeColor: '#00ffff', size: 128 }
    };

    for(let type in enemyTypes) {
        const info = enemyTypes[type];
        ['walk1','walk2','attack','hurt','dead'].forEach(state => {
            list[`${type}_${state}`] = generateCanvasTexture(info.size, info.size, (ctx, w, h) => {
                drawEnemyBase(ctx, type, info, w, h, state);
            });
        });
    }
    return list;
}

function drawEnemyBase(ctx, type, info, w, h, state) {
    ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.fillRect(0,0,w,h);

    if (state === 'dead') {
        ctx.fillStyle = '#cc0022';
        ctx.beginPath(); ctx.ellipse(w/2, h-8, w/3, 6, 0, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = info.color; ctx.fillRect(w/4, h-14, w/2, 8);
        ctx.fillStyle = '#cc9988'; ctx.beginPath(); ctx.arc(w/4+4, h-14, 5, 0, Math.PI*2); ctx.fill();
        return;
    }

    const cx = w/2;
    const isPinky  = type === 'pinky';
    const isBoss   = type === 'boss';
    const isWraith = type === 'wraith';

    // Legs
    ctx.fillStyle = (isPinky || isBoss || isWraith) ? info.color : '#251c14';
    if (state === 'walk1')       { ctx.fillRect(cx-8,h-16,5,16); ctx.fillRect(cx+3,h-12,5,12); }
    else if (state === 'walk2')  { ctx.fillRect(cx-8,h-12,5,12); ctx.fillRect(cx+3,h-16,5,16); }
    else                         { ctx.fillRect(cx-7,h-14,5,14); ctx.fillRect(cx+2,h-14,5,14); }

    // Torso
    ctx.fillStyle = info.color;
    if (isPinky || isWraith) {
        ctx.fillRect(cx-16,h-38,32,24);
        if (isWraith) {
            // ghostly transparency strips
            ctx.fillStyle = 'rgba(255,255,255,0.15)';
            ctx.fillRect(cx-12,h-36,8,20); ctx.fillRect(cx+4,h-36,8,20);
        }
    } else if (isBoss) {
        ctx.fillRect(cx-24,h-68,48,48);
        ctx.fillStyle='#00ffff'; ctx.fillRect(cx-16,h-60,10,24);
    } else {
        ctx.fillRect(cx-10,h-34,20,20);
    }

    // Head
    ctx.fillStyle = (isPinky || isBoss || isWraith) ? info.color : '#e6b39a';
    const headY  = isBoss ? h-76 : ((isPinky||isWraith) ? h-34 : h-42);
    const headRad = isBoss ? 16 : ((isPinky||isWraith) ? 9 : 7);
    ctx.beginPath(); ctx.arc(cx, headY, headRad, 0, Math.PI*2); ctx.fill();

    // Wraith ghost glow aura
    if (isWraith) {
        ctx.fillStyle = 'rgba(0,220,200,0.2)';
        ctx.beginPath(); ctx.arc(cx, headY, headRad+5, 0, Math.PI*2); ctx.fill();
    }

    // Eyes
    ctx.fillStyle = info.eyeColor;
    if (isPinky || isBoss || isWraith) {
        ctx.fillRect(cx-6,headY-3,2,2); ctx.fillRect(cx+4,headY-3,2,2);
    } else {
        ctx.fillRect(cx-3,headY-2,2,2); ctx.fillRect(cx+2,headY-2,2,2);
    }

    // Mouth / enhancements
    if (isBoss) {
        ctx.fillStyle='#333'; ctx.fillRect(cx-8,headY+4,16,6);
        ctx.fillStyle='#eee';
        ctx.beginPath(); ctx.moveTo(cx-12,headY-10); ctx.lineTo(cx-20,headY-25); ctx.lineTo(cx-8,headY-14); ctx.fill();
        ctx.beginPath(); ctx.moveTo(cx+12,headY-10); ctx.lineTo(cx+20,headY-25); ctx.lineTo(cx+8,headY-14); ctx.fill();
    } else if (isPinky) {
        ctx.fillStyle='#000'; ctx.fillRect(cx-4,headY+2,8,4);
        if (state==='attack') { ctx.fillStyle='#ff0033'; ctx.fillRect(cx-4,headY+2,8,5); }
    } else if (isWraith) {
        // Wraith has hollow wail mouth
        ctx.fillStyle='#001a18'; ctx.fillRect(cx-5,headY+2,10,6);
    }

    // Arms
    ctx.fillStyle = info.color;
    if (state === 'attack') {
        if (type==='soldier') { ctx.fillStyle='#00ffff'; ctx.beginPath(); ctx.arc(cx-16,h-26,6,0,Math.PI*2); ctx.fill(); }
        else if (type==='imp') { ctx.fillStyle='#ff6600'; ctx.beginPath(); ctx.arc(cx,h-48,8,0,Math.PI*2); ctx.fill(); }
        else if (type==='wraith') {
            // Wraith shoots cyan orbs
            ctx.fillStyle='rgba(0,220,200,0.8)'; ctx.beginPath(); ctx.arc(cx,h-48,10,0,Math.PI*2); ctx.fill();
            ctx.fillStyle='#ffffff'; ctx.beginPath(); ctx.arc(cx,h-48,4,0,Math.PI*2); ctx.fill();
        }
        else if (isBoss) {
            ctx.fillStyle='#00ffff'; ctx.fillRect(cx-34,h-56,12,30);
            ctx.fillStyle='#ff3300'; ctx.beginPath(); ctx.arc(cx-28,h-60,16,0,Math.PI*2); ctx.fill();
        }
    } else {
        if (isBoss) {
            ctx.fillRect(cx-32,h-56,8,28);
            ctx.fillStyle='#333'; ctx.fillRect(cx+24,h-56,8,28);
        } else {
            ctx.fillRect(cx-14,h-30,4,12); ctx.fillRect(cx+10,h-30,4,12);
        }
    }

    if (state==='hurt') { ctx.fillStyle='rgba(255,0,0,0.45)'; ctx.fillRect(0,0,w,h); }
}

function buildWeaponHUDCanvasses() {
    const list = {};
    const weaponKeys = [
        'fist_idle','fist_punch1','fist_punch2',
        'pistol_idle','pistol_fire1','pistol_fire2',
        'shotgun_idle','shotgun_fire','shotgun_pump1','shotgun_pump2',
        'plasma_idle','plasma_fire1','plasma_fire2',
        'rocket_idle','rocket_fire'
    ];
    weaponKeys.forEach(key => {
        const canvas = document.createElement('canvas');
        canvas.width=320; canvas.height=320;
        const ctx = canvas.getContext('2d');
        drawHUDWeapon(ctx, key);
        list[key] = canvas.toDataURL();
    });
    return list;
}

function drawHUDWeapon(ctx, key) {
    ctx.fillStyle='rgba(0,0,0,0)'; ctx.fillRect(0,0,320,320);
    const w=320, h=320;

    if (key.startsWith('fist')) {
        ctx.fillStyle='#d2997a';
        if (key==='fist_idle') { ctx.fillRect(w-100,h-100,70,100); ctx.fillStyle='#b3775c'; ctx.fillRect(w-100,h-100,70,12); }
        else if (key==='fist_punch1') { ctx.fillRect(w-70,h-60,70,80); }
        else { ctx.fillRect(w/2-60,h-180,120,120); ctx.fillStyle='#b3775c'; ctx.fillRect(w/2-60,h-180,120,30); }
    } else if (key.startsWith('pistol')) {
        ctx.fillStyle='#7a5a4a'; ctx.fillRect(w/2-24,h-60,48,60);
        ctx.fillStyle='#00ffcc'; ctx.fillRect(w/2-16,h-140,32,90);
        if (key==='pistol_fire1') { ctx.translate(0,-15); ctx.fillStyle='#00ffff'; ctx.beginPath(); ctx.arc(w/2,h-165,22,0,Math.PI*2); ctx.fill(); }
        else if (key==='pistol_fire2') { ctx.translate(0,-8); }
    } else if (key.startsWith('shotgun')) {
        ctx.fillStyle='#111'; ctx.fillRect(w/2-24,h-160,48,160);
        ctx.fillStyle='#ff00aa'; ctx.fillRect(w/2-12,h-220,10,120); ctx.fillRect(w/2+2,h-220,10,120);
        if (key==='shotgun_fire') {
            ctx.translate(0,-25); ctx.fillStyle='#ff00aa';
            ctx.beginPath(); ctx.arc(w/2,h-235,45,0,Math.PI*2); ctx.fill();
            ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(w/2,h-235,20,0,Math.PI*2); ctx.fill();
        } else if (key==='shotgun_pump1') { ctx.translate(-15,10); ctx.rotate(-0.05); ctx.fillStyle='#d2997a'; ctx.fillRect(w/2-18,h-130,20,30); }
        else if (key==='shotgun_pump2') { ctx.translate(15,12); ctx.rotate(0.05); ctx.fillStyle='#d2997a'; ctx.fillRect(w/2-2,h-130,20,30); }
    } else if (key.startsWith('plasma')) {
        ctx.fillStyle='#333'; ctx.fillRect(w/2-30,h-160,60,160);
        ctx.fillStyle='#00ffff'; ctx.fillRect(w/2-18,h-180,36,120);
        if (key==='plasma_fire1') { ctx.translate(0,-8); ctx.fillStyle='#00ffff'; ctx.beginPath(); ctx.arc(w/2,h-190,25,0,Math.PI*2); ctx.fill(); }
        else if (key==='plasma_fire2') { ctx.translate(0,-4); ctx.fillStyle='#00aaff'; ctx.beginPath(); ctx.arc(w/2,h-190,18,0,Math.PI*2); ctx.fill(); }
    } else if (key.startsWith('rocket')) {
        // Rocket launcher — boxy tube weapon
        ctx.fillStyle='#553322'; ctx.fillRect(w/2-28,h-60,56,60);
        ctx.fillStyle='#886644'; ctx.fillRect(w/2-20,h-180,40,140);
        ctx.fillStyle='#aa5522'; ctx.fillRect(w/2-24,h-185,48,12);
        ctx.fillStyle='#cc3300'; ctx.fillRect(w/2-8,h-200,16,20);
        if (key==='rocket_fire') {
            ctx.translate(0,-30);
            ctx.fillStyle='#ff6600'; ctx.beginPath(); ctx.arc(w/2,h-210,35,0,Math.PI*2); ctx.fill();
            ctx.fillStyle='#ffff00'; ctx.beginPath(); ctx.arc(w/2,h-210,15,0,Math.PI*2); ctx.fill();
            ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(w/2,h-210,5,0,Math.PI*2); ctx.fill();
        }
    }
}

let faceCtx, faceCanvas;
function drawHUDFace(health, expression='idle') {
    if (!faceCtx) {
        faceCanvas = document.getElementById('face-canvas');
        if (!faceCanvas) return;
        faceCtx = faceCanvas.getContext('2d');
    }
    const w=48, h=56;
    faceCtx.fillStyle='#141414'; faceCtx.fillRect(0,0,w,h);
    const isDead = health <= 0;
    faceCtx.fillStyle = isDead ? '#555' : '#f2c199';
    faceCtx.fillRect(8,12,32,36);
    if (!isDead) {
        faceCtx.fillStyle='#00ffff'; faceCtx.fillRect(8,12,32,10); faceCtx.fillRect(6,14,4,14); faceCtx.fillRect(38,14,4,14);
    }
    faceCtx.fillStyle='#000';
    let eyeLOffset=0, eyeROffset=0;
    if (expression==='look_left') { eyeLOffset=-2; eyeROffset=-2; }
    if (expression==='look_right') { eyeLOffset=2; eyeROffset=2; }
    if (isDead) {
        faceCtx.strokeStyle='#ff0033'; faceCtx.lineWidth=2; faceCtx.beginPath();
        faceCtx.moveTo(14,24); faceCtx.lineTo(20,30); faceCtx.moveTo(20,24); faceCtx.lineTo(14,30);
        faceCtx.moveTo(28,24); faceCtx.lineTo(34,30); faceCtx.moveTo(34,24); faceCtx.lineTo(28,30);
        faceCtx.stroke();
    } else {
        faceCtx.fillStyle='#fff'; faceCtx.fillRect(14,24,6,6); faceCtx.fillRect(28,24,6,6);
        faceCtx.fillStyle='#ff0055'; faceCtx.fillRect(16+eyeLOffset,26,2,2); faceCtx.fillRect(30+eyeROffset,26,2,2);
    }
    faceCtx.fillStyle = isDead ? '#333' : '#e09870'; faceCtx.fillRect(22,30,4,6);
    if (isDead) { faceCtx.fillStyle='#222'; faceCtx.fillRect(16,42,16,4); }
    else if (expression==='wince') { faceCtx.fillStyle='#aa0000'; faceCtx.fillRect(16,40,16,8); }
    else if (expression==='grin') { faceCtx.fillStyle='#000'; faceCtx.fillRect(16,42,16,2); faceCtx.fillRect(14,38,2,4); faceCtx.fillRect(32,38,2,4); }
    else { faceCtx.fillStyle='#000'; faceCtx.fillRect(18,42,12,2); }
    if (!isDead) {
        faceCtx.fillStyle='#ff0055';
        if (health<75) faceCtx.fillRect(10,16,2,6);
        if (health<50) faceCtx.fillRect(22,36,4,3);
        if (health<25) { faceCtx.fillRect(10,32,6,2); faceCtx.fillStyle='rgba(255,0,85,0.3)'; faceCtx.fillRect(8,12,32,36); }
    }
}

// --- DYNAMIC LEVEL GENERATOR ---

function loadLevel(levelNum) {
    currentLevel = levelNum;
    levelKillCount = 0;
    portalActive = false;
    portalMesh = null;
    portalVanguardTriggered = false;
    portalLight = null;
    bossEntity = null;
    wraithsKilled = 0;
    player.runesCollected = 0;

    document.getElementById('boss-hud').style.display = 'none';
    document.getElementById('rune-hud') && (document.getElementById('rune-hud').style.display = 'none');

    soundManager.stopMusic();
    soundManager.step = 0;
    soundManager.startMusic();

    // Clear old level entities
    walls.forEach(w => scene.remove(w));
    doors.forEach(d => scene.remove(d.mesh));
    pickups.forEach(p => scene.remove(p.mesh));
    enemies.forEach(e => scene.remove(e.mesh));
    projectiles.forEach(pr => scene.remove(pr.mesh));
    particles.forEach(p => scene.remove(p));
    lightObjects.forEach(l => scene.remove(l));
    torches.forEach(t => { scene.remove(t.light); scene.remove(t.sprite); });

    walls=[]; doors=[]; pickups=[]; enemies=[]; projectiles=[]; particles=[]; lightObjects=[]; torches=[];

    const title = document.getElementById('level-num');
    const desc  = document.getElementById('level-objective');

    if (levelNum===1) {
        title.innerText="LEVEL 1: TOXIC RUINS";
        desc.innerText="Eliminate 8 Soldier Demons to open exit portal!";
        // Eerie dense radioactive green fog
        scene.fog.color.setHex(0x061408);
        scene.fog.density = 0.024;
        renderer.setClearColor(0x061408);
        MAP_GRID = generateLevelGrid(1);
        spawnLevelEntities(1);
        showLevelIntro("LEVEL 1: TOXIC RUINS", "Awakening in the ruins. The base has fallen. Find the portal.");
    } else if (levelNum===2) {
        title.innerText="LEVEL 2: THE INFERNO";
        desc.innerText="Gather RED, BLUE, and YELLOW keys to unlock final gate!";
        scene.fog.color.setHex(0x2d0505);
        scene.fog.density = 0.015;
        renderer.setClearColor(0x2d0505);
        MAP_GRID = generateLevelGrid(2);
        spawnLevelEntities(2);
        showLevelIntro("LEVEL 2: THE INFERNO", "Molten reactor breach. Search the sector and find the 3 keycards.");
    } else if (levelNum===3) {
        title.innerText="LEVEL 3: HELL'S KEEP";
        desc.innerText="BOSS BATTLE: Defeat the Cyber-Demon!";
        scene.fog.color.setHex(0x1a0202);
        scene.fog.density = 0.015;
        renderer.setClearColor(0x1a0202);
        document.getElementById('boss-hud').style.display='flex';
        document.getElementById('boss-health-bar').style.width='100%';
        MAP_GRID = generateLevelGrid(3);
        spawnLevelEntities(3);
        showLevelIntro("LEVEL 3: HELL'S KEEP", "The Cyber-Demon awaits. End the siege or humanity falls.");
    } else if (levelNum===4) {
        title.innerText="LEVEL 4: BLOOD CITADEL";
        desc.innerText=`Find ${LEVEL4_RUNES_NEEDED} Rune Stones to open the exit!`;
        scene.fog.color.setHex(0x220202); // Blood red fog
        scene.fog.density = 0.018;
        renderer.setClearColor(0x220202);
        MAP_GRID = generateLevelGrid(4);
        spawnLevelEntities(4);
        showLevelIntro("LEVEL 4: BLOOD CITADEL", "Shatter the ancient blood crypt. Destroy the 3 source runes.");
        // Show rune HUD
        const rh = document.getElementById('rune-hud');
        if (rh) { rh.style.display='flex'; updateRuneHUD(); }
    } else if (levelNum===5) {
        title.innerText="LEVEL 5: NEXUS CORE";
        desc.innerText="Destroy all WRAITH commanders to disable reactor shields!";
        scene.fog.color.setHex(0x000c22); // Deep neon blue fog
        scene.fog.density = 0.016;
        renderer.setClearColor(0x000c22);
        MAP_GRID = generateLevelGrid(5);
        spawnLevelEntities(5);
        showLevelIntro("LEVEL 5: NEXUS CORE", "The source gate. Eliminate the Wraith Commanders to sabotage the core.");
    }

    // Player start
    const startPositions = { 1:[2.5,2.5], 2:[2.5,2.5], 3:[10.5,3.5], 4:[2.5,2.5], 5:[3.5,3.5] };
    const sp = startPositions[levelNum] || [2.5,2.5];
    player.x = CELL_SIZE * sp[0]; player.z = CELL_SIZE * sp[1];
    if (yawObject) yawObject.position.set(player.x, 8, player.z);

    player.keys.red=false; player.keys.blue=false; player.keys.yellow=false;
    document.getElementById('red-key-card').classList.remove('active');
    document.getElementById('blue-key-card').classList.remove('active');
    document.getElementById('yellow-key-card').classList.remove('active');
    updateHUDStats();
    parseMapGrid();
}

function updateRuneHUD() {
    const icons = document.querySelectorAll('.rune-icon');
    icons.forEach((icon, i) => {
        if (i < player.runesCollected) icon.classList.add('active');
        else icon.classList.remove('active');
    });
    const desc = document.getElementById('level-objective');

    if (currentLevel === 4) {
        if (player.runesCollected === 1) {
            showMiddleMessage("CHAMBER 2 GATE OPENED!", "green");
            doors.forEach(dr => { if (dr.col === 13) dr.state = 'opening'; });
            soundManager.playSound('door');
        } else if (player.runesCollected === 2) {
            showMiddleMessage("CHAMBER 3 GATE OPENED!", "green");
            doors.forEach(dr => { if (dr.col === 27) dr.state = 'opening'; });
            soundManager.playSound('door');
        }
    }

    if (player.runesCollected >= LEVEL4_RUNES_NEEDED) {
        desc.innerText = "ALL RUNES FOUND! Reach the exit portal!";
        portalActive = true;
    } else {
        desc.innerText = `Find Rune Stones: ${player.runesCollected}/${LEVEL4_RUNES_NEEDED}`;
    }
}

function placeRandomPortal(grid, size, startRow, startCol) {
    let candidates = [];
    for (let r = 2; r < size - 2; r++) {
        for (let c = 2; c < size - 2; c++) {
            if (grid[r] && grid[r][c] === 0) {
                const dist = Math.sqrt((r - startRow)**2 + (c - startCol)**2);
                // Keep portal far enough from player spawn
                if (dist > size * 0.45) {
                    candidates.push([r, c]);
                }
            }
        }
    }
    if (candidates.length > 0) {
        const [pr, pc] = candidates[Math.floor(Math.random() * candidates.length)];
        grid[pr][pc] = 9;
    } else {
        grid[size - 2][size - 3] = 9;
    }
}

function generateLevelGrid(level) {
    // Level sizes
    const sizes = { 1:30, 2:40, 3:20, 4:40, 5:28 };
    const size = sizes[level] || 30;
    const grid = [];
    for(let r=0; r<size; r++) {
        const row=[];
        for(let c=0; c<size; c++) {
            if (r===0||r===size-1||c===0||c===size-1) row.push(level<=2?1:level===4?8:level===5?11:2);
            else row.push(0);
        }
        grid.push(row);
    }

    if (level===1) {
        // Eerie toxic ruins layout: scattering of column walls and rubble
        for(let i=0; i<18; i++) {
            const pr=Math.floor(4+Math.random()*(size-8)), pc=Math.floor(4+Math.random()*(size-8));
            grid[pr][pc]=1;
        }
        // Random column pillars
        grid[6][6]=1; grid[6][size-7]=1; grid[size-7][6]=1; grid[size-7][size-7]=1;
        placeRandomPortal(grid, size, 2.5, 2.5);
    } else if (level===2) {
        // LEVEL 2: MOLTEN CAVERNS - 4 progressive zones across 40 wide cols
        // Zone dividers
        for (let r=1; r<size-1; r++) {
            grid[r][10] = 2; // Zone 1 -> 2 divider
            grid[r][20] = 2; // Zone 2 -> 3 divider
            grid[r][30] = 2; // Zone 3 -> 4 divider
        }
        // Keycard doors in each divider
        grid[15][10] = 5; // RED keycard door
        grid[15][20] = 6; // BLUE keycard door
        grid[15][30] = 7; // YELLOW keycard door

        // Zone 1 (col 1-9): Starting ruins - pillars & ruins
        grid[5][3] = 2; grid[5][7] = 2;
        grid[15][4] = 2; grid[15][8] = 2;
        grid[25][3] = 2; grid[25][7] = 2;
        grid[10][5] = 2; grid[20][5] = 2;

        // Zone 2 (col 11-19): Lava river crossing
        for (let c=11; c<20; c++) {
            grid[8][c] = 10;  // top lava stream
            grid[22][c] = 10; // bottom lava stream
        }
        // Lava crossing bridges (gaps in lava = open floor)
        grid[8][14] = 0; grid[8][15] = 0; // top bridge
        grid[22][14] = 0; grid[22][15] = 0; // bottom bridge
        // Mid-lava island rocks
        grid[15][13] = 2; grid[15][17] = 2;
        grid[12][16] = 10; grid[18][16] = 10;

        // Zone 3 (col 21-29): Deep cavern - tight corridors and rocks
        grid[5][23] = 2; grid[5][27] = 2;
        grid[10][25] = 2; grid[10][22] = 2;
        grid[20][25] = 2; grid[20][28] = 2;
        grid[25][23] = 2; grid[25][27] = 2;
        // Additional lava pits
        for (let r=11; r<19; r++) grid[r][24] = 10;
        grid[14][24] = 0; grid[15][24] = 0; // passage through lava

        // Zone 4 (col 31-38): Final gauntlet - large enemy pens
        grid[4][33] = 2; grid[4][37] = 2;
        grid[26][33] = 2; grid[26][37] = 2;
        grid[14][33] = 2; grid[16][35] = 2;
        // Final lava moat before exit
        for (let c=31; c<39; c++) {
            grid[6][c] = 10;
            grid[24][c] = 10;
        }
        grid[6][35] = 0; grid[24][35] = 0; // bridge gaps

        // Portal at the far end
        grid[15][37] = 9;
    } else if (level===3) {
        // Circular arena layout
        const center=size/2, rad=size/2-1.5;
        for(let r=0; r<size; r++) {
            for(let c=0; c<size; c++) {
                const dist=Math.sqrt((r-center)**2+(c-center)**2);
                if (dist>rad) grid[r][c]=2;
            }
        }
        // pillars in corners
        grid[4][4]=3; grid[4][size-5]=3; grid[size-5][4]=3; grid[size-5][size-5]=3;
        placeRandomPortal(grid, size, 10.5, 3.5);
    } else if (level===4) {
        // LEVEL 4: BLOOD CITADEL - 3 wide chambers across 40 cols
        // Chamber divider walls
        for (let r=1; r<size-1; r++) {
            grid[r][13] = 8; // Divider 1
            grid[r][27] = 8; // Divider 2
        }
        // Rune-gated doors in dividers
        grid[20][13] = 4; // Door 1 (opens on Rune 1)
        grid[20][27] = 4; // Door 2 (opens on Rune 2)

        // Chamber 1 (col 1-12): Blood altar with columns
        grid[5][4] = 8; grid[5][9] = 8;
        grid[35][4] = 8; grid[35][9] = 8;
        grid[13][6] = 8; grid[27][6] = 8;
        grid[10][11] = 8; grid[30][11] = 8;

        // Chamber 2 (col 14-26): Mid combat arena with cover
        grid[5][16] = 8; grid[5][22] = 8;
        grid[35][16] = 8; grid[35][22] = 8;
        grid[12][18] = 8; grid[12][24] = 8;
        grid[28][18] = 8; grid[28][24] = 8;
        grid[20][20] = 8; // Central altar pillar

        // Chamber 3 (col 28-38): Final stand - tight kill zone
        grid[5][30] = 8; grid[5][36] = 8;
        grid[35][30] = 8; grid[35][36] = 8;
        grid[10][32] = 8; grid[10][38] = 8;
        grid[30][32] = 8; grid[30][38] = 8;
        grid[20][33] = 8; grid[20][36] = 8;

        // Exit Portal in Chamber 3
        grid[20][37] = 9;
    } else if (level===5) {
        // LEVEL 5: REACTOR ASSAULT CORE (No Maze)
        const center = Math.floor(size/2);
        
        // Shielded center core
        for(let r=center-2; r<=center+2; r++) {
            for(let c=center-2; c<=center+2; c++) {
                if (r===center && c===center) grid[r][c]=12; // core pillar
                else if (Math.abs(r-center)<=1 && Math.abs(c-center)<=1) {
                    grid[r][c]=11; // shield wall
                }
            }
        }
        
        // Shield doors that open when reactors are down
        grid[center-2][center]=4; // North gate
        grid[center+2][center]=4; // South gate
        grid[center][center-2]=4; // West gate
        
        // 3 side reactor pillars
        grid[4][center]=11; // North Reactor
        grid[center][4]=11; // West Reactor
        grid[center][size-5]=11; // East Reactor

        placeRandomPortal(grid, size, 3.5, 3.5);
    }

    return grid;
}

function spawnLevelEntities(level) {
    const sizes = {1:30,2:40,3:20,4:40,5:28};
    const size = sizes[level]||30;
    const dm = getDiffMult();

    if (level===1) {
        let spawned=0, attempts=0;
        while(spawned<8&&attempts<100) {
            const tr=Math.floor(4+Math.random()*(size-8));
            const tc=Math.floor(4+Math.random()*(size-8));
            if (MAP_GRID[tr]&&MAP_GRID[tr][tc]===0&&(tr>5||tc>5)) { spawnEnemy('soldier',tc,tr); spawned++; }
            attempts++;
        }
        spawnPickup('shotgun',5,5);
        spawnPickup('medkit',6,8);
        spawnPickup('armor',8,6);
        spawnPickup('shells',6,6);
        if (dm.pickupBonus>1) { spawnPickup('medkit',10,10); spawnPickup('bullets',8,10); }
        spawnCraftingItemsForLevel(1, size);
    } else if (level===2) {
        // ZONE 1 (col 1-9): Light patrol - 4 soldiers
        spawnPickup('key_red', 4, 3);
        spawnEnemy('soldier', 3, 7);
        spawnEnemy('soldier', 6, 5);
        spawnEnemy('imp', 7, 20);
        spawnEnemy('soldier', 4, 25);
        spawnPickup('medkit', 5, 12);
        spawnPickup('bullets', 7, 8);

        // ZONE 2 (col 11-19): Lava crossing ambush - imps
        spawnPickup('key_blue', 13, 3);
        spawnEnemy('imp', 12, 7);
        spawnEnemy('imp', 18, 5);
        spawnEnemy('soldier', 14, 14);
        spawnEnemy('imp', 16, 22);
        spawnEnemy('pinky', 13, 26);
        spawnPickup('shells', 15, 12);
        spawnPickup('shotgun', 16, 12);

        // ZONE 3 (col 21-29): Cavern ambush - pinkies + soldiers
        spawnPickup('key_yellow', 23, 3);
        spawnEnemy('pinky', 22, 8);
        spawnEnemy('soldier', 26, 5);
        spawnEnemy('imp', 27, 18);
        spawnEnemy('pinky', 23, 25);
        spawnEnemy('soldier', 28, 22);
        spawnPickup('armor', 25, 15);
        spawnPickup('cells', 26, 12);

        // ZONE 4 (col 31-38): Final gauntlet - heavy resistance
        spawnEnemy('pinky', 32, 10);
        spawnEnemy('pinky', 36, 10);
        spawnEnemy('imp', 33, 20);
        spawnEnemy('soldier', 37, 20);
        spawnEnemy('imp', 34, 14);
        spawnEnemy('pinky', 35, 28);
        spawnPickup('plasma', 33, 3);
        spawnPickup('cells', 34, 3);
        spawnPickup('medkit', 36, 15);

        if (dm.pickupBonus>1) {
            spawnPickup('medkit', 5, 18);
            spawnPickup('armor', 22, 18);
            spawnPickup('bullets', 32, 3);
        }
        spawnCraftingItemsForLevel(2, size);
    } else if (level===3) {
        spawnBoss(size/2, size/2);
        spawnPickup('plasma',4,10); spawnPickup('cells',5,10);
        spawnPickup('medkit',10,4); spawnPickup('medkit',10,size-5);
        spawnPickup('armor',size-5,10);
        if (dm.pickupBonus>1) spawnPickup('medkit',4,4);
        spawnCraftingItemsForLevel(3, size);
    } else if (level===4) {
        // CHAMBER 1 (col 1-12): Rune 1 - guarded by soldiers + imps
        spawnPickup('rune_stone', 6, 3);
        spawnEnemy('soldier', 4, 8);
        spawnEnemy('soldier', 8, 6);
        spawnEnemy('imp', 5, 15);
        spawnEnemy('imp', 10, 15);
        spawnEnemy('soldier', 3, 30);
        spawnEnemy('soldier', 9, 30);
        // Loot in Chamber 1
        spawnPickup('medkit', 6, 5);
        spawnPickup('bullets', 7, 5);
        spawnPickup('shells', 5, 10);

        // Rocket Launcher hidden in Chamber 1 alcove
        spawnPickup('rocket_gun', 2, 20);
        spawnPickup('rocket_ammo', 2, 22);

        // CHAMBER 2 (col 14-26): Rune 2 - pinkies + imps defend altar
        spawnPickup('rune_stone', 19, 3);
        spawnEnemy('pinky', 15, 10);
        spawnEnemy('imp', 19, 10);
        spawnEnemy('pinky', 25, 10);
        spawnEnemy('soldier', 14, 20);
        spawnEnemy('imp', 20, 20);
        spawnEnemy('soldier', 26, 20);
        spawnEnemy('pinky', 19, 30);
        // Chamber 2 supplies
        spawnPickup('armor', 19, 5);
        spawnPickup('cells', 20, 5);
        spawnPickup('medkit', 15, 15);
        spawnPickup('medkit', 25, 15);

        // CHAMBER 3 (col 28-38): Rune 3 - final stand, heavy demons
        spawnPickup('rune_stone', 32, 3);
        spawnEnemy('pinky', 29, 10);
        spawnEnemy('pinky', 35, 10);
        spawnEnemy('imp', 31, 15);
        spawnEnemy('imp', 33, 22);
        spawnEnemy('soldier', 29, 28);
        spawnEnemy('soldier', 35, 28);
        spawnEnemy('pinky', 32, 33);
        spawnEnemy('imp', 38, 15);
        // Chamber 3 supplies
        spawnPickup('plasma', 32, 5);
        spawnPickup('cells', 33, 5);
        spawnPickup('rocket_ammo', 31, 5);
        spawnPickup('medkit', 29, 18);
        spawnPickup('medkit', 35, 18);

        spawnTorchesInMaze(size, 20);
        if (dm.pickupBonus>1) {
            spawnPickup('medkit', 19, 20);
            spawnPickup('armor', 19, 25);
        }
        spawnCraftingItemsForLevel(4, size);
    } else if (level===5) {
        const center=Math.floor(size/2);
        // Three reactor wraith commanders
        spawnWraith(center, 3);      // North Reactor
        spawnWraith(3, center);      // West Reactor
        spawnWraith(size-4, center); // East Reactor

        // General guards
        for(let i=0; i<8; i++) spawnEnemyAtRandom('soldier',size);
        for(let i=0; i<8; i++) spawnEnemyAtRandom('imp',size);
        for(let i=0; i<6; i++) spawnEnemyAtRandom('pinky',size);

        // Sabotage gear pickups
        spawnPickup('cells',4,4); spawnPickup('plasma',size-5,4);
        spawnPickup('medkit',4,size-5); spawnPickup('medkit',size-5,size-5);
        spawnPickup('armor',4,center-3); spawnPickup('rocket_ammo',size-5,center-3);

        spawnNexusTorches(size, 12);
        if (dm.pickupBonus>1) { spawnPickup('medkit',center-3,4); spawnPickup('armor',center-3,size-5); }
        
        spawnCraftingItemsForLevel(5, size);
    }
}

function spawnCraftingItemsForLevel(level, size) {
    const counts = { 1: {scrap: 3, cores: 1, fuel: 1},
                     2: {scrap: 5, cores: 3, fuel: 3},
                     3: {scrap: 2, cores: 2, fuel: 1},
                     4: {scrap: 6, cores: 4, fuel: 4},
                     5: {scrap: 6, cores: 4, fuel: 4} };
    const config = counts[level] || {scrap: 3, cores: 1, fuel: 1};

    // Scatter scrap
    for (let i=0; i<config.scrap; i++) spawnCraftingItemAtRandom('scrap_metal', size);
    // Scatter cores
    for (let i=0; i<config.cores; i++) spawnCraftingItemAtRandom('energy_core', size);
    // Scatter fuel
    for (let i=0; i<config.fuel; i++) spawnCraftingItemAtRandom('unstable_fuel', size);
}

function spawnCraftingItemAtRandom(type, size) {
    let attempts=0;
    while(attempts<100) {
        let r=Math.floor(2+Math.random()*(size-4));
        let c=Math.floor(2+Math.random()*(size-4));
        if (MAP_GRID[r]&&MAP_GRID[r][c]===0) { spawnPickup(type, c, r); break; }
        attempts++;
    }
}

function spawnTorchesInMaze(size, count) {
    let placed=0, attempts=0;
    while(placed<count&&attempts<200) {
        const r=Math.floor(2+Math.random()*(size-4));
        const c=Math.floor(2+Math.random()*(size-4));
        if (MAP_GRID[r]&&MAP_GRID[r][c]===0) {
            const px=c*CELL_SIZE+CELL_SIZE/2, pz=r*CELL_SIZE+CELL_SIZE/2;
            const light=new THREE.PointLight(0xff6600, 1.2, 28);
            light.position.set(px,6,pz); scene.add(light);
            // Torch sprite (simple cylinder)
            const geo=new THREE.CylinderGeometry(0.3,0.5,4,6);
            const mat=new THREE.MeshBasicMaterial({color:0x553300});
            const mesh=new THREE.Mesh(geo,mat);
            mesh.position.set(px,2,pz); scene.add(mesh);
            torches.push({light, sprite:mesh, baseIntensity:1.2, color:0xff6600});
            placed++;
        }
        attempts++;
    }
}

function spawnNexusTorches(size, count) {
    let placed=0, attempts=0;
    while(placed<count&&attempts<200) {
        const r=Math.floor(2+Math.random()*(size-4));
        const c=Math.floor(2+Math.random()*(size-4));
        if (MAP_GRID[r]&&MAP_GRID[r][c]===0) {
            const px=c*CELL_SIZE+CELL_SIZE/2, pz=r*CELL_SIZE+CELL_SIZE/2;
            const light=new THREE.PointLight(0x0088ff, 1.0, 32);
            light.position.set(px,8,pz); scene.add(light);
            const geo=new THREE.CylinderGeometry(0.2,0.3,5,6);
            const mat=new THREE.MeshBasicMaterial({color:0x001166});
            const mesh=new THREE.Mesh(geo,mat);
            mesh.position.set(px,2.5,pz); scene.add(mesh);
            torches.push({light, sprite:mesh, baseIntensity:1.0, color:0x0088ff});
            placed++;
        }
        attempts++;
    }
}

// Spawn an entity in a bounded quadrant, finding nearest open cell
function spawnEntityInQuadrant(type, rMin, rMax, cMin, cMax) {
    const rStart = Math.floor(rMin + Math.random() * (rMax - rMin));
    const cStart = Math.floor(cMin + Math.random() * (cMax - cMin));
    // spiral search outward from candidate position
    for (let radius = 0; radius <= 6; radius++) {
        for (let dr = -radius; dr <= radius; dr++) {
            for (let dc = -radius; dc <= radius; dc++) {
                if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue;
                const nr = rStart + dr, nc = cStart + dc;
                if (nr > 0 && nr < MAP_GRID.length - 1 && nc > 0 && nc < MAP_GRID[0].length - 1
                    && MAP_GRID[nr] && MAP_GRID[nr][nc] === 0) {
                    if (type === 'wraith') spawnWraith(nc, nr);
                    else spawnEnemy(type, nc, nr);
                    return;
                }
            }
        }
    }
}

function spawnEnemyAtRandom(type, size) {
    let attempts=0;
    while(attempts<80) {
        let r=Math.floor(5+Math.random()*(size-10));
        let c=Math.floor(5+Math.random()*(size-10));
        if (MAP_GRID[r]&&MAP_GRID[r][c]===0) { spawnEnemy(type,c,r); break; }
        attempts++;
    }
}

function spawnEnemy(type, tx, tz) {
    const dm=getDiffMult();
    let defaultTex=enemyTextures[`${type}_walk1`];
    const mat=new THREE.SpriteMaterial({map:defaultTex, color:0xffffff});
    const sprite=new THREE.Sprite(mat);
    let scale=type==='pinky'?10:8;
    sprite.scale.set(scale,scale,1);
    const px=tx*CELL_SIZE+CELL_SIZE/2, pz=tz*CELL_SIZE+CELL_SIZE/2;
    sprite.position.set(px,scale/2,pz);
    scene.add(sprite);

    const baseHP = type==='pinky'?120 : type==='imp'?60 : 35;
    const hp = Math.round(baseHP*dm.enemyHP);
    enemies.push({ mesh:sprite, type, health:hp, maxHealth:hp,
        state:'idle', col:tx, row:tz, timer:0,
        speed:type==='pinky'?24.0:14.0, x:px, z:pz, dmgMult:dm.enemyDmg });
}

function spawnWraith(tx, tz) {
    const dm=getDiffMult();
    let defaultTex=enemyTextures['wraith_walk1'];
    const mat=new THREE.SpriteMaterial({map:defaultTex, color:0xffffff});
    const sprite=new THREE.Sprite(mat);
    sprite.scale.set(12,12,1);
    const px=tx*CELL_SIZE+CELL_SIZE/2, pz=tz*CELL_SIZE+CELL_SIZE/2;
    sprite.position.set(px,6,pz);
    scene.add(sprite);
    const hp=Math.round(250*dm.enemyHP);
    const wraith={
        mesh:sprite, type:'wraith', health:hp, maxHealth:hp,
        state:'idle', col:tx, row:tz, timer:0,
        speed:20.0, x:px, z:pz, dmgMult:dm.enemyDmg, isWraith:true
    };
    enemies.push(wraith);
    return wraith;
}

function spawnBoss(tx, tz) {
    const dm=getDiffMult();
    let defaultTex=enemyTextures.boss_walk1;
    const mat=new THREE.SpriteMaterial({map:defaultTex, color:0xffffff});
    const sprite=new THREE.Sprite(mat);
    sprite.scale.set(22,22,1);
    const px=tx*CELL_SIZE+CELL_SIZE/2, pz=tz*CELL_SIZE+CELL_SIZE/2;
    sprite.position.set(px,11,pz);
    scene.add(sprite);
    const hp=Math.round(500*dm.enemyHP);
    bossEntity={mesh:sprite, type:'boss', health:hp, maxHealth:hp,
        state:'idle', col:tx, row:tz, timer:0,
        speed:16.0, x:px, z:pz, dmgMult:dm.enemyDmg};
    enemies.push(bossEntity);
}

function spawnPickup(type, tx, tz) {
    // rune_stone and rocket_ammo textures come from sceneTextures
    let tex = pickupTextures[type] || sceneTextures[type] || pickupTextures.bullets;
    const mat=new THREE.SpriteMaterial({map:tex});
    const sprite=new THREE.Sprite(mat);
    sprite.scale.set(6,6,1);
    const px=tx*CELL_SIZE+CELL_SIZE/2, pz=tz*CELL_SIZE+CELL_SIZE/2;
    sprite.position.set(px,3,pz);
    scene.add(sprite);
    pickups.push({mesh:sprite, type, col:tx, row:tz});
    let color=0x00ffff;
    if (type.startsWith('key')) color=type==='key_red'?0xff0000:type==='key_blue'?0x0000ff:0xffff00;
    if (type==='shotgun'||type==='rocket_gun') color=0xff00ff;
    if (type==='rune_stone') color=0x00ff88;
    const light=new THREE.PointLight(color,1.0,16);
    light.position.set(px,3,pz); scene.add(light); lightObjects.push(light);
}

function parseMapGrid() {
    const wallGeo=new THREE.BoxGeometry(CELL_SIZE,20,CELL_SIZE);

    // Ceiling
    if (!ceilMesh) {
        const ceilGeo=new THREE.PlaneGeometry(700,700);
        const ceilMat=new THREE.MeshBasicMaterial({color:0x11071e, side:THREE.DoubleSide});
        ceilMesh=new THREE.Mesh(ceilGeo,ceilMat);
        ceilMesh.rotation.x=Math.PI/2;
        ceilMesh.position.set(210,20,210);
        scene.add(ceilMesh);
    } else {
        const ceilColors={1:0x11071e,2:0x2d0505,3:0x150202,4:0x050a02,5:0x001030};
        ceilMesh.material.color.setHex(ceilColors[currentLevel]||0x11071e);
    }

    // Floor
    if (!floorMesh) {
        const floorGeo=new THREE.PlaneGeometry(700,700);
        const floorMat=new THREE.MeshLambertMaterial({map:sceneTextures.floor_tile});
        floorMesh=new THREE.Mesh(floorGeo,floorMat);
        floorMesh.rotation.x=-Math.PI/2;
        floorMesh.position.set(210,0,210);
        scene.add(floorMesh);
    } else {
        const floorMaps={1:sceneTextures.floor_tile,2:sceneTextures.floor_slime,3:sceneTextures.floor_tile,4:sceneTextures.floor_crypt,5:sceneTextures.floor_nexus};
        floorMesh.material.map = floorMaps[currentLevel]||sceneTextures.floor_tile;
        floorMesh.material.needsUpdate=true;
    }

    for(let r=0; r<MAP_GRID.length; r++) {
        for(let c=0; c<MAP_GRID[r].length; c++) {
            const val=MAP_GRID[r][c];
            const px=c*CELL_SIZE+CELL_SIZE/2, pz=r*CELL_SIZE+CELL_SIZE/2;

            if (val===1||val===2||val===3||val===8||val===11) {
                let tex=sceneTextures.wall_brick;
                if (val===2||val===3) tex=val===2?sceneTextures.wall_metal:sceneTextures.wall_caution;
                if (val===8) tex=sceneTextures.wall_crypt;
                if (val===11) tex=sceneTextures.wall_nexus;
                const mat=new THREE.MeshLambertMaterial({map:tex});
                const mesh=new THREE.Mesh(wallGeo,mat);
                mesh.position.set(px,10,pz);
                scene.add(mesh); walls.push(mesh);
            } else if (val>=4&&val<=7) {
                let tex=sceneTextures.wall_door;
                if (val===5) tex=sceneTextures.door_red;
                if (val===6) tex=sceneTextures.door_blue;
                if (val===7) tex=sceneTextures.door_yellow;
                const doorMesh=new THREE.Mesh(
                    new THREE.BoxGeometry(CELL_SIZE,20,CELL_SIZE-1.5),
                    new THREE.MeshLambertMaterial({map:tex})
                );
                doorMesh.position.set(px,10,pz);
                scene.add(doorMesh);
                doors.push({mesh:doorMesh,state:'closed',col:c,row:r,type:val,speed:15,height:10,timer:0});
            } else if (val===9) {
                // High-fidelity Dimensional Portal
                const group = new THREE.Group();

                // Outer decorative portal frame ring
                const frameGeo = new THREE.TorusGeometry(5.0, 0.7, 12, 32);
                const frameMat = new THREE.MeshBasicMaterial({color: 0x9900ff});
                const frame = new THREE.Mesh(frameGeo, frameMat);
                frame.position.y = 8;
                group.add(frame);

                // Inner swirling energy vortex
                const vortexGeo = new THREE.CylinderGeometry(4.6, 4.6, 0.3, 32);
                const vortexMat = new THREE.MeshBasicMaterial({
                    color: 0x330055,
                    transparent: true,
                    opacity: 0.5,
                    side: THREE.DoubleSide
                });
                const vortex = new THREE.Mesh(vortexGeo, vortexMat);
                vortex.rotation.x = Math.PI / 2;
                vortex.position.y = 8;
                group.add(vortex);

                group.position.set(px, 0, pz);
                scene.add(group);

                const portLight = new THREE.PointLight(0x9900ff, 1.5, 30);
                portLight.position.set(px, 8, pz);
                scene.add(portLight);
                lightObjects.push(portLight);

                portalMesh = group;
                portalLight = portLight;
            } else if (val===12) {
                // Nexus core pillar — glowing cyan
                const coreGeo=new THREE.CylinderGeometry(3,3,22,16);
                const coreMat=new THREE.MeshBasicMaterial({color:0x00aaff, transparent:true, opacity:0.75});
                const coreMesh=new THREE.Mesh(coreGeo,coreMat);
                coreMesh.position.set(px,11,pz);
                scene.add(coreMesh); walls.push(coreMesh);
                const coreLight=new THREE.PointLight(0x00aaff,3.0,60);
                coreLight.position.set(px,10,pz); scene.add(coreLight); lightObjects.push(coreLight);
            }
        }
    }
}

// --- PHYSICS & COLLISION ---
function checkWallCollision(px, pz, radius=2.5) {
    const cc=Math.floor(px/CELL_SIZE), cr=Math.floor(pz/CELL_SIZE);
    for(let r=cr-1; r<=cr+1; r++) {
        for(let c=cc-1; c<=cc+1; c++) {
            if (r<0||r>=MAP_GRID.length||c<0||c>=MAP_GRID[0].length) continue;
            const cellVal=MAP_GRID[r][c];
            let block=false;
            if ([1,2,3,8,11,12].includes(cellVal)) block=true;
            else if (cellVal>=4&&cellVal<=7) {
                const dr=doors.find(d=>d.col===c&&d.row===r);
                if (dr&&(dr.state==='closed'||dr.state==='closing')) block=true;
            }
            if (block) {
                const minX=c*CELL_SIZE, maxX=(c+1)*CELL_SIZE;
                const minZ=r*CELL_SIZE, maxZ=(r+1)*CELL_SIZE;
                const cx2=Math.max(minX,Math.min(px,maxX));
                const cz2=Math.max(minZ,Math.min(pz,maxZ));
                const dist=Math.sqrt((px-cx2)**2+(pz-cz2)**2);
                if (dist<radius) return {hit:true, cx:cx2, cz:cz2};
            }
        }
    }
    return {hit:false};
}

function updatePlayerMovement(delta) {
    velocity.x -= velocity.x*9.0*delta;
    velocity.z -= velocity.z*9.0*delta;
    const theta=yawObject.rotation.y;
    const forwardX=-Math.sin(theta), forwardZ=-Math.cos(theta);
    const rightX=Math.cos(theta), rightZ=-Math.sin(theta);
    let moveDirX=0, moveDirZ=0;
    if (moveForward)  { moveDirX+=forwardX; moveDirZ+=forwardZ; }
    if (moveBackward) { moveDirX-=forwardX; moveDirZ-=forwardZ; }
    if (moveLeft)     { moveDirX-=rightX; moveDirZ-=rightZ; }
    if (moveRight)    { moveDirX+=rightX; moveDirZ+=rightZ; }
    const len=Math.sqrt(moveDirX*moveDirX+moveDirZ*moveDirZ);
    if (len>0) { moveDirX/=len; moveDirZ/=len; }
    const targetSpeed=75.0;
    if (moveForward||moveBackward||moveLeft||moveRight) {
        velocity.x+=moveDirX*targetSpeed*9.0*delta;
        velocity.z+=moveDirZ*targetSpeed*9.0*delta;
    }
    const moveX=velocity.x*delta, moveZ=velocity.z*delta;
    let nextX=yawObject.position.x+moveX, nextZ=yawObject.position.z;
    if (!checkWallCollision(nextX,nextZ,2.5).hit) yawObject.position.x=nextX;
    nextX=yawObject.position.x; nextZ=yawObject.position.z+moveZ;
    if (!checkWallCollision(nextX,nextZ,2.5).hit) yawObject.position.z=nextZ;
    player.x=yawObject.position.x; player.z=yawObject.position.z;

    const currentCol=Math.floor(player.x/CELL_SIZE);
    const currentRow=Math.floor(player.z/CELL_SIZE);

    if (MAP_GRID[currentRow]&&MAP_GRID[currentRow][currentCol]===10) playerTakeDamage(25*delta);

    // Portal auto-trigger
    if (MAP_GRID[currentRow]&&MAP_GRID[currentRow][currentCol]===9) {
        const now=performance.now();
        if (currentLevel===1) {
            if (levelKillCount>=levelObjectiveKills) { soundManager.playSound('win'); loadLevel(2); }
            else { if (now-lastPortalMsgTime>1500) { showMiddleMessage(`ELIMINATE ${levelObjectiveKills-levelKillCount} MORE DEMONS!`,"red"); lastPortalMsgTime=now; } }
        } else if (currentLevel===2) {
            if (player.keys.red&&player.keys.blue&&player.keys.yellow) { soundManager.playSound('win'); loadLevel(3); }
            else { if (now-lastPortalMsgTime>1500) { showMiddleMessage("COLLECT ALL THREE KEYCARDS FIRST!","yellow"); lastPortalMsgTime=now; } }
        } else if (currentLevel===4) {
            if (player.runesCollected>=LEVEL4_RUNES_NEEDED) { soundManager.playSound('win'); loadLevel(5); }
            else { if (now-lastPortalMsgTime>1500) { showMiddleMessage(`FIND ${LEVEL4_RUNES_NEEDED-player.runesCollected} MORE RUNE STONES!`,"green"); lastPortalMsgTime=now; } }
        } else if (currentLevel===5) {
            if (wraithsKilled>=LEVEL5_WRAITHS_NEEDED) { triggerVictory(); }
            else { if (now-lastPortalMsgTime>1500) { showMiddleMessage(`DESTROY ALL ${LEVEL5_WRAITHS_NEEDED-wraithsKilled} REACTOR WRAITHS!`,"blue"); lastPortalMsgTime=now; } }
        }
    }

    // Portal Vanguard Ambush Trigger
    if (portalMesh && !portalVanguardTriggered) {
        const portalDist = portalMesh.position.distanceTo(yawObject.position);
        if (portalDist < 95) {
            portalVanguardTriggered = true;
            soundManager.playSound('boss_screamer');

            const px = portalMesh.position.x;
            const pz = portalMesh.position.z;
            const pCol = Math.floor(px / CELL_SIZE);
            const pRow = Math.floor(pz / CELL_SIZE);

            showMiddleMessage("PORTAL GUARDIANS AWOKEN! SURVIVE THE ESCAPE!", "red");

            let spawnedCount = 0;
            const offsets = [
                {x: -2, z: -2}, {x: 2, z: -2}, {x: -2, z: 2}, {x: 2, z: 2},
                {x: -3, z: 0}, {x: 3, z: 0}, {x: 0, z: -3}, {x: 0, z: 3}
            ];

            let enemyTypes = ['imp', 'soldier'];
            if (currentLevel === 1) enemyTypes = ['soldier'];
            else if (currentLevel === 2) enemyTypes = ['imp', 'pinky'];
            else if (currentLevel === 4) enemyTypes = ['pinky', 'soldier'];
            else if (currentLevel === 5) enemyTypes = ['wraith', 'pinky'];

            let maxAmbush = currentLevel === 1 ? 2 : currentLevel === 2 ? 3 : currentLevel === 4 ? 4 : 3;
            if (currentLevel !== 3) {
                for (let off of offsets) {
                    const r = pRow + off.z;
                    const c = pCol + off.x;
                    if (r > 0 && r < MAP_GRID.length - 1 && c > 0 && c < MAP_GRID[0].length - 1) {
                        if (MAP_GRID[r] && MAP_GRID[r][c] === 0) {
                            const enemyType = enemyTypes[Math.floor(Math.random() * enemyTypes.length)];
                            if (enemyType === 'wraith') {
                                spawnWraith(c, r);
                            } else {
                                spawnEnemy(enemyType, c, r);
                            }
                            spawnedCount++;
                            if (spawnedCount >= maxAmbush) break;
                        }
                    }
                }
            }
        }
    }
}

// --- DOOR INTERACTION ---
function interactDoor() {
    const forwardVec=new THREE.Vector3(0,0,-1).applyQuaternion(yawObject.quaternion).normalize();
    const checkDist=14;
    const targetX=yawObject.position.x+forwardVec.x*checkDist;
    const targetZ=yawObject.position.z+forwardVec.z*checkDist;
    const col=Math.floor(targetX/CELL_SIZE), row=Math.floor(targetZ/CELL_SIZE);
    if (row<0||row>=MAP_GRID.length||col<0||col>=MAP_GRID[0].length) return;
    const cellVal=MAP_GRID[row][col];
    if (cellVal>=4&&cellVal<=7) {
        const dr=doors.find(d=>d.col===col&&d.row===row);
        if (dr&&dr.state==='closed') {
            if (dr.type===5&&!player.keys.red) { soundManager.playSound('door_buzz'); showMiddleMessage("RED KEYCARD REQUIRED!","red"); return; }
            if (dr.type===6&&!player.keys.blue) { soundManager.playSound('door_buzz'); showMiddleMessage("BLUE KEYCARD REQUIRED!","blue"); return; }
            if (dr.type===7&&!player.keys.yellow) { soundManager.playSound('door_buzz'); showMiddleMessage("YELLOW KEYCARD REQUIRED!","yellow"); return; }
            dr.state='opening'; soundManager.playSound('door');
        }
    } else if (cellVal===9) {
        if (currentLevel===1) {
            if (levelKillCount>=levelObjectiveKills) { soundManager.playSound('win'); loadLevel(2); }
            else { soundManager.playSound('door_buzz'); showMiddleMessage(`ELIMINATE ${levelObjectiveKills-levelKillCount} MORE DEMONS!`,"red"); }
        } else if (currentLevel===2) {
            if (player.keys.red&&player.keys.blue&&player.keys.yellow) { soundManager.playSound('win'); loadLevel(3); }
            else { soundManager.playSound('door_buzz'); showMiddleMessage("COLLECT ALL THREE KEYCARDS FIRST!","yellow"); }
        } else if (currentLevel===4) {
            if (player.runesCollected>=LEVEL4_RUNES_NEEDED) { soundManager.playSound('win'); loadLevel(5); }
            else { soundManager.playSound('door_buzz'); showMiddleMessage(`FIND ${LEVEL4_RUNES_NEEDED-player.runesCollected} MORE RUNE STONES!`,"green"); }
        } else if (currentLevel===5) {
            if (wraithsKilled>=LEVEL5_WRAITHS_NEEDED) { triggerVictory(); }
            else { soundManager.playSound('door_buzz'); showMiddleMessage("DESTROY BOTH WRAITH COMMANDERS!","blue"); }
        }
    }
}

function showMiddleMessage(text, colorClass) {
    const overlay=document.getElementById('item-flash');
    overlay.style.backgroundColor='rgba(255,0,0,0.15)';
    overlay.style.opacity=1;
    setTimeout(()=>overlay.style.opacity=0,400);
    const msg=document.createElement('div');
    msg.style.position='absolute'; msg.style.top='40%'; msg.style.left='50%';
    msg.style.transform='translate(-50%,-50%)';
    const colors={red:'#ff3333',blue:'#5599ff',yellow:'#ffff33',green:'#33ff88',white:'#ffffff'};
    msg.style.color=colors[colorClass]||'#ffffff';
    msg.style.fontSize='14px'; msg.style.fontWeight='bold'; msg.style.fontFamily="'Press Start 2P',cursive";
    msg.innerText=text; msg.style.zIndex=15;
    document.getElementById('game-container').appendChild(msg);
    setTimeout(()=>msg.remove(),1600);
}

// --- WEAPONS & COMBAT ---
let nextShootTime=0, activeFiringFrames=0;

function shoot() {
    const now=performance.now();
    if (now<nextShootTime) return;
    const activeWep=WEAPONS_STATS[player.activeWeaponIdx];
    if (activeWep.ammoType!=='none') {
        if (player.ammo[activeWep.ammoType]<=0) { soundManager.playSound('door_buzz'); return; }
        player.ammo[activeWep.ammoType]--;
        updateHUDStats();
    }
    soundManager.playSound(activeWep.sound);
    nextShootTime=now+activeWep.delay;
    recoilPitch=Math.min(0.12, recoilPitch+0.04);
    activeFiringFrames=4;

    if (activeWep.key==='plasma') {
        spawnPlasmaBall();
    } else if (activeWep.key==='shotgun') {
        for(let i=0; i<5; i++) {
            const spreadX=(Math.random()-0.5)*0.08, spreadY=(Math.random()-0.5)*0.05;
            raycastAttack(spreadX, spreadY, activeWep.damage/4);
        }
    } else if (activeWep.key==='rocket') {
        spawnRocket();
    } else {
        raycastAttack(0, 0, activeWep.damage);
    }
}

function raycastAttack(spreadX, spreadY, damage) {
    const raycaster=new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(spreadX,spreadY), camera);
    raycaster.far=player.activeWeaponIdx===0?10:150;
    const enemyMeshes=enemies.filter(e=>e.state!=='dead').map(e=>e.mesh);
    const hitEnemies=raycaster.intersectObjects(enemyMeshes);
    const hitWalls=raycaster.intersectObjects(walls);
    let hitDoors=[];
    doors.forEach(d=>{ if(d.state==='closed'||d.state==='closing') hitDoors.push(...raycaster.intersectObject(d.mesh)); });
    let closestBlockedDist=Infinity;
    hitWalls.forEach(h=>{ if(h.distance<closestBlockedDist) closestBlockedDist=h.distance; });
    hitDoors.forEach(h=>{ if(h.distance<closestBlockedDist) closestBlockedDist=h.distance; });
    if (hitEnemies.length>0&&hitEnemies[0].distance<closestBlockedDist) {
        const targetMesh=hitEnemies[0].object;
        const enemyObj=enemies.find(e=>e.mesh===targetMesh);
        if (enemyObj) damageEnemy(enemyObj, damage, hitEnemies[0].point);
    }
}

function spawnPlasmaBall() {
    const geo=new THREE.SphereGeometry(0.6,6,6);
    const mat=new THREE.MeshBasicMaterial({color:0x00ffff});
    const mesh=new THREE.Mesh(geo,mat);
    const dir=new THREE.Vector3(0,0,-1).applyQuaternion(yawObject.quaternion).normalize();
    mesh.position.copy(yawObject.position); mesh.position.y-=1;
    scene.add(mesh);
    projectiles.push({mesh, direction:dir, speed:120.0, damage:24, isPlayer:true, isRocket:false});
}

function spawnRocket() {
    const geo=new THREE.CylinderGeometry(0.4,0.4,2,8);
    const mat=new THREE.MeshBasicMaterial({color:0xff6600});
    const mesh=new THREE.Mesh(geo,mat);
    const dir=new THREE.Vector3(0,0,-1).applyQuaternion(yawObject.quaternion).normalize();
    mesh.position.copy(yawObject.position); mesh.position.y-=1;
    // orient cylinder along travel direction
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dir);
    scene.add(mesh);
    projectiles.push({mesh, direction:dir, speed:70.0, damage:120, isPlayer:true, isRocket:true, splashRadius:18});
}

function rocketSplash(position, damage, splashRadius) {
    soundManager.playSound('explosion');
    spawnExplosionParticles(position, 30);
    // Damage all nearby living enemies
    enemies.forEach(e=>{
        if (e.state==='dead') return;
        const dist=position.distanceTo(e.mesh.position);
        if (dist<splashRadius) {
            const falloff=1-(dist/splashRadius);
            damageEnemy(e, damage*falloff, position);
        }
    });
    // Player self-damage if too close
    const playerDist=position.distanceTo(yawObject.position);
    if (playerDist<splashRadius*0.5) {
        const falloff=1-(playerDist/(splashRadius*0.5));
        playerTakeDamage(damage*falloff*0.4);
    }
}

function spawnExplosionParticles(position, count) {
    const geo=new THREE.SphereGeometry(0.5,4,4);
    const colors=[0xff6600,0xffaa00,0xffff00,0xff3300];
    for(let i=0; i<count; i++) {
        const mat=new THREE.MeshBasicMaterial({color:colors[Math.floor(Math.random()*colors.length)]});
        const mesh=new THREE.Mesh(geo,mat);
        mesh.position.copy(position);
        mesh.userData.velocity=new THREE.Vector3(
            (Math.random()-0.5)*20, Math.random()*16+4, (Math.random()-0.5)*20
        );
        scene.add(mesh); particles.push(mesh);
    }
}

function damageEnemy(enemy, amount, hitPoint) {
    if (enemy.state==='dead') return;
    enemy.health-=amount;
    enemy.state='hurt'; enemy.timer=0.15;
    soundManager.playSound('enemy_pain');
    spawnBlood(hitPoint||enemy.mesh.position, 8);

    if (enemy.type==='boss') {
        const pct=Math.max(0,(enemy.health/enemy.maxHealth)*100);
        document.getElementById('boss-health-bar').style.width=`${pct}%`;
    }

    if (enemy.health<=0) {
        enemy.state='dead';
        soundManager.playSound('enemy_death');
        spawnBlood(enemy.mesh.position, 25);
        registerKill(enemy.type);

        if (enemy.type==='boss') {
            document.getElementById('boss-hud').style.display='none';
            soundManager.playSound('win');
            // Boss defeated — transition to Level 4 (not final victory yet)
            showMiddleMessage("BOSS DEFEATED! DESCENDING DEEPER...", "green");
            setTimeout(() => {
                player.health = Math.min(100, player.health + 30); // reward HP
                player.armor  = Math.min(100, player.armor  + 20);
                loadLevel(4);
            }, 2500);
        } else if (enemy.isWraith) {
            wraithsKilled++;
            showMiddleMessage(`REACTOR WRAITH DESTROYED! (${wraithsKilled}/${LEVEL5_WRAITHS_NEEDED})`, "blue");
            dropLoot(enemy.mesh.position, 'medkit_forced');
            const desc=document.getElementById('level-objective');
            if (wraithsKilled>=LEVEL5_WRAITHS_NEEDED) {
                desc.innerText="CORE SHIELDS DOWN! SABOTAGE THE NEXUS CORE!";
                // Open all central core shield gates
                doors.forEach(dr => {
                    if (dr.type === 4) {
                        dr.state = 'opening';
                    }
                });
                soundManager.playSound('door');
                portalActive=true;
            }
        } else {
            levelKillCount++;
            updateObjectiveBoard();
            // Random drop (25% chance unless difficulty easy = 40%)
            const dropChance=difficulty==='easy'?0.40:0.25;
            if (Math.random()<dropChance) dropLoot(enemy.mesh.position, enemy.type);
        }
    }
}

function dropLoot(pos, type) {
    let lootType;
    if (type==='medkit_forced') { lootType='medkit'; }
    else if (type==='pinky') { lootType=Math.random()<0.5?'armor':'medkit'; }
    else if (type==='imp')   { lootType=Math.random()<0.5?'shells':'bullets'; }
    else { lootType=Math.random()<0.5?'bullets':'medkit'; }

    const mat=new THREE.SpriteMaterial({map:pickupTextures[lootType]});
    const sprite=new THREE.Sprite(mat);
    sprite.scale.set(5,5,1);
    sprite.position.copy(pos); sprite.position.y=2.5;
    scene.add(sprite);
    const col=Math.floor(pos.x/CELL_SIZE), row=Math.floor(pos.z/CELL_SIZE);
    pickups.push({mesh:sprite, type:lootType, col, row});
}

function spawnImpFireball(enemy) {
    const geo=new THREE.SphereGeometry(0.8,8,8);
    const mat=new THREE.MeshBasicMaterial({color:0xff4400});
    const mesh=new THREE.Mesh(geo,mat);
    mesh.position.copy(enemy.mesh.position); mesh.position.y=4;
    const dir=new THREE.Vector3().subVectors(yawObject.position,enemy.mesh.position).normalize();
    scene.add(mesh);
    const dm=enemy.dmgMult||1;
    projectiles.push({mesh, direction:dir, speed:48.0, damage:Math.round(22*dm), isPlayer:false, isRocket:false});
}

function spawnWraithBolt(enemy) {
    const geo=new THREE.SphereGeometry(1.0,8,8);
    const mat=new THREE.MeshBasicMaterial({color:0x00ddcc});
    const mesh=new THREE.Mesh(geo,mat);
    mesh.position.copy(enemy.mesh.position); mesh.position.y=5;
    const dir=new THREE.Vector3().subVectors(yawObject.position,enemy.mesh.position).normalize();
    scene.add(mesh);
    const dm=enemy.dmgMult||1;
    projectiles.push({mesh, direction:dir, speed:55.0, damage:Math.round(28*dm), isPlayer:false, isRocket:false});
}

function spawnBossMissile(enemy, angleOffset = 0) {
    const geo=new THREE.SphereGeometry(1.5,8,8);
    const mat=new THREE.MeshBasicMaterial({color:0xff00aa});
    const mesh=new THREE.Mesh(geo,mat);
    mesh.position.copy(enemy.mesh.position); mesh.position.y=8;
    const dir=new THREE.Vector3().subVectors(yawObject.position,enemy.mesh.position);
    dir.y=0;
    dir.normalize();
    if (angleOffset !== 0) {
        dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), angleOffset);
    }
    scene.add(mesh);
    const dm=enemy.dmgMult||1;
    projectiles.push({mesh, direction:dir, speed:58.0, damage:Math.round(32*dm), isPlayer:false, isRocket:false});
}

function spawnCircularProjectile(pos, angle, speed, damage) {
    const geo=new THREE.SphereGeometry(1.2,8,8);
    const mat=new THREE.MeshBasicMaterial({color:0xff3300});
    const mesh=new THREE.Mesh(geo,mat);
    mesh.position.copy(pos); mesh.position.y=6;
    const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).normalize();
    scene.add(mesh);
    projectiles.push({mesh, direction:dir, speed:speed, damage:damage, isPlayer:false, isRocket:false});
}

// --- PICKUPS ---
function updatePickups() {
    for(let i=pickups.length-1; i>=0; i--) {
        const item=pickups[i];
        const dist=item.mesh.position.distanceTo(yawObject.position);
        if (dist<6) {
            let collected=false;
            switch(item.type) {
                case 'medkit':   if(player.health<100){player.health=Math.min(100,player.health+25);collected=true;} break;
                case 'armor':    if(player.armor<100){player.armor=Math.min(100,player.armor+25);collected=true;} break;
                case 'bullets':  player.ammo.pistol=Math.min(200,player.ammo.pistol+30);collected=true; break;
                case 'shells':   player.ammo.shotgun=Math.min(50,player.ammo.shotgun+12);collected=true; break;
                case 'cells':    player.ammo.plasma=Math.min(300,player.ammo.plasma+60);collected=true; break;
                case 'rocket_ammo': player.ammo.rockets=Math.min(50,player.ammo.rockets+5);collected=true; showMiddleMessage("+5 ROCKETS","yellow"); break;
                case 'shotgun':
                    player.weaponsUnlocked[2]=true; player.ammo.shotgun=Math.min(50,player.ammo.shotgun+8);
                    collected=true; showMiddleMessage("YOU GOT THE SHOTGUN!","yellow"); break;
                case 'plasma':
                    player.weaponsUnlocked[3]=true; player.ammo.plasma=Math.min(300,player.ammo.plasma+60);
                    collected=true; showMiddleMessage("YOU GOT THE PLASMA RIFLE!","blue"); break;
                case 'rocket_gun':
                    player.weaponsUnlocked[4]=true; player.ammo.rockets=Math.min(50,player.ammo.rockets+10);
                    collected=true; showMiddleMessage("YOU GOT THE ROCKET LAUNCHER!","red"); break;
                case 'key_red':    player.keys.red=true; document.getElementById('red-key-card').classList.add('active'); collected=true; showMiddleMessage("RED KEYCARD PICKED UP","red"); break;
                case 'key_blue':   player.keys.blue=true; document.getElementById('blue-key-card').classList.add('active'); collected=true; showMiddleMessage("BLUE KEYCARD PICKED UP","blue"); break;
                case 'key_yellow': player.keys.yellow=true; document.getElementById('yellow-key-card').classList.add('active'); collected=true; showMiddleMessage("YELLOW KEYCARD PICKED UP","yellow"); break;
                case 'rune_stone':
                    player.runesCollected++;
                    collected=true;
                    soundManager.playSound('rune_pickup');
                    showMiddleMessage(`RUNE STONE ${player.runesCollected}/${LEVEL4_RUNES_NEEDED} COLLECTED!`,"green");
                    updateRuneHUD();
                    break;
                case 'scrap_metal':
                    player.inventory.scrap++;
                    collected=true;
                    showMiddleMessage("+1 SCRAP METAL", "white");
                    break;
                case 'energy_core':
                    player.inventory.cores++;
                    collected=true;
                    showMiddleMessage("+1 ENERGY CORE", "cyan");
                    break;
                case 'unstable_fuel':
                    player.inventory.fuel++;
                    collected=true;
                    showMiddleMessage("+1 UNSTABLE FUEL", "orange");
                    break;
            }
            if (collected) {
                if (item.type!=='rune_stone') soundManager.playSound('pickup');
                scene.remove(item.mesh); pickups.splice(i,1);
                const flash=document.getElementById('item-flash');
                flash.style.opacity=0.55; setTimeout(()=>flash.style.opacity=0,100);
                updateHUDStats();
            }
        }
    }
}

// --- PLAYER DAMAGE ---
function playerTakeDamage(amount) {
    if (isDead||isWin) return;
    if (player.armor>0) {
        const absorbed=amount*0.5;
        player.armor=Math.max(0,player.armor-absorbed);
        player.health=Math.max(0,player.health-(amount-absorbed));
    } else {
        player.health=Math.max(0,player.health-amount);
    }
    soundManager.playSound('player_pain');
    updateHUDStats();
    const overlay=document.getElementById('damage-overlay');
    overlay.style.opacity=0.65; setTimeout(()=>overlay.style.opacity=0,150);
    currentFaceExpr='wince'; faceTimer=0.8;
    triggerShake();
    if (player.health<=0) {
        isDead=true;
        showDeathScreen();
        document.exitPointerLock();
    }
}

function updateHUDStats() {
    const activeWep=WEAPONS_STATS[player.activeWeaponIdx];
    if (activeWep.ammoType==='none') {
        document.getElementById('ammo-val').innerText='---';
        document.getElementById('ammo-type').innerText='FST';
    } else {
        const map={pistol:['PIS',player.ammo.pistol],shotgun:['SHE',player.ammo.shotgun],plasma:['CEL',player.ammo.plasma],rockets:['RKT',player.ammo.rockets]};
        const [typeStr,val]=map[activeWep.ammoType]||['PIS',player.ammo.pistol];
        document.getElementById('ammo-val').innerText=val;
        document.getElementById('ammo-type').innerText=typeStr;
    }
    document.getElementById('health-val').innerText=Math.floor(player.health)+'%';
    document.getElementById('armor-val').innerText=Math.floor(player.armor)+'%';
}

function updateObjectiveBoard() {
    const desc=document.getElementById('level-objective');
    if (currentLevel===1) {
        if (levelKillCount>=levelObjectiveKills) {
            desc.innerText="PORTAL IS OPEN! Find the exit portal!"; portalActive=true;
        } else {
            desc.innerText=`Eliminate ${levelObjectiveKills-levelKillCount} Soldier Demons to open portal`;
        }
    }
}

function updateWeaponUI() {
    const weaponImg=document.getElementById('weapon-img');
    const flash=document.getElementById('flash');
    const wepName=WEAPONS_STATS[player.activeWeaponIdx].key;
    let frameKey=`${wepName}_idle`;
    flash.style.display='none';
    if (activeFiringFrames>0) {
        activeFiringFrames--;
        if (wepName==='fist') { frameKey=activeFiringFrames>2?'fist_punch1':'fist_punch2'; }
        else if (wepName==='pistol') { frameKey=activeFiringFrames>2?'pistol_fire1':'pistol_fire2'; if(activeFiringFrames>2) flash.style.display='block'; }
        else if (wepName==='shotgun') { frameKey=activeFiringFrames>2?'shotgun_fire':'shotgun_pump1'; if(activeFiringFrames>2) flash.style.display='block'; }
        else if (wepName==='plasma') { frameKey=activeFiringFrames>2?'plasma_fire1':'plasma_fire2'; if(activeFiringFrames>2) flash.style.display='block'; }
        else if (wepName==='rocket') { frameKey='rocket_fire'; flash.style.display='block'; }
    }
    const dataURL=weaponImages[frameKey];
    if (dataURL&&weaponImg.src!==dataURL) weaponImg.src=dataURL;
}

function checkLineOfSight(enemyPos, playerPos) {
    const from = enemyPos.clone();
    from.y = 8; // eye level height for standard walls
    const to = playerPos.clone();
    to.y = 8;
    
    const direction = new THREE.Vector3().subVectors(to, from);
    const distance = direction.length();
    direction.normalize();
    
    const raycaster = new THREE.Raycaster(from, direction, 0.1, distance);
    
    // Check hit walls
    const hitWalls = raycaster.intersectObjects(walls);
    if (hitWalls.length > 0) return false;
    
    // Check closed/closing doors
    let hitDoors = [];
    doors.forEach(d => {
        if (d.state === 'closed' || d.state === 'closing') {
            hitDoors.push(...raycaster.intersectObject(d.mesh));
        }
    });
    if (hitDoors.length > 0) return false;
    
    return true;
}

// --- ENEMY AI ---
function updateEnemies(delta, time) {
    enemies.forEach(enemy => {
        if (enemy.state==='dead') {
            if (enemy.mesh.material.map!==enemyTextures[`${enemy.type}_dead`]) {
                enemy.mesh.material.map=enemyTextures[`${enemy.type}_dead`];
                enemy.mesh.material.needsUpdate=true;
                enemy.mesh.position.y=0.5;
            }
            return;
        }

        // Cyber-Demon Boss Stage Modifiers
        if (enemy.type === 'boss') {
            const hpPct = enemy.health / enemy.maxHealth;
            if (hpPct > 0.66) {
                enemy.speed = 16.0;
                enemy.mesh.material.color.setHex(0xffffff);
            } else if (hpPct > 0.33) {
                enemy.speed = 22.0; // Stage 2: Rage speed boost
                enemy.mesh.material.color.setHex(0xffaa88);
            } else {
                enemy.speed = 25.0; // Stage 3: Overdrive speed
                // Pulsing red effect
                const pulseVal = Math.floor(180 + Math.sin(time * 0.015) * 75);
                const hexColor = (pulseVal << 16) | (50 << 8) | 50;
                enemy.mesh.material.color.setHex(hexColor);
            }
        }

        const dist=enemy.mesh.position.distanceTo(yawObject.position);
        enemy.timer-=delta;
        if (enemy.state==='hurt'&&enemy.timer<=0) enemy.state='chase';
        if (enemy.state==='idle') {
            if (dist<250) { enemy.state='chase'; enemy.timer=0; if(enemy.type==='boss'||enemy.isWraith) soundManager.playSound('boss_screamer'); }
            enemy.mesh.material.map=enemyTextures[`${enemy.type}_walk1`];
        } else if (enemy.state==='chase') {
            const walkFrame=Math.floor(time*0.006)%2===0?'walk1':'walk2';
            enemy.mesh.material.map=enemyTextures[`${enemy.type}_${walkFrame}`];
            const dir=new THREE.Vector3().subVectors(yawObject.position,enemy.mesh.position);
            dir.y=0; dir.normalize();
            
            // Lateral dodging logic
            if (enemy.dodgeTimer === undefined) {
                enemy.dodgeTimer = Math.random() * 2.0 + 1.0;
                enemy.dodgeDuration = 0;
                enemy.dodgeDir = 0;
            }
            enemy.dodgeTimer -= delta;
            if (enemy.dodgeTimer <= 0) {
                enemy.dodgeDir = Math.random() < 0.5 ? 1 : -1;
                enemy.dodgeDuration = 0.35; // dodge lasts 0.35s
                enemy.dodgeTimer = Math.random() * 2.5 + 2.0; // time until next allowed dodge
            }
            
            const rad=enemy.type==='boss'?8.0:enemy.isWraith?5.0:3.5;
            
            if (enemy.dodgeDuration > 0) {
                enemy.dodgeDuration -= delta;
                const leftX = -dir.z, leftZ = dir.x;
                const slideX = leftX * enemy.dodgeDir * 32.0 * delta;
                const slideZ = leftZ * enemy.dodgeDir * 32.0 * delta;
                let testX = enemy.mesh.position.x + slideX, testZ = enemy.mesh.position.z;
                if (!checkWallCollision(testX, testZ, rad).hit) enemy.mesh.position.x = testX;
                testX = enemy.mesh.position.x; testZ = enemy.mesh.position.z + slideZ;
                if (!checkWallCollision(testX, testZ, rad).hit) enemy.mesh.position.z = testZ;
            }

            const moveX=dir.x*enemy.speed*delta, moveZ=dir.z*enemy.speed*delta;
            let nextX=enemy.mesh.position.x+moveX, nextZ=enemy.mesh.position.z;
            if (!checkWallCollision(nextX,nextZ,rad).hit) enemy.mesh.position.x=nextX;
            nextX=enemy.mesh.position.x; nextZ=enemy.mesh.position.z+moveZ;
            if (!checkWallCollision(nextX,nextZ,rad).hit) enemy.mesh.position.z=nextZ;
            
            const minAttackDist=enemy.type==='pinky'?7.5:enemy.type==='boss'?85.0:enemy.isWraith?70.0:65.0;
            if (dist<minAttackDist&&enemy.timer<=0) {
                enemy.state='attack';
                enemy.timer=enemy.type==='pinky'?0.35:enemy.type==='boss'?0.8:0.9;
            }
        } else if (enemy.state==='attack') {
            enemy.mesh.material.map=enemyTextures[`${enemy.type}_attack`];
            if (enemy.timer<=0) {
                const dm=enemy.dmgMult||1;
                const hasLOS = checkLineOfSight(enemy.mesh.position, yawObject.position);

                if (hasLOS) {
                    if (enemy.type==='pinky')   { if(dist<8) playerTakeDamage(Math.round(18*dm)); }
                    else if (enemy.type==='imp') { spawnImpFireball(enemy); }
                    else if (enemy.type==='soldier') { soundManager.playSound('pistol'); if(dist<75) playerTakeDamage(Math.round(10*dm)); }
                    else if (enemy.isWraith)    { spawnWraithBolt(enemy); }
                    else if (enemy.type==='boss') {
                        const hpPct = enemy.health / enemy.maxHealth;
                        if (hpPct > 0.66) {
                            // Stage 1: Single Missile attack
                            spawnBossMissile(enemy, 0);
                            setTimeout(()=> { if (enemy.state !== 'dead') spawnBossMissile(enemy, 0); }, 180);
                        } else if (hpPct > 0.33) {
                            // Stage 2: Triple spread missile
                            spawnBossMissile(enemy, 0);
                            spawnBossMissile(enemy, -0.22);
                            spawnBossMissile(enemy, 0.22);
                        } else {
                            // Stage 3: Circular Burst + Rapid Rocket
                            for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
                                spawnCircularProjectile(enemy.mesh.position, angle, 48, Math.round(20*dm));
                            }
                            spawnBossMissile(enemy, 0);
                            setTimeout(()=> { if (enemy.state !== 'dead') spawnBossMissile(enemy, 0.12); }, 150);
                            setTimeout(()=> { if (enemy.state !== 'dead') spawnBossMissile(enemy, -0.12); }, 300);
                        }
                    }
                }
                enemy.state='chase';
                enemy.timer=enemy.type==='pinky'?0.2:enemy.type==='boss'?0.9:enemy.isWraith?0.7:1.1;
            }
        }
    });
}

function spawnBlood(position, count=10) {
    const geo=new THREE.BoxGeometry(0.4,0.4,0.4);
    const mat=new THREE.MeshBasicMaterial({color:0xff0055});
    for(let i=0; i<count; i++) {
        const mesh=new THREE.Mesh(geo,mat);
        mesh.position.copy(position);
        mesh.userData.velocity=new THREE.Vector3((Math.random()-0.5)*12, Math.random()*8+4, (Math.random()-0.5)*12);
        scene.add(mesh); particles.push(mesh);
    }
}

function spawnPortalSpark(position) {
    const geo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    const mat = new THREE.MeshBasicMaterial({color: 0xcc00ff});
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    mesh.position.x += (Math.random() - 0.5) * 6;
    mesh.position.z += (Math.random() - 0.5) * 6;
    mesh.position.y += Math.random() * 4;
    mesh.userData.velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        Math.random() * 10 + 6,
        (Math.random() - 0.5) * 2
    );
    scene.add(mesh);
    particles.push(mesh);
}

function updateParticles(delta) {
    for(let i=particles.length-1; i>=0; i--) {
        const p=particles[i];
        p.userData.velocity.y-=26*delta;
        p.position.addScaledVector(p.userData.velocity, delta);
        if (p.position.y<0.2) { scene.remove(p); particles.splice(i,1); }
    }
}

function updateProjectiles(delta) {
    for(let i=projectiles.length-1; i>=0; i--) {
        const proj=projectiles[i];
        proj.mesh.position.addScaledVector(proj.direction, proj.speed*delta);
        const coll=checkWallCollision(proj.mesh.position.x, proj.mesh.position.z, 0.8);
        if (coll.hit) {
            if (proj.isRocket) rocketSplash(proj.mesh.position.clone(), proj.damage, proj.splashRadius);
            scene.remove(proj.mesh); projectiles.splice(i,1); continue;
        }
        if (proj.isPlayer) {
            let hit=false;
            for(let e of enemies) {
                if (e.state==='dead') continue;
                const d=proj.mesh.position.distanceTo(e.mesh.position);
                const hitRad=e.type==='boss'?12:e.isWraith?7:5;
                if (d<hitRad) {
                    if (proj.isRocket) rocketSplash(proj.mesh.position.clone(), proj.damage, proj.splashRadius);
                    else damageEnemy(e, proj.damage, proj.mesh.position);
                    hit=true; break;
                }
            }
            if (hit) { scene.remove(proj.mesh); projectiles.splice(i,1); }
        } else {
            const d=proj.mesh.position.distanceTo(yawObject.position);
            if (d<5) { playerTakeDamage(proj.damage); scene.remove(proj.mesh); projectiles.splice(i,1); }
        }
    }
}

function updateDoors(delta) {
    doors.forEach(dr => {
        if (dr.state==='opening') {
            dr.mesh.position.y+=dr.speed*delta;
            if (dr.mesh.position.y>=26) { dr.mesh.position.y=26; dr.state='open'; dr.timer=4.0; }
        } else if (dr.state==='open') {
            dr.timer-=delta;
            if (dr.timer<=0) dr.state='closing';
        } else if (dr.state==='closing') {
            const px=yawObject.position.x, pz=yawObject.position.z;
            const dcX=dr.col*CELL_SIZE+CELL_SIZE/2, dcZ=dr.row*CELL_SIZE+CELL_SIZE/2;
            const dist=Math.sqrt((px-dcX)**2+(pz-dcZ)**2);
            if (dist<6.5) { dr.state='opening'; return; }
            dr.mesh.position.y-=dr.speed*delta;
            if (dr.mesh.position.y<=10) { dr.mesh.position.y=10; dr.state='closed'; }
        }
    });
}

// Animated torches update
function updateTorches(time) {
    torches.forEach(t => {
        t.light.intensity = t.baseIntensity + Math.sin(time*0.006+t.light.position.x)*0.35 + Math.random()*0.05;
    });
}

// --- CONTROLS ---
function onMouseMove(event) {
    if (!isLocked||isDead||isWin) return;
    const movementX=event.movementX||event.mozMovementX||event.webkitMovementX||0;
    const movementY=event.movementY||event.mozMovementY||event.webkitMovementY||0;
    yawObject.rotation.y-=movementX*0.0022;
    pitchObject.rotation.x-=movementY*0.0022;
    pitchObject.rotation.x=Math.max(-PI_2, Math.min(PI_2, pitchObject.rotation.x));
}

function onKeyDown(event) {
    if (event.code === 'KeyC' || event.code === 'KeyI') {
        toggleCraftingMenu();
        return;
    }
    if (isCraftingOpen) return;

    switch(event.code) {
        case 'ArrowUp':    case 'KeyW': moveForward=true; break;
        case 'ArrowLeft':  case 'KeyA': moveLeft=true; break;
        case 'ArrowDown':  case 'KeyS': moveBackward=true; break;
        case 'ArrowRight': case 'KeyD': moveRight=true; break;
        case 'KeyE': case 'Space': interactDoor(); break;
        case 'Digit1': selectWeapon(0); break;
        case 'Digit2': selectWeapon(1); break;
        case 'Digit3': selectWeapon(2); break;
        case 'Digit4': selectWeapon(3); break;
        case 'Digit5': selectWeapon(4); break;
    }
}

function onKeyUp(event) {
    if (isCraftingOpen) {
        moveForward=false; moveBackward=false; moveLeft=false; moveRight=false;
        return;
    }
    switch(event.code) {
        case 'ArrowUp':    case 'KeyW': moveForward=false; break;
        case 'ArrowLeft':  case 'KeyA': moveLeft=false; break;
        case 'ArrowDown':  case 'KeyS': moveBackward=false; break;
        case 'ArrowRight': case 'KeyD': moveRight=false; break;
    }
}

function onMouseDown() {
    if (isCraftingOpen) return;
    if (!isLocked&&!isDead&&!isWin) { document.body.requestPointerLock(); soundManager.init(); return; }
    if (isLocked&&!isDead&&!isWin) shoot();
}

function toggleCraftingMenu() {
    if (isDead || isWin) return;
    isCraftingOpen = !isCraftingOpen;
    const overlay = document.getElementById('crafting-overlay');
    if (isCraftingOpen) {
        overlay.style.display = 'flex';
        document.exitPointerLock();
        isLocked = false;
        // reset movement
        moveForward=false; moveBackward=false; moveLeft=false; moveRight=false;
        updateCraftingRecipesUI();
    } else {
        overlay.style.display = 'none';
        document.body.requestPointerLock();
    }
}

function updateCraftingRecipesUI() {
    document.getElementById('mat-scrap').innerText = player.inventory.scrap;
    document.getElementById('mat-cores').innerText = player.inventory.cores;
    document.getElementById('mat-fuel').innerText = player.inventory.fuel;

    const recipes = {
        shotgun: { scrap: 3, cores: 0, fuel: 1 },
        plasma:  { scrap: 2, cores: 2, fuel: 0 },
        rocket:  { scrap: 4, cores: 0, fuel: 2 },
        medkit:  { scrap: 1, cores: 1, fuel: 0 },
        armor:   { scrap: 2, cores: 1, fuel: 0 }
    };

    for (let item in recipes) {
        const cost = recipes[item];
        const canCraft = player.inventory.scrap >= cost.scrap &&
                         player.inventory.cores >= cost.cores &&
                         player.inventory.fuel >= cost.fuel;

        const card = document.getElementById('recipe-' + item);
        if (card) {
            const btn = card.querySelector('.craft-btn');
            if (canCraft) {
                btn.disabled = false;
                btn.style.opacity = 1.0;
                btn.style.cursor = 'pointer';
            } else {
                btn.disabled = true;
                btn.style.opacity = 0.4;
                btn.style.cursor = 'not-allowed';
            }
        }
    }
}

function craftItem(itemName) {
    const recipes = {
        shotgun: { scrap: 3, cores: 0, fuel: 1 },
        plasma:  { scrap: 2, cores: 2, fuel: 0 },
        rocket:  { scrap: 4, cores: 0, fuel: 2 },
        medkit:  { scrap: 1, cores: 1, fuel: 0 },
        armor:   { scrap: 2, cores: 1, fuel: 0 }
    };

    const cost = recipes[itemName];
    if (!cost) return;

    if (player.inventory.scrap >= cost.scrap &&
        player.inventory.cores >= cost.cores &&
        player.inventory.fuel >= cost.fuel) {

        player.inventory.scrap -= cost.scrap;
        player.inventory.cores -= cost.cores;
        player.inventory.fuel -= cost.fuel;

        if (itemName === 'shotgun') {
            player.weaponsUnlocked[2] = true;
            player.ammo.shotgun = Math.min(50, player.ammo.shotgun + 16);
            showMiddleMessage("CRAFTED SHOTGUN!", "yellow");
        } else if (itemName === 'plasma') {
            player.weaponsUnlocked[3] = true;
            player.ammo.plasma = Math.min(300, player.ammo.plasma + 120);
            showMiddleMessage("CRAFTED PLASMA RIFLE!", "blue");
        } else if (itemName === 'rocket') {
            player.weaponsUnlocked[4] = true;
            player.ammo.rockets = Math.min(50, player.ammo.rockets + 8);
            showMiddleMessage("CRAFTED ROCKET LAUNCHER!", "red");
        } else if (itemName === 'medkit') {
            player.health = 100;
            showMiddleMessage("CRAFTED MEGA MEDKIT (100% HEALTH)!", "green");
        } else if (itemName === 'armor') {
            player.armor = 100;
            showMiddleMessage("CRAFTED MEGA ARMOR (100% ARMOR)!", "blue");
        }

        soundManager.playSound('win');
        updateHUDStats();
        updateCraftingRecipesUI();
    } else {
        soundManager.playSound('door_buzz');
    }
}

function onMouseWheel(event) {
    if (!isLocked || isDead || isWin) return;
    let newIdx = player.activeWeaponIdx;
    if (event.deltaY > 0) {
        // Scroll down -> next weapon
        do {
            newIdx = (newIdx + 1) % WEAPONS_STATS.length;
        } while (!player.weaponsUnlocked[newIdx] && newIdx !== player.activeWeaponIdx);
    } else if (event.deltaY < 0) {
        // Scroll up -> previous weapon
        do {
            newIdx = (newIdx - 1 + WEAPONS_STATS.length) % WEAPONS_STATS.length;
        } while (!player.weaponsUnlocked[newIdx] && newIdx !== player.activeWeaponIdx);
    }
    if (newIdx !== player.activeWeaponIdx) {
        selectWeapon(newIdx);
    }
}

function selectWeapon(idx) {
    if (player.weaponsUnlocked[idx]) {
        player.activeWeaponIdx=idx;
        soundManager.playSound('pickup');
        updateHUDStats();
        currentFaceExpr='grin'; faceTimer=0.8;
    } else {
        soundManager.playSound('door_buzz');
    }
}

// --- VICTORY / DEATH SCREENS ---
function getElapsedTime() {
    const ms=performance.now()-gameStartTime;
    const s=Math.floor(ms/1000);
    const m=Math.floor(s/60);
    return `${m}:${String(s%60).padStart(2,'0')}`;
}

function buildStatHTML(statsArr) {
    return statsArr.map(([label, value])=>`
        <div class="end-stat">
            <span class="end-stat-label">${label}</span>
            <span class="end-stat-value">${value}</span>
        </div>
    `).join('');
}

function showDeathScreen() {
    document.getElementById('game-over').style.display='flex';
    document.getElementById('hud').style.display='none';
    document.getElementById('minimap-container').style.display='none';
    document.getElementById('level-hud').style.display='none';
    document.getElementById('boss-hud').style.display='none';
    document.getElementById('score-hud').style.display='none';
    const best=localStorage.getItem('doomjs_best')||'0';
    document.getElementById('game-over-stats').innerHTML=buildStatHTML([
        ['SCORE', score],['KILLS', totalKills],['LEVEL', currentLevel],['TIME', getElapsedTime()],['BEST', best]
    ]);
}

function respawn() {
    isDead = false;
    player.health = 100;
    player.armor = 50;
    // Reset keys
    player.keys = { red: false, blue: false, yellow: false };
    document.getElementById('red-key-card').classList.remove('active');
    document.getElementById('blue-key-card').classList.remove('active');
    document.getElementById('yellow-key-card').classList.remove('active');
    
    // Minimum pistol ammo guarantee
    if (player.ammo.pistol < 50) player.ammo.pistol = 50;
    
    document.getElementById('game-over').style.display = 'none';
    document.getElementById('hud').style.display = 'flex';
    document.getElementById('minimap-container').style.display = 'block';
    document.getElementById('level-hud').style.display = 'flex';
    document.getElementById('score-hud').style.display = 'flex';
    
    loadLevel(currentLevel);
    document.body.requestPointerLock();
}

function showVictoryScreen() {
    document.getElementById('level-win').style.display='flex';
    document.getElementById('hud').style.display='none';
    document.getElementById('score-hud').style.display='none';
    document.exitPointerLock();
    const best=localStorage.getItem('doomjs_best')||'0';
    document.getElementById('win-stats').innerHTML=buildStatHTML([
        ['SCORE', score],['KILLS', totalKills],['TIME', getElapsedTime()],['BEST', best]
    ]);
}

function triggerVictory() {
    if (isWin) return;
    isWin=true;
    soundManager.playSound('win');
    document.getElementById('win-message').innerText='You purged the Nexus Core. The nightmare ends.';
    showVictoryScreen();
}

// --- MINIMAP ---
function updateMinimap() {
    minimapCtx.fillStyle='rgba(10,5,10,0.85)'; minimapCtx.fillRect(0,0,150,150);
    const mapScale=0.45, centerX=75, centerY=75;
    for(let r=0; r<MAP_GRID.length; r++) {
        for(let c=0; c<MAP_GRID[r].length; c++) {
            const val=MAP_GRID[r][c];
            if (val===0) continue;
            const dx=(c*CELL_SIZE+CELL_SIZE/2-player.x)*mapScale;
            const dy=(r*CELL_SIZE+CELL_SIZE/2-player.z)*mapScale;
            if (Math.abs(dx)<70&&Math.abs(dy)<70) {
                if ([1,2,3,8,11].includes(val)) minimapCtx.fillStyle='#4c5d64';
                else if (val===12) minimapCtx.fillStyle='#00aaff';
                else if (val>=4&&val<=7) {
                    const dr=doors.find(d=>d.col===c&&d.row===r);
                    minimapCtx.fillStyle=(dr&&dr.mesh.position.y>15)?'#003c00':'#bb0000';
                } else if (val===9) minimapCtx.fillStyle='#9900ff';
                else if (val===10) minimapCtx.fillStyle='#ff3300';
                minimapCtx.fillRect(centerX+dx-3, centerY+dy-3, 6, 6);
            }
        }
    }
    minimapCtx.fillStyle='#ff0033';
    enemies.forEach(e=>{
        if (e.state==='dead') return;
        const dx=(e.mesh.position.x-player.x)*mapScale;
        const dy=(e.mesh.position.z-player.z)*mapScale;
        if (Math.abs(dx)<70&&Math.abs(dy)<70) {
            const dotColor=e.isWraith?'#00ddcc':e.type==='boss'?'#ff00aa':'#ff0033';
            minimapCtx.fillStyle=dotColor;
            minimapCtx.fillRect(centerX+dx-2, centerY+dy-2, 4, 4);
        }
    });
    minimapCtx.fillStyle='#00ffcc'; minimapCtx.beginPath();
    minimapCtx.arc(centerX,centerY,4,0,Math.PI*2); minimapCtx.fill();
    const dir=new THREE.Vector3(0,0,-1).applyQuaternion(yawObject.quaternion);
    minimapCtx.strokeStyle='#00ffcc'; minimapCtx.lineWidth=2;
    minimapCtx.beginPath(); minimapCtx.moveTo(centerX,centerY);
    minimapCtx.lineTo(centerX+dir.x*12, centerY+dir.z*12); minimapCtx.stroke();
}

// --- INITIALIZATION ---
function init() {
    sceneTextures = buildTextures();
    pickupTextures = buildPickupTextures();
    enemyTextures  = buildEnemyTextures();
    weaponImages   = buildWeaponHUDCanvasses();

    // Add rune HUD to HTML dynamically
    const runeHud=document.createElement('div');
    runeHud.id='rune-hud';
    runeHud.style.display='none';
    runeHud.innerHTML=`<span>RUNES</span><div style="display:flex;gap:6px;margin-top:4px;">
        <span class="rune-icon" id="rune-0"></span>
        <span class="rune-icon" id="rune-1"></span>
        <span class="rune-icon" id="rune-2"></span>
    </div>`;
    document.getElementById('game-container').appendChild(runeHud);

    drawHUDFace(player.health);

    scene=new THREE.Scene();
    scene.background=new THREE.Color(0x0e0202);
    scene.fog=new THREE.FogExp2(0x0e0202, 0.015);

    const skyGeo=new THREE.SphereGeometry(600,32,16);
    const skyMat=new THREE.MeshBasicMaterial({map:sceneTextures.sky_hell, side:THREE.BackSide, fog:false});
    const skyMesh=new THREE.Mesh(skyGeo,skyMat); scene.add(skyMesh);

    const ambient=new THREE.AmbientLight(0x2d1a3a); scene.add(ambient);

    camera=new THREE.PerspectiveCamera(65, window.innerWidth/window.innerHeight, 0.1, 1000);
    pitchObject=new THREE.Object3D(); pitchObject.add(camera);
    yawObject=new THREE.Object3D(); yawObject.position.set(player.x,8,player.z); yawObject.add(pitchObject);
    scene.add(yawObject);

    playerLight=new THREE.PointLight(0xffaaff,1.2,70);
    playerLight.position.set(0,4,0); yawObject.add(playerLight);

    renderer=new THREE.WebGLRenderer({antialias:true});
    renderer.setSize(window.innerWidth,window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2.0));
    document.getElementById('game-container').appendChild(renderer.domElement);

    loadLevel(1);
    updateWeaponUI();

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    window.addEventListener('wheel', onMouseWheel);
    window.addEventListener('resize', onWindowResize);

    document.getElementById('start-btn').addEventListener('click', ()=>{
        document.body.requestPointerLock();
        soundManager.init();
        gameStartTime=performance.now();
    });

    document.addEventListener('pointerlockchange', ()=>{
        isLocked=document.pointerLockElement===document.body;
        const menu=document.getElementById('start-screen');
        if (isLocked) {
            menu.classList.add('hidden');
            if (gameStartTime===0) gameStartTime=performance.now();
            // Close crafting menu if pointer lock is re-acquired from clicking game canvas
            if (isCraftingOpen) {
                isCraftingOpen = false;
                document.getElementById('crafting-overlay').style.display = 'none';
            }
        } else {
            if (!isDead&&!isWin&&!isCraftingOpen) {
                menu.classList.remove('hidden');
                document.getElementById('menu-title').innerText='PAUSED';
                document.getElementById('start-btn').innerText='RESUME';
            }
        }
    });

    // Show best score on start screen
    const best=localStorage.getItem('doomjs_best');
    if (best&&parseInt(best)>0) {
        document.getElementById('best-score-display').innerText=`BEST SCORE: ${best}`;
    }

    // Custom enemy face upload
    document.getElementById('custom-enemy-input').addEventListener('change', function(e){
        const file=e.target.files[0]; if(!file) return;
        const reader=new FileReader();
        reader.onload=function(event){
            const img=new Image(); img.src=event.target.result;
            img.onload=function(){
                const customTex=new THREE.Texture(img);
                customTex.magFilter=THREE.NearestFilter; customTex.needsUpdate=true;
                enemyTextures.soldier_walk1=customTex; enemyTextures.soldier_walk2=customTex; enemyTextures.soldier_attack=customTex;
                enemies.forEach(en=>{ if(en.type==='soldier'){ en.mesh.material.map=customTex; en.mesh.material.needsUpdate=true; } });
                alert("Custom Face uploaded as Soldier Demon!");
            };
        };
        reader.readAsDataURL(file);
    });
}

// --- GAME LOOP ---
function animate() {
    requestAnimationFrame(animate);
    const time=performance.now();
    const delta=Math.min((time-prevTime)/1000,0.1);

    if ((isLocked || isCraftingOpen) && !isDead && !isWin) {
        if (!isCraftingOpen) {
            updatePlayerMovement(delta);
            updateEnemies(delta, time);
            updateProjectiles(delta);
            updateDoors(delta);
            updateParticles(delta);
            updatePickups();
            updateTorches(time);
        }

        // Animate dimensional portal
        if (portalMesh) {
            portalMesh.children[0].rotation.z += 1.8 * delta;
            portalMesh.children[0].rotation.y += 0.4 * delta;
            if (portalActive) {
                portalMesh.children[1].material.color.setHex(0xcc00ff);
                portalMesh.children[1].material.opacity = 0.75 + Math.sin(time * 0.015) * 0.15;
                if (portalLight) {
                    portalLight.color.setHex(0xcc00ff);
                    portalLight.intensity = 2.2 + Math.sin(time * 0.02) * 0.6;
                }
                if (Math.random() < 0.18) {
                    spawnPortalSpark(portalMesh.position);
                }
            } else {
                portalMesh.children[1].material.color.setHex(0x220044);
                portalMesh.children[1].material.opacity = 0.35 + Math.sin(time * 0.005) * 0.05;
                if (portalLight) {
                    portalLight.color.setHex(0x440077);
                    portalLight.intensity = 0.8;
                }
            }
        }

        // Streak message timer
        if (streakMsgTimer>0) {
            streakMsgTimer-=delta;
            if (streakMsgTimer<=0) { document.getElementById('streak-msg').innerText=''; }
        }

        faceTimer-=delta;
        if (faceTimer<=0) {
            faceTimer=Math.random()*1.5+1.0;
            const r=Math.random();
            if (r<0.2) currentFaceExpr='look_left';
            else if (r<0.4) currentFaceExpr='look_right';
            else currentFaceExpr='idle';
        }
        drawHUDFace(player.health, currentFaceExpr);

        recoilPitch=Math.max(0, recoilPitch-0.7*delta);
        camera.rotation.x=recoilPitch;

        if (moveForward||moveBackward||moveLeft||moveRight) {
            const bobX=Math.sin(time*0.010)*6, bobY=Math.abs(Math.cos(time*0.010))*4;
            document.getElementById('weapon-img').style.transform=`translate(${bobX}px,${bobY}px)`;
        } else {
            document.getElementById('weapon-img').style.transform='translate(0px,0px)';
        }

        updateWeaponUI();
        renderer.render(scene, camera);
        updateMinimap();
    }
    prevTime=time;
}

function onWindowResize() {
    camera.aspect=window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth,window.innerHeight);
}

// Start!
init();
animate();